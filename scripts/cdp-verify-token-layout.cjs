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
// Verify the token usage number reads left-to-right (adjacent to label, not pushed right).
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
  await ev(`(async () => {
    const deadline = Date.now() + 90000
    while (Date.now() < deadline) { if (document.querySelector('.instance-card__usage')) return true; await new Promise(r => setTimeout(r, 500)) }
    return false
  })()`)
  const out = await ev(`(() => {
    const b = document.querySelector('.instance-card__usage')
    if (!b) return null
    const cs = getComputedStyle(b)
    const span = b.querySelector('span')
    const small = b.querySelector('small')
    const br = b.getBoundingClientRect()
    const sr = span.getBoundingClientRect()
    const mr = small.getBoundingClientRect()
    return {
      justify: cs.justifyContent,
      fullWidth: Math.round(br.width) >= Math.round(document.querySelector('.instance-card').getBoundingClientRect().width) - 32,
      labelLeft: Math.round(sr.left - br.left),
      numLeft: Math.round(mr.left - br.left),
      numRightGap: Math.round(br.right - mr.right),
      text: b.innerText,
    }
  })()`)
  const verdict = {
    justifyStart: out && out.justify === 'flex-start',
    numberAdjacent: out && out.numLeft < 200, // 数字紧跟标签（左对齐），不再被推到最右
    backgroundStillWide: out && out.numRightGap > 100, // 底框仍铺满整行（背景不受影响）
  }
  verdict.PASS = out !== null && Object.values(verdict).every(v => v === true)
  process.stdout.write(`${JSON.stringify({ out, verdict }, null, 2)}\n`)
  client.close()
  if (!verdict.PASS) process.exitCode = 2
}

main().catch(e => { process.stderr.write(`ERROR: ${(e && e.stack) || e}\n`); process.exitCode = 1 })
