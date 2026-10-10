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

import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, readFile, readdir, realpath, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { InstanceLayout } from './runtime-adapter'
import { resolveManagedLayout } from './instance-paths'

export interface CreateTransaction { layout: InstanceLayout; publish(): Promise<InstanceLayout>; rollback(): Promise<void>; release(): Promise<void> }
export interface UnfinishedCreate { lockPath: string; taskId: string; target: string; pid: number; active: boolean; phase: string }
interface OwnedEntry { relative: string; directory: boolean; identity: string; digest?: string }
interface RecoveryOwner { version: 1; taskToken: string; token: string; pid: number; identity: string; proofPath: string }
interface RootCleanup { root: string; identity: string; preserve: boolean; state: 'members' | 'root-empty' | 'root-finished' }
interface Journal {
  version: 1; taskId: string; token: string; pid: number; target: string; requestedTarget: string
  parent: string; parentIdentity: string; targetIdentity?: string; lockIdentity: string
  phase: 'staging' | 'publishing' | 'published' | 'cleaning' | 'rolled-back' | 'committed'; inventory?: OwnedEntry[]
  cleanup?: RootCleanup; commitIdentity?: string; lockRemoval?: 'pending'; recovery?: RecoveryOwner
}
const OWNER = '.dsh-create-owner.json'
const JOURNAL = 'task.json'
const key = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
const lockName = (target: string) => `.dsh-create-${digest(key(target)).slice(0, 32)}.lock`
const identity = (info: { dev: number; ino: number }) => `${info.dev}:${info.ino}`
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
async function info(file: string) { try { return await lstat(file) } catch (error) { if (missing(error)) return null; throw error } }
function contains(parent: string, child: string) { const rel = path.relative(key(parent), key(child)); return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)) }

