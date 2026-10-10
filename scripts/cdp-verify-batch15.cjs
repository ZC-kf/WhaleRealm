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
// Verify batch-15 changes in the packaged Hub over CDP:
//   main window - base size 1400x900, fullscreen toggle button (全屏/还原),
//                 settings has "启动实例后自动关闭" toggle.
//   tray view   - delete button opens the same two-mode delete dialog as main,
//                 tray settings has "启动后自动关闭" toggle.
const http = require('node:http')
const PORT = Number(process.argv[2] || 9333)

function getJSON(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, res => {
      let data = ''
      res.on('data', c => { data += c })
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch (e) { reject(e) } })
    }).on('error', reject)
  })
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const pending = new Map()
    let seq = 0
    ws.addEventListener('open', () => resolve({
      send(method, params) {
        const id = ++seq
        return new Promise((res, rej) => {
          const timer = setTimeout(() => { pending.delete(id); rej(new Error(`CDP timeout: ${method}`)) }, 60000)
          pending.set(id, { res, rej, timer })
          ws.send(JSON.stringify({ id, method, params: params || {} }))
        })
      },
      close() { ws.close() },
    }))
    ws.addEventListener('message', event => {
      let msg
      try { msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString()) } catch { return }
      const entry = msg.id !== undefined ? pending.get(msg.id) : undefined
      if (!entry) return
      pending.delete(msg.id)
      clearTimeout(entry.timer)
      if (msg.error) entry.rej(new Error(JSON.stringify(msg.error)))
      else entry.res(msg.result)
    })
    ws.addEventListener('error', e => reject(new Error(`ws error: ${e.message ?? 'unknown'}`)))
  })
}

const BASE = 'file:///C:/Users/Lenovo/AppData/Local/Programs/DSH%20Desktop%20Hub/resources/app.asar/dist/index.html'

async function main() {
  const targets = await getJSON('/json/list')
  const page = targets.find(t => t.type === 'page' && /dist[\\/]index\.html(?:[?#]|$)/.test(t.url))
  if (!page) throw new Error('main renderer target not found')
  const client = await connect(page.webSocketDebuggerUrl)
  await client.send('Runtime.enable', {})
  await client.send('Page.enable', {})
  const ev = async expression => {
    const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(`renderer exception: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
    return result.result.value
  }

  const report = {}

  // ---- main window ----
  report.ready = await ev(`(async () => {
    const deadline = Date.now() + 90000
    while (Date.now() < deadline) { if (document.querySelector('.instance-switcher')) return true; await new Promise(r => setTimeout(r, 500)) }
    return false
  })()`)
  await ev(`(() => { const d = document.querySelector('[aria-label="首次使用引导"]'); if (d) { const c = d.querySelector('[aria-label="关闭引导"]'); if (c) c.click() } return true })()`)

  // base size + button label
  report.baseSize = await ev(`(() => ({ w: window.innerWidth, h: window.innerHeight, screenW: window.screen.width }))()`)
  report.maxButtonLabel = await ev(`(() => {
    const btn = document.querySelector('.launcher-window-button.maximize')
    return btn ? { title: btn.title, label: btn.getAttribute('aria-label') } : null
  })()`)

  // fullscreen toggle
  report.fullscreen = await ev(`(async () => {
    const btn = () => document.querySelector('.launcher-window-button.maximize')
    const w0 = window.innerWidth
    btn().click()
    await new Promise(r => setTimeout(r, 900))
    const w1 = window.innerWidth
    const labelAfter = btn().getAttribute('aria-label')
    btn().click()
    await new Promise(r => setTimeout(r, 900))
    const w2 = window.innerWidth
    return { w0, w1, w2, grewToFullscreen: w1 > w0 + 100, restored: w2 < w1, labelAfter }
  })()`)

  // settings dialog has auto-close toggle
  report.settingsAutoClose = await ev(`(async () => {
    const sb = document.querySelector('[aria-label="启动器设置"]')
    if (!sb) return null
    sb.click()
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) { if (document.querySelector('.settings-dialog')) break; await new Promise(r => setTimeout(r, 200)) }
    const dialog = document.querySelector('.settings-dialog')
    if (!dialog) return null
    const text = dialog.innerText || ''
    const close = dialog.querySelector('.settings-close-button')
    if (close) close.click()
    return { hasAutoClose: text.includes('启动实例后自动关闭') }
  })()`)

  // ---- tray view ----
  await client.send('Page.navigate', { url: 'about:blank' })
  await new Promise(r => setTimeout(r, 400))
  await client.send('Page.navigate', { url: `${BASE}#tray` })
  await (async () => {
    for (let i = 0; i < 120; i++) {
      try { if (await ev(`(() => !!document.querySelector('.tray-panel'))()`)) return } catch { }
      await new Promise(r => setTimeout(r, 250))
    }
  })()

  report.trayDelete = await ev(`(async () => {
    const row = document.querySelector('.tray-stopped-row')
    if (!row) return { noStoppedRow: true }
    row.click()
    await new Promise(r => setTimeout(r, 350))
    const removeBtn = Array.from(document.querySelectorAll('.tray-stopped-functions button')).find(b => /移除/.test(b.textContent || ''))
    if (!removeBtn) return { noRemoveBtn: true }
    removeBtn.click()
    await new Promise(r => setTimeout(r, 350))
    const dialog = document.querySelector('.delete-dialog')
    if (!dialog) return { noDialog: true }
    const text = dialog.innerText || ''
    const hasUnregister = text.includes('仅移除注册')
    const hasPurge = text.includes('完全删除')
    const close = dialog.querySelector('.icon-button')
    if (close) close.click()
    return { hasUnregister, hasPurge, urlIsTray: window.location.hash === '#tray' }
  })()`)

  report.traySettingsAutoClose = await ev(`(async () => {
    const settingsBtn = Array.from(document.querySelectorAll('.tray-panel-footer button')).find(b => /设置/.test(b.textContent || ''))
    if (!settingsBtn) return { noSettingsBtn: true }
    settingsBtn.click()
    await new Promise(r => setTimeout(r, 300))
    const panel = document.querySelector('.tray-settings')
    if (!panel) return { noPanel: true }
    const text = panel.innerText || ''
    settingsBtn.click()
    await new Promise(r => setTimeout(r, 300))
    return { hasAutoClose: text.includes('启动后自动关闭') }
  })()`)

  // restore main window
  await client.send('Page.navigate', { url: 'about:blank' })
  await new Promise(r => setTimeout(r, 400))
  await client.send('Page.navigate', { url: BASE })
  client.close()

  // ---- verdict ----
  report.verdict = {
    ready: report.ready,
    baseSizeOk: report.baseSize.w >= 1300 && report.baseSize.h >= 850,
    maxButtonIsFullscreen: report.maxButtonLabel?.label === '全屏',
    fullscreenToggleWorks: report.fullscreen?.grewToFullscreen === true && report.fullscreen?.restored === true,
    settingsAutoClosePresent: report.settingsAutoClose?.hasAutoClose === true,
    trayDeleteAligned: report.trayDelete?.hasUnregister === true && report.trayDelete?.hasPurge === true,
    traySettingsAutoClosePresent: report.traySettingsAutoClose?.hasAutoClose === true,
  }
  report.verdict.PASS = Object.values(report.verdict).every(v => v === true)

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!report.verdict.PASS) process.exitCode = 2
}

main().catch(e => { process.stderr.write(`ERROR: ${(e && e.stack) || e}\n`); process.exitCode = 1 })
