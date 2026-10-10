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
// Verify batch-13 main-window UI changes in the packaged Hub over CDP:
//   token usage row, detail modal PID/url/autostart/skills fields, discovery head X close.
// The tray panel is verified separately by scripts/cdp-verify-tray-panel.cjs.
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

async function main() {
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

  const report = {}
  report.ready = await ev(`(async () => {
    const deadline = Date.now() + 90000
    while (Date.now() < deadline) { if (document.querySelector('.instance-switcher')) return true; await new Promise(r => setTimeout(r, 500)) }
    return false
  })()`)
  await ev(`(() => { const d = document.querySelector('[aria-label="首次使用引导"]'); if (d) { const c = d.querySelector('[aria-label="关闭引导"]'); if (c) c.click() } return true })()`)

  report.tokenRow = await ev(`(() => !!document.querySelector('.instance-card__usage-row'))()`)
  report.cardCount = await ev(`(() => document.querySelectorAll('.instance-card').length)()`)

  // detail modal fields
  report.detail = await ev(`(async () => {
    const btn = document.querySelector('.instance-card__detail-toggle')
    if (!btn) return { opened: false }
    btn.click()
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) { if (document.querySelector('.instance-detail-list')) break; await new Promise(r => setTimeout(r, 200)) }
    const list = document.querySelector('.instance-detail-list')
    if (!list) return { opened: false }
    const text = list.innerText || ''
    const close = document.querySelector('.instance-detail-modal .icon-button')
    if (close) close.click()
    return { opened: true, pid: text.includes('运行 PID'), url: text.includes('访问地址'), autostart: text.includes('自启动 / 启用'), skills: text.includes('技能源') }
  })()`)

  // discovery head X close (only present when there are un-imported discovered installs)
  report.discovery = await ev(`(async () => {
    const box = document.querySelector('.instance-discovery-results')
    if (!box) return { present: false }
    const head = document.querySelector('.instance-discovery-head')
    const close = head ? head.querySelector('.icon-button') : null
    if (close) {
      close.click()
      await new Promise(r => setTimeout(r, 300))
      return { present: true, hasHead: !!head, closedOnClick: !document.querySelector('.instance-discovery-results') }
    }
    return { present: true, hasHead: !!head, hasClose: false }
  })()`)

  report.verdict = {
    ready: report.ready,
    tokenUsageRow: report.tokenRow,
    detailOpened: report.detail.opened,
    detailPid: report.detail.pid,
    detailUrl: report.detail.url,
    detailAutostart: report.detail.autostart,
    detailSkills: report.detail.skills,
    discoveryHeadClose: report.discovery.present ? report.discovery.hasHead && (report.discovery.hasClose === undefined ? true : report.discovery.hasClose) : 'n/a',
  }
  report.verdict.PASS = Object.entries(report.verdict).every(([k, v]) => v === true || v === 'n/a')

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  client.close()
  if (!report.verdict.PASS) process.exitCode = 2
}

main().catch(e => { process.stderr.write(`ERROR: ${(e && e.stack) || e}\n`); process.exitCode = 1 })
