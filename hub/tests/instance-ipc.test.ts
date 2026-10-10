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

import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'
import { registerInstanceIpcHandlers } from '../electron/instance-ipc'
import { createInstanceRegistry } from '../electron/instance-registry'
import { createInstanceOperations } from '../electron/instance-operations'
import { beginCreateTransaction } from '../electron/create-transaction'
import { resolveManagedLayout } from '../electron/instance-paths'
import { writeInstanceOwnership } from '../electron/instance-ownership'
import { mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'

async function freePort() {
  const server = net.createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as net.AddressInfo).port
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}

describe('instance IPC', () => {
  // Heavy real-fs test: thousands of file ops; allow headroom under parallel full-suite load.
  it('restores A bytes and purges its proven runtime while B and a legacy shared runtime survive', { timeout: 30_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-task6-ab-'))
    try {
      const registry = createInstanceRegistry(join(root, 'hub'))
      const create = async (id: string) => {
        const target = join(root, id); const transaction = await beginCreateTransaction(target, `fixture-${id}`, [])
        await writeFile(join(transaction.layout.runtimeRoot, 'runtime.bin'), Buffer.from([0, 1, id.charCodeAt(0), 255]))
        await writeInstanceOwnership(transaction.layout, resolveManagedLayout(target), id, 'fixture-adapter-v1')
        const layout = await transaction.publish(); await transaction.release()
        return registry.create({ id, ...layout, layoutVersion: 2, adapterId: 'fixture-adapter-v1', port: await freePort() })
      }
      const a = await create('a'); const b = await create('b')
      const shared = join(root, 'legacy-shared'); await mkdir(shared); await writeFile(join(shared, 'legacy.bin'), Buffer.from([4, 5, 6]))
      await registry.create({ id: 'legacy', runtimeRoot: shared, port: await freePort() })
      const aHome = join(a.dshHome, 'config.json'); const aWork = join(a.workspace, 'config.json'); const bHome = join(b.dshHome, 'config.json')
      await writeFile(aHome, Buffer.from([0, 65, 255])); await writeFile(aWork, Buffer.from([1, 66, 254])); await writeFile(bHome, 'B unchanged')
      const channels = new Map<string, Function>()
      const trash = join(root, 'fixture-trash'); await mkdir(trash)
      let profileLocked = true
      registerInstanceIpcHandlers({ handle: (c, f) => channels.set(c, f) }, registry,
        { stop: async () => {}, state: () => ({ status: 'stopped', pid: null }) } as any, undefined, undefined,
        { trash: async target => { if (profileLocked) throw new Error('fixture profile locked'); await rename(target, join(trash, 'a')) }, readSkipPaths: () => [], addSkip: async () => {}, findShortcuts: () => [] })
      await channels.get('instances:mirror-update')!({}, 'a')
      await writeFile(aHome, 'changed'); await rm(aWork); await writeFile(join(a.workspace, 'added.txt'), 'added')
      await channels.get('instances:mirror-restore')!({}, 'a')
      expect(await readFile(aHome)).toEqual(Buffer.from([0, 65, 255])); expect(await readFile(aWork)).toEqual(Buffer.from([1, 66, 254]))
      expect(await readdir(a.workspace)).toEqual(['config.json']); expect(await readFile(bHome, 'utf8')).toBe('B unchanged')
      await registry.update('b', { runtimeRoot: a.runtimeRoot })
      await expect(channels.get('instances:delete')!({}, 'a', { mode: 'purge' })).rejects.toThrow(/Another instance/)
      await registry.update('b', { runtimeRoot: b.runtimeRoot })
      await symlink(shared, join(a.workspace, 'escape'), 'junction')
      await expect(channels.get('instances:delete')!({}, 'a', { mode: 'purge' })).rejects.toThrow(/link/)
      await rm(join(a.workspace, 'escape'))
      await expect(channels.get('instances:delete')!({}, 'a', { mode: 'purge' })).rejects.toThrow(/重启鲸域/)
      expect((await registry.get('a')).id).toBe('a'); expect(await readFile(aHome)).toEqual(Buffer.from([0, 65, 255]))
      profileLocked = false
      const result = await channels.get('instances:delete')!({}, 'a', { mode: 'purge' })
      expect(result).toMatchObject({ ok: true, trashed: [a.root] })
      expect((await registry.list()).map(record => record.id)).toEqual(['b', 'legacy'])
      expect(await readdir(root)).not.toContain('a')
      expect(await readFile(join(trash, 'a', 'runtime', 'runtime.bin'))).toEqual(Buffer.from([0, 1, 97, 255]))
      expect(await readFile(bHome, 'utf8')).toBe('B unchanged'); expect(await readFile(join(shared, 'legacy.bin'))).toEqual(Buffer.from([4, 5, 6]))
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('blocks snapshot and restore when crash cleanup is pending or a pid remains', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-task6-guard-'))
    try {
      const registry = createInstanceRegistry(root); await registry.create({ id: 'a', port: await freePort() })
      const channels = new Map<string, Function>()
      let state: any = { status: 'crashed', pid: null, cleanupPending: true }
      const supervisor = { state: () => state } as any
      registerInstanceIpcHandlers({ handle: (c, f) => channels.set(c, f) }, registry, supervisor)
      for (const route of ['instances:mirror-update', 'instances:mirror-restore', 'instances:mirror-restore-to']) {
        await expect(channels.get(route)!({}, 'a', '2026-01-01T00-00-00-000Z')).rejects.toThrow(/confirmed|running/)
      }
      state = { status: 'crashed', pid: 42 }
      await expect(channels.get('instances:mirror-update')!({}, 'a')).rejects.toThrow(/confirmed|running/)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('preserves unproven legacy files instead of claiming purge success', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-task6-legacy-'))
    try {
      const registry = createInstanceRegistry(root); const record = await registry.create({ id: 'a', port: await freePort() })
      mkdirSync(record.dshHome, { recursive: true })
      const marker = join(record.dshHome, 'config.json'); writeFileSync(marker, 'legacy data')
      const channels = new Map<string, Function>()
      registerInstanceIpcHandlers({ handle: (c, f) => channels.set(c, f) }, registry, { stop: async () => {}, state: () => ({ status: 'stopped', pid: null }) } as any, undefined, undefined,
        { trash: async target => rmSync(target, { recursive: true, force: true }), readSkipPaths: () => [], addSkip: async () => {}, findShortcuts: () => [] })
      await expect(channels.get('instances:delete')!({}, 'a', { mode: 'purge' })).rejects.toThrow(/ownership|所有权/)
      expect(readFileSync(marker, 'utf8')).toBe('legacy data'); expect((await registry.get('a')).id).toBe('a')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('waits for a queued creation before starting and passes the authoritative reserved port', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-task3-ipc-'))
    try {
      const registry = createInstanceRegistry(root); const operations = createInstanceOperations()
      const channels = new Map<string, Function>()
      let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve })
      const port = await freePort()
      const creation = operations.run('new', async () => { await gate; await registry.create({ id: 'new', port }) })
      const contexts: any[] = []
      const supervisor = { start: async (_id: string, context: any) => { contexts.push(context) }, state: () => ({ status: 'ready' }), listStates: () => [] } as any
      registerInstanceIpcHandlers({ handle: (c, f) => channels.set(c, f) }, registry, supervisor, undefined, undefined, undefined, operations)
      const start = channels.get('instances:start')!({}, 'new')
      // Attach rejection observation before yielding, so RED cannot create an unhandled rejection.
      const observed = start.then(() => undefined, (error: unknown) => error)
      await new Promise(resolve => setTimeout(resolve, 10)); expect(contexts).toEqual([])
      release(); await creation; expect(await observed).toBeUndefined()
      expect(contexts[0].port).toBe((await registry.get('new')).port)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('serializes start, restore and delete for one instance without blocking another', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-task3-ipc-'))
    try {
      const registry = createInstanceRegistry(root); await registry.create({ id: 'a', port: await freePort() }); await registry.create({ id: 'b', port: await freePort() })
      const channels = new Map<string, Function>(); const order: string[] = []
      let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve })
      const status = new Map<string, string>()
      const supervisor = { start: async (id: string) => { order.push(`start-${id}`); if (id === 'a') await gate; status.set(id, 'ready') }, stop: async (id: string) => { order.push(`stop-${id}`); status.set(id, 'stopped') }, state: (id: string) => ({ status: status.get(id) ?? 'stopped' }), listStates: () => [] } as any
      registerInstanceIpcHandlers({ handle: (c, f) => channels.set(c, f) }, registry, supervisor)
      const start = channels.get('instances:start')!({}, 'a')
      while (!order.includes('start-a')) await new Promise(resolve => setTimeout(resolve, 1))
      const restore = channels.get('instances:mirror-restore')!({}, 'a').then(() => undefined, (error: unknown) => error)
      const remove = channels.get('instances:delete')!({}, 'a')
      await channels.get('instances:start')!({}, 'b')
      expect(order).not.toContain('stop-a'); expect((await registry.list()).map(r => r.id)).toContain('a')
      release(); await start; expect(String(await restore)).toMatch(/running/)
      expect((await remove).ok).toBe(true); expect(order).toEqual(['start-a', 'start-b', 'stop-a'])
      expect((await registry.list()).map(r => r.id)).toEqual(['b'])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('preserves running registration and files when delete cannot stop the instance', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-task3-stop-failure-'))
    try {
      const registry = createInstanceRegistry(root)
      const record = await registry.create({ id: 'running', port: await freePort() })
      await registry.markRunning(record.id)
      const marker = join(root, 'user-data.txt'); writeFileSync(marker, 'preserve me')
      const channels = new Map<string, Function>()
      const supervisor = { stop: async () => { throw new Error('fixture stop failed') } } as any
      const trash = async (target: string) => { rmSync(target, { recursive: true, force: true }) }
      registerInstanceIpcHandlers({ handle: (c, f) => channels.set(c, f) }, registry, supervisor, undefined, undefined, { trash, readSkipPaths: () => [], addSkip: async () => undefined, findShortcuts: () => [marker] })
      await expect(channels.get('instances:delete')!({}, record.id, { mode: 'purge', removeShortcuts: true })).rejects.toThrow('fixture stop failed')
      expect(await registry.get(record.id)).toEqual(record)
      await expect(registry.remove(record.id)).rejects.toThrow(/running/)
      expect(readFileSync(marker, 'utf8')).toBe('preserve me')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('restarts inside one queued operation without reacquiring the same instance lock', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-task3-restart-'))
    try {
      const registry = createInstanceRegistry(root)
      await registry.create({ id: 'a', port: await freePort() }); await registry.markRunning('a')
      const channels = new Map<string, Function>(); const order: string[] = []
      let status = 'ready'
      const supervisor = { stop: async () => { order.push('stop'); status = 'stopped' }, start: async () => { order.push('start'); status = 'ready' }, state: () => ({ status }) } as any
      registerInstanceIpcHandlers({ handle: (c, f) => channels.set(c, f) }, registry, supervisor)
      await channels.get('instances:restart')!({}, 'a')
      expect(order).toEqual(['stop', 'start'])
      await expect(registry.remove('a')).rejects.toThrow(/running/)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('releases the running guard and queued operation after a failed start', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-task3-start-failure-'))
    try {
      const registry = createInstanceRegistry(root); await registry.create({ id: 'a', port: await freePort() })
      const channels = new Map<string, Function>()
      const supervisor = { start: async () => { throw new Error('fixture start failed') }, state: () => ({ status: 'stopped' }) } as any
      registerInstanceIpcHandlers({ handle: (c, f) => channels.set(c, f) }, registry, supervisor)
      await expect(channels.get('instances:start')!({}, 'a')).rejects.toThrow('fixture start failed')
      const renamed = await channels.get('instances:rename')!({}, { id: 'a', name: 'usable after failure' })
      expect(renamed.name).toBe('usable after failure')
      await registry.remove('a'); expect(await registry.list()).toEqual([])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('retains registration ownership when startup cleanup cannot be confirmed', async () => {
    const { createRuntimeSupervisor } = await import('../electron/runtime-supervisor')
    const { ProcessCleanupError } = await import('../electron/process-supervisor')
    const root = mkdtempSync(join(tmpdir(), 'dsh-task4-uncertain-'))
    try {
      const registry = createInstanceRegistry(root); await registry.create({ id: 'a', port: await freePort() })
      const channels = new Map<string, Function>()
      const supervisor = createRuntimeSupervisor({ spawn: async () => { throw new ProcessCleanupError('unconfirmed exit') } })
      registerInstanceIpcHandlers({ handle: (c, f) => channels.set(c, f) }, registry, supervisor)
      await expect(channels.get('instances:start')!({}, 'a')).rejects.toThrow('unconfirmed exit')
      await expect(registry.remove('a')).rejects.toThrow(/running/)
      await expect(channels.get('instances:delete')!({}, 'a')).rejects.toThrow(/not confirmed/)
      expect((await registry.get('a')).id).toBe('a')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('registers instance lifecycle channels', () => {
    const channels = new Map<string, Function>()
    const ipc = { handle: (channel: string, listener: Function) => channels.set(channel, listener) }
    const registry = { list: vi.fn(async () => []), get: vi.fn(), create: vi.fn(), markRunning: vi.fn(), markStopped: vi.fn(), remove: vi.fn() } as any
    const supervisor = { start: vi.fn(), stop: vi.fn(), state: vi.fn(), listStates: vi.fn() } as any
    registerInstanceIpcHandlers(ipc, registry, supervisor)
    expect([...channels.keys()]).toEqual(expect.arrayContaining(['instances:list', 'instances:create', 'instances:start', 'instances:stop', 'instances:restart', 'instances:states', 'instances:discover', 'instances:import', 'instances:delete']))
  })

  it('discovers machine installs and imports only isolatable installs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-task6-import-'))
    try {
    const channels = new Map<string, Function>()
    const ipc = { handle: (channel: string, listener: Function) => channels.set(channel, listener) }
    const registry = createInstanceRegistry(root)
    const supervisor = { start: vi.fn(), stop: vi.fn(), state: vi.fn(), listStates: vi.fn() } as any
    const discovery = {
      scanMachine: vi.fn(() => [{ path: 'C:/safe', executable: 'C:/safe/DeepSeek Harness.exe', exeName: 'DeepSeek Harness.exe', version: '1', source: 'manual', running: false, pid: null, isolatable: true, reason: 'declared' }]),
      importByPath: vi.fn(() => ({ path: 'C:/safe', executable: 'C:/safe/DeepSeek Harness.exe', exeName: 'DeepSeek Harness.exe', version: '1', source: 'manual', running: false, pid: null, isolatable: true, reason: 'declared' })),
    }
    registerInstanceIpcHandlers(ipc, registry, supervisor, discovery as any, { catalogPath: 'test-catalog.json' })
    expect(channels.get('instances:discover')?.({})).toEqual(expect.objectContaining({ ok: true, installs: expect.any(Array) }))
    await expect(Promise.resolve(channels.get('instances:import')?.({}, 'C:/safe'))).resolves.toEqual(expect.objectContaining({ ok: true, registered: true }))
    expect((await registry.list())[0].runtimeRoot).toBe('C:/safe')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('keeps non-isolatable imports inventory-only', async () => {
    const channels = new Map<string, Function>()
    const ipc = { handle: (channel: string, listener: Function) => channels.set(channel, listener) }
    const registry = { list: vi.fn(async () => []), get: vi.fn(), create: vi.fn(), markRunning: vi.fn(), markStopped: vi.fn(), remove: vi.fn() } as any
    const supervisor = { start: vi.fn(), stop: vi.fn(), state: vi.fn(), listStates: vi.fn() } as any
    const discovery = { scanMachine: vi.fn(), importByPath: vi.fn(() => ({ path: 'C:/legacy', executable: 'C:/legacy/DeepSeek Harness.exe', exeName: 'DeepSeek Harness.exe', version: '1', source: 'manual', running: false, pid: null, isolatable: false, reason: 'unknown' })) }
    registerInstanceIpcHandlers(ipc, registry, supervisor, discovery as any, { catalogPath: 'test-catalog.json' })
    await expect(Promise.resolve(channels.get('instances:import')?.({}, 'C:/legacy'))).resolves.toEqual(expect.objectContaining({ ok: true, registered: false, reason: expect.stringContaining('不可隔离') }))
    expect(registry.create).not.toHaveBeenCalled()
  })

  it('backfills instanceKind for every legacy record without lost updates', async () => {
    // 6 条老记录共用同一 runtimeRoot（真实场景：gui-a/…/smoke-b 同指一个运行时目录）。
    const fixture = mkdtempSync(join(tmpdir(), 'whale-kinds-'))
    try {
      writeFileSync(join(fixture, 'DeepSeek Harness.exe'), 'MZ')
      const stored: any[] = Array.from({ length: 6 }, (_, i) => ({ id: `inst-${i}`, runtimeRoot: fixture }))
      const channels = new Map<string, Function>()
      const ipc = { handle: (channel: string, listener: Function) => channels.set(channel, listener) }
      const registry = {
        list: vi.fn(async () => stored.map(record => ({ ...record }))),
        // 复刻真实 registry 的读改写语义：基于同一份快照整体重写；
        // 若补种并发执行，6 次 update 各持旧快照互写覆盖，最终只剩最后一条落盘。
        update: vi.fn(async (id: string, input: Record<string, unknown>) => {
          const snapshot = stored.map(record => ({ ...record }))
          const target = snapshot.find(record => record.id === id)
          if (!target) throw new Error(`instance not found: ${id}`)
          Object.assign(target, input)
          await new Promise(resolve => setTimeout(resolve, 5))
          stored.length = 0
          stored.push(...snapshot)
          return { ...target }
        }),
        get: vi.fn(), create: vi.fn(), markRunning: vi.fn(), markStopped: vi.fn(), remove: vi.fn(),
      } as any
      const supervisor = { start: vi.fn(), stop: vi.fn(), state: vi.fn(), listStates: vi.fn() } as any
      registerInstanceIpcHandlers(ipc, registry, supervisor, undefined, { catalogPath: 'test-catalog.json' })
      const result = await channels.get('instances:list')?.({})
      expect(result).toHaveLength(6)
      expect(result.every((record: any) => record.instanceKind === 'official-desktop')).toBe(true)
      expect(stored.every(record => record.instanceKind === 'official-desktop')).toBe(true)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  it('deletes via unregister (with skip) and purge (with trash)', async () => {    const channels = new Map<string, Function>()
    const ipc = { handle: (channel: string, listener: Function) => channels.set(channel, listener) }
    const record = { id: 'x', root: 'C:/inst/x', runtimeRoot: 'C:/rt', dshHome: 'C:/inst/x/dsh-home', workspace: 'C:/inst/x/workspace' }
    const registry = { get: vi.fn(async () => record), list: async () => [record], remove: vi.fn(async () => undefined), markStopped: vi.fn(async () => undefined) } as any
    const supervisor = { stop: vi.fn(async () => undefined), state: () => ({ status: 'stopped', pid: null }) } as any
    const trash = vi.fn(async () => undefined)
    const addSkip = vi.fn(async () => undefined)
    const readSkipPaths = vi.fn(() => [])
    registerInstanceIpcHandlers(ipc, registry, supervisor, undefined, { catalogPath: 'test-catalog.json' }, { trash, readSkipPaths, addSkip } as any)

    const unregister = await channels.get('instances:delete')?.({}, 'x', { mode: 'unregister', skipScan: 'temporary', skipScanDays: 3 })
    expect(unregister.ok).toBe(true)
    expect(registry.remove).toHaveBeenCalledWith('x')
    expect(trash).not.toHaveBeenCalled()
    expect(addSkip).toHaveBeenCalledWith('C:/rt', false, expect.any(Number))

    await expect(channels.get('instances:delete')!({}, 'x', { mode: 'purge' })).rejects.toThrow(/ownership/)
    expect(trash).not.toHaveBeenCalled()
  })
})

it('stop IPC aborts a startup held inside the shared instance queue', async () => {
 const { createRuntimeSupervisor } = await import('../electron/runtime-supervisor')
 const root=mkdtempSync(join(tmpdir(),'dsh-task4-queue-'))
 try {
  const registry=createInstanceRegistry(root); const record = await registry.create({id:'a',port:await freePort()})
  for (const dir of [record.dshHome, record.workspace]) mkdirSync(dir, { recursive: true })
  let started!:()=>void;const entered=new Promise<void>(r=>{started=r})
  let aborted=false
  const supervisor=createRuntimeSupervisor({spawn:async(_context,signal)=>{started();await new Promise<void>((_r,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(new Error('cancelled'))},{once:true}));throw new Error('unreachable')}})
  const channels=new Map<string,Function>();registerInstanceIpcHandlers({handle:(c,f)=>channels.set(c,f)},registry,supervisor)
  const start=channels.get('instances:start')!({},'a').catch(()=>{})
  await entered
  const stop=channels.get('instances:stop')!({},'a')
  await new Promise(r=>setTimeout(r,20));const reached=aborted
  supervisor.cancelStart?.('a')
  await start; await stop
  expect(reached).toBe(true)
  expect(supervisor.state('a').status).toBe('stopped')
 } finally {rmSync(root,{recursive:true,force:true})}
})
