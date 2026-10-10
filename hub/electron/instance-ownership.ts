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
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { InstanceLayout } from './runtime-adapter'
import type { DesktopInstanceRecord } from './instance-types'

export const pathKey = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)
export function containsPath(root: string, target: string): boolean {
  const rel = path.relative(pathKey(root), pathKey(target))
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`))
}
export async function assertRealDirectory(dir: string): Promise<void> {
  const info = await lstat(dir)
  if (!info.isDirectory() || info.isSymbolicLink() || pathKey(await realpath(dir)) !== pathKey(dir)) throw new Error(`Directory link or escape rejected: ${dir}`)
}
/**
 * Verify a single owned file.
 *
 * `allowHardLinks` relaxes the exclusive-ownership rule for files *inside* an
 * owned tree. A hard link is NOT a recursive-purge escape: removing one
 * directory entry never destroys data another link still references, so a purge
 * cannot reach outside the owned root through a hard link — only symlinks and
 * junctions can, and those stay rejected here (isSymbolicLink + realpath) and in
 * assertOwnedTree. The managed runtime legitimately hard-links its native module
 * cache (node-addon-native-custom-loader) into the instance cache, so the tree
 * walk must accept those shared inodes. The single-file ownership proof
 * (instance.json) keeps the strict exclusive rule.
 */
export async function assertRegularFile(file: string, options: { allowHardLinks?: boolean } = {}): Promise<void> {
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink() || (!options.allowHardLinks && info.nlink !== 1) || pathKey(await realpath(file)) !== pathKey(file)) throw new Error(`File link or escape rejected: ${file}`)
}
export async function assertOwnedTree(dir: string): Promise<void> {
  await assertRealDirectory(dir)
  for (const name of await readdir(dir)) {
    const file = path.join(dir, name); const info = await lstat(file)
    if (info.isSymbolicLink()) throw new Error(`Directory link rejected: ${file}`)
    if (info.isDirectory()) await assertOwnedTree(file)
    else await assertRegularFile(file, { allowHardLinks: true })
  }
}
const fields = ['root', 'runtimeRoot', 'dshHome', 'electronUserData', 'workspace', 'logs', 'cache'] as const
const identity = (info: { dev: number; ino: number }) => `${info.dev}:${info.ino}`
interface OwnershipProof {
  version: 1; instanceId: string; adapterId: string; layoutVersion: 2
  layout: InstanceLayout; rootIdentity: string; runtimeIdentity: string
}
async function validateLayout(layout: InstanceLayout, physicalRoot = layout.root): Promise<void> {
  if (!path.isAbsolute(layout.root) || path.dirname(layout.root) === layout.root) throw new Error('Invalid ownership root')
  for (const field of fields) {
    const value = layout[field]
    if (typeof value !== 'string' || !path.isAbsolute(value) || !containsPath(layout.root, value) || (field !== 'root' && pathKey(value) === pathKey(layout.root))) throw new Error(`Invalid ownership layout: ${field}`)
    await assertRealDirectory(path.join(physicalRoot, path.relative(layout.root, value)))
  }
  const independent = fields.filter(field => field !== 'root')
  for (const [i, field] of independent.entries()) for (const other of independent.slice(i + 1)) {
    if (containsPath(layout[field], layout[other]) || containsPath(layout[other], layout[field])) throw new Error('Overlapping ownership layout')
  }
}
/** Written in staging before publication; rename preserves directory identities. */
export async function writeInstanceOwnership(staging: InstanceLayout, finalLayout: InstanceLayout, instanceId: string, adapterId: string): Promise<void> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(instanceId) || !adapterId) throw new Error('Invalid instance ownership identity')
  await validateLayout(finalLayout, staging.root)
  for (const field of fields) if (pathKey(staging[field]) !== pathKey(path.join(staging.root, path.relative(finalLayout.root, finalLayout[field])))) throw new Error('Staging ownership layout mismatch')
  const proof: OwnershipProof = { version: 1, instanceId, adapterId, layoutVersion: 2, layout: finalLayout,
    rootIdentity: identity(await lstat(staging.root)), runtimeIdentity: identity(await lstat(staging.runtimeRoot)) }
  await writeFile(path.join(staging.root, 'instance.json'), `${JSON.stringify(proof, null, 2)}\n`, { flag: 'wx' })
}
async function canonicalExisting(value: string): Promise<string> {
  try { return await realpath(value) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = path.dirname(value); if (parent === value) throw error
    return path.join(await canonicalExisting(parent), path.basename(value))
  }
}
/** Registry paths alone never authorize reclamation of legacy/shared installations. */
export async function verifyInstanceOwnership(record: DesktopInstanceRecord, records: DesktopInstanceRecord[]): Promise<void> {
  try {
    const file = path.join(record.root, 'instance.json'); await assertRegularFile(file)
    const proof = JSON.parse(await readFile(file, 'utf8')) as OwnershipProof
    if (proof.version !== 1 || proof.layoutVersion !== 2 || record.layoutVersion !== 2 || proof.instanceId !== record.id || !proof.adapterId || proof.adapterId !== record.adapterId || !proof.layout) throw new Error('Identity or adapter mismatch')
    await validateLayout(proof.layout)
    for (const field of fields) if (typeof record[field] !== 'string' || pathKey(proof.layout[field]) !== pathKey(record[field]!)) throw new Error(`Recorded ownership path mismatch: ${field}`)
    for (const value of [record.desktopProfile, record.skills]) if (value && !containsPath(record.root, value)) throw new Error('Recorded profile or skills escapes owned root')
    if (proof.rootIdentity !== identity(await lstat(record.root)) || proof.runtimeIdentity !== identity(await lstat(record.runtimeRoot!))) throw new Error('Owned directory identity changed')
    for (const other of records.filter(value => value.id !== record.id)) {
      for (const field of ['root', 'runtimeRoot', 'dshHome', 'electronUserData', 'desktopProfile', 'workspace', 'logs', 'cache', 'skills', 'skillsSource'] as const) {
        const value = other[field]; if (!value) continue
        const canonical = await canonicalExisting(path.resolve(value))
        if (containsPath(record.root, canonical) || containsPath(canonical, record.root)) throw new Error(`Another instance uses this layout: ${other.id}`)
      }
    }
    // A junction anywhere in a runtime or data subtree invalidates recursive purge.
    await assertOwnedTree(record.root)
  } catch (error) { throw new Error(`Instance ownership cannot be verified; files preserved: ${String(error)}`) }
}
