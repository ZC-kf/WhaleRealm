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

import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createInstanceRegistry } from '../electron/instance-registry'
import { operationsForRegistry } from '../electron/instance-operations'
import { registerInstanceIpcHandlers } from '../electron/instance-ipc'
import { IPC } from '../src/constants'
import { dshBinIn } from '../electron/web-runtime'
import { verifyInstanceOwnership } from '../electron/instance-ownership'
import { ProcessCleanupError } from '../electron/process-supervisor'

const boundary = vi.hoisted(() => ({ selfcheck: vi.fn(), fetch: vi.fn(), spawn: vi.fn(), rollback: vi.fn(), release: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: {}, net: { fetch: boundary.fetch } }))
vi.mock('../electron/process', () => ({ runOwnedCommand: (exe: string, args: string[], _timeout: number, options: object) => boundary.spawn(exe, args, options) }))
vi.mock('../electron/adapters/official-web', async original => {
  const actual = await original<typeof import('../electron/adapters/official-web')>()
  return { ...actual, createOfficialWebAdapter: (deps: Parameters<typeof actual.createOfficialWebAdapter>[0]) => {
    const adapter = actual.createOfficialWebAdapter({ ...deps,
      deployNode: async (_bytes, destination) => { await mkdir(destination, { recursive: true }); await writeFile(path.join(destination, 'node.exe'), 'fixture node') },
      installProxy: async () => undefined,
    })
    // Own process boundaries are controlled; real deploy/layout/publication remain.
    return { ...adapter, selfcheck: (layout: Parameters<typeof adapter.selfcheck>[0], port: number, signal: AbortSignal) => boundary.selfcheck({ port, signal, binJs: dshBinIn(layout.runtimeRoot) }) }
  } }
})
vi.mock('../electron/create-transaction', async original => {
  const actual = await original<typeof import('../electron/create-transaction')>()
  return { ...actual, beginCreateTransaction: async (...args: Parameters<typeof actual.beginCreateTransaction>) => {
    const transaction = await actual.beginCreateTransaction(...args)
    return { ...transaction,
      rollback: async () => { boundary.rollback(); await transaction.rollback() },
      release: async () => { boundary.release(); await transaction.release() },
    }
  } }
})
vi.mock('../electron/runtime-assets', () => ({
  resolveRuntimeAsset: async () => ({ assetId: 'fixture', kind: 'official-web', version: '0.2.0-rc.2', adapterId: 'official-web', url: 'https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.0-rc.2.tgz', integrity: 'sha512-fixture', format: 'npm', sourceRef: 'fixture' }),
  // Asset integrity is tested separately. Here only deterministic fixture bytes cross the network boundary.
  verifyRuntimeIntegrity: (bytes: Buffer) => { if (createHash('sha256').update(bytes).digest('hex') !== createHash('sha256').update('fixture archive').digest('hex')) throw new Error('unexpected archive') },
}))
import { registerCreateInstanceHandler } from '../electron/create-runtime'

