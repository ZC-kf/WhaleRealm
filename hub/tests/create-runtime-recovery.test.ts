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
import { mkdtemp, mkdir, readFile, readdir, rm, rmdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beginCreateTransaction, discoverUnfinishedCreates } from '../electron/create-transaction'
import { createInstanceRegistry } from '../electron/instance-registry'
import { IPC } from '../src/constants'
vi.mock('electron', () => ({ ipcMain: {}, net: { fetch: async () => { throw new Error('network forbidden in recovery test') } } }))
import { registerCreateInstanceHandler } from '../electron/create-runtime'

const fixtures: string[] = []
afterEach(async () => { for (const root of fixtures.splice(0)) await rm(root, { recursive: true, force: true }) })
// Heavy real-fs test: full staging trees; allow headroom under parallel full-suite load.
it.each(['staging', 'journal-deleted', 'lock-deleted'])('performs startup read-only discovery and confirmed main API cleanup for %s', { timeout: 30_000 }, async state => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-recovery-api-test-')); fixtures.push(root)
  const hub = path.join(root, 'hub'); const parent = path.join(root, 'instances'); await mkdir(parent)
  const taskId = 'c478db3a-e0ad-4aec-9158-bb6bd03d8a00'
  const target = path.join(parent, 'unfinished')
  const tx = await beginCreateTransaction(target, taskId, [])
  await writeFile(path.join(tx.layout.runtimeRoot, 'partial'), 'task bytes')
  const [task] = await discoverUnfinishedCreates([parent])
  if (state !== 'staging') await tx.rollback()
  const journalFile = path.join(task!.lockPath, 'task.json'); const journal = JSON.parse(await readFile(journalFile, 'utf8'))
  if (state !== 'staging') journal.lockRemoval = 'pending'
  journal.pid = 2147483647; await writeFile(journalFile, JSON.stringify(journal))
  const durableFile = `${task!.lockPath}.journal.json`
  await writeFile(durableFile, JSON.stringify(journal))
  if (state !== 'staging') await unlink(journalFile)
  if (state === 'lock-deleted') await rmdir(task!.lockPath)
  const pointers = path.join(hub, 'hub-data', 'create-tasks'); await mkdir(pointers, { recursive: true })
  await writeFile(path.join(pointers, `${taskId}.json`), JSON.stringify({ target }))
  const before = await readFile(durableFile, 'utf8'); const parentBefore = await readdir(parent)
  const handlers = new Map<string, (...args: any[]) => Promise<any>>()
  const startup = registerCreateInstanceHandler({ handle: (channel: string, handler: (...args: any[]) => Promise<any>) => { handlers.set(channel, handler) } } as never,
    createInstanceRegistry(hub), { catalogPath: path.join(hub, 'catalog.json'), hubRuntimesRoot: path.join(hub, 'runtimes') }, () => undefined)
  expect(await startup).toHaveLength(1)
  expect(await readFile(durableFile, 'utf8')).toBe(before); expect(await readdir(parent)).toEqual(parentBefore)
  const refuse = await handlers.get(IPC.createCleanup)!({}, { lockPath: task!.lockPath, confirmed: false })
  expect(refuse.ok).toBe(false); expect(await readFile(durableFile, 'utf8')).toBe(before)
  const cleanup = await handlers.get(IPC.createCleanup)!({}, { lockPath: task!.lockPath, confirmed: true })
  expect(cleanup.ok).toBe(true); expect(await readdir(parent)).toEqual([]); expect(await readdir(pointers)).toEqual([])
})
