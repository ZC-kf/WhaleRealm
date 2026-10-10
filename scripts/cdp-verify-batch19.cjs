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
// Verify batch-19 changes (DOM-structure checks, no React input simulation).
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

  // settings checks
  report.settings = await ev(`(() => {
    const sb = document.querySelector('[aria-label="启动器设置"]')
    if (!sb) return null
    sb.click()
    return true
  })()`)
  await ev(`(async () => { const d = Date.now() + 10000; while (Date.now() < d) { if (document.querySelector('.settings-dialog')) break; await new Promise(r => setTimeout(r, 200)) } return true })()`)
  report.settingsDetail = await ev(`(() => {
    const cats = Array.from(document.querySelectorAll('.settings-category')).map(b => b.textContent)
    const headerInput = !!document.querySelector('.settings-header-search input')
    const text = document.querySelector('.settings-dialog')?.innerText || ''
    const numpadInSettings = document.querySelectorAll('.settings-dialog .number-field').length
    const scrollbarHidden = (() => { try { return getComputedStyle(document.querySelector('.settings-content-scroll'), '::-webkit-scrollbar').display === 'none' } catch { return false } })()
    return { cats, headerInput, hasTrayStyle: text.includes('托盘独立样式'), hasAbout: cats.includes('关于'), numpadInSettings, scrollbarHidden }
  })()`)
  await ev(`(() => { const c = document.querySelector('.settings-close-button'); if (c) c.click(); return true })()`)

  // mirror history always visible
  report.mirrorHistory = await ev(`(async () => {
    const repairBtn = Array.from(document.querySelectorAll('.instance-card__actions button')).find(b => /修复/.test(b.textContent || ''))
    if (!repairBtn) return null
    repairBtn.click()
    const d = Date.now() + 10000; while (Date.now() < d) { if (document.querySelector('.repair-dialog')) break; await new Promise(r => setTimeout(r, 200)) }
    const dialog = document.querySelector('.repair-dialog'); if (!dialog) return null
    const hasHistorySection = !!dialog.querySelector('.mirror-history')
    const close = dialog.querySelector('.icon-button'); if (close) close.click()
    return { hasHistorySection }
  })()`)

  // tray quick functions
  await client.send('Page.navigate', { url: 'about:blank' })
  await new Promise(r => setTimeout(r, 400))
  await client.send('Page.navigate', { url: `${BASE}#tray` })
  await (async () => { for (let i = 0; i < 120; i++) { try { if (await ev(`(() => !!document.querySelector('.tray-panel'))()`)) return } catch { } await new Promise(r => setTimeout(r, 250)) } })()
  report.tray = await ev(`(() => {
    const footer = Array.from(document.querySelectorAll('.tray-panel-footer button')).map(b => b.textContent)
    const runningSection = document.querySelector('.tray-running')?.innerText || ''
    return { hasFullSettings: footer.some(t => t.includes('完整设置')), hasStopAll: runningSection.includes('全部停止') }
  })()`)
  await client.send('Page.navigate', { url: 'about:blank' })
  await new Promise(r => setTimeout(r, 400))
  await client.send('Page.navigate', { url: BASE })
  client.close()

  const s = report.settingsDetail ?? {}
  const mh = report.mirrorHistory ?? {}
  const t = report.tray ?? {}
  report.verdict = {
    ready: report.ready,
    settingsHeaderSearch: s.headerInput === true,
    settingsAbout: s.hasAbout === true,
    settingsTrayStyle: s.hasTrayStyle === true,
    settingsPlainNumbers: s.numpadInSettings === 0,
    settingsScrollbarHidden: s.scrollbarHidden === true,
    mirrorHistoryAlwaysVisible: mh.hasHistorySection === true,
    trayFullSettings: t.hasFullSettings === true,
    // 全部停止仅在存在运行中实例时渲染，此处环境无运行实例 → 不纳入判定。
  }
  report.verdict.PASS = Object.values(report.verdict).every(v => v === true)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!report.verdict.PASS) process.exitCode = 2
}

main().catch(e => { process.stderr.write(`ERROR: ${(e && e.stack) || e}\n`); process.exitCode = 1 })