const fixtures: string[] = []
afterEach(async () => { for (const root of fixtures.splice(0)) await rm(root, { recursive: true, force: true }); vi.clearAllMocks() })
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-task3-create-')); fixtures.push(root)
  const hub = path.join(root, 'hub'); const registry = createInstanceRegistry(hub)
  const server = net.createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const preferred = (server.address() as net.AddressInfo).port; await new Promise<void>(resolve => server.close(() => resolve()))
  // Keep production reservation behavior; only its initial preference uses this fixture's ephemeral port.
  const reserve = registry.reservePort.bind(registry); registry.reservePort = (id, _preferred) => reserve(id, preferred)
  boundary.fetch.mockImplementation(async (_url: string, options?: { method?: string }) => options?.method === 'HEAD'
    ? { ok: true, status: 200 }
    : { ok: true, status: 200, headers: new Map(), body: new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('fixture archive')); controller.close() } }) })
  boundary.spawn.mockImplementation(async (_exe: string, _args: string[], options: { cwd?: string }) => {
      const directory = path.join(options.cwd!, 'node_modules', '@deepseek-ai', 'dsh', 'lib'); await mkdir(directory, { recursive: true })
      await writeFile(path.join(directory, 'bin.js'), 'fixture dsh')
      await writeFile(path.join(path.dirname(directory), 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.0-rc.2' }))
  })
  const handlers = new Map<string, Function>(); const ipc = { handle: (channel: string, listener: Function) => handlers.set(channel, listener) }
  await registerCreateInstanceHandler(ipc as never, registry, { catalogPath: path.join(hub, 'catalog'), hubRuntimesRoot: path.join(hub, 'runtimes') }, () => undefined)
  return { root, registry, preferred, handlers, ipc }
}

it('reserves distinct selfcheck ports for simultaneous same-name creation and keeps lifecycle queued until publish', async () => {
  const x = await setup(); const entered: number[] = []; let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  boundary.selfcheck.mockImplementation(async ({ port }: { port: number }) => { entered.push(port); await gate })
  const contexts: number[] = []
  const supervisor = { start: async (_id: string, context: { port: number }) => { contexts.push(context.port) }, state: () => ({ status: 'stopped' }), listStates: () => [] } as any
  registerInstanceIpcHandlers(x.ipc, x.registry, supervisor)
  const request = (name: string) => ({ name: 'same', path: path.join(x.root, name), kind: 'official-web', version: '0.2.0-rc.2' })
  const a = x.handlers.get(IPC.createInstance)!({}, request('a')); const b = x.handlers.get(IPC.createInstance)!({}, request('b'))
  await vi.waitFor(() => expect(entered).toHaveLength(2))
  expect(new Set(entered).size).toBe(2); expect(await x.registry.list()).toEqual([])
  const start = x.handlers.get('instances:start')!({}, 'same').then(() => undefined, (error: unknown) => error)
  await new Promise(resolve => setTimeout(resolve, 10)); expect(contexts).toEqual([])
  release(); const outcomes = await Promise.all([a, b]); expect(outcomes.every(result => result.ok)).toBe(true)
  expect(await start).toBeUndefined()
  const records = await x.registry.list(); expect(records).toHaveLength(2); expect(new Set(records.map(r => r.id)).size).toBe(2)
  expect(contexts).toEqual([records.find(record => record.id === 'same')!.port])
  expect(new Set(records.map(r => r.port))).toEqual(new Set(entered))
  for (const record of records) {
    expect(await readFile(path.join(record.runtimeRoot!, 'node', 'node.exe'), 'utf8')).toBe('fixture node')
    await verifyInstanceOwnership(record, records)
  }
})

it('releases the pending port and operation queue after selfcheck failure without publishing a record', async () => {
  const x = await setup(); boundary.selfcheck.mockRejectedValueOnce(new Error('fixture selfcheck failed'))
  const result = await x.handlers.get(IPC.createInstance)!({}, { name: 'failed', path: path.join(x.root, 'failed'), kind: 'official-web', version: '0.2.0-rc.2' })
  expect(result.ok).toBe(false); expect(result.error).toContain('fixture selfcheck failed'); expect(await x.registry.list()).toEqual([])
  const pending = await x.registry.beginCreation('failed'); expect(pending).toBe('failed')
  expect(await x.registry.reservePort(pending, x.preferred)).toBe(x.preferred); await x.registry.releaseCreation(pending)
  expect(await operationsForRegistry(x.registry).run('failed', async () => 11)).toBe(11)
})

it('settles cancellation before deployment without rejecting the cancel operation', async () => {
 const x=await setup();const taskId='bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee'
 const creation=x.handlers.get(IPC.createInstance)!({}, {taskId,name:'early',path:path.join(x.root,'early'),kind:'official-web',version:'0.2.0-rc.2'})
 await expect(x.handlers.get(IPC.createCancel)!({},taskId)).resolves.toEqual({ok:true})
 expect((await creation).ok).toBe(false)
 expect(boundary.spawn).not.toHaveBeenCalled()
 expect(await x.registry.list()).toEqual([])
})

it('cancels an active creation by task ID and waits for selfcheck cleanup before releasing registration', async () => {
 const x=await setup();let entered!:()=>void;const gate=new Promise<void>(r=>{entered=r})
 let finishCleanup!:()=>void;const cleanup=new Promise<void>(r=>{finishCleanup=r});let aborted=false
 boundary.selfcheck.mockImplementation(async ({signal}:{signal:AbortSignal})=>{
  entered()
  await new Promise<void>(resolve=>signal.addEventListener('abort',()=>{aborted=true;resolve()},{once:true}))
  await cleanup
  throw new Error('fixture cancelled')
 })
 const taskId='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
 const creation=x.handlers.get(IPC.createInstance)!({}, {taskId,name:'cancelled',path:path.join(x.root,'cancelled'),kind:'official-web',version:'0.2.0-rc.2'})
 await gate
 expect((await x.handlers.get(IPC.createTasks)!()).map((t:any)=>t.taskId)).toEqual([taskId])
 let cancellationDone=false
 const cancellation=x.handlers.get(IPC.createCancel)!({},taskId).then(()=>{cancellationDone=true})
 expect(aborted).toBe(true)
 await new Promise(resolve=>setTimeout(resolve,10))
 expect(cancellationDone).toBe(false)
 expect((await x.handlers.get(IPC.createTasks)!()).map((t:any)=>t.taskId)).toEqual([taskId])
 finishCleanup();await cancellation
 expect((await creation).ok).toBe(false);expect(await x.registry.list()).toEqual([])
 expect(await x.handlers.get(IPC.createTasks)!()).toEqual([])
 const id=await x.registry.beginCreation('cancelled');expect(id).toBe('cancelled');await x.registry.releaseCreation(id)
})

it('preserves unsafe npm deploy cleanup across cancellation without fallback or rollback', async () => {
 const x=await setup();const taskId='cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee'
 let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve});let marker=''
 boundary.spawn.mockImplementation(async (_exe:string,_args:string[],options:{signal:AbortSignal;cwd:string})=>{
  marker=path.join(options.cwd,'npm-evidence.log');await writeFile(marker,'preserve npm evidence');entered()
  await new Promise<void>(resolve=>options.signal.addEventListener('abort',()=>resolve(),{once:true}))
  throw new ProcessCleanupError('npm tree still unconfirmed')
 })
 const creation=x.handlers.get(IPC.createInstance)!({}, {taskId,name:'unsafe-extract',path:path.join(x.root,'unsafe-extract'),kind:'official-web',version:'0.2.0-rc.2'})
 await started
 const cancel=await x.handlers.get(IPC.createCancel)!({},taskId)
 expect(await creation).toMatchObject({ok:false,cleanupPending:true,error:expect.stringContaining('npm tree still unconfirmed')})
 expect(cancel).toMatchObject({ok:false,cleanupPending:true})
 expect(boundary.spawn).toHaveBeenCalledTimes(1)
 expect(boundary.rollback).not.toHaveBeenCalled();expect(boundary.release).not.toHaveBeenCalled()
 expect(await readFile(marker,'utf8')).toBe('preserve npm evidence')
 expect(await x.registry.list()).toEqual([])
})

