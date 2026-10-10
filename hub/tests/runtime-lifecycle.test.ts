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
import { describe, expect, it } from 'vitest'
import { ProcessCleanupError } from '../electron/process-supervisor'
import { createRuntimeSupervisor } from '../electron/runtime-supervisor'
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
const context = { id: 'a', port: 0, dshHome: 'fixture' }
function fixture() { const exit = deferred<{ code: number | null; signal: NodeJS.Signals | null }>(); return { pid: 1, url: '', exited: exit.promise, stop: async () => { exit.resolve({ code: 0, signal: null }) }, pause: async () => {}, resume: async () => {}, exit } }
describe('runtime ownership lifecycle', () => {
 it('retains uncertain startup ownership and refuses stop or restart success', async () => {
   const s = createRuntimeSupervisor({ spawn: async () => { throw new ProcessCleanupError('unconfirmed tree exit') } })
   await expect(s.start('a', context)).rejects.toThrow('unconfirmed tree exit')
   expect(s.state('a')).toMatchObject({ status: 'crashed', cleanupPending: true })
   await expect(s.stop('a')).rejects.toThrow(/not confirmed/)
   await expect(s.start('a', context)).rejects.toThrow(/not exited/)
   expect(s.state('a').status).not.toBe('stopped')
 })
 it('cancels deferred startup and disposes a late handle before stop succeeds', async () => {
   const gate = deferred<any>(); const h = fixture(); let signal: AbortSignal | undefined
   const s = createRuntimeSupervisor({ spawn: async (_c, abort) => { signal = abort; return gate.promise } })
   const starting = s.start('a', context).catch(() => {})
   const stopping = s.stop('a')
   const cancelled = signal?.aborted
   gate.resolve(h); await starting; await stopping
   expect(cancelled).toBe(true); expect(s.state('a').status).toBe('stopped')
 })
 it('never reports stopped after failed termination or missing exit confirmation', async () => {
   const h = fixture(); h.stop = async () => { throw new Error('denied') }
   const s = createRuntimeSupervisor({ spawn: async () => h, stopTimeoutMs: 30 })
   await s.start('a', context)
   await expect(s.stop('a')).rejects.toThrow('denied')
   expect(s.state('a').status).not.toBe('stopped')
   h.stop = async () => {}
   await expect(s.stop('a')).rejects.toThrow(/timed out/)
   expect(s.state('a').status).not.toBe('stopped')
   h.exit.resolve({ code: 1, signal: null })
 })
 it('synchronizes unexpected exits and still stops B when A fails', async () => {
   const a = fixture(), b = fixture(); const s = createRuntimeSupervisor({ spawn: async c => c.id === 'a' ? a : b })
   await s.start('a', context); await s.start('b', { ...context, id: 'b' })
   a.stop = async () => { throw new Error('denied') }
   await expect(s.stopAll()).rejects.toThrow()
   expect(s.state('b').status).toBe('stopped')
   a.exit.resolve({ code: 7, signal: null }); await Promise.resolve(); await Promise.resolve()
   expect(s.state('a').status).toBe('crashed')
 })
})
