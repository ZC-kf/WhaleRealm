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
import { app, session } from 'electron'
import { connect } from 'node:net'
import { managedWebHostLayout, type WebHostBootstrap } from './web-host-contract'
import { webHostChannel } from './web-host-channel'
import { prepareWebLayout, probeWebReady } from './adapters/official-web'
import { spawnWebRunner, webNodeExeIn, dshBinIn } from './web-runtime'
import { approveInstanceWebWindow, openInstanceWebWindow, revokeInstanceWebWindow } from './instance-web-window'

export async function runWebHost(bootstrap: WebHostBootstrap): Promise<void> {
  const { record, controlPort, key } = bootstrap
  const layout = managedWebHostLayout(record)
  const abort = new AbortController()
  let started = false, ready = false, ending = false
  let browserOpened = false
  const socket = connect(controlPort, '127.0.0.1')
  const finish = () => {
    if (ending) return
    ending = true; ready = false; abort.abort()
    revokeInstanceWebWindow(record.id)
    // Root exit makes the outer parent-owned Job terminate every descendant.
    app.exit(1)
  }
  const timeout = setTimeout(finish, 15000)
  const channel = webHostChannel(socket, key, 'child', message => {
    if (message.type === 'start' && !started && message.request === undefined) {
      started = true; clearTimeout(timeout)
      void start().catch(() => { try { channel.send({ type: 'failed' }) } finally { finish() } })
    } else if (message.type === 'stop' && message.request === undefined) {
      if (ending) return
      ending = true; ready = false; abort.abort()
      void (async () => {
        if (browserOpened) {
          const isolated = session.fromPath(layout.electronUserData)
          isolated.flushStorageData()
          await isolated.cookies.flushStore()
        }
      })().finally(() => { revokeInstanceWebWindow(record.id); app.exit(0) })
    } else if (message.type === 'open' && ready && message.request) {
      void openInstanceWebWindow(record.id, `http://127.0.0.1:${record.port}`).then(() => {
        if (!ending) channel.send({ type: 'opened', request: message.request })
      }).catch(finish)
    } else { finish() }
  }, finish)
  socket.once('connect', () => channel.send({ type: 'hello' }))
  app.on('before-quit', finish)
  app.on('render-process-gone', finish)
  app.on('child-process-gone', (_event, details) => { if (details.type === 'GPU' && details.reason === 'crashed') finish() })
  async function start() {
    await app.whenReady(); abort.signal.throwIfAborted()
    const patch = await prepareWebLayout(layout)
    const backend = await spawnWebRunner({ id: record.id, port: record.port, lockName: record.lockName,
      ...layout, node: webNodeExeIn(layout.runtimeRoot), binJs: dshBinIn(layout.runtimeRoot), patch }, undefined, abort.signal)
    void backend.exited.then(finish, finish)
    const url = await backend.waitReady(url => probeWebReady(url, abort.signal), 90000)
    abort.signal.throwIfAborted()
    approveInstanceWebWindow(record.id, record.port, layout.electronUserData)
    await openInstanceWebWindow(record.id, url)
    browserOpened = true
    abort.signal.throwIfAborted()
    ready = true
    channel.send({ type: 'ready' })
  }
}
