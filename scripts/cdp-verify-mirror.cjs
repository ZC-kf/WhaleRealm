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
// Verify the per-instance mirror section renders in the detail modal.
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
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params: params || {} }))
  })
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject) })
  ws.addEventListener('message', event => {
    const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString())
    if (msg.id === undefined || !pending.has(msg.id)) return
    pending.get(msg.id).resolve(msg.result)
    pending.delete(msg.id)
  })
  await send('Runtime.enable')
  const ev = async expression => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value

  await ev(`(async () => { const d = document.querySelector('[aria-label="首次使用引导"]'); if (d) { const c = d.querySelector('[aria-label="关闭引导"]'); if (c) c.click(); await new Promise(r => setTimeout(r, 500)) } return true })()`)
  const r = await ev(`(async () => {
    const b = Array.from(document.querySelectorAll('.instance-card__actions button')).find(x => /详情/.test(x.textContent || ''))
    b?.click()
    await new Promise(r => setTimeout(r, 1400))
    const txt = document.querySelector('.instance-detail-modal')?.innerText || ''
    return {
      mirrorSection: txt.includes('实例镜像'),
      checkBtn: txt.includes('检查变动'),
      updateBtn: txt.includes('更新镜像'),
      restoreBtn: txt.includes('校正还原'),
    }
  })()`)
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`)
  ws.close()
  if (!r.mirrorSection || !r.checkBtn || !r.updateBtn || !r.restoreBtn) process.exitCode = 2
}

main().catch(e => { process.stderr.write(`ERROR: ${(e && e.stack) || e}\n`); process.exitCode = 1 })
