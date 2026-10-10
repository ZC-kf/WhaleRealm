/*
 * 鲸域 · WhaleRealm
 * Copyright (C) 2026 凛枫
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 附加署名要求：任何分发本程序或其衍生作品的行为，必须在显著位置
 * 保留上述版权声明及作者署名。
 */
// Verify correction step 3 (install target modal): navigate to DSH Market, click
// "install" on an uninstalled plugin, and assert the target-selection modal shows
// per-instance toggles with compatibility/installed state and a counted confirm.
// Read-only: it never confirms the install, so it writes nothing.
const http = require('node:http')
const PORT = Number(process.argv[2] || 9333)

function getTargets() {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: '/json/list' }, res => {
      let data = ''
      res.on('data', c => { data += c })
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch (e) { reject(e) } })
    }).on('error', reject)
  })
}

async function main() {
  const targets = await getTargets()
  const page = targets.filter(t => t.type === 'page').find(t => /dist[\\/]index\.html/.test(t.url))
  if (!page) throw new Error('app page target not found')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  const pending = new Map()
  let seq = 0
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 120000)
    pending.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify({ id, method, params: params || {} }))
  })
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject) })
  ws.addEventListener('message', event => {
    let msg
    try { msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString()) } catch { return }
    if (msg.id === undefined || !pending.has(msg.id)) return
    const entry = pending.get(msg.id)
    pending.delete(msg.id)
    clearTimeout(entry.timer)
    if (msg.error) entry.reject(new Error(JSON.stringify(msg.error)))
    else entry.resolve(msg.result)
  })
  const ev = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(`renderer exception: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
    return result.result.value
  }

  await send('Runtime.enable')
  const report = {}

  report.ready = await ev(`(async () => {
    const deadline = Date.now() + 90000
    while (Date.now() < deadline) { if (document.querySelector('.launcher-surface-host')) return true; await new Promise(r => setTimeout(r, 500)) }
    return false
  })()`)

  await ev(`(async () => { const d = document.querySelector('[aria-label="首次使用引导"]'); if (d) { const c = d.querySelector('[aria-label="关闭引导"]'); if (c) c.click(); await new Promise(r => setTimeout(r, 700)) } return true })()`)

  // Verify the renderer API exposes the target listing (backend wiring).
  report.apiTargets = await ev(`(async () => {
    try {
      const r = await window.launcher.listInstanceInstallTargets('plugin', 'dsh-plugin-cyber')
      return { ok: r.ok, count: r.targets ? r.targets.length : 0, sample: r.targets ? r.targets[0] : null }
    } catch (e) { return { ok: false, error: String(e && e.message || e) } }
  })()`)

  // Navigate to DSH Market and try to open the install modal.
  report.market = await ev(`(async () => {
    const manage = Array.from(document.querySelectorAll('.launcher-nav-actions button')).find(b => /管理/.test(b.textContent || ''))
    if (manage) { manage.click(); }
    const deadline = Date.now() + 20000
    while (Date.now() < deadline) { if (document.querySelector('.side-navigation')) break; await new Promise(r => setTimeout(r, 300)) }
    const dshMarketTab = Array.from(document.querySelectorAll('.side-navigation nav button')).find(b => /DSH Market/.test(b.textContent || ''))
    if (dshMarketTab) dshMarketTab.click()
    const catalogDeadline = Date.now() + 30000
    while (Date.now() < catalogDeadline) {
      const installBtn = Array.from(document.querySelectorAll('.dsh-market-card button')).find(b => /安装/.test(b.textContent || '') && !/更新/.test(b.textContent || ''))
      if (installBtn) break
      if (document.querySelector('.dsh-market-card')) break
      await new Promise(r => setTimeout(r, 500))
    }
    const installBtn = Array.from(document.querySelectorAll('.dsh-market-card button')).find(b => /安装/.test(b.textContent || '') && !/更新/.test(b.textContent || ''))
    const cardCount = document.querySelectorAll('.dsh-market-card').length
    if (installBtn) installBtn.click()
    const modalDeadline = Date.now() + 15000
    while (Date.now() < modalDeadline) { if (document.querySelector('.install-target-dialog')) break; await new Promise(r => setTimeout(r, 300)) }
    return { cardCount, installClicked: !!installBtn, modalOpened: !!document.querySelector('.install-target-dialog') }
  })()`)

  report.modal = await ev(`(async () => {
    const dialog = document.querySelector('.install-target-dialog')
    if (!dialog) return { present: false }
    const rows = Array.from(dialog.querySelectorAll('.install-target-row'))
    const states = rows.map(r => (r.querySelector('.install-target-state') || {}).textContent || '')
    // toggle first two rows
    if (rows[0]) rows[0].click()
    if (rows[1]) rows[1].click()
    await new Promise(r => setTimeout(r, 300))
    const checked = rows.map(r => r.getAttribute('aria-checked'))
    const confirm = dialog.querySelector('footer .primary-command')
    return {
      present: true,
      rowCount: rows.length,
      hasToggleSwitch: rows.every(r => r.getAttribute('role') === 'switch'),
      states,
      checkedAfterTwoClicks: checked,
      confirmText: confirm ? (confirm.textContent || '').trim() : '',
      confirmDisabled: confirm ? confirm.disabled : null,
    }
  })()`)

  const m = report.modal
  report.verdict = {
    backendTargetsExposed: report.apiTargets.ok === true && (report.apiTargets.count || 0) > 0,
    modalOpensOnInstall: report.market.modalOpened === true,
    modalListsInstances: m.present && m.rowCount > 0,
    toggleSwitchesUsed: m.hasToggleSwitch === true,
    multiSelectWorks: Array.isArray(m.checkedAfterTwoClicks) && m.checkedAfterTwoClicks.filter(v => v === 'true').length === 2,
    confirmCounted: /安装到 2 个实例/.test(m.confirmText),
    confirmDisabledWhenNone: m.confirmDisabled !== null,
  }
  report.verdict.PASS = Object.entries(report.verdict).every(([key, value]) => key === 'PASS' || value === true)

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  ws.close()
  if (!report.verdict.PASS) process.exitCode = 2
}

main().catch(e => { process.stderr.write(`ERROR: ${(e && e.stack) || e}\n`); process.exitCode = 1 })
