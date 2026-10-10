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
// Verify the guide toggle inside the Settings UI: it must share the same storage key as
// the guide's own checkbox, and flipping it must actually persist.
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
  // The frameless window has a second data: page used only for the drop shadow; it has no app
  // DOM. Selecting the first page target picks that shadow layer and reports an empty body.
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
    while (Date.now() < deadline) { if (document.querySelector('.launcher-surface-host')) return { ready: true } ; await new Promise(r => setTimeout(r, 500)) }
    return { ready: false }
  })()`)

  // Close the first-run guide if it is showing, so it cannot swallow clicks.
  report.guideClosed = await ev(`(async () => {
    const dlg = document.querySelector('[aria-label="首次使用引导"]')
    if (!dlg) return { wasOpen: false }
    const btn = dlg.querySelector('[aria-label="关闭引导"]')
    if (btn) btn.click()
    await new Promise(r => setTimeout(r, 600))
    return { wasOpen: true, nowClosed: !document.querySelector('[aria-label="首次使用引导"]') }
  })()`)

  // Enter the manager surface, then open Settings.
  report.entered = await ev(`(async () => {
    const managerVisible = () => { const m = document.querySelector('.manager-surface-host'); return !!m && !m.classList.contains('view-hidden') }
    if (!managerVisible()) {
      const manage = Array.from(document.querySelectorAll('.launcher-utility-button')).find(b => /管理/.test(b.textContent || ''))
      if (manage) { manage.click(); await new Promise(r => setTimeout(r, 1600)) }
    }
    const settings = document.querySelector('[aria-label="启动器设置"]')
    if (settings) { settings.click(); await new Promise(r => setTimeout(r, 1600)) }
    return { managerVisible: managerVisible(), settingsButtonFound: !!settings }
  })()`)

  report.panel = await ev(`(async () => {
    const deadline = Date.now() + 20000
    let label = null
    while (Date.now() < deadline) {
      label = document.querySelector('[aria-label="使用引导设置"]')
      if (label) break
      await new Promise(r => setTimeout(r, 400))
    }
    const dialog = document.querySelector('.settings-dialog')
    if (!label || !dialog) return { found: false, dialogPresent: !!dialog, labelPresent: !!label }
    const box = label.querySelector('input[type="checkbox"]')
    // The open button is a sibling of the check-field label, not a descendant.
    const openBtn = dialog.querySelector('[aria-label="立即打开使用引导"]')
    const flag = () => { try { return window.localStorage.getItem('dsh-launcher:first-run-guide') } catch { return 'unavailable' } }
    const before = { checked: box ? box.checked : null, flag: flag() }
    if (box) box.click()
    await new Promise(r => setTimeout(r, 400))
    const afterOff = { checked: box ? box.checked : null, flag: flag() }
    if (box) box.click()
    await new Promise(r => setTimeout(r, 400))
    const afterOn = { checked: box ? box.checked : null, flag: flag() }
    let opened = false
    if (openBtn) {
      openBtn.click()
      await new Promise(r => setTimeout(r, 1000))
      opened = !!document.querySelector('[aria-label="首次使用引导"]')
    }
    return {
      found: true,
      hasSwitch: !!box,
      hasOpenButton: !!openBtn,
      sectionTitle: (dialog.textContent || '').includes('使用引导'),
      before, afterOff, afterOn,
      openButtonShowsGuide: opened,
      dialogClosedByOpenButton: !document.querySelector('.settings-dialog'),
      flagAfterOpen: flag(),
    }
  })()`)

  const p = report.panel || {}
  report.verdict = {
    panelInSettings: !!p.found,
    hasSwitchAndButton: !!(p.hasSwitch && p.hasOpenButton),
    offPersistsDismissed: !!(p.afterOff && p.afterOff.checked === false && p.afterOff.flag === 'dismissed'),
    onClearsFlag: !!(p.afterOn && p.afterOn.checked === true && (p.afterOn.flag === null || p.afterOn.flag === 'undefined')),
    openButtonReopensGuide: !!p.openButtonShowsGuide,
  }
  report.verdict.PASS = Object.entries(report.verdict).every(([key, value]) => key === 'PASS' || value === true)

  // Leave the guide armed so the user still gets the first-run experience.
  await ev(`(() => { try { window.localStorage.removeItem('dsh-launcher:first-run-guide') } catch {} const d = document.querySelector('[aria-label="首次使用引导"]'); if (d) { const c = d.querySelector('[aria-label="关闭引导"]'); if (c) c.click() } return true })()`)

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  ws.close()
  if (!report.verdict.PASS) process.exitCode = 2
}

main().catch(e => { process.stderr.write(`ERROR: ${(e && e.stack) || e}\n`); process.exitCode = 1 })