/** Resolve missing leaves through the nearest real ancestor; comparisons include junction aliases. */
async function canonical(file: string): Promise<string> {
  const absolute = path.resolve(file)
  try { return await realpath(absolute) } catch (error) {
    if (!missing(error)) throw error
    const parent = path.dirname(absolute)
    if (parent === absolute) throw error
    return path.join(await canonical(parent), path.basename(absolute))
  }
}
async function rejectOverlap(target: string, existingRoots: string[]) {
  for (const root of existingRoots.filter(Boolean)) {
    const existing = await canonical(root)
    if (contains(target, existing) || contains(existing, target)) throw new Error(`目标路径与已有实例重叠：${root}`)
  }
}
async function emptyTarget(target: string) {
  const value = await info(target)
  if (value && (value.isSymbolicLink() || !value.isDirectory())) throw new Error('目标路径不能是链接或文件')
  if (value && (await readdir(target)).length) throw new Error('目标文件夹必须为空')
  return value
}
function processActive(pid: number) { try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH' } }
const durableJournal = (lock: string) => `${lock}.journal.json`
async function atomicJson(file: string, value: unknown, lock: string) {
  // Adjacent temporaries cannot strand a mutex or prevent lock-directory disposal.
  const temp = `${lock}.${randomUUID()}.tmp`
  const handle = await open(temp, 'wx')
  try { await handle.writeFile(JSON.stringify(value), 'utf8'); await handle.sync() }
  finally { await handle.close() }
  await rename(temp, file)
}
async function regularJson(file: string) {
  const value = await lstat(file)
  if (!value.isFile() || value.isSymbolicLink()) throw new Error(`所有权日志不是普通文件：${file}`)
  return JSON.parse(await readFile(file, 'utf8'))
}
async function storedJournal(lock: string): Promise<Journal> {
  return await info(durableJournal(lock)) ? regularJson(durableJournal(lock)) : regularJson(path.join(lock, JOURNAL))
}
async function save(lock: string, journal: Journal) {
  const previous = await info(durableJournal(lock))
  if (previous) {
    const stored = await regularJson(durableJournal(lock)) as Journal
    if (stored.token !== journal.token || stored.taskId !== journal.taskId) throw new Error('外部任务日志所有权不匹配')
  }
  // Flush the authoritative evidence before any destructive operation or internal mirror update.
  await atomicJson(durableJournal(lock), journal, lock)
  if (await info(lock)) await atomicJson(path.join(lock, JOURNAL), journal, lock)
}
async function verifyLock(lock: string, journal: Journal, allowRemoved = false) {
  const value = await info(lock)
  const removed = !value && allowRemoved && journal.lockRemoval === 'pending' && ['rolled-back', 'committed'].includes(journal.phase)
  if ((!removed && (!value || value.isSymbolicLink() || !value.isDirectory() || identity(value) !== journal.lockIdentity || key(await realpath(lock)) !== key(lock)))
    || key(await canonical(journal.requestedTarget)) !== key(journal.target)
    || key(await realpath(journal.parent)) !== key(journal.parent)
    || identity(await lstat(journal.parent)) !== journal.parentIdentity) throw new Error('任务所有权或父路径 changed，拒绝清理或发布')
  const stored = await storedJournal(lock)
  if (stored.token !== journal.token || stored.taskId !== journal.taskId) throw new Error('任务所有权标记不匹配')
  if (await info(path.join(lock, JOURNAL))) {
    const mirror = await regularJson(path.join(lock, JOURNAL)) as Journal
    if (mirror.token !== journal.token || mirror.taskId !== journal.taskId) throw new Error('内部任务日志所有权已改变')
  }
}
async function verifyOwner(root: string, journal: Journal) {
  const value = await info(root)
  if (!value || value.isSymbolicLink() || !value.isDirectory() || key(await realpath(root)) !== key(root)) throw new Error('任务目录所有权验证失败')
  const markerInfo = await lstat(path.join(root, OWNER))
  if (!markerInfo.isFile() || markerInfo.isSymbolicLink()) throw new Error('任务目录所有权标记无效')
  const marker = JSON.parse(await readFile(path.join(root, OWNER), 'utf8')) as { token?: string; taskId?: string }
  if (marker.token !== journal.token || marker.taskId !== journal.taskId) throw new Error('任务目录所有权标记不匹配')
}
async function inventory(root: string): Promise<OwnedEntry[]> {
  const entries: OwnedEntry[] = []
  async function visit(dir: string) {
    for (const name of await readdir(dir)) {
      const file = path.join(dir, name); const relative = path.relative(root, file)
      if (relative === OWNER) continue
      const value = await lstat(file)
      if (value.isSymbolicLink() || (!value.isDirectory() && !value.isFile())) throw new Error(`部署产物包含不安全链接：${relative}`)
      entries.push({ relative, directory: value.isDirectory(), identity: identity(value), ...(!value.isDirectory() ? { digest: digest(await readFile(file)) } : {}) })
      if (value.isDirectory()) await visit(file)
    }
  }
  await visit(root)
  return entries
}
function safeRelative(relative: string) { return !!relative && !path.isAbsolute(relative) && path.normalize(relative) === relative && !relative.split(/[\\/]/).some(part => part === '..' || part === '.') && relative !== OWNER }
async function safeEntry(root: string, relative: string) {
  if (!safeRelative(relative)) throw new Error('所有权清单含路径逃逸')
  const file = path.join(root, relative)
  let ancestor = path.dirname(file)
  while (ancestor !== root) {
    const value = await info(ancestor)
    if (!value) return null
    if (!value.isDirectory() || value.isSymbolicLink()) throw new Error(`清理路径包含链接：${relative}`)
    ancestor = path.dirname(ancestor)
  }
  return file
}
/** Remove exact inventoried members, never recursively remove the user's destination. */
async function verifyRootIdentity(root: string, expected: string) {
  const value = await info(root)
  if (!value) return false
  if (!value.isDirectory() || value.isSymbolicLink() || identity(value) !== expected || key(await realpath(root)) !== key(root)) throw new Error('任务目录所有权身份已改变，残留保留')
  return true
}
async function finishEmptyRoot(lock: string, journal: Journal) {
  const cleanup = journal.cleanup!
  if (await verifyRootIdentity(cleanup.root, cleanup.identity)) {
    const names = await readdir(cleanup.root)
    if (names.some(name => name !== OWNER)) throw new Error('清理失败，终态目录含用户内容，残留保留')
    if (names.includes(OWNER)) { await verifyOwner(cleanup.root, journal); await unlink(path.join(cleanup.root, OWNER)) }
    if (!(await verifyRootIdentity(cleanup.root, cleanup.identity)) || (await readdir(cleanup.root)).length) throw new Error('清理失败，目录在终态处理时已改变')
    if (!cleanup.preserve) await rmdir(cleanup.root)
  }
  cleanup.state = 'root-finished'; journal.phase = 'rolled-back'; await save(lock, journal)
}
async function removeOwned(lock: string, root: string, journal: Journal, entries: OwnedEntry[]) {
  if (journal.cleanup) {
    if (journal.cleanup.root !== root) throw new Error('清理目录与持久所有权不匹配')
    if (journal.cleanup.state !== 'members') { await finishEmptyRoot(lock, journal); return }
    await verifyRootIdentity(root, journal.cleanup.identity)
    entries = journal.inventory!
  } else {
    await verifyOwner(root, journal)
    journal.cleanup = { root, identity: identity(await lstat(root)), preserve: !!journal.targetIdentity && root === journal.target, state: 'members' }
    journal.inventory = entries; journal.phase = 'cleaning'; await save(lock, journal)
  }
  await verifyOwner(root, journal)
  const errors: string[] = []
  for (const entry of [...entries].sort((a, b) => b.relative.split(path.sep).length - a.relative.split(path.sep).length)) {
    try {
      const file = await safeEntry(root, entry.relative); if (!file) continue
      const value = await info(file); if (!value) continue
      if (value.isSymbolicLink() || identity(value) !== entry.identity || value.isDirectory() !== entry.directory) throw new Error(`所有权发生变化：${entry.relative}`)
      if (entry.directory) await rmdir(file)
      else {
        if (digest(await readFile(file)) !== entry.digest) throw new Error(`用户修改了任务文件：${entry.relative}`)
        await unlink(file)
      }
    } catch (error) { errors.push(message(error)) }
  }
  if ((await readdir(root)).some(name => name !== OWNER)) errors.push(`目录含未拥有或未清理的内容：${root}`)
  if (errors.length) throw new Error(`清理失败，残留已保留：${errors.join('；')}`)
  await verifyOwner(root, journal)
  journal.cleanup!.state = 'root-empty'; await save(lock, journal)
  await finishEmptyRoot(lock, journal)
}
async function releaseLock(lock: string, journal: Journal, recovery?: RecoveryOwner) {
  await verifyLock(lock, journal, true)
  if (!['rolled-back', 'committed'].includes(journal.phase)) throw new Error('任务未持久完成，保留所有权日志')
  if (!(await info(lock))) {
    if (recovery) await removeProof(recovery, journal)
    await unlink(durableJournal(lock)); return
  }
  const names = await readdir(lock)
  if (names.some(name => name !== JOURNAL && name !== 'task.json.tmp' && !(name === 'recovery.lock' && recovery))) throw new Error(`清理失败，任务锁含残留：${lock}`)
  journal.lockRemoval = 'pending'; await save(lock, journal)
  const temp = await info(path.join(lock, 'task.json.tmp'))
  if (temp) { if (!temp.isFile() || temp.isSymbolicLink()) throw new Error('任务日志临时文件所有权无效'); await unlink(path.join(lock, 'task.json.tmp')) }
  if (recovery) await removeMutex(path.join(lock, 'recovery.lock'), recovery, journal)
  if (await info(path.join(lock, JOURNAL))) await unlink(path.join(lock, JOURNAL))
  await rmdir(lock)
  if (recovery) await removeProof(recovery, journal)
  // The external journal is removed last, after the exact lock directory is gone.
  await unlink(durableJournal(lock))
}

export async function beginCreateTransaction(selectedTarget: string, taskId: string, existingRoots: string[]): Promise<CreateTransaction> {
  if (!path.isAbsolute(selectedTarget) || !taskId || taskId.length > 128) throw new Error('无效创建目标或任务 id')
  const requestedTarget = path.resolve(selectedTarget)
  let parent: string
  try { parent = await realpath(path.dirname(requestedTarget)) }
  catch (error) { if (missing(error)) throw new Error('目标父文件夹不存在，请先创建父文件夹或选择已有父文件夹'); throw error }
  const target = path.join(parent, path.basename(requestedTarget))
  if (path.dirname(target) === target) throw new Error('不能在卷根创建实例')
  await rejectOverlap(await canonical(requestedTarget), existingRoots)
  const original = await emptyTarget(requestedTarget)
  const lock = path.join(parent, lockName(target))
  if (await info(durableJournal(lock))) throw new Error(`目标已有待恢复的创建任务日志：${target}`)
  try { await mkdir(lock) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`目标已有创建任务 lock：${target}`); throw error }
  const journal: Journal = { version: 1, taskId, token: randomUUID(), pid: process.pid, target, requestedTarget, parent, parentIdentity: identity(await lstat(parent)), targetIdentity: original ? identity(original) : undefined, lockIdentity: identity(await lstat(lock)), phase: 'staging' }
  const stage = path.join(lock, 'staging')
  try {
    await save(lock, journal)
    await mkdir(stage)
    await writeFile(path.join(stage, OWNER), JSON.stringify({ token: journal.token, taskId }), { flag: 'wx' })
    const layout = resolveManagedLayout(stage)
    for (const dir of [layout.runtimeRoot, layout.dshHome, layout.electronUserData, layout.workspace, layout.logs, layout.cache]) await mkdir(dir, { recursive: true })
    let published = false; let rolledBack = false; let released = false
    return {
      layout,
      async publish() {
        if (published || rolledBack || released) throw new Error('创建任务状态无效')
        await verifyLock(lock, journal); await verifyOwner(stage, journal)
        await rejectOverlap(await canonical(requestedTarget), existingRoots)
        const current = await emptyTarget(target)
        if (journal.targetIdentity ? !current || identity(current) !== journal.targetIdentity : !!current) throw new Error('目标路径 changed，拒绝发布')
        journal.inventory = await inventory(stage); journal.phase = 'publishing'; await save(lock, journal)
        if (current) await rmdir(target) // Atomic emptiness guard: newly arrived user files make this fail.
        try { await rename(stage, target) } catch (error) {
          if (current && !(await info(target))) await mkdir(target).catch(() => undefined)
          throw error
        }
        published = true; journal.phase = 'published'; await save(lock, journal)
        return resolveManagedLayout(target)
      },
      async rollback() {
        if (released || rolledBack) return
        await verifyLock(lock, journal)
        const ownedRoot = published ? target : stage
        if (await info(ownedRoot) || journal.cleanup) await removeOwned(lock, ownedRoot, journal, published ? journal.inventory! : journal.inventory ?? await inventory(stage))
        rolledBack = true; journal.phase = 'rolled-back'; await save(lock, journal)
      },
      async release() {
        if (released) return
        if (!published && !rolledBack) throw new Error('创建尚未完成，任务锁保留')
        if (published && !rolledBack) {
          await verifyLock(lock, journal); await verifyOwner(target, journal)
          journal.phase = 'committed'; journal.commitIdentity = identity(await lstat(target)); await save(lock, journal)
          await unlink(path.join(target, OWNER))
        }
        await releaseLock(lock, journal); released = true
      },
    }
  } catch (error) {
    // Initialization owns only these fixed files; preserve any unexpected content.
    try {
      if (await info(stage)) await removeOwned(lock, stage, journal, await inventory(stage))
      journal.phase = 'rolled-back'; await save(lock, journal)
      await releaseLock(lock, journal)
    } catch (cleanupError) { throw new Error(`${message(error)}；清理失败：${message(cleanupError)}；任务残留：${lock}`) }
    throw error
  }
}

