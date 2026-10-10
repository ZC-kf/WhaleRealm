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
// Verify the new instance-management features over CDP (read-only except minimize click).
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
  const page = targets.filter(t => t.type === 'page').find(t => /index\.html/.test(t.url))
  if (!page) throw new Error('app page target not found')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  const pending = new Map()
  let seq = 0
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 60000)
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

  await ev(`(async () => { const d = document.querySelector('[aria-label="首次使用引导"]'); if (d) { const c = d.querySelector('[aria-label="关闭引导"]'); if (c) c.click(); await new Promise(r => setTimeout(r, 600)) } return true })()`)

  report.checks = await ev(`(async () => {
    const result = {}
    // default card view
    result.cardViewDefault = !!document.querySelector('.instance-switcher__list--card')
    // port button present (stopped card actions)
    const portBtn = Array.from(document.querySelectorAll('.instance-card__actions button')).find(b => /端口/.test(b.textContent || ''))
    result.portButtonPresent = !!portBtn
    // token usage toggle (button element)
    result.usageTogglePresent = !!document.querySelector('.instance-card__usage')
    // balance badge present
    result.balancePresent = !!document.querySelector('.launcher-balance')
    result.balanceText = (document.querySelector('.launcher-balance span')?.textContent || '').trim()
    // minimize button present
    result.minimizeButtonPresent = !!document.querySelector('[aria-label="最小化"]')
    // detail modal: open + close
    const detailBtn = Array.from(document.querySelectorAll('.instance-card__actions button')).find(b => /详情/.test(b.textContent || ''))
    detailBtn?.click(); await new Promise(r => setTimeout(r, 500))
    result.detailModalOpens = !!document.querySelector('.instance-detail-modal')
    const closeBtn = document.querySelector('.instance-detail-modal [aria-label="关闭详情"]')
    closeBtn?.click(); await new Promise(r => setTimeout(r, 400))
    result.detailModalCloses = !document.querySelector('.instance-detail-modal')
    return result
  })()`)

  // click minimize and report visibility state change
  report.minimize = await ev(`(async () => {
    const before = document.visibilityState
    document.querySelector('[aria-label="最小化"]')?.click()
    await new Promise(r => setTimeout(r, 1200))
    return { visibilityBefore: before, visibilityAfter: document.visibilityState, noException: true }
  })()`)

  const c = report.checks
  report.verdict = {
    cardViewDefault: c.cardViewDefault,
    portButtonPresent: c.portButtonPresent,
    usageTogglePresent: c.usageTogglePresent,
    balancePresent: c.balancePresent,
    minimizeButtonPresent: c.minimizeButtonPresent,
    detailModalOpens: c.detailModalOpens,
    detailModalCloses: c.detailModalCloses,
    minimizeNoException: report.minimize.noException === true,
  }
  report.verdict.PASS = Object.entries(report.verdict).every(([key, value]) => key === 'PASS' || value === true)

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  ws.close()
  if (!report.verdict.PASS) process.exitCode = 2
}

main().catch(e => { process.stderr.write(`ERROR: ${(e && e.stack) || e}\n`); process.exitCode = 1 })
