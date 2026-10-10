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
// Verify the guide callout never overflows the window, especially at the tall
// left-sidebar step (第 4 步 · 左侧导航). Walks to that step and asserts the
// callout rect stays fully inside the viewport.
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
  await send('Page.enable')
  const report = {}

  await ev(`(() => { try { window.localStorage.removeItem('dsh-launcher:first-run-guide') } catch {} return true })()`)
  await send('Page.reload', { ignoreCache: false })
  await ev(`(async () => {
    const deadline = Date.now() + 90000
    while (Date.now() < deadline) { if (document.querySelector('[data-testid="guide-callout"]')) return true; await new Promise(r => setTimeout(r, 300)) }
    return false
  })()`)

  report.sideNav = await ev(`(async () => {
    const next = () => { const c = document.querySelector('[data-testid="guide-callout"]'); if (!c) return null; return Array.from(c.querySelectorAll('button')).find(b => /下一步/.test(b.textContent || '')) }
    let entered = false
    for (let i = 0; i < 8; i++) {
      const c = document.querySelector('[data-testid="guide-callout"]')
      if (!c) break
      const enter = Array.from(c.querySelectorAll('button')).find(b => /进入管理界面/.test(b.textContent || ''))
      if (enter) { enter.click(); await new Promise(r => setTimeout(r, 1800)); entered = true; break }
      const n = next(); if (!n) break; n.click(); await new Promise(r => setTimeout(r, 500))
    }
    if (!entered) return { entered: false }
    await new Promise(r => setTimeout(r, 900))
    // The 第 4 步 callout should now be visible with the side-nav highlight.
    const c = document.querySelector('[data-testid="guide-callout"]')
    if (!c) return { entered: true, callout: false }
    const r = c.getBoundingClientRect()
    return {
      entered: true,
      callout: true,
      stepLabel: (c.textContent || '').match(/指向式引导 · \\d+ \\/ \\d+/)?.[0] ?? '',
      title: (c.querySelector('h2') || {}).textContent || '',
      rect: { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) },
      viewport: { w: window.innerWidth, h: window.innerHeight },
      withinViewport: r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight + 1 && r.right <= window.innerWidth + 1,
    }
  })()`)

  const s = report.sideNav
  report.verdict = {
    reachedSideNavStep: s.entered === true && s.callout === true,
    calloutWithinViewport: s.withinViewport === true,
  }
  report.verdict.PASS = Object.entries(report.verdict).every(([k, v]) => k === 'PASS' || v === true)

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  ws.close()
  if (!report.verdict.PASS) process.exitCode = 2
}

main().catch(e => { process.stderr.write(`ERROR: ${(e && e.stack) || e}\n`); process.exitCode = 1 })
