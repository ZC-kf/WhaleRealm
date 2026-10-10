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
/**
 * Launch ONE registered instance through the Hub's own runner modules and hold it
 * open until a stop flag appears. Used to verify per-instance behaviour (login state,
 * window geometry, port ownership) without going through the full smoke harness.
 *
 * Usage: tsx scripts/launch-one-instance.ts <instanceId> [holdSeconds]
 */
import { existsSync } from 'node:fs'
import { mkdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInstanceRegistry } from '../hub/electron/instance-registry'
import { spawnOfficialDesktopRunner } from '../hub/electron/official-runner'

const HUB = process.env.DSH_HUB_ROOT ?? fileURLToPath(new URL('..', import.meta.url))
const STOP_FLAG = path.join(HUB, 'manifests', 'launch-one-stop.flag')

function log(message: string): void {
  process.stdout.write(`[launch-one] ${message}\n`)
}

async function portListening(port: number): Promise<boolean> {
  const net = await import('node:net')
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port })
    socket.setTimeout(1500)
    const finish = (value: boolean): void => { socket.destroy(); resolve(value) }
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

async function main(): Promise<void> {
  const id = process.argv[2]
  if (!id) throw new Error('usage: launch-one-instance.ts <instanceId> [holdSeconds]')
  const holdSeconds = Number(process.argv[3] ?? 240)

  const registry = createInstanceRegistry(HUB)
  const record = await registry.get(id)
  const runner = record.runtimeRoot ? path.join(record.runtimeRoot, 'DeepSeek Harness.exe') : ''
  if (!runner || !existsSync(runner)) throw new Error(`instance ${id} has no isolatable runner (runtimeRoot=${record.runtimeRoot || 'unset'})`)

  for (const dir of [record.dshHome, record.electronUserData, record.workspace, record.logs, record.desktopProfile]) {
    await mkdir(dir, { recursive: true })
  }
  if (existsSync(STOP_FLAG)) await unlink(STOP_FLAG)

  const logFile = path.join(record.logs, `launch-one-${Date.now()}.log`)
  const stream = (await import('node:fs')).createWriteStream(logFile, { flags: 'a' })
  const handle = await spawnOfficialDesktopRunner({
    id: record.id,
    dshHome: record.dshHome,
    electronUserData: record.electronUserData,
    workspace: record.workspace,
    port: record.port,
    lockName: record.lockName,
    runnerExecutable: runner,
  }, text => { stream.write(text) })
  await registry.markRunning(record.id)

  let listening = false
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (await portListening(record.port)) { listening = true; break }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  process.stdout.write(`${JSON.stringify({
    id: record.id, pid: handle.pid, port: record.port, listening,
    dshHome: record.dshHome, userData: record.electronUserData,
    desktopProfile: record.desktopProfile, lockName: record.lockName, logFile,
  })}\n`)

  const holdUntil = Date.now() + holdSeconds * 1000
  while (Date.now() < holdUntil && !existsSync(STOP_FLAG)) {
    await new Promise(resolve => setTimeout(resolve, 1500))
  }
  await handle.stop()
  await registry.markStopped(record.id).catch(() => undefined)
  stream.end()
  if (existsSync(STOP_FLAG)) await unlink(STOP_FLAG)
  log(`stopped ${record.id} pid=${handle.pid}`)
}

main().then(() => { process.exitCode = 0 }).catch((error: unknown) => {
  process.stderr.write(`LAUNCH_ONE_ERROR: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
