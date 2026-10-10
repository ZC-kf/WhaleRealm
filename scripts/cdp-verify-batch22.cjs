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
// Verify batch-22: language category + instant language switch (sidebar labels change).
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

async function main() {
  const targets = await getJSON('/json/list')
  const page = targets.find(t => t.type === 'page' && /dist[\\/]index\.html(?:[?#]|$)/.test(t.url))
  if (!page) throw new Error('main renderer target not found')
  const client = await connect(page.webSocketDebuggerUrl)
  await client.send('Runtime.enable', {})
  const ev = async expression => {
    const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }

  const report = {}
  report.ready = await ev(`(async () => { const d = Date.now() + 90000; while (Date.now() < d) { if (document.querySelector('.instance-switcher')) return true; await new Promise(r => setTimeout(r, 500)) } return false })()`)
  await ev(`(() => { const g = document.querySelector('[aria-label="首次使用引导"]'); if (g) { const x = g.querySelector('[aria-label="关闭引导"]'); if (x) x.click() } return true })()`)

  report.result = await ev(`(async () => {
    const sb = document.querySelector('[aria-label="启动器设置"]')
    if (!sb) return { error: 'no settings gear' }
    sb.click()
    const d0 = Date.now() + 8000
    while (Date.now() < d0) { if (document.querySelector('.settings-dialog')) break; await new Promise(r => setTimeout(r, 150)) }
    const catsBefore = Array.from(document.querySelectorAll('.settings-category')).map(b => b.textContent.trim())
    // click language category
    const langCat = Array.from(document.querySelectorAll('.settings-category')).find(b => (b.textContent || '').includes('语言'))
    if (langCat) langCat.click()
    await new Promise(r => setTimeout(r, 300))
    const hasSection = !!document.getElementById('sec-language')
    const langOptions = Array.from(document.querySelectorAll('.settings-dialog .theme-option')).map(b => b.textContent.trim()).filter(t => t.length > 0)
    // click English
    const enOpt = Array.from(document.querySelectorAll('.settings-dialog .theme-option')).find(b => (b.textContent || '').includes('English'))
    if (enOpt) enOpt.click()
    await new Promise(r => setTimeout(r, 400))
    const catsAfter = Array.from(document.querySelectorAll('.settings-category')).map(b => b.textContent.trim())
    const close = document.querySelector('.settings-close-button')
    if (close) close.click()
    return { catsBefore, hasSection, langOptionCount: langOptions.length, catsAfter }
  })()`)

  client.close()

  const r = report.result ?? {}
  report.verdict = {
    ready: report.ready === true,
    hasLanguageCategory: Array.isArray(r.catsBefore) && r.catsBefore.some(c => c.includes('语言')),
    hasLanguageSection: r.hasSection === true,
    hasNineLanguages: (r.langOptionCount ?? 0) >= 9,
    switchToEnglish: Array.isArray(r.catsAfter) && r.catsAfter.includes('Appearance') && r.catsAfter.includes('Language'),
  }
  report.verdict.PASS = Object.values(report.verdict).every(v => v === true)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!report.verdict.PASS) process.exitCode = 2
}

main().catch(e => { process.stderr.write(`ERROR: ${(e && e.stack) || e}\n`); process.exitCode = 1 })
