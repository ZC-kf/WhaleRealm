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
// Behavioural check for the labelled "back to launcher" control in the packaged Hub.
// Proves: (1) the element exists with a real text label, (2) entering the manager surface
// works, (3) clicking the labelled button actually returns to the launcher surface.
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

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const pending = new Map()
    let seq = 0
    ws.addEventListener('open', () => resolve({
      send(method, params) {
        const id = ++seq
        return new Promise((res, rej) => {
          // Must exceed the longest in-page wait (the readiness loop runs up to 90s).
          const timer = setTimeout(() => { pending.delete(id); rej(new Error(`CDP timeout: ${method}`)) }, 150000)
          pending.set(id, { res, rej, timer })
          ws.send(JSON.stringify({ id, method, params }))
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
  const targets = await getTargets()
  const page = targets.find(t => t.type === 'page' && /dist[\\/]index\.html/.test(t.url))
  if (!page) throw new Error('main renderer target not found')
  const client = await connect(page.webSocketDebuggerUrl)
  await client.send('Runtime.enable', {})

  const evalJs = async expression => {
    const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(`renderer exception: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
    return result.result.value
  }

  const report = {}

  // The renderer mounts asynchronously. Querying before React has rendered reports both
  // surfaces as hidden and yields a false negative, so wait for the real DOM first.
  report.ready = await evalJs(`(async () => {
    const deadline = Date.now() + 90000
    while (Date.now() < deadline) {
      const l = document.querySelector('.launcher-surface-host')
      const m = document.querySelector('.manager-surface-host')
      const btn = document.querySelector('.manager-back-labeled')
      if (l && m && btn) return { ready: true }
      await new Promise(r => setTimeout(r, 500))
    }
    return {
      ready: false,
      launcherHost: !!document.querySelector('.launcher-surface-host'),
      managerHost: !!document.querySelector('.manager-surface-host'),
      backBtn: !!document.querySelector('.manager-back-labeled'),
      bodyChildren: document.body ? document.body.children.length : -1,
      rootHtmlLength: (document.getElementById('root') || {}).innerHTML ? document.getElementById('root').innerHTML.length : 0,
    }
  })()`)
  if (!report.ready || !report.ready.ready) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    client.close()
    process.exitCode = 3
    return
  }

  // 1. The labelled control must exist, be a real button, and carry visible text.
  report.control = await evalJs(`(() => {
    const btn = document.querySelector('.manager-back-labeled')
    if (!btn) return { found: false }
    const host = btn.closest('.manager-surface-host')
    const rect = btn.getBoundingClientRect()
    return {
      found: true,
      tag: btn.tagName,
      text: (btn.textContent || '').trim(),
      ariaLabel: btn.getAttribute('aria-label'),
      title: btn.getAttribute('title'),
      insideManagerSurface: !!host,
      hasNonEmptyLabel: (btn.textContent || '').trim().length > 0,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      cornerTriangleStillPresent: !!document.querySelector('.manager-back .manager-corner-mark') || !!document.querySelector('.manager-corner-mark'),
    }
  })()`)

  const surfaceState = () => evalJs(`(() => {
    const launcher = document.querySelector('.launcher-surface-host')
    const manager = document.querySelector('.manager-surface-host')
    return {
      launcherVisible: !!launcher && !launcher.classList.contains('view-hidden'),
      managerVisible: !!manager && !manager.classList.contains('view-hidden'),
    }
  })()`)

  report.before = await surfaceState()

  // 2. Enter the manager surface the way a user would: click a launcher control that
  //    switches surface. Try labelled candidates, then fall back to any element whose
  //    click flips the manager surface visible.
  report.enteredManager = await evalJs(`(async () => {
    const isVisible = () => {
      const m = document.querySelector('.manager-surface-host')
      return !!m && !m.classList.contains('view-hidden')
    }
    if (isVisible()) return { how: 'already-manager' }
    const candidates = Array.from(document.querySelectorAll('.launcher-surface-host button, .launcher-surface-host [role="button"], .launcher-surface-host a'))
    const scored = candidates.map(el => ({ el, text: ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '')).trim() }))
      .filter(x => /管理|插件|整合包|环境|设置|market|plugin|manage|settings/i.test(x.text))
    for (const item of scored) {
      item.el.click()
      await new Promise(r => setTimeout(r, 400))
      if (isVisible()) return { how: 'labelled-click', label: item.text.slice(0, 60) }
    }
    for (const item of candidates.map(el => ({ el }))) {
      item.el.click()
      await new Promise(r => setTimeout(r, 250))
      if (isVisible()) return { how: 'exhaustive-click' }
    }
    return { how: 'failed' }
  })()`)

  report.inManager = await surfaceState()

  // 3. Click the labelled back button and confirm we land on the launcher surface.
  report.backClicked = await evalJs(`(() => {
    const btn = document.querySelector('.manager-back-labeled')
    if (!btn) return { clicked: false }
    btn.click()
    return { clicked: true }
  })()`)
  await new Promise(r => setTimeout(r, 800))
  report.after = await surfaceState()

  report.verdict = {
    controlExistsWithLabel: !!(report.control && report.control.found && report.control.hasNonEmptyLabel && report.control.tag === 'BUTTON'),
    controlInsideManagerSurface: !!(report.control && report.control.insideManagerSurface),
    cornerShortcutPreserved: !!(report.control && report.control.cornerTriangleStillPresent),
    managerReached: !!(report.inManager && report.inManager.managerVisible),
    returnedToLauncher: !!(report.after && report.after.launcherVisible && !report.after.managerVisible),
  }
  report.verdict.PASS = Object.values(report.verdict).every(v => v === true)

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  client.close()
  if (!report.verdict.PASS) process.exitCode = 2
}

main().catch(e => { process.stderr.write(`ERROR: ${(e && e.stack) || e}\n`); process.exitCode = 1 })
