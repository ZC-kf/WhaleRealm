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

import { afterEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import { link, lstat, mkdtemp, mkdir, readFile, readdir, rename, rm, rmdir, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beginCreateTransaction, discoverUnfinishedCreates, cleanupUnfinishedCreate } from '../electron/create-transaction'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, link: vi.fn(actual.link) }
})

const fixtures: string[] = []
async function fixture() { const root = await mkdtemp(path.join(tmpdir(), 'dsh-create-test-')); fixtures.push(root); return root }
const stalePid = 2147483647
const fileIdentity = (info: { dev: number; ino: number }) => `${info.dev}:${info.ino}`
async function staleTask() {
  const root = await fixture(); const tx = await beginCreateTransaction(path.join(root, 'target'), 'interrupted', [])
  const [task] = await discoverUnfinishedCreates([root]); const lock = task!.lockPath
  const journal = JSON.parse(await readFile(path.join(lock, 'task.json'), 'utf8')); journal.pid = stalePid
  await writeFile(path.join(lock, 'task.json'), JSON.stringify(journal))
  // New durable evidence protocol: a sibling survives deletion of the internal journal.
  await writeFile(`${lock}.journal.json`, JSON.stringify(journal))
  return { root, tx, lock, journal }
}
async function recoveryMutex(lock: string, journal: any, pid: number) {
  const proofPath = `${lock}.recovery-6bccf9f5-6ec6-4326-88d7-579272cc2a07.json`
  await writeFile(proofPath, '')
  const owner = { version: 1, taskToken: journal.token, token: '6bccf9f5-6ec6-4326-88d7-579272cc2a07', pid, identity: fileIdentity(await lstat(proofPath)), proofPath }
  await writeFile(proofPath, JSON.stringify(owner)); await link(proofPath, path.join(lock, 'recovery.lock'))
  return proofPath
}
async function emptyPublishedRoot(x: Awaited<ReturnType<typeof staleTask>>) {
  const published = await x.tx.publish()
  x.journal = JSON.parse(await readFile(path.join(x.lock, 'task.json'), 'utf8')); x.journal.pid = stalePid
  for (const entry of [...x.journal.inventory].sort((a: any, b: any) => b.relative.split(path.sep).length - a.relative.split(path.sep).length)) {
    if (entry.directory) await rmdir(path.join(published.root, entry.relative)); else await unlink(path.join(published.root, entry.relative))
  }
  x.journal.phase = 'cleaning'
  x.journal.cleanup = { root: published.root, identity: fileIdentity(await lstat(published.root)), preserve: false, state: 'root-empty' }
  await writeFile(path.join(x.lock, 'task.json'), JSON.stringify(x.journal)); await writeFile(`${x.lock}.journal.json`, JSON.stringify(x.journal))
  await unlink(path.join(published.root, '.dsh-create-owner.json'))
  return published.root
}
afterEach(async () => { for (const root of fixtures.splice(0)) await rm(root, { recursive: true, force: true }) })

