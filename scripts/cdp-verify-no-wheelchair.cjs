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
// Verify wheelchair mode removed + widgets migrated into settings dialog.
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

  await ev(`(async () => {
    const deadline = Date.now() + 90000
    while (Date.now() < deadline) { if (document.querySelector('.launcher-surface-host')) return true; await new Promise(r => setTimeout(r, 500)) }
    return false
  })()`)

  await ev(`(async () => { const d = document.querySelector('[aria-label="首次使用引导"]'); if (d) { const c = d.querySelector('[aria-label="关闭引导"]'); if (c) c.click(); await new Promise(r => setTimeout(r, 700)) } return true })()`)

  report.launcher = await ev(`(() => ({
    wheelchairAbsent: !document.querySelector('.wheelchair-mode') && !document.querySelector('.wheelchair-surface-host'),
    launcherHomePresent: !!document.querySelector('.launcher-home .instance-switcher'),
    hasWebRuntimeButton: !!Array.from(document.querySelectorAll('.launcher-nav-actions button')).find(b => /Web 工作台/.test(b.textContent || '')),
  }))()`)

  report.settings = await ev(`(async () => {
    const manage = Array.from(document.querySelectorAll('.launcher-nav-actions button')).find(b => /管理/.test(b.textContent || ''))
    if (manage) manage.click()
    const deadline = Date.now() + 20000
    while (Date.now() < deadline) { if (document.querySelector('.side-navigation [aria-label="启动器设置"]')) break; await new Promise(r => setTimeout(r, 300)) }
    const btn = document.querySelector('.side-navigation [aria-label="启动器设置"]')
    if (!btn) return { opened: false }
    btn.click()
    const d = Date.now() + 15000
    while (Date.now() < d) { if (document.querySelector('.settings-dialog')) break; await new Promise(r => setTimeout(r, 300)) }
    const dialog = document.querySelector('.settings-dialog')
    if (!dialog) return { opened: false }
    const text = (dialog.textContent || '').replace(/\\s+/g, ' ')
    return {
      opened: true,
      widgetZonePresent: !!dialog.querySelector('.widget-zone'),
      widgetCardCount: dialog.querySelectorAll('.widget-card').length,
      overviewHeading: /概览/.test(text),
    }
  })()`)

  const l = report.launcher
  const s = report.settings
  report.verdict = {
    wheelchairRemoved: l.wheelchairAbsent === true,
    launcherHomeClassic: l.launcherHomePresent === true && l.hasWebRuntimeButton === true,
    settingsOpens: s.opened === true,
    widgetsMigratedToSettings: s.widgetZonePresent === true && (s.widgetCardCount || 0) > 0,
    overviewSectionPresent: s.overviewHeading === true,
  }
  report.verdict.PASS = Object.entries(report.verdict).every(([key, value]) => key === 'PASS' || value === true)

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  ws.close()
  if (!report.verdict.PASS) process.exitCode = 2
}

main().catch(e => { process.stderr.write(`ERROR: ${(e && e.stack) || e}\n`); process.exitCode = 1 })
