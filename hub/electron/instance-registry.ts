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


import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { TextDecoder } from 'node:util'
import path from 'node:path'
import { resolveInstanceRecord, resolveInstancePaths } from './instance-paths'
import type { DesktopInstanceRecord } from './instance-types'
import { allocateLoopbackPort } from './port-allocator'

export type UpdateInstanceInput = Partial<Omit<DesktopInstanceRecord, 'id'>>
export type CreateInstanceInput = UpdateInstanceInput & { id: string }
export interface InstanceRegistry {
  list(): Promise<DesktopInstanceRecord[]>
  get(id: string): Promise<DesktopInstanceRecord>
  create(input: CreateInstanceInput): Promise<DesktopInstanceRecord>
  update(id: string, input: UpdateInstanceInput): Promise<DesktopInstanceRecord>
  remove(id: string): Promise<void>
  markRunning(id: string): Promise<void>
  markStopped(id: string): Promise<void>
  /** Claim a unique pending id before selfcheck, without publishing a record. */
  beginCreation(preferredId: string): Promise<string>
  /** Drop only the pending lease; any durable record continues reserving its port. */
  releaseCreation(id: string): Promise<void>
  reservePort(id: string, preferred: number): Promise<number>
}

interface RegistryState {
  tail: Promise<void>
  running: Set<string>
  pending: Map<string, number | undefined>
}
// Main has one registry. Sharing by root also prevents stale-cache races between
// separately constructed registry clients in this process; this is not an OS lock.
const states = new Map<string, RegistryState>()
function validate(bytes: string | Buffer): DesktopInstanceRecord[] {
  // Decode file bytes strictly: replacement characters must never normalize a
  // damaged recorded path into apparently valid recovery evidence.
  const text = typeof bytes === 'string' ? bytes : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  const parsed: unknown = JSON.parse(text)
  if (!Array.isArray(parsed)) throw new Error('instance registry must be an array')
  const ids = new Set<string>()
  const requiredStrings = ['root', 'dshHome', 'electronUserData', 'desktopProfile', 'workspace', 'logs', 'skillsSource', 'lockName']
  const optionalStrings = ['name', 'version', 'runtimeRoot', 'skills', 'adapterId', 'cache']
  for (const value of parsed) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid instance registry record')
    const record = value as Record<string, unknown>
    if (typeof record.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(record.id) || ids.has(record.id)) throw new Error('invalid or duplicate instance id')
    ids.add(record.id)
    if (requiredStrings.some(key => typeof record[key] !== 'string' || !record[key])) throw new Error('invalid instance registry path')
    if (optionalStrings.some(key => record[key] !== undefined && typeof record[key] !== 'string')) throw new Error('invalid instance registry string')
    if (['enabled', 'autoStart'].some(key => record[key] !== undefined && typeof record[key] !== 'boolean')) throw new Error('invalid instance registry flag')
    if (!Number.isInteger(record.port) || Number(record.port) < 1 || Number(record.port) > 65535) throw new Error('invalid instance registry port')
    if (record.layoutVersion !== undefined && record.layoutVersion !== 2) throw new Error('invalid instance layout version')
    if (record.instanceKind !== undefined && (typeof record.instanceKind !== 'string' || !['official-web', 'official-desktop', 'community-desktop'].includes(record.instanceKind))) throw new Error('invalid instance kind')
  }
  return parsed as DesktopInstanceRecord[]
}
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
const encode = (records: DesktopInstanceRecord[]) => `${JSON.stringify(records, null, 2)}\n`

