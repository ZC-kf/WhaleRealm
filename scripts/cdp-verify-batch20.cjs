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
// Verify batch-20 changes: search jump (item 1), search keyboard nav (item 4),
// tray per-instance functions (item 8). DOM + dispatched-keyboard checks.
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

async function main() {
  const targets = await getJSON('/json/list')
  const page = targets.find(t => t.type === 'page' && /dist[\\/]index\.html(?:[?#]|$)/.test(t.url))
  if (!page) throw new Error('main renderer target not found')
  const base = page.url.split('#')[0]
  const client = await connect(page.webSocketDebuggerUrl)
  await client.send('Runtime.enable', {})
  await client.send('Page.enable', {})
  const ev = async expression => {
    const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }

  // setNativeValue: testing-library style, works with React controlled inputs.
  const SET_VALUE = `function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el)
    const desc = Object.getOwnPropertyDescriptor(proto, 'value')
    const own = Object.getOwnPropertyDescriptor(el, 'value')
    const setter = (own && own.set && own.set !== desc.set) ? desc.set : (desc && desc.set)
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }`

  const report = {}
  report.ready = await ev(`(async () => { const d = Date.now() + 90000; while (Date.now() < d) { if (document.querySelector('.instance-switcher')) return true; await new Promise(r => setTimeout(r, 500)) } return false })()`)
  await ev(`(() => { const g = document.querySelector('[aria-label="首次使用引导"]'); if (g) { const c = g.querySelector('[aria-label="关闭引导"]'); if (c) c.click() } return true })()`)

  // ---- Item 1 + 4: main search -> keyboard nav -> jump to tray-behavior section ----
  report.mainSearch = await ev(`(async () => {
    ${SET_VALUE}
    const input = document.querySelector('[aria-label="搜索实例"]')
    if (!input) return { error: 'no search input' }
    setNativeValue(input, '托盘行为')
    const d = Date.now() + 8000
    while (Date.now() < d) { if (document.querySelector('.search-results .search-result')) break; await new Promise(r => setTimeout(r, 150)) }
    const results = Array.from(document.querySelectorAll('.search-results .search-result')).map(b => ({
      label: b.querySelector('.search-result-label')?.textContent,
      source: b.querySelector('.search-result-source')?.textContent,
    }))
    const settingHit = results.filter(r => r.source === '设置' && (r.label || '').includes('托盘'))
    return { count: results.length, settingHit: settingHit.map(r => r.label) }
  })()`)

  report.mainSearchKeyboard = await ev(`(async () => {
    const input = document.querySelector('[aria-label="搜索实例"]')
    if (!input) return { error: 'no search input' }
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    await new Promise(r => setTimeout(r, 120))
    const active = document.querySelector('.search-results .search-result.is-active')
    const activeLabel = active ? active.querySelector('.search-result-label')?.textContent : null
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    const d = Date.now() + 10000
    while (Date.now() < d) { if (document.querySelector('.settings-dialog')) break; await new Promise(r => setTimeout(r, 150)) }
    const dialogOpen = !!document.querySelector('.settings-dialog')
    const activeCat = document.querySelector('.settings-category.is-active')?.textContent?.trim() ?? null
    const traySection = !!document.getElementById('sec-tray-behavior')
    return { activeLabel, dialogOpen, activeCat, traySection }
  })()`)

  // ---- Item 4 (settings search keyboard nav) + close ----
  report.settingsSearchKeyboard = await ev(`(async () => {
    ${SET_VALUE}
    if (!document.querySelector('.settings-dialog')) return { error: 'settings not open' }
    const input = document.querySelector('.settings-header-search input')
    if (!input) return { error: 'no settings search input' }
    setNativeValue(input, '渐变')
    const d = Date.now() + 6000
    while (Date.now() < d) { if (document.querySelector('.settings-search-results .settings-search-result')) break; await new Promise(r => setTimeout(r, 150)) }
    const count = document.querySelectorAll('.settings-search-results .settings-search-result').length
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    await new Promise(r => setTimeout(r, 120))
    const active = document.querySelector('.settings-search-result.is-active')
    const activeLabel = active ? active.querySelector('.search-result-label')?.textContent : null
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await new Promise(r => setTimeout(r, 400))
    const activeCat = document.querySelector('.settings-category.is-active')?.textContent?.trim() ?? null
    const fadeSection = !!document.getElementById('sec-list-fade')
    const close = document.querySelector('.settings-close-button')
    if (close) close.click()
    return { count, activeLabel, activeCat, fadeSection }
  })()`)
  await ev(`(async () => { const d = Date.now() + 6000; while (Date.now() < d) { if (!document.querySelector('.settings-dialog')) break; await new Promise(r => setTimeout(r, 150)) } return true })()`)

  // ---- Item 8: tray per-instance functions ----
  await client.send('Page.navigate', { url: 'about:blank' })
  await new Promise(r => setTimeout(r, 400))
  await client.send('Page.navigate', { url: `${base}#tray` })
  await (async () => { for (let i = 0; i < 120; i++) { try { if (await ev(`(() => !!document.querySelector('.tray-panel'))()`)) return } catch { } await new Promise(r => setTimeout(r, 250)) } })()
  report.tray = await ev(`(async () => {
    const footer = Array.from(document.querySelectorAll('.tray-panel-footer button')).map(b => b.textContent)
    // wait for stopped instances to load (refresh() is async), then expand one
    const d0 = Date.now() + 15000
    while (Date.now() < d0) { if (document.querySelector('.tray-stopped-row')) break; await new Promise(r => setTimeout(r, 200)) }
    const row = document.querySelector('.tray-stopped-row')
    if (row) {
      row.click()
      const d = Date.now() + 4000
      while (Date.now() < d) { if (document.querySelector('.tray-stopped-functions')) break; await new Promise(r => setTimeout(r, 150)) }
    }
    const funcs = Array.from(document.querySelectorAll('.tray-stopped-functions button')).map(b => b.textContent)
    return {
      hasFullSettings: footer.some(t => t.includes('完整设置')),
      footerHasOpenMain: footer.some(t => t.includes('打开主界面')),
      stoppedRowCount: document.querySelectorAll('.tray-stopped-row').length,
      stoppedFuncs: funcs,
      hasOpenFolder: funcs.some(t => t.includes('目录')),
    }
  })()`)
  await client.send('Page.navigate', { url: 'about:blank' })
  await new Promise(r => setTimeout(r, 400))
  await client.send('Page.navigate', { url: base })
  client.close()

  const ms = report.mainSearch ?? {}
  const mk = report.mainSearchKeyboard ?? {}
  const sk = report.settingsSearchKeyboard ?? {}
  const t = report.tray ?? {}
  report.verdict = {
    ready: report.ready === true,
    mainSearchSettingHit: Array.isArray(ms.settingHit) && ms.settingHit.length > 0,
    mainSearchActiveOnArrow: typeof mk.activeLabel === 'string' && mk.activeLabel.length > 0,
    mainSearchJumpToTray: mk.dialogOpen === true && mk.activeCat === '托盘' && mk.traySection === true,
    settingsSearchActiveOnArrow: typeof sk.activeLabel === 'string' && sk.activeLabel.length > 0,
    settingsSearchJumpToFade: sk.activeCat === '窗口' && sk.fadeSection === true,
    trayNoFullSettings: t.hasFullSettings === false,
    trayStoppedHasFolder: t.hasOpenFolder === true,
  }
  report.verdict.PASS = Object.values(report.verdict).every(v => v === true)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!report.verdict.PASS) process.exitCode = 2
}

main().catch(e => { process.stderr.write(`ERROR: ${(e && e.stack) || e}\n`); process.exitCode = 1 })
