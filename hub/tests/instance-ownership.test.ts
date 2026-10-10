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
import { lstat, link, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { assertOwnedTree, assertRegularFile } from '../electron/instance-ownership'

/*
 * Regression guard for the production purge hard-link defect.
 *
 * The managed runtime's native module cache (node-addon-native-custom-loader)
 * creates hard links at run time whose partner entry lives OUTSIDE the instance
 * root. `assertOwnedTree` previously required `nlink === 1` for every file,
 * so `instances:delete` (purge) rejected the whole instance with
 * "File link or escape rejected" and preserved the files.
 *
 * A hard link is not a recursive-purge escape: removing one directory entry
 * never destroys data another link still references. Only symlinks/junctions
 * can make a purge reach outside the root, and those remain rejected.
 */

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'wr-ownership-'))
}

describe('assertOwnedTree hard-link handling', () => {
  it('accepts a hard-linked cache file whose partner lives outside the owned root', async () => {
    const base = await tempDir()
    try {
      const root = path.join(base, 'instance')
      const external = path.join(base, 'external')
      await mkdir(root)
      await mkdir(external)
      const source = path.join(external, 'win32-x64-msvc-napi-v9.node')
      await writeFile(source, 'native bytes')
      const cached = path.join(root, 'cached.node')
      await link(source, cached)
      expect((await lstat(cached)).nlink).toBe(2)
      // Must not throw: the shared inode is not a purge escape.
      await expect(assertOwnedTree(root)).resolves.toBeUndefined()
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('accepts hard links that stay inside the owned root', async () => {
    const base = await tempDir()
    try {
      const root = path.join(base, 'instance')
      await mkdir(root)
      const first = path.join(root, 'a.node')
      await writeFile(first, 'shared bytes')
      await link(first, path.join(root, 'b.node'))
      await expect(assertOwnedTree(root)).resolves.toBeUndefined()
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('still rejects a symbolic link file inside the owned root', async () => {
    const base = await tempDir()
    try {
      const root = path.join(base, 'instance')
      const external = path.join(base, 'external')
      await mkdir(root)
      await mkdir(external)
      await writeFile(path.join(external, 'outside.node'), 'x')
      const linked = path.join(root, 'linked.node')
      try {
        await symlink(path.join(external, 'outside.node'), linked, 'file')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return // no symlink privilege in this environment
        throw error
      }
      // Some CI sandboxes inject a shim that degrades symlink() to a plain file;
      // in that case there is no real link to assert against.
      if (!(await lstat(linked)).isSymbolicLink()) return
      await expect(assertOwnedTree(root)).rejects.toThrow(/link rejected/)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('still rejects a linked directory inside the owned root', async () => {
    const base = await tempDir()
    try {
      const root = path.join(base, 'instance')
      const external = path.join(base, 'external')
      await mkdir(root)
      await mkdir(external)
      const linked = path.join(root, 'junction')
      try {
        await symlink(external, linked, 'junction')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return
        throw error
      }
      if (!(await lstat(linked)).isSymbolicLink()) return // shim degraded the junction
      await expect(assertOwnedTree(root)).rejects.toThrow(/link rejected/)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})

describe('assertRegularFile exclusivity', () => {
  it('keeps the strict exclusive rule by default and relaxes only when asked', async () => {
    const base = await tempDir()
    try {
      const external = path.join(base, 'external')
      await mkdir(external)
      const source = path.join(external, 'proof.json')
      await writeFile(source, '{}')
      const shared = path.join(external, 'shared.json')
      await link(source, shared)
      expect((await lstat(shared)).nlink).toBe(2)
      await expect(assertRegularFile(shared)).rejects.toThrow(/link or escape rejected/)
      await expect(assertRegularFile(shared, { allowHardLinks: true })).resolves.toBeUndefined()
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})
