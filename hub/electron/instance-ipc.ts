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

import type { DesktopInstanceRecord } from './instance-types'
import type { InstanceRegistry, CreateInstanceInput } from './instance-registry'
import type { RuntimeSupervisor } from './runtime-supervisor'
import type { InstanceImportResult } from '../src/types'
import { scanMachine, importByPath, detectKindFromDir, type DiscoveredInstall, type ScanOptions } from './instance-discovery'
import { operationsForRegistry, type InstanceOperations } from './instance-operations'
import { diffMirror, listMirrorHistory, restoreMirror, restoreMirrorTo, snapshotMirror, type MirrorDiff } from './instance-mirror'
import { mkdir } from 'node:fs/promises'
import { verifyInstanceOwnership } from './instance-ownership'

export const INSTANCE_IPC = {
  list: 'instances:list',
  create: 'instances:create',
  select: 'instances:select',
  start: 'instances:start',
  open: 'instances:open',
  stop: 'instances:stop',
  restart: 'instances:restart',
  pause: 'instances:pause',
  resume: 'instances:resume',
  port: 'instances:port',
  rename: 'instances:rename',
  mirrorStatus: 'instances:mirror-status',
  mirrorUpdate: 'instances:mirror-update',
  mirrorRestore: 'instances:mirror-restore',
  mirrorHistory: 'instances:mirror-history',
  mirrorRestoreTo: 'instances:mirror-restore-to',
  states: 'instances:states',
  discover: 'instances:discover',
  import: 'instances:import',
  delete: 'instances:delete',
  findShortcuts: 'instances:find-shortcuts',
  removeShortcuts: 'instances:remove-shortcuts',
} as const

interface IpcRegistrar { handle(channel: string, listener: (...args: any[]) => unknown): unknown }
interface DiscoveryApi { scanMachine(options: ScanOptions): DiscoveredInstall[]; importByPath(rawPath: string, options: ScanOptions): DiscoveredInstall }
const defaultDiscovery: DiscoveryApi = { scanMachine, importByPath }

/** 删除实例所需的外部能力（回收站、扫描跳过清单、快捷方式检测），由 main 装配注入以保持本模块无 electron 依赖。 */
export interface InstanceDeleteDeps {
  openExternal?: (url: string) => Promise<void>
  trash: (path: string) => Promise<void>
  readSkipPaths: () => string[]
  addSkip: (path: string, permanent: boolean, until: number | null) => Promise<void>
  findShortcuts: (runtimeRoot: string) => string[]
}

function discoveryId(install: DiscoveredInstall): string {
  const base = install.path.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
  return `imported-${base.slice(-48) || 'desktop'}`
}

/**
 * 收录一个既有发行体并创建实例；返回结果与 import IPC 一致。
 */
export async function importAndCreateInstance(
  registry: InstanceRegistry,
  discovery: DiscoveryApi | undefined,
  scanOptions: ScanOptions,
  rawPath: string,
  nameOverride?: string,
  operations: InstanceOperations = operationsForRegistry(registry),
): Promise<InstanceImportResult> {
  const disc = discovery ?? defaultDiscovery
  const install = disc.importByPath(rawPath, scanOptions)
  if (!install.isolatable) return { ok: true, registered: false, install, reason: `该发行体不可隔离托管，仅收录到清单：${install.reason}` }
  const records = await registry.list()
  const existing = records.find(record => record.runtimeRoot?.toLowerCase() === install.path.toLowerCase())
  if (existing) return { ok: true, registered: true, existing, install }
  const id = discoveryId(install)
  const uniqueId = records.some(record => record.id === id) ? `${id}-${Date.now().toString(36)}` : id
  return operations.run(uniqueId, async () => {
    const record = await registry.create({ id: uniqueId, name: nameOverride ?? (install.version ? `DSH ${install.version}` : install.exeName), version: install.version ?? undefined, runtimeRoot: install.path, instanceKind: install.instanceKind ?? undefined })
    try {
      for (const dir of [record.dshHome, record.workspace]) await mkdir(dir, { recursive: true })
      const status = await diffMirror(record.root, [record.dshHome, record.workspace])
      if (!status.snapshotAt) await snapshotMirror(record.root, [record.dshHome, record.workspace])
    } catch (error) {
      return { ok: false, registered: true, record, install, error: `实例已收录，但镜像失败：${error instanceof Error ? error.message : String(error)}` }
    }
    return { ok: true, registered: true, record, install }
  })
}

