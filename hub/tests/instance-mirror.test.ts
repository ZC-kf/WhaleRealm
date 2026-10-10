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
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { diffMirror, snapshotMirror, restoreMirror, restoreMirrorTo } from '../electron/instance-mirror'
const fixtures: string[] = []
afterEach(async () => { for (const root of fixtures.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-task6-mirror-')); fixtures.push(root)
  const dirs = [path.join(root, 'home', 'state'), path.join(root, 'workspace', 'state')]
  for (const dir of dirs) await mkdir(dir, { recursive: true })
  return { root, dirs }
}
it('restores same-name files from distinct roots and detects same-size byte changes', async () => {
  const { root, dirs } = await fixture()
  await writeFile(path.join(dirs[0], 'config.json'), 'HOME'); await writeFile(path.join(dirs[1], 'config.json'), 'WORK')
  await snapshotMirror(root, dirs)
  await writeFile(path.join(dirs[0], 'config.json'), 'FAIL'); await rm(path.join(dirs[1], 'config.json'))
  await writeFile(path.join(dirs[0], 'extra'), 'extra')
  const diff = await diffMirror(root, dirs)
  expect(diff.changed).toHaveLength(1); expect(diff.removed).toHaveLength(1)
  await restoreMirror(root, dirs)
  expect(await readFile(path.join(dirs[0], 'config.json'), 'utf8')).toBe('HOME')
  expect(await readFile(path.join(dirs[1], 'config.json'), 'utf8')).toBe('WORK')
  expect(await readdir(dirs[0])).toEqual(['config.json'])
})
it('keeps the previous baseline on failed copy or archive', async () => {
  const { root, dirs } = await fixture(); await writeFile(path.join(dirs[0], 'value'), 'baseline'); await snapshotMirror(root, dirs)
  const previous = await readFile(path.join(root, 'mirror', 'mirror.json'))
  await rm(dirs[1], { recursive: true }); await expect(snapshotMirror(root, dirs)).rejects.toThrow()
  expect(await readFile(path.join(root, 'mirror', 'mirror.json'))).toEqual(previous)
  await mkdir(dirs[1]); await rm(path.join(root, 'mirror-history'), { recursive: true }); await writeFile(path.join(root, 'mirror-history'), 'blocks archive')
  await expect(snapshotMirror(root, dirs)).rejects.toThrow()
  expect(await readFile(path.join(root, 'mirror', 'mirror.json'))).toEqual(previous)
})
it('preserves ambiguous old snapshots and requires explicit rebaseline before restore', async () => {
  const { root, dirs } = await fixture(); await mkdir(path.join(root, 'mirror'))
  const old = JSON.stringify({ files: { 'config.json': { size: 1, mtimeMs: 1 } }, createdAt: '2026-01-01T00:00:00Z' })
  await writeFile(path.join(root, 'mirror', 'mirror.json'), old)
  expect(await diffMirror(root, dirs)).toMatchObject({ requiresRebaseline: true })
  await expect(restoreMirror(root, dirs)).rejects.toThrow(/baseline|基线/)
  await snapshotMirror(root, dirs)
  const history = await readdir(path.join(root, 'mirror-history'))
  expect(await readFile(path.join(root, 'mirror-history', history[0], 'mirror.json'), 'utf8')).toBe(old)
})
it('rejects history traversal, manifest traversal and junction escapes before mutation', async () => {
  const { root, dirs } = await fixture(); await writeFile(path.join(dirs[0], 'safe'), 'safe'); await snapshotMirror(root, dirs)
  await expect(restoreMirrorTo(root, dirs, '../mirror')).rejects.toThrow()
  const file = path.join(root, 'mirror', 'mirror.json'); const manifest = JSON.parse(await readFile(file, 'utf8'))
  // A malformed member must be rejected before any restore writes.
  if (manifest.roots) manifest.roots[0].files['../escape'] = { size: 1, sha256: 'a'.repeat(64) }
  else manifest.files['../escape'] = { size: 1, mtimeMs: 1 }
  await writeFile(file, JSON.stringify(manifest)); await expect(restoreMirror(root, dirs)).rejects.toThrow()
  await symlink(dirs[1], path.join(dirs[0], 'linked'), 'junction')
  await expect(snapshotMirror(root, dirs)).rejects.toThrow(/link|链接/)
  expect(await readFile(path.join(dirs[0], 'safe'), 'utf8')).toBe('safe')
})
