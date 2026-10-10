// @vitest-environment jsdom
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
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { registerInstanceIpcHandlers } from '../electron/instance-ipc'
import { createRuntimeSupervisor } from '../electron/runtime-supervisor'
import { TrayPanel } from '../src/components/TrayPanel'
import { LauncherApiProvider } from '../src/api/client'

const bridge = vi.hoisted(() => ({ channels: new Map<string, Function>(), calls: [] as unknown[][], api: null as any }))
vi.mock('electron', () => ({
 contextBridge: { exposeInMainWorld: (_name: string, api: unknown) => { bridge.api = api } },
 ipcRenderer: { invoke: async (channel: string, ...args: unknown[]) => { bridge.calls.push([channel, ...args]); return bridge.channels.get(channel)!({}, ...args) }, on() {}, removeListener() {} },
}))
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
const roots: string[] = []
afterEach(async () => { bridge.calls.length = 0; bridge.channels.clear(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture(kind = 'official-web') {
 const root = await mkdtemp(path.join(tmpdir(), 'web-open-route-')); roots.push(root)
 const record = { id: 'a', root, dshHome: path.join(root, 'home'), workspace: path.join(root, 'workspace'), port: 19430, name: 'A', instanceKind: kind }
 // 真实流程中打开实例会先创建数据目录；停止时的镜像快照要求它们真实存在。
 await mkdir(record.dshHome, { recursive: true }); await mkdir(record.workspace, { recursive: true })
 const registry = { get: async (id: string) => { if (id !== 'a') throw new Error('Unknown instance'); return record }, list: async () => [record], markStopped: async () => {} } as any
 const exit = deferred<{ code: number; signal: null }>(); const opened: string[] = []; const external: string[] = []
 let onOpen = async () => { opened.push('a') }
 const supervisor = createRuntimeSupervisor({ spawn: async () => ({ pid: 123, url: 'http://127.0.0.1:19430', exited: exit.promise, open: () => onOpen(), stop: async () => { exit.resolve({ code: 0, signal: null }) }, pause: async () => {}, resume: async () => {} }) })
 registerInstanceIpcHandlers({ handle: (c, f) => bridge.channels.set(c, f) }, registry, supervisor, undefined, undefined, { openExternal: async (url: string) => { external.push(url) } } as any)
 await supervisor.start('a', { id: 'a', port: record.port, dshHome: record.dshHome })
 await import('../electron/preload')
 return { supervisor, exit, opened, external, setOpen: (fn: () => Promise<void>) => { onOpen = fn } }
}
it('tray Open goes through the preload instance ID route and reuses the live runtime opener', async () => {
 const f = await fixture()
 bridge.channels.set('settings:get', () => ({ language: 'en', trayTheme: 'auto' }))
 bridge.channels.set('deepseek:balance', () => null)
 bridge.channels.set('shell:open-external', (_e: unknown, url: string) => { f.external.push(url) })
 const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
 ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
 try {
  await act(async () => { root.render(<LauncherApiProvider value={bridge.api}><TrayPanel /></LauncherApiProvider>) })
  const button = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Open URL'))!
  expect(button.disabled).toBe(false)
  await act(async () => { button.click(); await new Promise(r => setTimeout(r, 0)) })
  expect(f.opened).toEqual(['a']); expect(f.external).toEqual([])
  expect(bridge.calls).toContainEqual(['instances:open', 'a'])
  expect(f.supervisor.state('a')).toMatchObject({ status: 'ready', pid: 123 })
 } finally { await act(async () => root.unmount()); host.remove(); await f.supervisor.stop('a') }
})
it('instance Open rejects supplied URL authority and stopped or crashed runtimes', async () => {
 const f = await fixture(); const open = bridge.channels.get('instances:open')
 expect(open).toBeTypeOf('function')
 await expect(Promise.resolve().then(() => open!({}, { id: 'a', url: 'https://example.org' }))).rejects.toThrow()
 f.exit.resolve({ code: 7, signal: null }); await Promise.resolve()
 await expect(open!({}, 'a')).rejects.toThrow(/not running/)
 await f.supervisor.stop('a')
 await expect(open!({}, 'a')).rejects.toThrow(/not running/)
 expect(f.opened).toEqual([])
})
it('Open shares the lifecycle queue and cannot reopen after a queued stop', async () => {
 const f = await fixture(); const gate = deferred<void>(); const entered = deferred<void>()
 f.setOpen(async () => { entered.resolve(); await gate.promise })
 const open = bridge.channels.get('instances:open'); expect(open).toBeTypeOf('function')
 const opening = open!({}, 'a').catch((error: unknown) => error); await entered.promise
 const stopping = bridge.channels.get('instances:stop')!({}, 'a')
 const later = open!({}, 'a').catch((error: unknown) => error)
 gate.resolve(); expect(String(await opening)).toMatch(/not running/)
 await stopping; expect(String(await later)).toMatch(/not running/)
 expect(f.supervisor.state('a').status).toBe('stopped')
})
it('Desktop Open retains external-browser behavior with the trusted runtime URL', async () => {
 const f = await fixture('official-desktop'); const open = bridge.channels.get('instances:open'); expect(open).toBeTypeOf('function')
 await open!({}, 'a')
 expect(f.external).toEqual(['http://127.0.0.1:19430/']); expect(f.opened).toEqual([])
 await f.supervisor.stop('a')
})