describe('owned creation transactions', () => {
  it('resumes explicitly confirmed cleanup after a verified stale recovery mutex', async () => {
    const x = await staleTask(); const proof = await recoveryMutex(x.lock, x.journal, stalePid)
    const before = await readFile(proof, 'utf8')
    expect(await discoverUnfinishedCreates([x.root])).toHaveLength(1); expect(await readFile(proof, 'utf8')).toBe(before)
    await cleanupUnfinishedCreate(x.lock, true, [])
    expect(await readdir(x.root)).toEqual([])
  })
  it('reclaims a stale interrupted replacement claim while preserving read-only discovery', async () => {
    const x = await staleTask(); const proof = await recoveryMutex(x.lock, x.journal, stalePid)
    await link(proof, path.join(x.lock, 'recovery.reclaim'))
    const before = await readdir(x.lock)
    expect(await discoverUnfinishedCreates([x.root])).toHaveLength(1)
    expect(await readdir(x.lock)).toEqual(before)
    await cleanupUnfinishedCreate(x.lock, true, [])
    expect(await readdir(x.root)).toEqual([])
  })
  it('reclaims durable stale recovery evidence after its mutex was removed', async () => {
    const x = await staleTask(); const proof = await recoveryMutex(x.lock, x.journal, stalePid)
    x.journal.recovery = JSON.parse(await readFile(proof, 'utf8'))
    await writeFile(`${x.lock}.journal.json`, JSON.stringify(x.journal))
    await writeFile(path.join(x.lock, 'task.json'), JSON.stringify(x.journal))
    await unlink(path.join(x.lock, 'recovery.lock'))
    await cleanupUnfinishedCreate(x.lock, true, [])
    expect(await readdir(x.root)).toEqual([])
  })
  it('refuses a live competing recovery without changing its mutex or task files', async () => {
    const x = await staleTask(); const proof = await recoveryMutex(x.lock, x.journal, process.pid)
    await writeFile(path.join(x.tx.layout.runtimeRoot, 'keep'), 'owned bytes')
    const before = await readFile(proof, 'utf8')
    await expect(cleanupUnfinishedCreate(x.lock, true, [])).rejects.toThrow(/active|进行|恢复/)
    expect(await readFile(proof, 'utf8')).toBe(before)
    expect(await readFile(path.join(x.tx.layout.runtimeRoot, 'keep'), 'utf8')).toBe('owned bytes')
  })
  it('allows only one simultaneous confirmed recovery to own the cleanup', async () => {
    const x = await staleTask()
    for (let index = 0; index < 20; index++) await writeFile(path.join(x.tx.layout.runtimeRoot, `${index}.bin`), 'task bytes')
    const results = await Promise.allSettled([cleanupUnfinishedCreate(x.lock, true, []), cleanupUnfinishedCreate(x.lock, true, [])])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(await readdir(x.root)).toEqual([])
  })
  it('rechecks durable live recovery ownership after acquiring a previously absent mutex', async () => {
    const x = await staleTask()
    await writeFile(path.join(x.tx.layout.runtimeRoot, 'keep'), 'owned bytes')
    const nativeLink = fs.link
    let competingProof = ''
    // Pause at the acquisition boundary: another recovery finishes removing its
    // mutex, but still owns the durable journal while disposing the task lock.
    const gate = vi.spyOn(fs, 'link').mockImplementation(async (source, destination) => {
      if (destination === path.join(x.lock, 'recovery.lock')) {
        gate.mockRestore()
        competingProof = await recoveryMutex(x.lock, x.journal, process.pid)
        x.journal.recovery = JSON.parse(await readFile(competingProof, 'utf8'))
        await writeFile(`${x.lock}.journal.json`, JSON.stringify(x.journal))
        await writeFile(path.join(x.lock, 'task.json'), JSON.stringify(x.journal))
        await unlink(path.join(x.lock, 'recovery.lock'))
      }
      await nativeLink(source, destination)
    })
    try {
      await expect(cleanupUnfinishedCreate(x.lock, true, [])).rejects.toThrow(/active|进行|恢复/)
      expect(await readFile(path.join(x.tx.layout.runtimeRoot, 'keep'), 'utf8')).toBe('owned bytes')
      expect(JSON.parse(await readFile(`${x.lock}.journal.json`, 'utf8')).recovery.proofPath).toBe(competingProof)
      expect(await readFile(competingProof, 'utf8')).toContain(x.journal.token)
    } finally { gate.mockRestore() }
  })
  it('finishes a verified empty root after its marker was deleted during cleanup', async () => {
    const x = await staleTask(); const target = await emptyPublishedRoot(x)
    expect(await readdir(target)).toEqual([])
    expect(await discoverUnfinishedCreates([x.root])).toHaveLength(1)
    await cleanupUnfinishedCreate(x.lock, true, [])
    expect(await readdir(x.root)).toEqual([])
  })
  it('preserves nonempty or substituted roots after terminal marker deletion', async () => {
    const changed = await staleTask(); const changedTarget = await emptyPublishedRoot(changed)
    await writeFile(path.join(changedTarget, 'user'), 'arrived after marker deletion')
    await expect(cleanupUnfinishedCreate(changed.lock, true, [])).rejects.toThrow()
    expect(await readFile(path.join(changedTarget, 'user'), 'utf8')).toBe('arrived after marker deletion')
    const substituted = await staleTask(); const substitutedTarget = await emptyPublishedRoot(substituted)
    await rename(substitutedTarget, path.join(substituted.root, 'old-target')); await mkdir(substitutedTarget)
    await expect(cleanupUnfinishedCreate(substituted.lock, true, [])).rejects.toThrow()
    expect(await readdir(substitutedTarget)).toEqual([])
  })
  it('discovers and releases an exact empty lock after its internal journal was deleted', async () => {
    const x = await staleTask(); await x.tx.rollback()
    x.journal = JSON.parse(await readFile(path.join(x.lock, 'task.json'), 'utf8')); x.journal.pid = stalePid; x.journal.lockRemoval = 'pending'
    await writeFile(`${x.lock}.journal.json`, JSON.stringify(x.journal)); await unlink(path.join(x.lock, 'task.json'))
    expect(await discoverUnfinishedCreates([x.root])).toHaveLength(1)
    await cleanupUnfinishedCreate(x.lock, true, [])
    expect(await readdir(x.root)).toEqual([])
  })
  it('finishes the external journal when lock removal completed before journal disposal', async () => {
    const x = await staleTask(); await x.tx.rollback()
    x.journal = JSON.parse(await readFile(path.join(x.lock, 'task.json'), 'utf8')); x.journal.pid = stalePid; x.journal.lockRemoval = 'pending'
    await writeFile(`${x.lock}.journal.json`, JSON.stringify(x.journal)); await unlink(path.join(x.lock, 'task.json')); await rmdir(x.lock)
    expect(await discoverUnfinishedCreates([x.root])).toHaveLength(1)
    await cleanupUnfinishedCreate(x.lock, true, [])
    expect(await readdir(x.root)).toEqual([])
  })
  it('disposes stale recovery proof after both mutex and task lock removal completed', async () => {
    const x = await staleTask(); await x.tx.rollback()
    x.journal = JSON.parse(await readFile(path.join(x.lock, 'task.json'), 'utf8'))
    const proof = await recoveryMutex(x.lock, x.journal, stalePid)
    x.journal.pid = stalePid; x.journal.lockRemoval = 'pending'
    x.journal.recovery = JSON.parse(await readFile(proof, 'utf8'))
    await writeFile(`${x.lock}.journal.json`, JSON.stringify(x.journal))
    await unlink(path.join(x.lock, 'recovery.lock')); await unlink(path.join(x.lock, 'task.json')); await rmdir(x.lock)
    expect(await discoverUnfinishedCreates([x.root])).toHaveLength(1)
    await cleanupUnfinishedCreate(x.lock, true, [])
    expect(await readdir(x.root)).toEqual([])
  })
  it('keeps user files and substituted lock directories when the internal journal is gone', async () => {
    const x = await staleTask(); await x.tx.rollback()
    x.journal = JSON.parse(await readFile(path.join(x.lock, 'task.json'), 'utf8')); x.journal.pid = stalePid; x.journal.lockRemoval = 'pending'
    await writeFile(`${x.lock}.journal.json`, JSON.stringify(x.journal)); await unlink(path.join(x.lock, 'task.json'))
    await writeFile(path.join(x.lock, 'user'), 'lock user bytes')
    await expect(cleanupUnfinishedCreate(x.lock, true, [])).rejects.toThrow()
    expect(await readFile(path.join(x.lock, 'user'), 'utf8')).toBe('lock user bytes')
    await rename(x.lock, path.join(x.root, 'old-lock')); await mkdir(x.lock)
    await expect(cleanupUnfinishedCreate(x.lock, true, [])).rejects.toThrow()
    expect(await readdir(x.lock)).toEqual([])
  })
  it('finishes committed metadata cleanup without deleting the published registered runtime', async () => {
    const x = await staleTask(); await writeFile(path.join(x.tx.layout.runtimeRoot, 'node.exe'), 'runtime')
    const layout = await x.tx.publish()
    x.journal = JSON.parse(await readFile(path.join(x.lock, 'task.json'), 'utf8')); x.journal.pid = stalePid; x.journal.phase = 'committed'
    x.journal.commitIdentity = fileIdentity(await lstat(layout.root))
    await writeFile(path.join(x.lock, 'task.json'), JSON.stringify(x.journal)); await writeFile(`${x.lock}.journal.json`, JSON.stringify(x.journal))
    await unlink(path.join(layout.root, '.dsh-create-owner.json'))
    await cleanupUnfinishedCreate(x.lock, true, [layout.root])
    expect(await readFile(path.join(layout.runtimeRoot, 'node.exe'), 'utf8')).toBe('runtime')
    expect(await readdir(x.root)).toEqual(['target'])
  })
  it('protects nonempty destinations without changing their bytes', async () => {
    const root = await fixture(); const target = path.join(root, 'target'); await mkdir(target)
    await writeFile(path.join(target, 'user.bin'), Buffer.from([0, 1, 255]))
    await expect(beginCreateTransaction(target, 'one', [])).rejects.toThrow(/empty|为空/)
    expect(await readFile(path.join(target, 'user.bin'))).toEqual(Buffer.from([0, 1, 255]))
    expect(await readdir(root)).toEqual(['target'])
  })
  it('rejects existing instance ancestors, descendants and realpath aliases', async () => {
    const root = await fixture(); const existing = path.join(root, 'existing'); await mkdir(existing)
    await writeFile(path.join(existing, 'keep'), 'other instance')
    const alias = path.join(root, 'alias'); await symlink(existing, alias, 'junction')
    for (const target of [root, path.join(existing, 'child'), path.join(alias, 'child'), alias]) {
      await expect(beginCreateTransaction(target, 'one', [existing])).rejects.toThrow()
    }
    expect(await readFile(path.join(existing, 'keep'), 'utf8')).toBe('other instance')
  })
  it('uses exclusive locking across parent aliases and permits Chinese space paths', async () => {
    const root = await fixture(); const parent = path.join(root, '中文 空格'); await mkdir(parent)
    const alias = path.join(root, 'alias'); await symlink(parent, alias, 'junction')
    const tx = await beginCreateTransaction(path.join(parent, '实例 A'), 'one', [])
    await expect(beginCreateTransaction(path.join(alias, '实例 A'), 'two', [])).rejects.toThrow(/lock|任务/)
    await writeFile(path.join(tx.layout.runtimeRoot, 'node.exe'), 'runtime bytes')
    const published = await tx.publish()
    expect(published.root).toBe(path.join(parent, '实例 A'))
    expect(await readFile(path.join(published.runtimeRoot, 'node.exe'), 'utf8')).toBe('runtime bytes')
    await tx.release()
    expect((await discoverUnfinishedCreates([parent]))).toEqual([])
  })
  it('rechecks user files added after selfcheck and rolls back only staging', async () => {
    const root = await fixture(); const target = path.join(root, 'target'); await mkdir(target)
    const tx = await beginCreateTransaction(target, 'one', [])
    await writeFile(path.join(tx.layout.runtimeRoot, 'artifact'), 'owned')
    await writeFile(path.join(target, 'user'), 'arrived during deploy')
    await expect(tx.publish()).rejects.toThrow(/empty|为空/)
    await tx.rollback(); await tx.release()
    expect(await readdir(target)).toEqual(['user'])
    expect(await readFile(path.join(target, 'user'), 'utf8')).toBe('arrived during deploy')
  })
  it('refuses publication when a parent is swapped for a junction', async () => {
    const root = await fixture(); const parent = path.join(root, 'parent'); const other = path.join(root, 'other')
    await mkdir(parent); await mkdir(other)
    const tx = await beginCreateTransaction(path.join(parent, 'target'), 'one', [])
    await rename(parent, path.join(root, 'moved')); await symlink(other, parent, 'junction')
    await expect(tx.publish()).rejects.toThrow(/changed|路径/)
    await expect(tx.rollback()).rejects.toThrow(/ownership|所有权|路径/)
    expect(await readdir(other)).toEqual([])
  })
  it('preserves added and modified published files and reports incomplete cleanup', async () => {
    const root = await fixture(); const tx = await beginCreateTransaction(path.join(root, 'target'), 'one', [])
    await writeFile(path.join(tx.layout.runtimeRoot, 'owned'), 'original')
    const published = await tx.publish()
    await writeFile(path.join(published.runtimeRoot, 'owned'), 'user edit')
    await writeFile(path.join(published.runtimeRoot, 'extra'), 'user file')
    await expect(tx.rollback()).rejects.toThrow(/cleanup|清理/)
    expect(await readFile(path.join(published.runtimeRoot, 'owned'), 'utf8')).toBe('user edit')
    expect(await readFile(path.join(published.runtimeRoot, 'extra'), 'utf8')).toBe('user file')
    expect(await discoverUnfinishedCreates([root])).toHaveLength(1)
  })
  it('discovers without writing and requires explicit confirmation and stale ownership for cleanup', async () => {
    const root = await fixture(); const tx = await beginCreateTransaction(path.join(root, 'target'), 'one', [])
    const tasks = await discoverUnfinishedCreates([root]); expect(tasks).toHaveLength(1)
    const before = await readdir(root)
    await expect(cleanupUnfinishedCreate(tasks[0]!.lockPath, false, [])).rejects.toThrow(/confirm|确认/)
    await expect(cleanupUnfinishedCreate(tasks[0]!.lockPath, true, [])).rejects.toThrow(/active|进行/)
    expect(await readdir(root)).toEqual(before)
    await tx.rollback(); await tx.release()
  })
  it('cleans a stale published task using its inventory and rejects tampered ownership', async () => {
    const root = await fixture(); const tx = await beginCreateTransaction(path.join(root, 'target'), 'one', [])
    await writeFile(path.join(tx.layout.runtimeRoot, 'artifact'), 'owned bytes')
    await tx.publish()
    const [task] = await discoverUnfinishedCreates([root])
    const journalFile = path.join(task!.lockPath, 'task.json')
    const journal = JSON.parse(await readFile(journalFile, 'utf8'))
    journal.pid = 2147483647
    await writeFile(journalFile, JSON.stringify(journal))
    await writeFile(`${task!.lockPath}.journal.json`, JSON.stringify(journal))
    expect((await discoverUnfinishedCreates([root]))[0]?.active).toBe(false)
    await expect(cleanupUnfinishedCreate(task!.lockPath, true, [path.join(root, 'target', 'runtime')])).rejects.toThrow(/重叠/)
    await cleanupUnfinishedCreate(task!.lockPath, true, [])
    expect(await readdir(root)).toEqual([])

    const next = await beginCreateTransaction(path.join(root, 'another'), 'two', [])
    await writeFile(path.join(next.layout.runtimeRoot, 'artifact'), 'keep bytes')
    await writeFile(path.join(next.layout.root, '.dsh-create-owner.json'), JSON.stringify({ token: 'fake', taskId: 'two' }))
    await expect(next.rollback()).rejects.toThrow(/所有权/)
    expect(await readFile(path.join(next.layout.runtimeRoot, 'artifact'), 'utf8')).toBe('keep bytes')
  })
  it('does not follow a published directory replaced with a junction during rollback', async () => {
    const root = await fixture(); const other = path.join(root, 'other'); await mkdir(other)
    await writeFile(path.join(other, 'keep'), 'other instance bytes')
    const tx = await beginCreateTransaction(path.join(root, 'target'), 'one', [])
    await writeFile(path.join(tx.layout.runtimeRoot, 'artifact'), 'owned')
    const published = await tx.publish()
    await rename(published.runtimeRoot, path.join(root, 'moved-runtime'))
    await symlink(other, published.runtimeRoot, 'junction')
    await expect(tx.rollback()).rejects.toThrow(/清理/)
    expect(await readFile(path.join(other, 'keep'), 'utf8')).toBe('other instance bytes')
  })
})