export function registerInstanceIpcHandlers(ipc: IpcRegistrar, registry: InstanceRegistry, supervisor: RuntimeSupervisor, discovery: DiscoveryApi = defaultDiscovery, scanOptions?: ScanOptions, deps?: InstanceDeleteDeps, operations: InstanceOperations = operationsForRegistry(registry)): void {
  const requireConfirmedStop = (id: string) => {
    const state = supervisor.state(id)
    if (!['stopped', 'crashed'].includes(state.status) || state.pid || state.cleanupPending) throw new Error(`instance is running or process exit is not confirmed: ${id}`)
  }
  const startRequests = new Map<string, Set<AbortController>>()
  // Wrap at the route boundary only: helpers called inside an operation must not
  // reacquire its id. Registry's independent global queue is safe inside these.
  const queued = new Set<string>([INSTANCE_IPC.create, INSTANCE_IPC.open, INSTANCE_IPC.start, INSTANCE_IPC.stop, INSTANCE_IPC.restart, INSTANCE_IPC.pause, INSTANCE_IPC.resume, INSTANCE_IPC.port, INSTANCE_IPC.rename, INSTANCE_IPC.mirrorStatus, INSTANCE_IPC.mirrorUpdate, INSTANCE_IPC.mirrorRestore, INSTANCE_IPC.mirrorHistory, INSTANCE_IPC.mirrorRestoreTo, INSTANCE_IPC.delete, INSTANCE_IPC.findShortcuts, INSTANCE_IPC.removeShortcuts])
  const handle = (channel: string, listener: (...args: any[]) => unknown) => ipc.handle(channel, (...args: any[]) => {
    if (channel === INSTANCE_IPC.open && (typeof args[1] !== 'string' || !args[1].trim())) throw new Error('实例标识无效。')
    if (!queued.has(channel)) return listener(...args)
    const input = args[1]
    const id = typeof input === 'string' ? input : input?.id
    if (typeof id !== 'string') throw new Error('实例标识无效。')
    if ([INSTANCE_IPC.stop, INSTANCE_IPC.restart, INSTANCE_IPC.delete].includes(channel as any)) {
      for (const request of startRequests.get(id) ?? []) request.abort()
      supervisor.cancelStart?.(id)
    }
    const request = channel === INSTANCE_IPC.start || channel === INSTANCE_IPC.restart ? new AbortController() : undefined
    if (request) { const requests = startRequests.get(id) ?? new Set(); requests.add(request); startRequests.set(id, requests) }
    return operations.run(id, async () => { request?.signal.throwIfAborted(); return listener(...args, request?.signal) })
      .finally(() => { if (request) { startRequests.get(id)?.delete(request); if (!startRequests.get(id)?.size) startRequests.delete(id) } })
  })
  handle(INSTANCE_IPC.list, async () => {
    const records = await registry.list()
    // 老实例补种类别：现场按特征检测并持久化；运行中的实例 update 会被拒，仅临时补充返回值。
    // 补种也参与每个实例的操作队列，避免与启动或删除交错。
    const result: DesktopInstanceRecord[] = []
    for (const record of records) {
      if (record.instanceKind) { result.push(record); continue }
      const kind = detectKindFromDir(record.runtimeRoot ?? '')
      if (!kind) { result.push(record); continue }
      try {
        result.push(await operations.run(record.id, () => registry.update(record.id, { instanceKind: kind })))
      } catch {
        result.push({ ...record, instanceKind: kind })
      }
    }
    return result
  })
  handle(INSTANCE_IPC.create, (_event, input: CreateInstanceInput) => registry.create(input))
  handle(INSTANCE_IPC.select, (_event, id: string) => registry.get(id))
  const start = async (id: string, signal?: AbortSignal) => {
    const record = await registry.get(id)
    signal?.throwIfAborted()
    const status = supervisor.state(id).status
    if (status === 'ready' || status === 'starting' || status === 'paused') {
      await supervisor.start(id, { id, port: record.port, dshHome: record.dshHome })
      return supervisor.state(id)
    }
    const port = await registry.reservePort(id, record.port)
    await registry.markRunning(id)
    try { signal?.throwIfAborted(); await supervisor.start(id, { id, port, dshHome: record.dshHome }); return supervisor.state(id) }
    catch (error) { const state = supervisor.state(id); if (!state.pid && !state.cleanupPending) await registry.markStopped(id); throw error }
  }
  handle(INSTANCE_IPC.start, (_event, id: string, signal?: AbortSignal) => start(id, signal))
  handle(INSTANCE_IPC.open, async (_event, id: string) => {
    const record = await registry.get(id)
    if (record.instanceKind === 'official-web') return supervisor.open(id)
    const state = supervisor.state(id)
    if (state.status !== 'ready' || !state.url || !deps?.openExternal) throw new Error('instance is not running or cannot be opened')
    const url = new URL(state.url)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只允许打开网页链接。')
    await deps.openExternal(url.toString())
  })
  handle(INSTANCE_IPC.stop, async (_event, id: string) => {
    const record = await registry.get(id)
    await supervisor.stop(id)
    requireConfirmedStop(id)
    await registry.markStopped(id)
    // Old ambiguous manifests require the user's explicit mirror-update action.
    if (!(await diffMirror(record.root, [record.dshHome, record.workspace])).requiresRebaseline) await snapshotMirror(record.root, [record.dshHome, record.workspace])
    return supervisor.state(id)
  })
  handle(INSTANCE_IPC.restart, async (_event, id: string, signal?: AbortSignal) => { await registry.get(id); await supervisor.stop(id); requireConfirmedStop(id); await registry.markStopped(id); return start(id, signal) })
  handle(INSTANCE_IPC.pause, async (_event, id: string) => { await supervisor.pause(id); return supervisor.state(id) })
  handle(INSTANCE_IPC.resume, async (_event, id: string) => { await supervisor.resume(id); return supervisor.state(id) })
  handle(INSTANCE_IPC.port, async (_event, payload: { id: string; port: number }) => {
    const id = payload.id
    const preferred = Number(payload.port)
    if (!Number.isInteger(preferred) || preferred < 1 || preferred > 65535) throw new Error('端口无效')
    await registry.reservePort(id, preferred)
    return registry.get(id)
  })
  handle(INSTANCE_IPC.rename, async (_event, payload: { id: string; name: string }) => {
    if (!payload || typeof payload.id !== 'string') throw new Error('实例标识无效。')
    const name = typeof payload.name === 'string' ? payload.name.trim().slice(0, 60) : ''
    return registry.update(payload.id, { name: name || undefined })
  })

  const mirrorDirs = (record: DesktopInstanceRecord) => [record.dshHome, record.workspace] as const
  const mirrorResult = (diff: MirrorDiff) => ({
    ok: true,
    hasSnapshot: diff.snapshotAt !== null,
    snapshotAt: diff.snapshotAt,
    changed: diff.changed,
    added: diff.added,
    removed: diff.removed,
    requiresRebaseline: diff.requiresRebaseline ?? false,
  })
  handle(INSTANCE_IPC.mirrorStatus, async (_event, id: string) => {
    const record = await registry.get(id)
    return mirrorResult(await diffMirror(record.root, [...mirrorDirs(record)]))
  })
  handle(INSTANCE_IPC.mirrorUpdate, async (_event, id: string) => {
    requireConfirmedStop(id)
    const record = await registry.get(id)
    await snapshotMirror(record.root, [...mirrorDirs(record)])
    return mirrorResult(await diffMirror(record.root, [...mirrorDirs(record)]))
  })
  handle(INSTANCE_IPC.mirrorRestore, async (_event, id: string) => {
    requireConfirmedStop(id)
    const record = await registry.get(id)
    await restoreMirror(record.root, [...mirrorDirs(record)])
    return mirrorResult(await diffMirror(record.root, [...mirrorDirs(record)]))
  })
  handle(INSTANCE_IPC.mirrorHistory, async (_event, id: string) => {
    const record = await registry.get(id)
    return { ok: true, history: await listMirrorHistory(record.root) }
  })
  handle(INSTANCE_IPC.mirrorRestoreTo, async (_event, id: string, timestamp: string) => {
    requireConfirmedStop(id)
    const record = await registry.get(id)
    await restoreMirrorTo(record.root, [...mirrorDirs(record)], timestamp)
    return mirrorResult(await diffMirror(record.root, [...mirrorDirs(record)]))
  })
  handle(INSTANCE_IPC.states, () => supervisor.listStates())
  handle(INSTANCE_IPC.findShortcuts, async (_event, id: string) => {
    const record = await registry.get(id)
    if (!deps?.findShortcuts || !record.runtimeRoot) return { ok: true, shortcuts: [] }
    return { ok: true, shortcuts: deps.findShortcuts(record.runtimeRoot) }
  })
  handle(INSTANCE_IPC.removeShortcuts, async (_event, id: string) => {
    const record = await registry.get(id)
    if (!deps || !record.runtimeRoot) return { ok: true, trashed: [] }
    const shortcuts = deps.findShortcuts(record.runtimeRoot)
    const trashed: string[] = []
    for (const s of shortcuts) { try { await deps.trash(s); trashed.push(s) } catch { /* 忽略单个失败 */ } }
    return { ok: true, trashed }
  })
  handle(INSTANCE_IPC.delete, async (_event, id: string, options?: { mode?: string; skipScan?: string; skipScanDays?: number; removeShortcuts?: boolean }) => {
    const mode = options?.mode === 'purge' ? 'purge' : 'unregister'
    const record = await registry.get(id)
    // Stop errors must abort before any shortcut/file/registry mutation. Task 4
    // strengthens the supervisor's contract to wait for actual process exit.
    await supervisor.stop(id)
    requireConfirmedStop(id)
    await registry.markStopped(id)

    // Validate purge authority before shortcut or registry mutation. Unverifiable
    // legacy records remain usable through unregister, with every file preserved.
    if (mode === 'purge') {
      if (!deps?.trash) throw new Error('回收站能力不可用；实例文件保留')
      await verifyInstanceOwnership(record, await registry.list())
    }

    // 可选：删除指向该实例的桌面快捷方式（只删快捷方式，移入回收站可还原）。
    const trashedShortcuts: string[] = []
    if (options?.removeShortcuts && deps?.findShortcuts && record.runtimeRoot) {
      for (const s of deps.findShortcuts(record.runtimeRoot)) {
        try { await deps.trash(s); trashedShortcuts.push(s) } catch { /* 忽略单个失败 */ }
      }
    }

    if (mode === 'purge') {
      // 完全删除：文件移入回收站（实例根含镜像、状态根、工作区、日志），再移除注册、释放端口。
      try { await deps!.trash(record.root) } catch (error) {
        throw new Error(`移入回收站失败，实例注册与尚未回收的文件保留。若网页资料目录被占用，请重启鲸域后重试（会中断其他实例）：${error instanceof Error ? error.message : String(error)}`)
      }
      await registry.remove(id)
      return { ok: true, trashed: [record.root], trashedShortcuts }
    }

    // 仅移除注册：文件与镜像保留。
    await registry.remove(id)
    if (deps && options?.skipScan && options.skipScan !== 'none' && record.runtimeRoot) {
      const permanent = options.skipScan === 'permanent'
      const days = Math.max(0, Math.floor(Number(options.skipScanDays) || 0))
      const until = permanent ? null : Date.now() + days * 86_400_000
      await deps.addSkip(record.runtimeRoot, permanent, until).catch(() => undefined)
    }
    return { ok: true, trashed: [], trashedShortcuts }
  })
  handle(INSTANCE_IPC.discover, () => {
    if (!scanOptions) return { ok: false, installs: [], error: '发现配置未就绪' }
    try {
      const skipPaths = deps?.readSkipPaths() ?? []
      return { ok: true, installs: discovery.scanMachine({ ...scanOptions, skipPaths }) }
    }
    catch (error) { return { ok: false, installs: [], error: error instanceof Error ? error.message : String(error) } }
  })
  handle(INSTANCE_IPC.import, async (_event, rawPath: string) => {
    if (!scanOptions) return { ok: false, registered: false, error: '发现配置未就绪' }
    try {
      return await importAndCreateInstance(registry, discovery, scanOptions, rawPath, undefined, operations)
    } catch (error) {
      return { ok: false, registered: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}

export type InstanceIpcSnapshot = Pick<DesktopInstanceRecord, 'id' | 'dshHome' | 'electronUserData' | 'desktopProfile' | 'workspace' | 'logs' | 'port' | 'lockName'>