async function readJournal(lock: string): Promise<Journal> {
  const journal = await storedJournal(lock)
  if (journal.version !== 1 || typeof journal.taskId !== 'string' || !journal.taskId || typeof journal.token !== 'string' || !/^[a-f0-9-]{36}$/.test(journal.token)
    || !Number.isInteger(journal.pid) || journal.pid <= 0 || typeof journal.target !== 'string' || !path.isAbsolute(journal.target)
    || typeof journal.requestedTarget !== 'string' || !path.isAbsolute(journal.requestedTarget) || typeof journal.parent !== 'string'
    || path.dirname(journal.target) !== journal.parent || path.dirname(lock) !== journal.parent || path.basename(lock) !== lockName(journal.target)
    || !['staging', 'publishing', 'published', 'cleaning', 'rolled-back', 'committed'].includes(journal.phase)
    || (journal.cleanup && (!['members', 'root-empty', 'root-finished'].includes(journal.cleanup.state) || typeof journal.cleanup.identity !== 'string' || typeof journal.cleanup.preserve !== 'boolean' || ![journal.target, path.join(lock, 'staging')].includes(journal.cleanup.root)))
    || (journal.phase === 'cleaning' && !journal.cleanup)
    || (journal.phase === 'committed' && typeof journal.commitIdentity !== 'string')
    || (journal.lockRemoval && (journal.lockRemoval !== 'pending' || !['rolled-back', 'committed'].includes(journal.phase)))
    || (journal.inventory && (!Array.isArray(journal.inventory) || journal.inventory.some(entry => !safeRelative(entry.relative) || typeof entry.identity !== 'string' || typeof entry.directory !== 'boolean')))) throw new Error('无效任务所有权日志')
  await verifyLock(lock, journal, true)
  return journal
}
/** Read-only startup discovery: invalid or unowned directories are never treated as cleanup candidates. */
export async function discoverUnfinishedCreates(parents: string[]): Promise<UnfinishedCreate[]> {
  const result: UnfinishedCreate[] = []; const seen = new Set<string>()
  for (const candidate of parents) {
    let parent: string
    try { parent = await realpath(candidate) } catch { continue }
    if (seen.has(key(parent))) continue; seen.add(key(parent))
    const locks = new Set((await readdir(parent)).filter(name => /^\.dsh-create-[a-f0-9]{32}\.lock(?:\.journal\.json)?$/.test(name)).map(name => name.replace(/\.journal\.json$/, '')))
    for (const name of locks) {
      const lock = path.join(parent, name)
      try {
        const journal = await readJournal(lock)
        const recovery = await currentRecovery(lock, journal)
        result.push({ lockPath: lock, taskId: journal.taskId, target: journal.target, pid: journal.pid, active: processActive(journal.pid) || !!recovery && processActive(recovery.pid), phase: journal.phase })
      } catch { /* Ownership not established: leave untouched. */ }
    }
  }
  return result
}
function validateRecovery(owner: RecoveryOwner, lock: string, journal: Journal) {
  if (owner.version !== 1 || owner.taskToken !== journal.token || !/^[a-f0-9-]{36}$/.test(owner.token)
    || !Number.isInteger(owner.pid) || owner.pid <= 0 || typeof owner.identity !== 'string'
    || owner.proofPath !== `${lock}.recovery-${owner.token}.json`) throw new Error('恢复互斥所有权证据无效')
}
async function readRecovery(file: string, lock: string, journal: Journal): Promise<RecoveryOwner> {
  const owner = await regularJson(file) as RecoveryOwner
  validateRecovery(owner, lock, journal)
  if (identity(await lstat(file)) !== owner.identity) throw new Error('恢复互斥文件身份已改变')
  return owner
}
async function currentRecovery(lock: string, journal: Journal): Promise<RecoveryOwner | undefined> {
  const claim = path.join(lock, 'recovery.reclaim')
  if (await info(claim)) return readRecovery(claim, lock, journal)
  const mutex = path.join(lock, 'recovery.lock')
  if (await info(mutex)) return readRecovery(mutex, lock, journal)
  if (journal.recovery) { validateRecovery(journal.recovery, lock, journal); return journal.recovery }
  return undefined
}
async function removeMutex(file: string, owner: RecoveryOwner, journal: Journal) {
  if (!(await info(file))) return
  const lock = path.dirname(file)
  const current = await readRecovery(file, lock, journal)
  if (current.token !== owner.token || current.identity !== owner.identity) throw new Error('恢复互斥所有权已改变，拒绝释放')
  await unlink(file)
}
async function removeProof(owner: RecoveryOwner, journal: Journal) {
  if (!(await info(owner.proofPath))) return
  const lock = owner.proofPath.slice(0, -`.recovery-${owner.token}.json`.length)
  const current = await readRecovery(owner.proofPath, lock, journal)
  if (current.identity !== owner.identity || current.token !== owner.token) throw new Error('恢复所有权证据已改变，残留保留')
  await unlink(owner.proofPath)
}
async function reclaimStale(file: string, lock: string, journal: Journal) {
  if (!(await info(file))) return
  const stale = await readRecovery(file, lock, journal)
  if (processActive(stale.pid)) throw new Error('恢复仍在进行 active，拒绝并发清理')
  await removeMutex(file, stale, journal)
  // Another hard link may still hold this proof; removing this pathname never follows it.
  await removeProof(stale, journal)
}
async function acquireRecovery(lock: string, journal: Journal): Promise<RecoveryOwner> {
  const existing = await currentRecovery(lock, journal)
  if (existing && processActive(existing.pid)) throw new Error('恢复仍在进行 active，拒绝并发清理')
  const claim = path.join(lock, 'recovery.reclaim')
  await reclaimStale(claim, lock, journal)
  const token = randomUUID(); const proofPath = `${lock}.recovery-${token}.json`
  const handle = await open(proofPath, 'wx')
  const owner: RecoveryOwner = { version: 1, taskToken: journal.token, token, pid: process.pid, identity: identity(await handle.stat()), proofPath }
  try { await handle.writeFile(JSON.stringify(owner), 'utf8'); await handle.sync() }
  finally { await handle.close() }
  const mutex = path.join(lock, 'recovery.lock')
  const replacement = `${proofPath}.swap`
  let claimed = false; let acquired = false
  try {
    // Atomic hard-link acquisition publishes already flushed metadata: no empty mutex window.
    try { await link(proofPath, mutex); acquired = true }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      await link(proofPath, claim); claimed = true
      const stale = await readRecovery(mutex, lock, journal)
      if (processActive(stale.pid)) throw new Error('恢复仍在进行 active，拒绝并发清理')
      // Replace the stale slot atomically while holding the owned reclamation claim.
      // There is never an empty slot for a competing acquisition to steal.
      await link(proofPath, replacement)
      const recheck = await readRecovery(mutex, lock, journal)
      if (recheck.token !== stale.token || recheck.identity !== stale.identity) throw new Error('恢复互斥在确认后已改变')
      await rename(replacement, mutex); acquired = true
      await removeProof(stale, journal)
    }
    // A caller can have read the journal before a competing recovery removed
    // its mutex for final disposal. Its flushed owner remains authoritative
    // during that gap; never overwrite it using the caller's older snapshot.
    const latest = await readJournal(lock)
    if (latest.token !== journal.token || latest.taskId !== journal.taskId) throw new Error('任务所有权在恢复互斥获取后已改变')
    if (latest.recovery) {
      validateRecovery(latest.recovery, lock, latest)
      if (latest.recovery.token !== owner.token && processActive(latest.recovery.pid)) throw new Error('恢复仍在进行 active，拒绝并发清理')
      if (latest.recovery.token !== owner.token) await removeProof(latest.recovery, latest)
    }
    Object.assign(journal, latest)
    journal.recovery = owner; await save(lock, journal)
    if (claimed) { await removeMutex(claim, owner, journal); claimed = false }
    return owner
  } catch (error) {
    if (await info(replacement)) {
      const pending = await readRecovery(replacement, lock, journal)
      if (pending.identity !== owner.identity) throw new Error('恢复替换证据发生变化，残留保留')
      await unlink(replacement)
    }
    if (claimed) await removeMutex(claim, owner, journal)
    if (acquired) await removeMutex(mutex, owner, journal)
    await removeProof(owner, journal)
    throw error
  }
}
async function finishCommitted(lock: string, journal: Journal) {
  if (!journal.commitIdentity || !(await verifyRootIdentity(journal.target, journal.commitIdentity))) throw new Error('已收录目录所有权发生变化，保留任务日志')
  if (await info(path.join(journal.target, OWNER))) {
    await verifyOwner(journal.target, journal); await unlink(path.join(journal.target, OWNER))
  }
  await save(lock, journal)
}
/** User-confirmed cleanup of an interrupted, no-longer-active task; registered roots remain protected. */
export async function cleanupUnfinishedCreate(lockPath: string, confirmed: boolean, existingRoots: string[]): Promise<void> {
  if (confirmed !== true) throw new Error('清理中断任务需要明确确认 confirm')
  const lock = path.resolve(lockPath); const journal = await readJournal(lock)
  if (processActive(journal.pid)) throw new Error('任务仍在进行 active，不能清理')
  if (journal.phase !== 'committed') await rejectOverlap(journal.target, existingRoots)
  const live = await currentRecovery(lock, journal)
  if (live && processActive(live.pid)) throw new Error('恢复仍在进行 active，拒绝并发清理')
  const recovery = await info(lock) ? await acquireRecovery(lock, journal) : undefined
  try {
    await verifyLock(lock, journal, true)
    const stage = path.join(lock, 'staging')
    if (journal.phase === 'committed') await finishCommitted(lock, journal)
    else if (journal.cleanup) await removeOwned(lock, journal.cleanup.root, journal, journal.inventory ?? [])
    else if (await info(stage)) await removeOwned(lock, stage, journal, await inventory(stage))
    else if (journal.phase !== 'rolled-back' && await info(journal.target)) {
      if (!journal.inventory) throw new Error('缺少发布所有权清单，保留目录')
      await removeOwned(lock, journal.target, journal, journal.inventory)
    }
    if (journal.phase !== 'committed') { journal.phase = 'rolled-back'; await save(lock, journal) }
    await releaseLock(lock, journal, recovery ?? journal.recovery)
  } catch (error) {
    if (recovery && await info(lock)) {
      try {
        await removeMutex(path.join(lock, 'recovery.lock'), recovery, journal)
        await removeProof(recovery, journal)
        journal.recovery = undefined; await save(lock, journal)
      } catch (cleanupError) { throw new Error(`${message(error)}；恢复元数据清理失败：${message(cleanupError)}`) }
    }
    throw error
  }
}