it('retains unsafe selfcheck task, evidence and ID/port lease and rejects cancellation success', async () => {
 const x=await setup();const taskId='dddddddd-bbbb-cccc-dddd-eeeeeeeeeeee'
 let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve});let marker='',reserved=0
 boundary.selfcheck.mockImplementation(async ({signal,binJs,port}:{signal:AbortSignal;binJs:string;port:number})=>{
  reserved=port;marker=path.join(path.dirname(binJs),'selfcheck-evidence.log');await writeFile(marker,'preserve selfcheck evidence');entered()
  await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}))
  throw new ProcessCleanupError('selfcheck tree still unconfirmed')
 })
 const creation=x.handlers.get(IPC.createInstance)!({}, {taskId,name:'unsafe-check',path:path.join(x.root,'unsafe-check'),kind:'official-web',version:'0.2.0-rc.2'})
 await started
 expect(await x.handlers.get(IPC.createCancel)!({},taskId)).toMatchObject({ok:false,cleanupPending:true})
 expect(await creation).toMatchObject({ok:false,cleanupPending:true})
 expect(await x.handlers.get(IPC.createTasks)!()).toContainEqual(expect.objectContaining({taskId,cleanupPending:true,error:expect.stringContaining('selfcheck tree still unconfirmed')}))
 expect(await x.handlers.get(IPC.createCancel)!({},taskId)).toMatchObject({ok:false,cleanupPending:true})
 expect(boundary.rollback).not.toHaveBeenCalled();expect(boundary.release).not.toHaveBeenCalled()
 expect(await readFile(marker,'utf8')).toBe('preserve selfcheck evidence')
 expect(await x.registry.list()).toEqual([])
 const next=await x.registry.beginCreation('unsafe-check');expect(next).not.toBe('unsafe-check')
 expect(await x.registry.reservePort(next,reserved)).not.toBe(reserved);await x.registry.releaseCreation(next)
 const unfinished=await x.handlers.get(IPC.createUnfinished)!()
 const task=unfinished.find((entry:any)=>entry.taskId===taskId);expect(task).toBeDefined()
 expect(await x.handlers.get(IPC.createCleanup)!({}, {lockPath:task.lockPath,confirmed:true})).toMatchObject({ok:false,error:expect.stringContaining('active')})
 const {shutdownCreateTasks}=await import('../electron/create-runtime')
 await expect(shutdownCreateTasks()).rejects.toThrow('ownership remains unresolved')
})
