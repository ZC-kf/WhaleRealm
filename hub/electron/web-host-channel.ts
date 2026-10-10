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
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Socket } from 'node:net'

export type HostMessage = { type: 'hello' | 'start' | 'ready' | 'open' | 'opened' | 'stop' | 'failed'; request?: number }
const types = new Set(['hello', 'start', 'ready', 'open', 'opened', 'stop', 'failed'])
/** Direction + sequence are authenticated, preventing reflection and replay. No URLs or paths on this channel. */
export function webHostChannel(socket: Socket, key: string, role: 'parent' | 'child', receive: (message: HostMessage) => void, failed: () => void) {
  let sent = 0, received = 0, buffer = '', dead = false
  const digest = (direction: string, sequence: number, payload: string) => createHmac('sha256', key).update(`${direction}:${sequence}:${payload}`).digest()
  const fail = () => { if (!dead) { dead = true; socket.destroy(); failed() } }
  socket.setEncoding('utf8')
  socket.on('error', fail)
  socket.on('close', fail)
  socket.on('data', (data: string) => {
    buffer += data
    if (buffer.length > 8192) { fail(); return }
    let end: number
    while (!dead && (end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
      try {
        const frame = JSON.parse(line)
        if (typeof frame.payload !== 'string' || typeof frame.mac !== 'string' || !/^[a-f0-9]{64}$/.test(frame.mac)) throw new Error('Invalid frame')
        const expected = digest(role === 'parent' ? 'child' : 'parent', received++, frame.payload)
        if (!timingSafeEqual(expected, Buffer.from(frame.mac, 'hex'))) throw new Error('Invalid authentication')
        const message = JSON.parse(frame.payload) as HostMessage
        if (!types.has(message.type) || Object.keys(message).some(name => name !== 'type' && name !== 'request') || (message.request !== undefined && (!Number.isSafeInteger(message.request) || message.request < 1))) throw new Error('Invalid message')
        receive(message)
      } catch { fail() }
    }
  })
  return {
    send(message: HostMessage) {
      if (dead || socket.destroyed) throw new Error('Web host channel is closed')
      const payload = JSON.stringify(message)
      socket.write(JSON.stringify({ payload, mac: digest(role, sent++, payload).toString('hex') }) + '\n')
    },
    close() { dead = true; socket.destroy() },
  }
}
