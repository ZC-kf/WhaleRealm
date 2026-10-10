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

import { bounded } from './process-supervisor'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, readdir, realpath, stat, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ipcMain, net } from 'electron'
import { IPC } from '../src/constants'
import type { CreateInstanceRequest, CreateInstanceResult, InstanceKind } from '../src/types'
import { runCreatePipeline, type CreateDeps, type CreateProgress, type RegisterOutcome } from './instance-create'
import { resolveRuntimeAsset } from './runtime-assets'
import { createOfficialWebAdapter } from './adapters/official-web'
import { createDesktopAdapter } from './adapters/desktop'
import { fileURLToPath } from 'node:url'
import type { InstanceLayout } from './runtime-adapter'
import type { RuntimeAsset } from './runtime-adapter'
import { beginCreateTransaction, cleanupUnfinishedCreate, discoverUnfinishedCreates } from './create-transaction'
import type { UnfinishedCreate } from './create-transaction'
import type { DesktopInstanceRecord } from './instance-types'
import type { InstanceRegistry } from './instance-registry'
import type { ScanOptions } from './instance-discovery'
import { operationsForRegistry, type InstanceOperations } from './instance-operations'
import { snapshotMirror } from './instance-mirror'
import { WEB_NODE_DIST_URL } from './web-runtime'
import { resolveManagedLayout } from './instance-paths'
import { writeInstanceOwnership } from './instance-ownership'

/**
 * 新建实例流水线的主进程装配：真实 net.fetch 下载、目录守卫、产物自检、收录。
 *  - 官方网页版：自含 Node 便携版 + npm install @deepseek-ai/dsh + `dsh web` 自检 → 收录为可托管实例。
 *  - 桌面版：缺少认证免安装包时，在任何网络与部署操作前拒绝。
 * 流水线逻辑本身在 instance-create.ts（可测试）。
 */


const activeCreates = new Map<string, { abort: AbortController; done: Promise<CreateInstanceResult>; path: string; cleanupPending?: boolean; error?: string }>()
let shuttingDown = false
export async function shutdownCreateTasks(): Promise<void> {
  shuttingDown = true
  for (const task of activeCreates.values()) task.abort.abort()
  const results = await bounded(Promise.all([...activeCreates.values()].map(task => task.done)), 30000, 'Creation cancellation')
  const unresolved = results.filter(result => result.cleanupPending)
  if (unresolved.length) throw new AggregateError(unresolved.map(result => new Error(result.error)), 'Creation cleanup ownership remains unresolved')
}

async function downloadTo(url: string, dest: string, onProgress: (received: number, total: number | null) => void, signal?: AbortSignal): Promise<void> {
  const res = await net.fetch(url, { signal })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') ?? 0) || null
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest), { signal })
  const size = (await stat(dest)).size
  onProgress(size, total)
  if (size <= 0) throw new Error('下载内容为空')
}

function fetchHeadOk(url: string, signal?: AbortSignal): Promise<{ ok: boolean; status: number }> {
  return net.fetch(url, { method: 'HEAD', signal }).then(res => ({ ok: res.ok, status: res.status }))
}

/** 名称 → 合法实例 id（sanitize + 冲突后缀）。 */
function preferredInstanceId(name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 63) || 'web'
  const safe = /^[A-Za-z0-9]/.test(base) ? base : `x-${base}`.slice(0, 63)
  return safe
}

