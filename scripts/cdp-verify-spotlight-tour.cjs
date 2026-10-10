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
// Verify the spotlight (point-at-real-control) first-run tour in the packaged Hub.
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
  // Never pick the frameless window's data: shadow page; it has no app DOM.
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

  // Ensure first-run state, then reload so the tour auto-opens.
  await ev(`(() => { try { window.localStorage.removeItem('dsh-launcher:first-run-guide') } catch {} return true })()`)
  await send('Page.reload', { ignoreCache: false })
  await ev(`(async () => {
    const deadline = Date.now() + 90000
    while (Date.now() < deadline) { if (document.querySelector('.launcher-surface-host')) break; await new Promise(r => setTimeout(r, 500)) }
    const d = Date.now() + 15000
    while (Date.now() < d) { if (document.querySelector('[data-testid="guide-callout"]')) return true; await new Promise(r => setTimeout(r, 300)) }
    return false
  })()`)

  const overlap = `(hl, target) => {
    const a = hl.getBoundingClientRect(); const b = target.getBoundingClientRect()
    const cx = Math.max(a.left, b.left); const cy = Math.max(a.top, b.top)
    const cx2 = Math.min(a.right, b.right); const cy2 = Math.min(a.bottom, b.bottom)
    return { overlaps: cx2 > cx && cy2 > cy, hl: { t: Math.round(a.top), l: Math.round(a.left), w: Math.round(a.width), h: Math.round(a.height) }, tg: { t: Math.round(b.top), l: Math.round(b.left), w: Math.round(b.width), h: Math.round(b.height) } }
  }`

  // The highlight is painted one animation frame after the callout mounts; wait for it
  // explicitly instead of measuring on the same tick the callout first renders.
  await ev(`(async () => {
    const d = Date.now() + 8000
    while (Date.now() < d) { if (document.querySelector('[data-testid="guide-highlight"]')) return true; await new Promise(r => setTimeout(r, 120)) }
    return false
  })()`)

  report.step1 = await ev(`(() => {
    const callout = document.querySelector('[data-testid="guide-callout"]')
    const highlight = document.querySelector('[data-testid="guide-highlight"]')
    const target = document.querySelector('.instance-switcher__header')
    if (!callout) return { callout: false }
    const cs = highlight ? getComputedStyle(highlight) : null
    const cr = callout.getBoundingClientRect()
    return {
      callout: true,
      highlight: !!highlight,
      highlightPointerEvents: cs ? cs.pointerEvents : '',
      targetFound: !!target,
      geometry: (highlight && target) ? (${overlap})(highlight, target) : null,
      calloutInsideViewport: cr.top >= 0 && cr.left >= 0 && cr.bottom <= window.innerHeight + 2 && cr.right <= window.innerWidth + 2,
      stepLabel: (callout.textContent || '').match(/指向式引导 · \\d+ \\/ \\d+/) ? RegExp.lastMatch : '',
      mentionsHeader: /实例总览/.test(callout.textContent || ''),
    }
  })()`)

  // Walk to the first cross-surface step (side nav) and use its enter action.
  report.crossSurface = await ev(`(async () => {
    const next = () => { const c = document.querySelector('[data-testid="guide-callout"]'); if (!c) return null; return Array.from(c.querySelectorAll('button')).find(b => /下一步/.test(b.textContent || '')) }
    let entered = false
    const seenLabels = []
    for (let i = 0; i < 8; i++) {
      const callout = document.querySelector('[data-testid="guide-callout"]')
      if (!callout) { seenLabels.push('(no callout)'); break }
      seenLabels.push((((callout.textContent || '').match(/指向式引导 · \\d+ \\/ \\d+/) || ['?'])[0]) + ' | ' + (((callout.querySelector('h2') || {}).textContent) || ''))
      const enter = Array.from(callout.querySelectorAll('button')).find(b => /进入管理界面/.test(b.textContent || ''))
      if (enter) {
        enter.click()
        await new Promise(r => setTimeout(r, 1800))
        entered = true
        break
      }
      const n = next(); if (!n) { seenLabels.push('(no next button)'); break }
      n.click(); await new Promise(r => setTimeout(r, 500))
    }
    if (!entered) return { entered: false, seenLabels }
    await new Promise(r => setTimeout(r, 900))
    const managerVisible = () => { const m = document.querySelector('.manager-surface-host'); return !!m && !m.classList.contains('view-hidden') }
    const highlight = document.querySelector('[data-testid="guide-highlight"]')
    const target = document.querySelector('aside nav')
    return {
      entered: true,
      managerVisible: managerVisible(),
      highlightAfterEnter: !!highlight,
      geometry: (highlight && target) ? (${overlap})(highlight, target) : null,
      calloutMentionsNav: /左侧导航/.test((document.querySelector('[data-testid="guide-callout"]') || {}).textContent || ''),
    }
  })()`)

  // Close with dismiss, verify persistence, then reopen via the persistent button.
  report.dismiss = await ev(`(async () => {
    const callout = document.querySelector('[data-testid="guide-callout"]')
    if (!callout) return { callout: false }
    const box = callout.querySelector('input[type="checkbox"]')
    if (box && !box.checked) box.click()
    await new Promise(r => setTimeout(r, 250))
    const closeBtn = callout.querySelector('[aria-label="关闭引导"]')
    if (closeBtn) closeBtn.click()
    await new Promise(r => setTimeout(r, 600))
    const flag = (() => { try { return window.localStorage.getItem('dsh-launcher:first-run-guide') } catch { return 'unavailable' } })()
    const reopen = document.querySelector('[aria-label="重新打开使用引导"]')
    let reopened = false
    if (reopen) { reopen.click(); await new Promise(r => setTimeout(r, 700)); reopened = !!document.querySelector('[data-testid="guide-callout"]') }
    // leave it dismissed=false so the user still gets the tour on their next launch
    const c2 = document.querySelector('[data-testid="guide-callout"]')
    if (c2) { const b2 = c2.querySelector('input[type="checkbox"]'); if (b2 && b2.checked) b2.click(); await new Promise(r => setTimeout(r, 200)); const x = c2.querySelector('[aria-label="关闭引导"]'); if (x) x.click(); await new Promise(r => setTimeout(r, 400)) }
    try { window.localStorage.removeItem('dsh-launcher:first-run-guide') } catch {}
    return { flagAfterDismiss: flag, reopenButtonPresent: !!reopen, reopened, flagRestored: (() => { try { return window.localStorage.getItem('dsh-launcher:first-run-guide') } catch { return 'unavailable' } })() }
  })()`)

  const s1 = report.step1 || {}
  const cs2 = report.crossSurface || {}
  const dm = report.dismiss || {}
  report.verdict = {
    tourAutoOpens: !!s1.callout,
    highlightWrapsRealControl: !!(s1.geometry && s1.geometry.overlaps),
    highlightDoesNotBlockClicks: s1.highlightPointerEvents === 'none',
    calloutInsideViewport: s1.calloutInsideViewport === true,
    crossSurfaceEnterWorks: !!(cs2.entered && cs2.managerVisible && cs2.highlightAfterEnter && cs2.geometry && cs2.geometry.overlaps),
    dismissPersists: dm.flagAfterDismiss === 'dismissed',
    reopenWorks: dm.reopened === true,
  }
  report.verdict.PASS = Object.entries(report.verdict).every(([key, value]) => key === 'PASS' || value === true)

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  ws.close()
  if (!report.verdict.PASS) process.exitCode = 2
}

main().catch(e => { process.stderr.write(`ERROR: ${(e && e.stack) || e}\n`); process.exitCode = 1 })
