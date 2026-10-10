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
// Verify batch-14 UI changes in the packaged Hub over CDP:
//   main window - detail modal has no autoStart field, health badge does not wrap,
//                 whole-card selection (white frame, single selection), delete dialog modes.
//   tray view   - 详情 opens an in-tray detail view (no jump to main window).
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

async function withMain(fn) {
  const targets = await getJSON('/json/list')
  const page = targets.find(t => t.type === 'page' && /dist[\\/]index\.html(?:[?#]|$)/.test(t.url))
  if (!page) throw new Error('main renderer target not found')
  const client = await connect(page.webSocketDebuggerUrl)
  await client.send('Runtime.enable', {})
  const ev = async expression => {
    const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(`renderer exception: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
    return result.result.value
  }
  const out = await fn(ev, client)
  client.close()
  return out
}

async function main() {
  const report = {}

  // ---- main window ----
  report.main = await withMain(async (ev) => {
    const ready = await ev(`(async () => {
      const deadline = Date.now() + 90000
      while (Date.now() < deadline) { if (document.querySelector('.instance-switcher')) return true; await new Promise(r => setTimeout(r, 500)) }
      return false
    })()`)
    await ev(`(() => { const d = document.querySelector('[aria-label="首次使用引导"]'); if (d) { const c = d.querySelector('[aria-label="关闭引导"]'); if (c) c.click() } return true })()`)

    // item 2: health badge nowrap
    const healthNowrap = await ev(`(() => {
      const el = document.querySelector('.instance-health')
      return el ? getComputedStyle(el).whiteSpace === 'nowrap' : null
    })()`)

    // item 5: detail modal has no autoStart field
    const detailNoAutoStart = await ev(`(async () => {
      const btn = document.querySelector('.instance-card__detail-toggle')
      if (!btn) return null
      btn.click()
      const deadline = Date.now() + 10000
      while (Date.now() < deadline) { if (document.querySelector('.instance-detail-list')) break; await new Promise(r => setTimeout(r, 200)) }
      const list = document.querySelector('.instance-detail-list')
      if (!list) return null
      const text = list.innerText || ''
      const close = document.querySelector('.instance-detail-modal .icon-button')
      if (close) close.click()
      return { hasAutoStart: text.includes('自启动'), text }
    })()`)

    // item 3: whole-card selection, single white frame
    const selection = await ev(`(async () => {
      const cards = Array.from(document.querySelectorAll('.instance-card'))
      if (cards.length < 2) return { skipped: true, count: cards.length }
      const second = cards[1].querySelector('.instance-card__facts')
      second.click()
      await new Promise(r => setTimeout(r, 200))
      const selectedAfterSecond = cards.filter(c => c.classList.contains('is-selected')).length
      const secondSelected = cards[1].classList.contains('is-selected')
      const first = cards[0].querySelector('.instance-card__facts')
      first.click()
      await new Promise(r => setTimeout(r, 200))
      const selectedAfterFirst = cards.filter(c => c.classList.contains('is-selected')).length
      const firstSelected = cards[0].classList.contains('is-selected')
      const secondStillSelected = cards[1].classList.contains('is-selected')
      return { count: cards.length, secondSelected, selectedAfterSecond, firstSelected, secondStillSelected, selectedAfterFirst }
    })()`)

    // item 7: delete dialog modes
    const deleteDialog = await ev(`(async () => {
      const btn = document.querySelector('.instance-card__remove')
      if (!btn) return null
      btn.click()
      const deadline = Date.now() + 10000
      while (Date.now() < deadline) { if (document.querySelector('.delete-dialog')) break; await new Promise(r => setTimeout(r, 200)) }
      const dialog = document.querySelector('.delete-dialog')
      if (!dialog) return null
      const text = dialog.innerText || ''
      const hasUnregister = text.includes('仅移除注册')
      const hasPurge = text.includes('完全删除')
      const hasSkipSection = text.includes('扫描收录')
      const close = dialog.querySelector('.icon-button')
      if (close) close.click()
      return { hasUnregister, hasPurge, hasSkipSection }
    })()`)

    return { ready, healthNowrap, detailNoAutoStart, selection, deleteDialog }
  })

  // ---- tray view (item 4): in-tray detail ----
  try {
    const targets = await getJSON('/json/list')
    const page = targets.find(t => t.type === 'page' && /dist[\\/]index\.html(?:[?#]|$)/.test(t.url))
    const client = await connect(page.webSocketDebuggerUrl)
    await client.send('Runtime.enable', {})
    await client.send('Page.enable', {})
    const ev = async expression => {
      const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(`renderer exception: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
      return result.result.value
    }
    await client.send('Page.navigate', { url: 'about:blank' })
    await new Promise(r => setTimeout(r, 400))
    await client.send('Page.navigate', { url: `${BASE}#tray` })
    await (async () => {
      for (let i = 0; i < 120; i++) {
        try { if (await ev(`(() => !!document.querySelector('.tray-panel'))()`)) return } catch { }
        await new Promise(r => setTimeout(r, 250))
      }
    })()
    report.tray = await ev(`(async () => {
      const row = document.querySelector('.tray-stopped-row')
      if (!row) return { noStoppedRow: true }
      row.click()
      await new Promise(r => setTimeout(r, 350))
      const detailBtn = Array.from(document.querySelectorAll('.tray-stopped-functions button')).find(b => /详情/.test(b.textContent || ''))
      if (!detailBtn) return { noDetailBtn: true }
      detailBtn.click()
      await new Promise(r => setTimeout(r, 350))
      const detailShown = !!document.querySelector('.tray-detail')
      const urlIsTray = window.location.hash === '#tray'
      const detailText = (document.querySelector('.tray-detail')?.innerText || '')
      return { detailShown, urlIsTray, hasPid: detailText.includes('PID'), hasDshHome: detailText.includes('状态根') }
    })()`)
    await client.send('Page.navigate', { url: 'about:blank' })
    await new Promise(r => setTimeout(r, 400))
    await client.send('Page.navigate', { url: BASE })
    client.close()
  } catch (e) {
    report.trayError = String((e && e.message) || e)
  }

  // ---- verdict ----
  const m = report.main
  const t = report.tray ?? {}
  report.verdict = {
    mainReady: m.ready,
    healthNoWrap: m.healthNowrap === true,
    detailNoAutoStart: m.detailNoAutoStart?.hasAutoStart === false,
    cardSelectionWorks: m.selection?.secondSelected === true && m.selection?.selectedAfterSecond === 1,
    singleSelection: m.selection?.firstSelected === true && m.selection?.secondStillSelected === false && m.selection?.selectedAfterFirst === 1,
    deleteDialogModes: m.deleteDialog?.hasUnregister === true && m.deleteDialog?.hasPurge === true,
    trayDetailInPlace: t.detailShown === true && t.urlIsTray === true,
  }
  report.verdict.PASS = Object.values(report.verdict).every(v => v === true)

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!report.verdict.PASS) process.exitCode = 2
}

main().catch(e => { process.stderr.write(`ERROR: ${(e && e.stack) || e}\n`); process.exitCode = 1 })
