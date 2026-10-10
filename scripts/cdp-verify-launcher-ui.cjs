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
// Verify launcher-surface instance card styling (issue 1) and the relocated
// back-to-launcher control (issue 3) in the packaged Hub, over CDP.
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
  // The frameless window also hosts a data: page used only for the drop shadow; it has no
  // app DOM. Always select the target whose URL is the packaged index.html.
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
    while (Date.now() < deadline) { if (document.querySelector('.launcher-surface-host')) return { ready: true } ; await new Promise(r => setTimeout(r, 500)) }
    return { ready: false }
  })()`)

  // Close the first-run guide so it cannot obscure measurements.
  await ev(`(async () => { const d = document.querySelector('[aria-label="首次使用引导"]'); if (d) { const c = d.querySelector('[aria-label="关闭引导"]'); if (c) c.click(); await new Promise(r => setTimeout(r, 600)) } return true })()`)

  report.cards = await ev(`(() => {
    const card = document.querySelector('.instance-card')
    if (!card) return { found: false }
    const select = card.querySelector('.instance-card__select')
    const strong = select ? select.querySelector('strong') : null
    const span = select ? select.querySelector('span') : null
    const small = select ? select.querySelector('small') : null
    const actionBtn = card.querySelector('.instance-card__actions button')
    const cs = el => el ? getComputedStyle(el) : null
    const cardStyle = cs(card)
    const selectStyle = cs(select)
    const btnStyle = cs(actionBtn)
    const alphaOf = value => {
      const m = /rgba?\\(([^)]+)\\)/.exec(value || '')
      if (!m) return 1
      const parts = m[1].split(',').map(x => parseFloat(x))
      return parts.length >= 4 ? parts[3] : 1
    }
    const stacked = el => { const s = cs(el); return s && (s.display === 'block' || s.display === 'grid' || s.display === 'flex' || s.display === 'list-item') }
    return {
      found: true,
      cardCount: document.querySelectorAll('.instance-card').length,
      cardBackgroundAlpha: cardStyle ? alphaOf(cardStyle.backgroundColor) : -1,
      cardBackdropFilter: cardStyle ? cardStyle.backdropFilter : '',
      selectDisplay: selectStyle ? selectStyle.display : '',
      fieldsStacked: !!(stacked(strong) && stacked(span) && stacked(small)),
      strongColor: strong ? cs(strong).color : '',
      buttonColor: btnStyle ? btnStyle.color : '',
      buttonBackgroundAlpha: btnStyle ? alphaOf(btnStyle.backgroundColor) : -1,
      buttonText: actionBtn ? (actionBtn.textContent || '').trim() : '',
    }
  })()`)

  report.backBar = await ev(`(() => ({
    oldBarPresent: !!document.querySelector('.manager-back-bar'),
    oldLabeledBarPresent: !!document.querySelector('.manager-back-labeled'),
  })())`)

  report.back = await ev(`(async () => {
    const managerVisible = () => { const m = document.querySelector('.manager-surface-host'); return !!m && !m.classList.contains('view-hidden') }
    if (!managerVisible()) {
      const manage = Array.from(document.querySelectorAll('.launcher-utility-button')).find(b => /管理/.test(b.textContent || ''))
      if (manage) { manage.click(); await new Promise(r => setTimeout(r, 1600)) }
    }
    const navBack = document.querySelector('aside [aria-label="返回启动页"], .side-navigation-footer [aria-label="返回启动页"]')
    if (!navBack) return { managerVisible: managerVisible(), navBackFound: false }
    const rect = navBack.getBoundingClientRect()
    navBack.click()
    await new Promise(r => setTimeout(r, 1600))
    const launcherVisible = () => { const l = document.querySelector('.launcher-surface-host'); return !!l && !l.classList.contains('view-hidden') }
    return {
      managerVisibleBefore: managerVisible(),
      navBackFound: true,
      navBackSize: { w: Math.round(rect.width), h: Math.round(rect.height) },
      returnedToLauncher: launcherVisible(),
    }
  })()`)

  const cards = report.cards || {}
  const back = report.back || {}
  report.verdict = {
    cardsRendered: !!cards.found && (cards.cardCount || 0) > 0,
    cardHasOpaqueSurface: (cards.cardBackgroundAlpha || 0) > 0.4,
    fieldsNotConcatenated: cards.selectDisplay === 'grid' && cards.fieldsStacked === true,
    buttonsReadable: (cards.buttonColor || '').includes('255') && (cards.buttonBackgroundAlpha || 0) > 0.05,
    oldBlockingBarRemoved: report.backBar ? !report.backBar.oldBarPresent && !report.backBar.oldLabeledBarPresent : false,
    backControlInSideNav: back.navBackFound === true,
    backControlWorks: back.returnedToLauncher === true,
  }
  report.verdict.PASS = Object.entries(report.verdict).every(([key, value]) => key === 'PASS' || value === true)

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  ws.close()
  if (!report.verdict.PASS) process.exitCode = 2
}

main().catch(e => { process.stderr.write(`ERROR: ${(e && e.stack) || e}\n`); process.exitCode = 1 })
