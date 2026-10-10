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
// Verify the new instance-home + discovery UI (correction step 1) in the freshly
// built Hub over CDP. Read-only: it clicks only "scan" (scanMachine), never "import"
// or "start", so it writes nothing.
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
  const report = {}

  report.ready = await ev(`(async () => {
    const deadline = Date.now() + 90000
    while (Date.now() < deadline) { if (document.querySelector('.launcher-surface-host')) return { ready: true }; await new Promise(r => setTimeout(r, 500)) }
    return { ready: false }
  })()`)

  // Close the first-run guide so it cannot obscure the launcher home.
  await ev(`(async () => { const d = document.querySelector('[aria-label="首次使用引导"]'); if (d) { const c = d.querySelector('[aria-label="关闭引导"]'); if (c) c.click(); await new Promise(r => setTimeout(r, 700)) } return true })()`)

  report.instanceHome = await ev(`(() => {
    const header = document.querySelector('.instance-switcher__header h2')
    const scanBtn = Array.from(document.querySelectorAll('button')).find(b => /扫描并收录/.test(b.textContent || ''))
    const importBtn = Array.from(document.querySelectorAll('button')).find(b => /手动导入/.test(b.textContent || ''))
    const isolations = Array.from(document.querySelectorAll('.instance-card__isolation'))
    return {
      headerText: header ? header.textContent : '',
      cardCount: document.querySelectorAll('.instance-card').length,
      searchPresent: !!document.querySelector('input[aria-label="搜索实例"]'),
      scanButtonPresent: !!scanBtn,
      importButtonPresent: !!importBtn,
      isolationRowCount: isolations.length,
      firstIsolationText: isolations[0] ? isolations[0].textContent : '',
      hasChineseActionButtons: !!Array.from(document.querySelectorAll('.instance-card__actions button')).find(b => /启动|停止|重启/.test(b.textContent || '')),
    }
  })()`)

  // Click the read-only scan and observe the discovery results.
  await ev(`(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /扫描并收录/.test(x.textContent || '')); if (b) b.click(); return !!b })()`)
  report.discovery = await ev(`(async () => {
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) { if (document.querySelector('.instance-discovery-results')) break; await new Promise(r => setTimeout(r, 500)) }
    const rows = Array.from(document.querySelectorAll('.instance-discovery-row'))
    const badges = Array.from(document.querySelectorAll('.tier-badge')).map(b => (b.textContent || '').trim())
    const tierA = rows.filter(r => r.querySelector('.tier-A'))
    const tierC = rows.filter(r => r.querySelector('.tier-C'))
    const importIn = list => list.map(r => !!Array.from(r.querySelectorAll('button')).find(b => /收录/.test(b.textContent || '')))
    return {
      found: !!document.querySelector('.instance-discovery-results'),
      rowCount: rows.length,
      badges,
      tierACount: tierA.length,
      tierCCount: tierC.length,
      aHasImport: importIn(tierA),
      cHasImport: importIn(tierC),
    }
  })()`)

  const h = report.instanceHome
  const d = report.discovery
  report.verdict = {
    instanceHomeRendered: h.headerText !== '' && h.cardCount === 6,
    searchPresent: h.searchPresent,
    scanImportButtonsPresent: h.scanButtonPresent && h.importButtonPresent,
    isolationMetadataShown: h.isolationRowCount >= 6 && /DSH_HOME/.test(h.firstIsolationText),
    localizedActions: h.hasChineseActionButtons,
    scanPopulatesDiscovery: d.found && d.rowCount > 0,
    tiersShown: d.badges.some(b => b.startsWith('A')) && d.badges.some(b => b.startsWith('C')),
    cTierReadOnly: d.tierCCount > 0 && d.cHasImport.every(v => v === false),
    aTierImportable: d.tierACount > 0 && d.aHasImport.some(v => v === true),
  }
  report.verdict.PASS = Object.entries(report.verdict).every(([key, value]) => key === 'PASS' || value === true)

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  ws.close()
  if (!report.verdict.PASS) process.exitCode = 2
}

main().catch(e => { process.stderr.write(`ERROR: ${(e && e.stack) || e}\n`); process.exitCode = 1 })
