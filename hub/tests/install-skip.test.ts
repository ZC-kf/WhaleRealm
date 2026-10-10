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
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { addSkipEntry, readActiveSkipPaths, readSkipEntries } from '../electron/install-skip'

describe('install-skip', () => {
  it('keeps permanent and unexpired entries, drops expired ones', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'skip-'))
    const file = path.join(dir, 'skipped.json')
    try {
      await addSkipEntry(file, { path: 'C:/a', permanent: true, until: null })
      await addSkipEntry(file, { path: 'C:/b', permanent: false, until: Date.now() + 60_000 })
      await addSkipEntry(file, { path: 'C:/c', permanent: false, until: Date.now() - 1 })
      const active = readActiveSkipPaths(file)
      expect(active).toEqual(expect.arrayContaining(['C:/a', 'C:/b']))
      expect(active).not.toContain('C:/c')
      expect(readSkipEntries(file).length).toBe(3)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('overwrites an existing entry with the same path', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'skip-'))
    const file = path.join(dir, 'skipped.json')
    try {
      await addSkipEntry(file, { path: 'C:/same', permanent: false, until: Date.now() - 1 })
      await addSkipEntry(file, { path: 'C:/same', permanent: true, until: null })
      expect(readSkipEntries(file).length).toBe(1)
      expect(readActiveSkipPaths(file)).toContain('C:/same')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
