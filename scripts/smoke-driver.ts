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
 * Real two-instance smoke driver.
 * Launches two official Desktop runners through the Hub's own instance modules,
 * waits for each loopback port, writes isolation evidence, then waits for a stop
 * flag before shutting both instances down.
 */
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInstanceRegistry } from '../hub/electron/instance-registry'
import { spawnOfficialDesktopRunner } from '../hub/electron/official-runner'
import { seedInstanceSkills } from '../hub/electron/skill-registry'

const HUB = process.env.DSH_HUB_ROOT ?? fileURLToPath(new URL('..', import.meta.url))
const RUNTIME_ROOT = path.join(HUB, 'runtimes', '0.1.7-alpha.1')
const RUNNER = path.join(RUNTIME_ROOT, 'DeepSeek Harness.exe')
const EVIDENCE = path.join(HUB, 'manifests', 'two-instance-smoke.json')
const STOP_FLAG = path.join(HUB, 'manifests', 'smoke-stop.flag')
const IDS = ['smoke-a', 'smoke-b']
const PORTS = [19391, 19392]
const SKILL = 'smoke-probe'

function log(message: string): void {
  process.stdout.write(`[smoke] ${new Date().toISOString()} ${message}\n`)
}

async function portListening(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port })
    socket.setTimeout(1500)
    const finish = (value: boolean) => { socket.destroy(); resolve(value) }
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await portListening(port)) return true
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  return false
}

function unique(values: string[]): boolean {
  return new Set(values.map(value => path.resolve(value).toLowerCase())).size === values.length
}

async function main(): Promise<void> {
  if (!existsSync(RUNNER)) throw new Error(`runner missing: ${RUNNER}`)
  const runnerSha256 = createHash('sha256').update(await readFile(RUNNER)).digest('hex')
  log(`runner sha256: ${runnerSha256}`)
  if (existsSync(STOP_FLAG)) await unlink(STOP_FLAG)

  const registry = createInstanceRegistry(HUB)
  for (const id of IDS) {
    try { await registry.remove(id) } catch { /* not registered yet */ }
    const root = path.join(HUB, 'instances', id)
    if (existsSync(root)) await rm(root, { recursive: true, force: true })
  }

  const sharedSkill = path.join(HUB, 'shared', 'skills', SKILL)
  await mkdir(sharedSkill, { recursive: true })
  await writeFile(path.join(sharedSkill, 'SKILL.md'), `# ${SKILL}\n\nTwo-instance isolation probe skill.\n`)

  const records = []
  for (let index = 0; index < IDS.length; index += 1) {
    const record = await registry.create({
      id: IDS[index],
      name: IDS[index],
      version: '0.1.7-alpha.1',
      port: PORTS[index],
      runtimeRoot: RUNTIME_ROOT,
    })
    for (const dir of [record.dshHome, record.electronUserData, record.workspace, record.logs, record.desktopProfile]) {
      await mkdir(dir, { recursive: true })
    }
    records.push(record)
  }

  const seededSkills = []
  for (const record of records) {
    const result = await seedInstanceSkills(record, [SKILL])
    const entry = result.seeded[0]
    if (!entry) throw new Error(`skill seeding produced no record for ${record.id}`)
    seededSkills.push(entry)
    log(`seeded skill for ${record.id}: ${entry.target} hash=${entry.targetHash.slice(0, 12)}`)
  }

  const running = []
  for (const record of records) {
    const logPath = path.join(record.logs, 'desktop.log')
    const stream = createWriteStream(logPath, { flags: 'a' })
    const handle = await spawnOfficialDesktopRunner({
      id: record.id,
      dshHome: record.dshHome,
      electronUserData: record.electronUserData,
      workspace: record.workspace,
      port: record.port,
      lockName: record.lockName,
      runnerExecutable: RUNNER,
    }, text => { stream.write(text) })
    await registry.markRunning(record.id)
    running.push({ record, handle, stream, logPath })
    log(`launched ${record.id} pid=${handle.pid} port=${record.port}`)
  }

  const readiness = []
  for (const item of running) {
    const ok = await waitForPort(item.record.port, 180_000)
    readiness.push({ id: item.record.id, ok })
    log(`${item.record.id} port ${item.record.port} listening=${ok}`)
  }

  const instances = running.map((item, index) => ({
    id: item.record.id,
    pid: item.handle.pid,
    port: item.record.port,
    portListening: readiness[index]?.ok === true,
    dshHome: item.record.dshHome,
    userData: item.record.electronUserData,
    desktopProfile: item.record.desktopProfile,
    workspace: item.record.workspace,
    logs: item.record.logs,
    lockName: item.record.lockName,
    runtimeRoot: RUNTIME_ROOT,
    runnerExecutable: RUNNER,
    logFile: item.logPath,
    skillPaths: seededSkills[index] ? [seededSkills[index].target] : [],
    skillHashes: seededSkills[index] ? [seededSkills[index].targetHash] : [],
  }))

  const distinct = {
    roots: unique(instances.flatMap(item => [item.dshHome, item.userData, item.desktopProfile, item.workspace, item.logs])),
    ports: new Set(instances.map(item => item.port)).size === instances.length,
    locks: unique(instances.map(item => item.lockName)),
    skills: unique(instances.flatMap(item => item.skillPaths)),
    pids: new Set(instances.map(item => item.pid)).size === instances.length,
  }

  await writeFile(EVIDENCE, `${JSON.stringify({
    schema: 'dsh-hub.two-instance-smoke.v1',
    generatedAt: new Date().toISOString(),
    officialCommit: 'c36a83ff6bb95e3f82cf79f9be7c724270a8aa61',
    version: '0.1.7-alpha.1',
    runnerSha256,
    instances,
    readiness,
    distinct,
  }, null, 2)}\n`, 'utf8')
  log(`evidence written: ${EVIDENCE}`)
  log(`distinct: ${JSON.stringify(distinct)}`)

  const deadline = Date.now() + 900_000
  while (Date.now() < deadline && !existsSync(STOP_FLAG)) {
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  log(existsSync(STOP_FLAG) ? 'stop flag observed; shutting down instances' : 'hold window elapsed; shutting down instances')

  for (const item of running) {
    await item.handle.stop()
    await registry.markStopped(item.record.id).catch(() => undefined)
    item.stream.end()
    log(`stopped ${item.record.id} pid=${item.handle.pid}`)
  }
  await new Promise(resolve => setTimeout(resolve, 3000))
  if (existsSync(STOP_FLAG)) await unlink(STOP_FLAG)
  log('smoke complete')
}

main().then(() => {
  process.exitCode = 0
}).catch((error: unknown) => {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`[smoke] fatal: ${detail}\n`)
  process.exitCode = 1
})
