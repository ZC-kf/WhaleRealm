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
// Verify correction step 2 (Web runtime demoted to a hideable tab):
//  1) launcher home is instance-only (no Web runtime controls mixed in),
//  2) "Web 工作台" / "管理" nav buttons are present,
//  3) clicking "Web 工作台" opens the manager surface WebRuntimeView,
//  4) the sidebar exposes a "Web 工作台" tab,
//  5) the settings dialog exposes the "隐藏 Web 工作台 标签" toggle.
// Read-only: no import/start, no settings save.
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
    while (Date.now() < deadline) { if (document.querySelector('.launcher-surface-host')) return { ready: true }; await new Promise(r => setTimeout(r, 500)) }
    return { ready: false }
  })()`)

  await ev(`(async () => { const d = document.querySelector('[aria-label="首次使用引导"]'); if (d) { const c = d.querySelector('[aria-label="关闭引导"]'); if (c) c.click(); await new Promise(r => setTimeout(r, 700)) } return true })()`)

  report.launcherHome = await ev(`(() => {
    const home = document.querySelector('.launcher-home')
    const textOf = el => (el && (el.textContent || '')) || ''
    const navBtns = Array.from(document.querySelectorAll('.launcher-nav-actions button')).map(textOf)
    return {
      homePresent: !!home,
      instanceSwitcherPresent: !!home.querySelector('.instance-switcher'),
      // 首屏不应再混入 Web 运行时控制
      webRuntimeControlsLeaked: !!(home.querySelector('.launcher-start-button') || home.querySelector('.launcher-runtime-state') || home.querySelector('.launcher-title-block')),
      navButtons: navBtns,
      hasWebRuntimeButton: navBtns.some(t => /Web 工作台/.test(t)),
      hasManageButton: navBtns.some(t => /管理/.test(t)),
    }
  })()`)

  // Click "Web 工作台" and wait for the manager WebRuntimeView.
  report.navigation = await ev(`(async () => {
    const btn = Array.from(document.querySelectorAll('.launcher-nav-actions button')).find(b => /Web 工作台/.test(b.textContent || ''))
    if (!btn) return { clicked: false }
    btn.click()
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) { if (document.querySelector('.web-runtime-view')) break; await new Promise(r => setTimeout(r, 300)) }
    return { clicked: true, webRuntimeViewRendered: !!document.querySelector('.web-runtime-view') }
  })()`)

  report.webRuntime = await ev(`(() => {
    const view = document.querySelector('.web-runtime-view')
    const textOf = el => (el && (el.textContent || '')) || ''
    if (!view) return { present: false }
    const startBtn = view.querySelector('.launcher-start-button')
    const apiBtn = Array.from(view.querySelectorAll('button')).find(b => /API 配置/.test(b.textContent || ''))
    return {
      present: true,
      startButtonPresent: !!startBtn,
      startButtonText: textOf(startBtn),
      runtimeStatePresent: !!view.querySelector('.launcher-runtime-state'),
      profileRowPresent: !!view.querySelector('.launcher-profile-row'),
      apiConfigPresent: !!apiBtn,
      titlePresent: !!view.querySelector('.launcher-title-block h1'),
    }
  })()`)

  report.sidebar = await ev(`(() => {
    const nav = document.querySelector('.side-navigation nav')
    const labels = nav ? Array.from(nav.querySelectorAll('button')).map(b => (b.textContent || '').trim()) : []
    return { sidebarPresent: !!nav, webRuntimeTabPresent: labels.some(t => /Web 工作台/.test(t)) }
  })()`)

  // Open settings and assert the hide toggle exists (do not save).
  report.settings = await ev(`(async () => {
    const settingsBtn = document.querySelector('.side-navigation [aria-label="启动器设置"]')
    if (!settingsBtn) return { opened: false }
    settingsBtn.click()
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) { if (document.querySelector('.settings-dialog')) break; await new Promise(r => setTimeout(r, 300)) }
    const dialog = document.querySelector('.settings-dialog')
    if (!dialog) return { opened: false }
    const text = dialog.textContent || ''
    return { opened: true, hideTogglePresent: /隐藏.*Web 工作台.*标签/.test(text.replace(/\\s+/g, ' ')) }
  })()`)

  const h = report.launcherHome
  const n = report.navigation
  const w = report.webRuntime
  const s = report.sidebar
  const st = report.settings
  report.verdict = {
    launcherHomeInstanceOnly: h.homePresent && h.instanceSwitcherPresent && !h.webRuntimeControlsLeaked,
    navButtonsPresent: h.hasWebRuntimeButton && h.hasManageButton,
    webRuntimeOpensAsTab: n.clicked === true && n.webRuntimeViewRendered === true,
    webRuntimeControlsIntact: w.present && w.startButtonPresent && w.runtimeStatePresent && w.profileRowPresent && w.apiConfigPresent && w.titlePresent,
    sidebarHasWebRuntimeTab: s.sidebarPresent && s.webRuntimeTabPresent,
    hideSettingPresent: st.opened === true && st.hideTogglePresent === true,
  }
  report.verdict.PASS = Object.entries(report.verdict).every(([key, value]) => key === 'PASS' || value === true)

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  ws.close()
  if (!report.verdict.PASS) process.exitCode = 2
}

main().catch(e => { process.stderr.write(`ERROR: ${(e && e.stack) || e}\n`); process.exitCode = 1 })
