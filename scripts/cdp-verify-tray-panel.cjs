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
// Verify the tray panel (TrayPanel) at runtime by navigating the main renderer
// to the #tray hash, which App.tsx uses to render the tray view from the same
// bundle. Verifies the starry-black fixed theme, the right-side settings drawer,
// and the new interaction hints (double-click start, no right-click menu).
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

  // Navigate to the tray hash. A bare hash change is a same-document navigation
  // (no reload), so route through about:blank first to force a fresh document.
  await client.send('Page.navigate', { url: 'about:blank' })
  await new Promise(r => setTimeout(r, 400))
  await client.send('Page.navigate', { url: `${BASE}#tray` })
  const ready = await (async () => {
    for (let i = 0; i < 120; i++) {
      try {
        const v = await ev(`(() => !!document.querySelector('.tray-panel'))()`)
        if (v) return true
      } catch { /* context rebuilding after navigation */ }
      await new Promise(r => setTimeout(r, 250))
    }
    return false
  })()

  const report = { ready }

  if (ready) {
    report.theme = await ev(`(() => {
      const el = document.querySelector('.tray-panel')
      const cs = getComputedStyle(el)
      return { accent: cs.getPropertyValue('--accent').trim(), bgHasRadial: cs.backgroundImage.includes('radial-gradient'), surfaceSolid: cs.getPropertyValue('--surface-solid').trim() }
    })()`)

    report.settingsDrawer = await ev(`(async () => {
      const btn = Array.from(document.querySelectorAll('.tray-panel-footer button')).find(b => /设置/.test(b.textContent || ''))
      if (!btn) return { found: false }
      btn.click()
      await new Promise(r => setTimeout(r, 300))
      const result = {
        found: true,
        opened: !!document.querySelector('.tray-settings'),
        themeOptions: document.querySelectorAll('.tray-theme-option').length,
        toggles: document.querySelectorAll('.tray-toggle').length,
        accentPicker: !!document.querySelector('.tray-settings input[type="color"]'),
        threshold: !!document.querySelector('.tray-settings input[type="number"]'),
      }
      btn.click()
      await new Promise(r => setTimeout(r, 300))
      result.closedAgain = !document.querySelector('.tray-settings')
      return result
    })()`)

    report.stoppedHint = await ev(`(() => {
      const titles = Array.from(document.querySelectorAll('.tray-panel-title')).map(t => (t.textContent || '').trim())
      return { titles, doubleClickHint: titles.some(t => t.includes('双击启动')), hasRightClickHint: titles.some(t => t.includes('右键')) }
    })()`)

    report.footer = await ev(`(() => {
      const btns = Array.from(document.querySelectorAll('.tray-panel-footer button')).map(b => (b.textContent || '').trim())
      return { btns, hasOpenMain: btns.some(t => t.includes('打开主界面')), hasSettings: btns.some(t => t.includes('设置')), hasQuit: btns.some(t => t.includes('退出')) }
    })()`)
  }

  // Navigate back to the launcher so the window is restored before we close.
  await client.send('Page.navigate', { url: 'about:blank' })
  await new Promise(r => setTimeout(r, 400))
  await client.send('Page.navigate', { url: BASE })
  await (async () => {
    for (let i = 0; i < 120; i++) {
      try {
        const v = await ev(`(() => !!document.querySelector('.instance-switcher'))()`)
        if (v) return true
      } catch { }
      await new Promise(r => setTimeout(r, 250))
    }
    return false
  })()

  report.verdict = {
    ready: report.ready,
    starryBlack: report.theme?.accent === '#7aa2f7' && report.theme?.bgHasRadial === true,
    settingsDrawerOpens: report.settingsDrawer?.opened === true && report.settingsDrawer?.closedAgain === true,
    settingsContent: (report.settingsDrawer?.themeOptions ?? 0) === 4 && (report.settingsDrawer?.toggles ?? 0) === 3 && report.settingsDrawer?.accentPicker && report.settingsDrawer?.threshold,
    doubleClickHint: report.stoppedHint?.doubleClickHint === true,
    noRightClickHint: report.stoppedHint?.hasRightClickHint === false,
    footerButtons: (report.footer?.hasOpenMain && report.footer?.hasSettings && report.footer?.hasQuit) === true,
  }
  report.verdict.PASS = Object.values(report.verdict).every(v => v === true)

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  client.close()
  if (!report.verdict.PASS) process.exitCode = 2
}

main().catch(e => { process.stderr.write(`ERROR: ${(e && e.stack) || e}\n`); process.exitCode = 1 })
