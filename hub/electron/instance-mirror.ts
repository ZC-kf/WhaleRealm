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
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rename, rm, lstat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { assertRealDirectory, assertRegularFile, pathKey, containsPath } from './instance-ownership'

const MANIFEST_FILE = 'mirror.json'
const HISTORY_LIMIT = 5
const EXCLUDE_DIRS = new Set(['node_modules', '.git', '.pnpm', 'Cache', 'GPUCache', 'Code Cache', 'DawnCache', 'GrShaderCache'])
interface ManifestFile { size: number; sha256: string }
interface ManifestRoot { namespace: string; source: string; files: Record<string, ManifestFile> }
interface Manifest { version: 2; createdAt: string; roots: ManifestRoot[] }
interface LegacyManifest { createdAt: string; files: Record<string, unknown>; version?: never }
type Snapshot = Manifest | LegacyManifest
export interface MirrorDiff { snapshotAt: string | null; changed: string[]; added: string[]; removed: string[]; requiresRebaseline?: boolean }
export interface MirrorHistoryEntry { timestamp: string; snapshotAt: string; restorable?: boolean }
const mirrorRoot = (root: string) => path.join(root, 'mirror')
const historyRoot = (root: string) => path.join(root, 'mirror-history')
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
function relativeMember(value: string): boolean {
  return !!value && !value.includes('\\') && !value.includes(':') && !value.includes('\0')
    && value.split('/').every(part => !!part && part !== '.' && part !== '..') && !path.isAbsolute(value)
}
function historyMember(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value) }
async function exists(file: string): Promise<boolean> { try { await lstat(file); return true } catch (error) { if (missing(error)) return false; throw error } }
async function hashFile(file: string): Promise<ManifestFile> {
  await assertRegularFile(file)
  const hash = createHash('sha256'); let size = 0
  for await (const chunk of createReadStream(file)) { size += chunk.length; hash.update(chunk) }
  return { size, sha256: hash.digest('hex') }
}
async function walk(root: string, excluded = true, base = root, files: Record<string, ManifestFile> = {}): Promise<Record<string, ManifestFile>> {
  await assertRealDirectory(root)
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Snapshot link rejected: ${full}`)
    if (entry.isDirectory()) {
      if (excluded && EXCLUDE_DIRS.has(entry.name)) continue
      await walk(full, excluded, base, files)
    } else {
      const rel = path.relative(base, full).split(path.sep).join('/')
      if (!relativeMember(rel)) throw new Error(`Invalid snapshot member: ${rel}`)
      files[rel] = await hashFile(full)
    }
  }
  return files
}
function validateManifest(value: unknown): Snapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid mirror manifest')
  const manifest = value as Manifest
  if (typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt))) throw new Error('Invalid mirror date')
  if (!('version' in value) && 'files' in value && value.files && typeof value.files === 'object' && !Array.isArray(value.files)) return value as LegacyManifest
  if (manifest.version !== 2 || !Array.isArray(manifest.roots) || !manifest.roots.length) throw new Error('Invalid mirror version or roots')
  const sources = new Set<string>(); const namespaces = new Set<string>()
  for (const root of manifest.roots) {
    if (!root || !/^root-\d+$/.test(root.namespace) || namespaces.has(root.namespace) || typeof root.source !== 'string' || !path.isAbsolute(root.source) || sources.has(pathKey(root.source)) || !root.files || typeof root.files !== 'object' || Array.isArray(root.files)) throw new Error('Invalid mirror root namespace')
    sources.add(pathKey(root.source)); namespaces.add(root.namespace)
    const keys = new Set<string>()
    for (const [rel, info] of Object.entries(root.files)) {
      const key = process.platform === 'win32' ? rel.toLowerCase() : rel
      if (!relativeMember(rel) || keys.has(key) || !info || !Number.isSafeInteger(info.size) || info.size < 0 || !/^[a-f0-9]{64}$/.test(info.sha256)) throw new Error(`Invalid mirror member: ${rel}`)
      keys.add(key)
    }
  }
  return manifest
}
async function readManifestFrom(dir: string): Promise<Snapshot | null> {
  if (!(await exists(dir))) return null
  await assertRealDirectory(dir)
  const file = path.join(dir, MANIFEST_FILE); await assertRegularFile(file)
  return validateManifest(JSON.parse(await readFile(file, 'utf8')))
}
function bindRoots(manifest: Manifest, dirs: string[]): ManifestRoot[] {
  if (manifest.roots.length !== dirs.length || new Set(dirs.map(pathKey)).size !== dirs.length) throw new Error('Mirror source roots changed; explicitly rebuild baseline')
  return dirs.map(dir => {
    const root = manifest.roots.find(root => pathKey(root.source) === pathKey(dir))
    if (!root) throw new Error('Mirror source roots changed; explicitly rebuild baseline')
    return root
  })
}
function compare(files: Record<string, ManifestFile>, current: Record<string, ManifestFile>) {
  const changed = Object.keys(current).filter(rel => files[rel] && (files[rel].size !== current[rel].size || files[rel].sha256 !== current[rel].sha256))
  return { changed, added: Object.keys(current).filter(rel => !files[rel]), removed: Object.keys(files).filter(rel => !current[rel]) }
}
async function diffAgainst(manifest: Snapshot | null, dirs: string[]): Promise<MirrorDiff> {
  if (!manifest) return { snapshotAt: null, changed: [], added: [], removed: [] }
  if (manifest.version !== 2) return { snapshotAt: manifest.createdAt, changed: [], added: [], removed: [], requiresRebaseline: true }
  const result: MirrorDiff = { snapshotAt: manifest.createdAt, changed: [], added: [], removed: [] }
  for (const root of bindRoots(manifest, dirs)) {
    const diff = compare(root.files, await walk(root.source))
    for (const kind of ['changed', 'added', 'removed'] as const) result[kind].push(...diff[kind].map(rel => `${root.namespace}/${rel}`))
  }
  return result
}
async function validatePayload(manifest: Manifest, dir: string): Promise<void> {
  await assertRealDirectory(dir)
  const names = await readdir(dir)
  if (names.length !== manifest.roots.length + 1 || names.some(name => name !== MANIFEST_FILE && !manifest.roots.some(root => root.namespace === name))) throw new Error('Unexpected mirror payload')
  for (const root of manifest.roots) {
    const diff = compare(root.files, await walk(path.join(dir, root.namespace), false))
    if (diff.changed.length || diff.added.length || diff.removed.length) throw new Error('Mirror payload is incomplete or changed')
  }
}
async function restoreFrom(instanceRoot: string, dirs: string[], srcRoot: string): Promise<void> {
  await assertRealDirectory(instanceRoot)
  const manifest = await readManifestFrom(srcRoot)
  if (!manifest) throw new Error('Mirror baseline missing')
  if (manifest.version !== 2) throw new Error('Legacy mirror ownership is ambiguous; explicitly rebuild baseline')
  const roots = bindRoots(manifest, dirs)
  // Preflight every payload and destination before any destructive write.
  await validatePayload(manifest, srcRoot)
  const current = await Promise.all(roots.map(root => walk(root.source)))
  for (const [index, root] of roots.entries()) {
    const diff = compare(root.files, current[index])
    for (const rel of diff.added) {
      const target = path.join(root.source, rel); await assertRealDirectory(path.dirname(target)); await assertRegularFile(target)
      await rm(target)
    }
    for (const rel of [...diff.changed, ...diff.removed]) {
      const target = path.join(root.source, rel)
      await mkdir(path.dirname(target), { recursive: true }); await assertRealDirectory(path.dirname(target))
      if (await exists(target)) await assertRegularFile(target)
      await assertRegularFile(path.join(srcRoot, root.namespace, rel))
      await copyFile(path.join(srcRoot, root.namespace, rel), target)
    }
  }
}
async function pruneHistory(dir: string): Promise<void> {
  const generations: { name: string; manifest: Manifest }[] = []
  for (const name of await readdir(dir)) {
    // Legacy/invalid evidence is retained; never guess its ownership or contents.
    if (!historyMember(name)) continue
    try { const manifest = await readManifestFrom(path.join(dir, name)); if (manifest?.version === 2) generations.push({ name, manifest }) } catch { continue }
  }
  generations.sort((a, b) => a.manifest.createdAt.localeCompare(b.manifest.createdAt))
  for (const generation of generations.slice(0, Math.max(0, generations.length - HISTORY_LIMIT))) {
    const target = path.join(dir, generation.name); await validatePayload(generation.manifest, target)
    await rm(target, { recursive: true })
  }
}
/** Build completely in a private sibling, then archive/publish with rollback. */
export async function snapshotMirror(instanceRoot: string, dirs: string[]): Promise<void> {
  await assertRealDirectory(instanceRoot)
  if (!dirs.length || new Set(dirs.map(pathKey)).size !== dirs.length) throw new Error('Invalid mirror source roots')
  for (const [index, dir] of dirs.entries()) for (const other of dirs.slice(index + 1)) {
    if (containsPath(dir, other) || containsPath(other, dir)) throw new Error('Overlapping mirror source roots')
  }
  for (const dir of dirs) {
    await assertRealDirectory(dir)
    if (containsPath(dir, mirrorRoot(instanceRoot)) || containsPath(mirrorRoot(instanceRoot), dir) || containsPath(dir, historyRoot(instanceRoot)) || containsPath(historyRoot(instanceRoot), dir)) throw new Error('Mirror source overlaps snapshot storage')
  }
  const root = mirrorRoot(instanceRoot); const stage = path.join(instanceRoot, `mirror.tmp-${randomUUID()}`)
  await mkdir(stage)
  let archived: string | undefined
  try {
    const manifest: Manifest = { version: 2, createdAt: new Date().toISOString(), roots: [] }
    for (const [index, dir] of dirs.entries()) {
      const namespace = `root-${index}`; const files = await walk(dir); const destination = path.join(stage, namespace)
      await mkdir(destination)
      for (const rel of Object.keys(files)) {
        await mkdir(path.dirname(path.join(destination, rel)), { recursive: true })
        await assertRegularFile(path.join(dir, rel))
        await copyFile(path.join(dir, rel), path.join(destination, rel))
      }
      manifest.roots.push({ namespace, source: path.resolve(dir), files })
    }
    await writeFile(path.join(stage, MANIFEST_FILE), `${JSON.stringify(manifest)}\n`, { flag: 'wx' })
    await validatePayload(manifest, stage)
    const live = await diffAgainst(manifest, dirs)
    if (live.changed.length || live.added.length || live.removed.length) throw new Error('Snapshot source changed during copy')
    await mkdir(historyRoot(instanceRoot), { recursive: true }); await assertRealDirectory(historyRoot(instanceRoot))
    if (await exists(root)) {
      await assertRealDirectory(root)
      // Preserve old or damaged snapshots without interpreting their root ownership.
      archived = path.join(historyRoot(instanceRoot), `snapshot-${Date.now()}-${randomUUID()}`)
      await rename(root, archived)
    }
    try { await rename(stage, root) } catch (error) {
      if (archived) await rename(archived, root)
      throw error
    }
    await pruneHistory(historyRoot(instanceRoot))
  } finally {
    if (await exists(stage)) { await assertRealDirectory(stage); await rm(stage, { recursive: true }) }
  }
}
export async function diffMirror(instanceRoot: string, dirs: string[]): Promise<MirrorDiff> {
  await assertRealDirectory(instanceRoot)
  return diffAgainst(await readManifestFrom(mirrorRoot(instanceRoot)), dirs)
}
export async function restoreMirror(instanceRoot: string, dirs: string[]): Promise<void> { await restoreFrom(instanceRoot, dirs, mirrorRoot(instanceRoot)) }
export async function listMirrorHistory(instanceRoot: string): Promise<MirrorHistoryEntry[]> {
  await assertRealDirectory(instanceRoot)
  const dir = historyRoot(instanceRoot)
  if (!(await exists(dir))) return []
  await assertRealDirectory(dir)
  const result: MirrorHistoryEntry[] = []
  for (const name of await readdir(dir)) {
    if (!historyMember(name)) throw new Error('Invalid history member')
    const manifest = await readManifestFrom(path.join(dir, name))
    if (manifest) result.push({ timestamp: name, snapshotAt: manifest.createdAt, restorable: manifest.version === 2 })
  }
  return result.sort((a, b) => b.snapshotAt.localeCompare(a.snapshotAt))
}
export async function restoreMirrorTo(instanceRoot: string, dirs: string[], timestamp: string): Promise<void> {
  if (typeof timestamp !== 'string' || !historyMember(timestamp)) throw new Error('Invalid history member')
  await assertRealDirectory(historyRoot(instanceRoot))
  await restoreFrom(instanceRoot, dirs, path.join(historyRoot(instanceRoot), timestamp))
}