export function registerCreateInstanceHandler(
  ipc: typeof ipcMain,
  registry: InstanceRegistry,
  scanOptions: ScanOptions,
  sendProgress: (progress: CreateProgress) => void,
  operations: InstanceOperations = operationsForRegistry(registry),
): Promise<UnfinishedCreate[]> {
  const journalDirectory = scanOptions.hubRuntimesRoot ? path.join(path.dirname(scanOptions.hubRuntimesRoot), 'hub-data', 'create-tasks') : undefined
  const rootsOf = (records: DesktopInstanceRecord[]) => records.flatMap(record => [record.root, record.runtimeRoot, record.dshHome, record.electronUserData, record.desktopProfile, record.workspace, record.logs, record.cache, record.skills, record.skillsSource].filter((value): value is string => !!value))
  async function readUnfinished(): Promise<UnfinishedCreate[]> {
    if (!journalDirectory) return []
    let names: string[]
    try { names = await readdir(journalDirectory) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    const parents: string[] = []
    const knownTasks = new Set<string>()
    for (const name of names.filter(name => /^[a-f0-9-]{36}\.json$/.test(name))) {
      try {
        const pointer = JSON.parse(await readFile(path.join(journalDirectory, name), 'utf8')) as { target?: unknown }
        if (typeof pointer.target === 'string' && path.isAbsolute(pointer.target)) {
          parents.push(path.dirname(pointer.target)); knownTasks.add(name.slice(0, -5))
        }
      } catch { /* Invalid pointers are left untouched, never used as cleanup authority. */ }
    }
    return (await discoverUnfinishedCreates(parents)).filter(task => knownTasks.has(task.taskId))
  }
  // Invoked during main-process setup. Discovery reads journals only; startup never cleans a task.
  const startupDiscovery = readUnfinished().catch(() => [])
  ipc.handle(IPC.createUnfinished, async () => { await startupDiscovery; return readUnfinished() })
  ipc.handle(IPC.createCleanup, async (_event, input: unknown) => {
    const req = input as { lockPath?: unknown; confirmed?: unknown }
    if (!req || typeof req.lockPath !== 'string' || req.confirmed !== true) return { ok: false, error: '清理中断任务需要明确确认' }
    try {
      const tasks = await readUnfinished()
      const task = tasks.find(item => item.lockPath === req.lockPath)
      if (!task) throw new Error('任务未通过所有权发现验证')
      await cleanupUnfinishedCreate(task.lockPath, true, rootsOf(await registry.list()))
      if (journalDirectory && /^[a-f0-9-]{36}$/.test(task.taskId)) await unlink(path.join(journalDirectory, `${task.taskId}.json`))
      return { ok: true }
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) } }
  })
  const create = async (input: unknown, signal: AbortSignal, taskId: string): Promise<CreateInstanceResult> => {
    const req = input as CreateInstanceRequest
    if (!req || typeof req !== 'object'
      || typeof req.name !== 'string' || !req.name.trim()
      || typeof req.path !== 'string' || !path.isAbsolute(req.path)
      || typeof req.version !== 'string'
      || !['official-web', 'official-desktop', 'community-desktop'].includes(req.kind as InstanceKind)) {
      throw new Error('新建参数无效。')
    }

    signal.throwIfAborted()
    let asset: RuntimeAsset
    try {
      asset = await resolveRuntimeAsset(req.kind, req.version, url => net.fetch(url, { signal }))
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    signal.throwIfAborted()
    const trustedRequest = { ...req, downloadUrl: asset.url, version: asset.version }

    // Claim id + port as an unpublished lease. One instance operation spans the
    // complete create/cleanup pipeline; register and unregister do not reacquire it.
    const id = await registry.beginCreation(preferredInstanceId(req.name))
    return operations.run(id, async () => {
      let stagedLayout: InstanceLayout | undefined
      const adapterDeps = { download: (url: string, destination: string, abort: AbortSignal) => downloadTo(url, destination, () => {}, abort) }
      const adapter = req.kind === 'official-web' ? createOfficialWebAdapter(adapterDeps) : createDesktopAdapter(req.kind, adapterDeps)
      let webPort: number | null = null
      let registeredRoot: string | undefined
      const existingRoots: string[] = []

      const deps: CreateDeps = {
        fetchHead: async url => {
          if (req.kind === 'official-web') {
            // 网页版链路 = Node 发行版 + npm tarball，两处都必须在核验阶段可 HEAD。
            const node = await fetchHeadOk(WEB_NODE_DIST_URL, signal).catch(() => ({ ok: false, status: 0 }))
            if (!node.ok) return { ok: false, status: node.status }
            return fetchHeadOk(url, signal)
          }
          if (new URL(url).protocol === 'file:') return { ok: (await stat(fileURLToPath(url))).isFile(), status: 200 }
          return fetchHeadOk(url, signal)
        },
        download: async (_url, dir, onProgress) => {
          if (!stagedLayout || stagedLayout.runtimeRoot !== dir) throw new Error('Missing staged runtime layout')
          await adapter.deploy(asset, stagedLayout, signal)
          onProgress(1, 1)
        },
        beginTransaction: async dir => {
          existingRoots.push(...rootsOf(await registry.list()))
          let pointer: string | undefined
          // Persist the read-only discovery pointer before taking the filesystem lock, including crash windows.
          try {
            if (journalDirectory) {
              await mkdir(journalDirectory, { recursive: true })
              pointer = path.join(journalDirectory, `${taskId}.json`)
              await writeFile(pointer, JSON.stringify({ target: dir }), { flag: 'wx' })
            }
          } catch (error) { throw new Error(`无法建立创建任务日志：${String(error)}`) }
          let transaction
          try { transaction = await beginCreateTransaction(dir, taskId, existingRoots) }
          catch (error) {
            if (pointer) {
              try { await unlink(pointer) } catch (cleanupError) { throw new Error(`${String(error)}；任务日志清理失败：${String(cleanupError)}`) }
            }
            throw error
          }
          stagedLayout = transaction.layout
          return {
            layout: transaction.layout,
            publish: async () => {
              existingRoots.splice(0, existingRoots.length, ...rootsOf(await registry.list()))
              const finalRoot = path.join(await realpath(path.dirname(dir)), path.basename(dir))
              await writeInstanceOwnership(transaction.layout, resolveManagedLayout(finalRoot), id, asset.adapterId)
              return transaction.publish()
            },
            rollback: () => transaction.rollback(),
            release: async () => { await transaction.release(); if (pointer) await unlink(pointer) },
          }
        },
        verifyPackage: async dir => {
          if (!stagedLayout || stagedLayout.runtimeRoot !== dir) throw new Error('Missing staged runtime layout')
          webPort = await registry.reservePort(id, 19430)
          await adapter.selfcheck(stagedLayout, webPort, signal)
        },
        register: async ({ name, path: dir, kind, version, layout }): Promise<RegisterOutcome> => {
          {
            if (webPort === null) return { ok: false, error: '端口分配失败' }
            registeredRoot = layout.root
            try {
              const record = await registry.create({ id, name, version, ...layout, runtimeRoot: dir, layoutVersion: 2, adapterId: asset.adapterId, port: webPort, instanceKind: kind })
              await snapshotMirror(record.root, [record.dshHome, record.workspace])
              return { ok: true, instanceId: id }
            } catch (error) {
              // A persistence failure may follow a successful write. Return the exact owned record id.
              try {
                const record = (await registry.list()).find(item => item.id === id && item.root === layout.root)
                return { ok: false, instanceId: record?.id, error: error instanceof Error ? error.message : String(error) }
              } catch (statusError) {
                return { ok: false, ownershipUncertain: true, error: `收录失败且无法确认登记状态：${String(error)}；${String(statusError)}` }
              }
            }
          }
        },
        unregister: async id => {
          const record = await registry.get(id)
          if (!registeredRoot || record.root !== registeredRoot) throw new Error('收录记录所有权已改变，拒绝撤销')
          await registry.remove(id)
        },
      }

      let cleanupPending = false
      try {
        const result = await runCreatePipeline(trustedRequest, deps, progress => sendProgress({ ...progress, taskId }), signal)
        cleanupPending = result.cleanupPending === true
        return result
      }
      catch (error) {
        cleanupPending = error instanceof Error && 'cleanupUnsafe' in error
        throw error
      }
      finally {
        // An unpublished selfcheck may still own its port, even before binding it.
        // Preserve the lease alongside its recovery journal until ownership resolves.
        if (!cleanupPending) await registry.releaseCreation(id)
      }
    })
  }
  ipc.handle(IPC.createInstance, (_event, input: unknown) => {
    if (shuttingDown) throw new Error('Launcher is shutting down')
    const requested = (input as { taskId?: unknown })?.taskId
    const taskId = typeof requested === 'string' && /^[a-f0-9-]{36}$/.test(requested) ? requested : randomUUID()
    if (activeCreates.has(taskId)) throw new Error('Creation task already exists')
    const abort = new AbortController()
    const done = create(input, abort.signal, taskId).catch((error): CreateInstanceResult => {
      // Cancellation before the transactional pipeline also settles normally;
      // it must not turn an otherwise clean Hub shutdown into an error.
      if (error instanceof Error && 'cleanupUnsafe' in error) return { ok: false, cleanupPending: true, error: error.message }
      if (abort.signal.aborted) return { ok: false, error: '创建已取消' }
      throw error
    }).then(result => {
      if (result.cleanupPending) {
        const task = activeCreates.get(taskId)!
        task.cleanupPending = true; task.error = result.error
      } else activeCreates.delete(taskId)
      return result
    }, error => { activeCreates.delete(taskId); throw error })
    activeCreates.set(taskId, { abort, done, path: String((input as { path?: unknown })?.path ?? '') })
    return done
  })
  ipc.handle(IPC.createTasks, () => [...activeCreates].map(([taskId, task]) => ({ taskId, path: task.path, cleanupPending: task.cleanupPending, error: task.error })))
  ipc.handle(IPC.createCancel, async (_event, taskId: string) => {
    const task = activeCreates.get(taskId)
    if (!task) return { ok: false, error: 'Creation task is no longer active' }
    task.abort.abort()
    const result = await task.done
    if (result.cleanupPending) return { ok: false, cleanupPending: true, error: result.error }
    return { ok: true }
  })
  return startupDiscovery
}
