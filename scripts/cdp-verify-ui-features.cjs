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
// Behavioural verification for the two new Hub UI features, driven through the real
// renderer over CDP: the "desktop inventory" manager view and the first-run guide.
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
          // Must exceed the longest in-page wait below.
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

  report.ready = await evalJs(`(async () => {
    const deadline = Date.now() + 90000
    while (Date.now() < deadline) {
      // Only the launcher host is guaranteed: App renders the manager surface conditionally,
      // so requiring both hosts would never be satisfied while sitting on the launcher.
      if (document.querySelector('.launcher-surface-host')) return { ready: true }
      await new Promise(r => setTimeout(r, 500))
    }
    return { ready: false, bodyChildren: document.body ? document.body.children.length : -1, title: document.title }
  })()`)
  if (!report.ready || !report.ready.ready) { report.PASS = false; process.stdout.write(JSON.stringify(report, null, 2) + '\n'); client.close(); process.exitCode = 3; return }

  // --- first-run guide: either the dialog is open, or its persistent reopen button exists ---
  // Walk every step and accumulate text: the guide is paginated, so checking only the
  // first step would miss content that lives on later steps.
  report.guide = await evalJs(`(async () => {
    let dialog = document.querySelector('[aria-label="首次使用引导"]')
    const reopenBefore = !!document.querySelector('[aria-label="重新打开使用引导"]')
    // A previous run may have closed it. Reopening through the persistent button also proves
    // the "repeatable trigger" requirement, not just the first-run auto show.
    if (!dialog && reopenBefore) {
      document.querySelector('[aria-label="重新打开使用引导"]').click()
      await new Promise(r => setTimeout(r, 700))
      dialog = document.querySelector('[aria-label="首次使用引导"]')
    }
    const reopen = document.querySelector('[aria-label="重新打开使用引导"]')
    const storageFlag = (() => { try { return window.localStorage.getItem('dsh-launcher:first-run-guide') } catch { return 'unavailable' } })()
    if (!dialog) return { dialogPresent: false, reopenButtonPresent: !!reopen, reopenWorked: false, storageFlag }
    const segments = dialog.parentElement ? dialog.querySelectorAll('span[style*="border-radius: 2px"], span[style*="height: 4px"]') : []
    let allText = dialog.textContent || ''
    let clicks = 0
    for (let i = 0; i < 12; i++) {
      const next = Array.from(document.querySelectorAll('[aria-label="首次使用引导"] button')).find(b => /下一步/.test(b.textContent || ''))
      if (!next) break
      next.click()
      clicks++
      await new Promise(r => setTimeout(r, 160))
      const d = document.querySelector('[aria-label="首次使用引导"]')
      if (d) allText += '\\n' + (d.textContent || '')
    }
    return {
      dialogPresent: true,
      reopenedViaButton: reopenBefore,
      reopenButtonPresent: reopenBefore || !!reopen,
      storageFlag,
      progressSegments: segments.length,
      stepsWalked: clicks + 1,
      totalTextLength: allText.length,
      mentionsInstanceCreation: /创建实例|新建实例/.test(allText),
      mentionsStart: /启动实例|点「启动」|状态会经历/.test(allText),
      mentionsPortAndStateRoot: /端口/.test(allText) && /(DSH_HOME|dsh-home|状态根|electron-user-data)/.test(allText),
      mentionsStop: /停止/.test(allText),
      mentionsTray: /托盘/.test(allText),
      mentionsBackToLauncher: /返回启动页/.test(allText),
    }
  })()`)

  // --- navigate to the manager surface and open the new inventory view ---
  report.nav = await evalJs(`(async () => {
    // The guide is a fixed overlay at zIndex 4000; it would swallow nav clicks, so close it first.
    const guideDialog = document.querySelector('[aria-label="首次使用引导"]')
    if (guideDialog) {
      const closeGuide = guideDialog.querySelector('[aria-label="关闭引导"]')
      if (closeGuide) { closeGuide.click(); await new Promise(r => setTimeout(r, 500)) }
    }
    const managerVisible = () => { const m = document.querySelector('.manager-surface-host'); return !!m && !m.classList.contains('view-hidden') }
    let manageFound = false
    if (!managerVisible()) {
      // LauncherHome.tsx renders the manager entry as button.launcher-utility-button labelled
      // 管理. Target it precisely; scanning every launcher button risks firing unrelated actions.
      const manage = Array.from(document.querySelectorAll('.launcher-utility-button'))
        .find(b => /管理/.test((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '')))
      manageFound = !!manage
      if (manage) { manage.click(); await new Promise(r => setTimeout(r, 1500)) }
      if (!managerVisible()) {
        const fallback = Array.from(document.querySelectorAll('.launcher-surface-host button'))
          .find(b => /管理/.test((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '')))
        if (fallback) { fallback.click(); await new Promise(r => setTimeout(r, 1500)) }
      }
    }
    const entries = Array.from(document.querySelectorAll('nav[aria-label="主导航"] button, nav[aria-label="主导航"] a'))
    const target = entries.find(el => /本机 DSH 发行体/.test((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '')))
    if (!target) return { managerVisible: managerVisible(), navEntryFound: false, navLabels: entries.map(e => ((e.textContent || '') + '|' + (e.getAttribute('aria-label') || '')).trim()).slice(0, 12) }
    target.click()
    await new Promise(r => setTimeout(r, 1500))
    return { managerVisible: managerVisible(), navEntryFound: true, navLabels: entries.map(e => ((e.textContent || '') + '|' + (e.getAttribute('aria-label') || '')).trim()).slice(0, 12) }
  })()`)

  report.inventory = await evalJs(`(async () => {
    const deadline = Date.now() + 20000
    let view = null
    while (Date.now() < deadline) {
      view = document.querySelector('[aria-label="本机 DSH 发行体清单"]')
      if (view && (view.textContent || '').length > 200) break
      await new Promise(r => setTimeout(r, 500))
    }
    if (!view) return { rendered: false }
    const text = view.textContent || ''
    return {
      rendered: true,
      textLength: text.length,
      showsOfficialRunner: /official-0\\.1\\.7-alpha\\.1|0\\.1\\.7-alpha\\.1/.test(text),
      showsLiveFork: /live-downstream-fork|cherrchen|0\\.1\\.2-beta\\.2/.test(text),
      showsRc12: /rc12-sdkwork|0\\.1\\.0-rc\\.12|sdkwork-ai/.test(text),
      showsSha256: /[0-9a-f]{64}/.test(text),
      showsTierVerdict: /A 档|C 档/.test(text),
      explainsWhyNotIsolatable: /不能注册为可启动实例|为什么不能/.test(text),
      showsSharedSurfaces: /共享面|HKCU|updater/.test(text),
      showsReadFailure: /清单读取失败/.test(text),
    }
  })()`)

  const inv = report.inventory || {}
  const guide = report.guide || {}
  report.verdict = {
    guideAvailable: !!(guide.dialogPresent || guide.reopenButtonPresent),
    // The objective fixes the guide's required coverage, so assert the content, not just presence.
    guideCoversRequiredTopics: !!(guide.mentionsInstanceCreation && guide.mentionsStart && guide.mentionsPortAndStateRoot
      && guide.mentionsStop && guide.mentionsTray && guide.mentionsBackToLauncher),
    navEntryAdded: !!(report.nav && report.nav.navEntryFound),
    inventoryRendered: !!inv.rendered,
    inventoryNotReadFailure: !!inv.rendered && !inv.showsReadFailure,
    showsAllThreeDistributions: !!(inv.showsOfficialRunner && inv.showsLiveFork && inv.showsRc12),
    showsSha256: !!inv.showsSha256,
    showsTierAndReason: !!(inv.showsTierVerdict && inv.explainsWhyNotIsolatable),
  }
  report.verdict.PASS = Object.entries(report.verdict).every(([key, value]) => key === 'PASS' || value === true)

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  client.close()
  if (!report.verdict.PASS) process.exitCode = 2
}

main().catch(e => { process.stderr.write(`ERROR: ${(e && e.stack) || e}\n`); process.exitCode = 1 })
