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
// Verify batch-17 changes in the packaged Hub over CDP:
//   item1 standard maximize icon, item2 tray follows theme, item3 bg opacity,
//   item4 desktop-shortcut setting + findInstanceShortcuts IPC.
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

const BASE = 'file:///' + `${process.env.LOCALAPPDATA || ''}/Programs/DSH Desktop Hub/resources/app.asar/dist/index.html`.replace(/\\/g, '/').replace(/ /g, '%20')

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
  report.ready = await ev(`(async () => {
    const deadline = Date.now() + 90000
    while (Date.now() < deadline) { if (document.querySelector('.instance-switcher')) return true; await new Promise(r => setTimeout(r, 500)) }
    return false
  })()`)
  await ev(`(() => { const d = document.querySelector('[aria-label="首次使用引导"]'); if (d) { const c = d.querySelector('[aria-label="关闭引导"]'); if (c) c.click() } return true })()`)

  // item1: maximize icon uses standard square
  report.maxIcon = await ev(`(() => {
    const svg = document.querySelector('.launcher-window-button.maximize svg')
    return svg ? svg.getAttribute('class') : null
  })()`)

  // item3: opacity variable + ::before
  report.opacity = await ev(`(() => {
    const root = getComputedStyle(document.documentElement)
    const home = document.querySelector('.launcher-home')
    const before = home ? getComputedStyle(home, '::before').opacity : null
    return { varVal: root.getPropertyValue('--launcher-opacity').trim(), beforeOpacity: before }
  })()`)

  // item4: settings toggle + find-shortcuts IPC
  report.settingsAndShortcuts = await ev(`(async () => {
    const sb = document.querySelector('[aria-label="启动器设置"]')
    if (sb) sb.click()
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) { if (document.querySelector('.settings-dialog')) break; await new Promise(r => setTimeout(r, 200)) }
    const dialog = document.querySelector('.settings-dialog')
    const text = dialog ? dialog.innerText || '' : ''
    const hasShortcutToggle = text.includes('删除/收录时移除桌面快捷方式')
    const hasOpacity = text.includes('背景透明度')
    const hasTrayBg = text.includes('托盘背景色')
    if (dialog) { const c = dialog.querySelector('.settings-close-button'); if (c) c.click() }

    const insts = await window.launcher.listInstances()
    const sc = insts.length > 0 ? await window.launcher.findInstanceShortcuts(insts[0].id) : { ok: true, shortcuts: [] }
    return { hasShortcutToggle, hasOpacity, hasTrayBg, shortcutsIpcOk: sc.ok === true && Array.isArray(sc.shortcuts) }
  })()`)

  // item2: tray follows theme (navigate #tray)
  await client.send('Page.navigate', { url: 'about:blank' })
  await new Promise(r => setTimeout(r, 400))
  await client.send('Page.navigate', { url: `${BASE}#tray` })
  await (async () => {
    for (let i = 0; i < 120; i++) {
      try { if (await ev(`(() => !!document.querySelector('.tray-panel'))()`)) return } catch { }
      await new Promise(r => setTimeout(r, 250))
    }
  })()
  report.trayTheme = await ev(`(() => {
    const el = document.querySelector('.tray-panel')
    if (!el) return null
    const cs = getComputedStyle(el)
    const accent = cs.getPropertyValue('--accent').trim()
    const theme = document.documentElement.dataset.theme
    return { accent, theme, notHardcodedBlue: accent !== '#7aa2f7' }
  })()`)
  await client.send('Page.navigate', { url: 'about:blank' })
  await new Promise(r => setTimeout(r, 400))
  await client.send('Page.navigate', { url: BASE })
  client.close()

  const s = report.settingsAndShortcuts ?? {}
  report.verdict = {
    ready: report.ready,
    standardMaxIcon: /square/.test(report.maxIcon || ''),
    opacityVarPresent: report.opacity?.varVal !== '',
    beforeOpacityOne: report.opacity?.beforeOpacity === '1',
    shortcutTogglePresent: s.hasShortcutToggle === true,
    opacitySettingPresent: s.hasOpacity === true,
    trayBgSettingPresent: s.hasTrayBg === true,
    findShortcutsIpcWorks: s.shortcutsIpcOk === true,
    trayFollowsTheme: report.trayTheme?.notHardcodedBlue === true && !!report.trayTheme?.theme,
  }
  report.verdict.PASS = Object.values(report.verdict).every(v => v === true)

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!report.verdict.PASS) process.exitCode = 2
}

main().catch(e => { process.stderr.write(`ERROR: ${(e && e.stack) || e}\n`); process.exitCode = 1 })