export function createInstanceRegistry(hubRoot: string): InstanceRegistry {
  const root = path.resolve(hubRoot)
  const file = path.join(root, 'hub-data', 'instances.json')
  const backup = `${file}.bak`
  const key = process.platform === 'win32' ? root.toLowerCase() : root
  let state = states.get(key)
  if (!state) { state = { tail: Promise.resolve(), running: new Set(), pending: new Map() }; states.set(key, state) }
  const shared = state
  function run<T>(operation: () => Promise<T>): Promise<T> {
    const result = shared.tail.then(operation)
    shared.tail = result.then(() => undefined, () => undefined)
    return result
  }
  async function atomicWrite(target: string, bytes: string | Buffer): Promise<void> {
    await mkdir(path.dirname(target), { recursive: true })
    const temp = `${target}.tmp-${randomUUID()}`
    try {
      const handle = await open(temp, 'wx')
      try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
      // Replace in place. Never remove the authoritative generation first.
      await rename(temp, target)
    } finally {
      try { await unlink(temp) } catch (error) { if (!missing(error)) throw error }
    }
  }
  async function load(): Promise<DesktopInstanceRecord[]> {
    let bytes: Buffer | undefined
    try { bytes = await readFile(file) } catch (error) { if (!missing(error)) throw error }
    if (bytes !== undefined) {
      try { return validate(bytes) } catch { /* Recover only from an independently validated backup. */ }
    }
    let saved: Buffer
    try { saved = await readFile(backup) } catch (error) {
      if (bytes === undefined && missing(error)) return []
      throw new Error(`instance registry unreadable and backup unavailable: ${String(error)}`)
    }
    let recovered: DesktopInstanceRecord[]
    try { recovered = validate(saved) } catch (error) { throw new Error(`instance registry backup invalid; original preserved: ${String(error)}`) }
    if (bytes !== undefined) {
      // Keep exact damaged bytes, then atomically replace main. Backup is untouched.
      await atomicWrite(`${file}.corrupt-${randomUUID()}`, bytes)
    }
    await atomicWrite(file, saved)
    return recovered
  }
  async function save(current: DesktopInstanceRecord[], next: DesktopInstanceRecord[]): Promise<void> {
    validate(encode(next))
    // A complete previous generation is always recoverable, including the empty
    // baseline on the first write. Failed replacement never creates an empty gap.
    await atomicWrite(backup, encode(current))
    await atomicWrite(file, encode(next))
  }
  function find(records: DesktopInstanceRecord[], id: string) {
    const record = records.find(item => item.id === id)
    if (!record) throw new Error(`instance not found: ${id}`)
    return record
  }
  function requireStopped(id: string) { if (shared.running.has(id)) throw new Error(`instance is running: ${id}`) }
  function takenPorts(records: DesktopInstanceRecord[], id: string): Set<number> {
    return new Set([...records.filter(r => r.id !== id).map(r => r.port), ...[...shared.pending].filter(([pendingId, port]) => pendingId !== id && port !== undefined).map(([, port]) => port!)])
  }
  return {
    list: () => run(async () => (await load()).map(record => ({ ...record }))),
    get: id => run(async () => ({ ...find(await load(), id) })),
    create: input => run(async () => {
      const current = await load()
      if (current.some(item => item.id === input.id)) throw new Error(`instance already exists: ${input.id}`)
      const value = resolveInstanceRecord(root, input.id, input)
      const leasedPort = shared.pending.get(input.id)
      value.port = leasedPort ?? await allocateLoopbackPort(value.port, takenPorts(current, input.id))
      await save(current, [...current, value])
      shared.pending.delete(input.id)
      return { ...value }
    }),
    update: (id, input) => run(async () => {
      requireStopped(id)
      const current = await load(); const old = find(current, id)
      const value = resolveInstanceRecord(root, id, { ...old, ...input })
      if (input.port !== undefined) value.port = await allocateLoopbackPort(value.port, takenPorts(current, id))
      await save(current, current.map(record => record.id === id ? value : record))
      return { ...value }
    }),
    remove: id => run(async () => {
      requireStopped(id)
      const current = await load(); find(current, id)
      await save(current, current.filter(item => item.id !== id))
      shared.pending.delete(id)
    }),
    markRunning: id => run(async () => { find(await load(), id); shared.running.add(id) }),
    markStopped: id => run(async () => { shared.running.delete(id) }),
    beginCreation: preferredId => run(async () => {
      resolveInstancePaths(root, preferredId)
      const current = await load()
      let id = preferredId
      while (shared.pending.has(id) || current.some(record => record.id === id)) id = `${preferredId.slice(0, 27)}-${randomUUID()}`
      shared.pending.set(id, undefined)
      return id
    }),
    releaseCreation: id => run(async () => { shared.pending.delete(id) }),
    reservePort: (id, preferred) => run(async () => {
      requireStopped(id)
      const current = await load()
      const record = current.find(item => item.id === id)
      if (!record && !shared.pending.has(id)) throw new Error(`instance not found or pending: ${id}`)
      const port = await allocateLoopbackPort(preferred, takenPorts(current, id))
      if (record) await save(current, current.map(item => item.id === id ? { ...item, port } : item))
      else shared.pending.set(id, port)
      return port
    }),
  }
}
