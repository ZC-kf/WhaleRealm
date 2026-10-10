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
// Verify batch-16 changes in the packaged Hub over CDP:
//   item1 mutual exclusion, item2 checkbox->toggle, item3 number keypad,
//   item4 style presets, item5 token full-width, item6 click-anywhere selection.
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

  // item2: checkbox -> toggle (appearance none)
  report.checkboxToggle = await ev(`(() => {
    // open settings to access a checkbox
    const sb = document.querySelector('[aria-label="启动器设置"]')
    if (!sb) return null
    sb.click()
    return true
  })()`)

  // item1 + item4: settings dialog checks
  report.settings = await ev(`(async () => {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) { if (document.querySelector('.settings-dialog')) break; await new Promise(r => setTimeout(r, 200)) }
    const dialog = document.querySelector('.settings-dialog')
    if (!dialog) return null
    const checkbox = dialog.querySelector('input[type="checkbox"]')
    const appearance = checkbox ? getComputedStyle(checkbox).appearance : null
    const text = dialog.innerText || ''

    // item1: mutual exclusion — click auto-close, auto-minimize should uncheck
    const fields = Array.from(dialog.querySelectorAll('.check-field'))
    const autoCloseField = fields.find(f => /自动关闭/.test(f.textContent || ''))
    const autoMinField = fields.find(f => /自动最小化/.test(f.textContent || ''))
    let autoMinCheckedAfter = null
    if (autoCloseField && autoMinField) {
      autoCloseField.querySelector('input').click()
      await new Promise(r => setTimeout(r, 200))
      autoMinCheckedAfter = autoMinField.querySelector('input').checked
    }

    const hasPresets = text.includes('样式预设')
    const hasSaveStyle = Array.from(dialog.querySelectorAll('button')).some(b => /保存当前样式/.test(b.textContent || ''))

    const close = dialog.querySelector('.settings-close-button')
    if (close) close.click()
    return { appearance, hasPresets, hasSaveStyle, autoMinCheckedAfter }
  })()`)

  // item5: token full-width
  report.tokenFullWidth = await ev(`(() => {
    const btn = document.querySelector('.instance-card__usage-row .instance-card__usage')
    if (!btn) return null
    return getComputedStyle(btn).flexGrow === '1'
  })()`)

  // item6: click an action button selects the card
  report.selection = await ev(`(async () => {
    const cards = Array.from(document.querySelectorAll('.instance-card'))
    if (cards.length < 2) return { skipped: true }
    const secondDir = Array.from(cards[1].querySelectorAll('.instance-card__actions button')).find(b => /目录/.test(b.textContent || ''))
    if (!secondDir) return { noDir: true }
    secondDir.click()
    await new Promise(r => setTimeout(r, 200))
    const secondSelected = cards[1].classList.contains('is-selected')
    const selectedCount = cards.filter(c => c.classList.contains('is-selected')).length
    return { secondSelected, selectedCount }
  })()`)

  // item3: number keypad in port dialog
  report.keypad = await ev(`(async () => {
    const portBtn = Array.from(document.querySelectorAll('.instance-card__actions button')).find(b => /端口/.test(b.textContent || ''))
    if (!portBtn) return null
    portBtn.click()
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) { if (document.querySelector('.port-dialog')) break; await new Promise(r => setTimeout(r, 200)) }
    const dialog = document.querySelector('.port-dialog')
    if (!dialog) return null
    const trigger = dialog.querySelector('.number-field-trigger')
    if (!trigger) return null
    trigger.click()
    await new Promise(r => setTimeout(r, 300))
    const popover = document.querySelector('.number-field-popover')
    if (!popover) return null
    const padButtons = popover.querySelectorAll('.number-field-pad button').length
    const stepperButtons = popover.querySelectorAll('.number-field-stepper button').length
    const close = dialog.querySelector('.icon-button')
    if (close) close.click()
    return { padButtons, stepperButtons }
  })()`)

  client.close()

  const s = report.settings ?? {}
  report.verdict = {
    ready: report.ready,
    checkboxIsToggle: s.appearance === 'none',
    mutualExclusion: s.autoMinCheckedAfter === false,
    stylePresetsPresent: s.hasPresets === true && s.hasSaveStyle === true,
    tokenFullWidth: report.tokenFullWidth === true,
    clickAnywhereSelects: report.selection?.secondSelected === true && report.selection?.selectedCount === 1,
    numberKeypadWorks: report.keypad?.padButtons === 12 && report.keypad?.stepperButtons === 2,
  }
  report.verdict.PASS = Object.values(report.verdict).every(v => v === true)

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!report.verdict.PASS) process.exitCode = 2
}

main().catch(e => { process.stderr.write(`ERROR: ${(e && e.stack) || e}\n`); process.exitCode = 1 })
