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
import { randomBytes } from 'node:crypto'
import { createServer, type Socket } from 'node:net'
import { buildWebEnvironment } from './instance-env'
import { bounded, spawnOwnedProcess, type OwnedProcess } from './process-supervisor'
import { webHostChannel } from './web-host-channel'
import { managedWebHostLayout, WEB_HOST_ENV, WEB_HOST_SWITCH } from './web-host-contract'
import type { DesktopInstanceRecord } from './instance-types'
import type { RuntimeHandle } from './runtime-adapter'

/** Only this parent-owned Job handle can authorize stop/exit. The Hub never opens instance storage. */
export async function launchWebHost(record: DesktopInstanceRecord, signal: AbortSignal): Promise<RuntimeHandle> {
  const layout = managedWebHostLayout(record)
  signal.throwIfAborted()
  const { app } = await import('electron')
  const key = randomBytes(32).toString('hex')
  let owner: OwnedProcess | undefined, channel: ReturnType<typeof webHostChannel> | undefined
  let live = false, ended = false, nextRequest = 0, authenticated = false
  const sockets = new Set<Socket>()
  const requests = new Map<number, { resolve(): void; reject(error: Error): void }>()
  let resolveReady!: (url: string) => void, rejectReady!: (error: Error) => void
  const ready = new Promise<string>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  void ready.catch(() => {})
  const retire = () => {
    if (ended) return
    ended = true; live = false
    signal.removeEventListener('abort', onAbort)
    rejectReady(new Error('Web host is no longer available'))
    for (const request of requests.values()) request.reject(new Error('Web host is no longer available'))
    requests.clear()
  }
  const revoke = () => {
    retire()
    for (const socket of sockets) socket.destroy()
    server.close()
  }
  let stopping: Promise<void> | undefined
  const stop = (): Promise<void> => {
    retire()
    if (!owner) { revoke(); return Promise.resolve() }
    if (!stopping) stopping = (async () => {
      // Give Chromium a bounded opportunity to flush durable storage; only Job exit is proof.
      try {
        channel?.send({ type: 'stop' })
        await bounded(owner!.exited, 2000, 'Web host storage flush')
      } catch { /* The owned Job below remains the termination authority. */ }
      finally { revoke() }
      await owner!.stop(); await owner!.exited
    })().finally(() => { stopping = undefined })
    return stopping
  }
  const onAbort = () => { void stop().catch(() => {}) }
  const server = createServer(socket => {
    if (authenticated || sockets.size >= 8 || ended) { socket.destroy(); return }
    sockets.add(socket)
    socket.setTimeout(5000, () => socket.destroy())
    socket.on('close', () => sockets.delete(socket))
    let accepted = false
    const candidate = webHostChannel(socket, key, 'parent', message => {
      if (!accepted) {
        if (message.type !== 'hello' || message.request !== undefined || authenticated) { socket.destroy(); return }
        accepted = true; authenticated = true; channel = candidate
        socket.setTimeout(0)
        for (const other of sockets) if (other !== socket) other.destroy()
        server.close()
        candidate.send({ type: 'start' })
      } else if (message.type === 'ready' && !live && message.request === undefined) {
        if (ended || signal.aborted) return
        live = true; resolveReady(`http://127.0.0.1:${record.port}`)
      } else if (message.type === 'opened' && message.request && requests.has(message.request)) {
        requests.get(message.request)!.resolve(); requests.delete(message.request)
      } else { revoke() }
    }, () => { if (accepted) revoke() })
  })
  server.on('error', revoke)
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
    })
    signal.throwIfAborted()
    const address = server.address()
    if (!address || typeof address === 'string' || address.port === 3080) throw new Error('Web host control unavailable')
    // Dev reuses the installed Electron and package entry; packaged uses this same executable.
    const args = [...(app.isPackaged ? [] : [app.getAppPath()]), WEB_HOST_SWITCH]
    const env = buildWebEnvironment(layout, process.env)
    env[WEB_HOST_ENV] = JSON.stringify({ record, controlPort: address.port, key })
    owner = await spawnOwnedProcess(process.execPath, args, { cwd: layout.workspace, env })
    void owner.exited.then(revoke, revoke)
    if (signal.aborted || ended) { await stop(); signal.throwIfAborted(); throw new Error('Web host startup ended') }
    const readyWithinDeadline = bounded(ready, 120000, 'Web host readiness').catch(error => { revoke(); throw error })
    void readyWithinDeadline.catch(() => {})
    return {
      pid: owner.pid, url: '', exited: owner.exited, ready: readyWithinDeadline,
      pause: () => owner!.pause(), resume: () => owner!.resume(),
      stop,
      async open() {
        if (!live || ended || signal.aborted || !channel) throw new Error('Web host is not running')
        const request = ++nextRequest
        try {
          await bounded(new Promise<void>((resolve, reject) => {
            requests.set(request, { resolve, reject }); channel!.send({ type: 'open', request })
          }), 15000, 'Web host reopen')
          if (!live || ended || signal.aborted) throw new Error('Web host is not running')
        } finally { requests.delete(request) }
      },
    }
  } catch (error) {
    revoke()
    if (owner) await owner.stop()
    throw error
  }
}
