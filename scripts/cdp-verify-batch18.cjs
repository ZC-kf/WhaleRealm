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
// Verify batch-18 changes: fullscreen categorized settings, right-side numpad,
// list fade vars, mirror history IPC, tray auto-collapse.
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
          const timer = setTimeout(() => { pending.delete(id); rej(new Error(`timeout ${method}`)) }, 60000)
          pending.set(id, { res, rej, timer })
          ws.send(JSON.stringify({ id, method, params: params || {} }))
        })
      },
      close() { ws.close() },
    }))
    ws.addEventListener('message', event => {
      let msg
      try { msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString()) } catch { return }
      const en = pending.get(msg.id)
      if (!en) return
      pending.delete(msg.id)
      clearTimeout(en.timer)
      if (msg.error) en.rej(new Error(JSON.stringify(msg.error)))
      else en.res(msg.result)
    })
    ws.addEventListener('error', e => reject(new Error(`ws error: ${e.message}`)))
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }
  const report = {}
  report.ready = await ev(`(async () => { const d = Date.now() + 90000; while (Date.now() < d) { if (document.querySelector('.instance-switcher')) return true; await new Promise(r => setTimeout(r, 500)) } return false })()`)
  await ev(`(() => { const d = document.querySelector('[aria-label="首次使用引导"]'); if (d) { const c = d.querySelector('[aria-label="关闭引导"]'); if (c) c.click() } return true })()`)

  // item 5: list fade vars
  report.fade = await ev(`(() => ({ type: document.documentElement.dataset.listFade, size: getComputedStyle(document.documentElement).getPropertyValue('--list-fade-size').trim() }))()`)

  // item 6: fullscreen settings + sidebar
  report.settings = await ev(`(async () => {
    const sb = document.querySelector('[aria-label="启动器设置"]'); if (sb) sb.click()
    const d = Date.now() + 10000; while (Date.now() < d) { if (document.querySelector('.settings-dialog')) break; await new Promise(r => setTimeout(r, 200)) }
    const dialog = document.querySelector('.settings-dialog')
    if (!dialog) return null
    const rect = dialog.getBoundingClientRect()
    const fullscreen = Math.abs(rect.width - window.innerWidth) < 4 && Math.abs(rect.height - window.innerHeight) < 4
    const cats = Array.from(document.querySelectorAll('.settings-category')).map(b => b.textContent)
    const close = dialog.querySelector('.settings-close-button'); if (close) close.click()
    return { fullscreen, cats }
  })()`)

  // item 1: number field keyboard + tail + right-side numpad
  report.numpad = await ev(`(async () => {
    const portBtn = Array.from(document.querySelectorAll('.instance-card__actions button')).find(b => /端口/.test(b.textContent || ''))
    if (!portBtn) return null
    portBtn.click()
    const d = Date.now() + 10000; while (Date.now() < d) { if (document.querySelector('.port-dialog')) break; await new Promise(r => setTimeout(r, 200)) }
    const dialog = document.querySelector('.port-dialog'); if (!dialog) return null
    const input = dialog.querySelector('.number-field-input'); const tail = dialog.querySelector('.number-field-tail')
    if (!input || !tail) return null
    const fieldRect = dialog.querySelector('.number-field').getBoundingClientRect()
    tail.click()
    await new Promise(r => setTimeout(r, 300))
    const pop = document.querySelector('.number-field-popover')
    const popRect = pop ? pop.getBoundingClientRect() : null
    const toRight = popRect ? popRect.left >= fieldRect.right - 8 : false
    const close = dialog.querySelector('.icon-button'); if (close) close.click()
    return { hasInput: true, hasTail: true, numpadOpensRight: toRight }
  })()`)

  // item 9: mirror history IPC
  report.mirrorHistory = await ev(`(async () => {
    const insts = await window.launcher.listInstances()
    if (insts.length === 0) return { ok: true, history: [] }
    const h = await window.launcher.instanceMirrorHistory(insts[0].id)
    return { ok: h.ok === true, historyIsArray: Array.isArray(h.history) }
  })()`)

  // item 8: tray auto-collapse (navigate #tray)
  await client.send('Page.navigate', { url: 'about:blank' })
  await new Promise(r => setTimeout(r, 400))
  await client.send('Page.navigate', { url: `${BASE}#tray` })
  await (async () => { for (let i = 0; i < 120; i++) { try { if (await ev(`(() => !!document.querySelector('.tray-panel'))()`)) return } catch { } await new Promise(r => setTimeout(r, 250)) } })()
  report.trayCollapse = await ev(`(async () => {
    const btn = Array.from(document.querySelectorAll('.tray-panel-footer button')).find(b => /设置/.test(b.textContent || ''))
    if (!btn) return { noBtn: true }
    btn.click(); await new Promise(r => setTimeout(r, 300))
    const opened = !!document.querySelector('.tray-settings')
    // 点击头部空白处 → 自动收回（真实点击会触发 mousedown）
    document.querySelector('.tray-panel-header').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await new Promise(r => setTimeout(r, 300))
    const closed = !document.querySelector('.tray-settings')
    return { opened, closedOnBlank: closed }
  })()`)
  await client.send('Page.navigate', { url: 'about:blank' })
  await new Promise(r => setTimeout(r, 400))
  await client.send('Page.navigate', { url: BASE })
  client.close()

  const s = report.settings ?? {}
  const n = report.numpad ?? {}
  const mh = report.mirrorHistory ?? {}
  const tc = report.trayCollapse ?? {}
  report.verdict = {
    ready: report.ready,
    fadeVarsPresent: report.fade?.type === 'gradient' && report.fade?.size !== '',
    settingsFullscreen: s.fullscreen === true,
    settingsCategorized: (s.cats ?? []).length === 4,
    numpadKeyboardAndTail: n.hasInput === true && n.hasTail === true,
    numpadOpensRight: n.numpadOpensRight === true,
    mirrorHistoryIpcWorks: mh.ok === true && mh.historyIsArray === true,
    trayCollapsesOnBlank: tc.opened === true && tc.closedOnBlank === true,
  }
  report.verdict.PASS = Object.values(report.verdict).every(v => v === true)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!report.verdict.PASS) process.exitCode = 2
}

main().catch(e => { process.stderr.write(`ERROR: ${(e && e.stack) || e}\n`); process.exitCode = 1 })
