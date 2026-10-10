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

import { describe, expect, it, vi } from 'vitest'
import { listCatalogVersions } from '../electron/instance-catalog'
export const integrity = `sha512-${Buffer.alloc(64, 7).toString('base64')}`
export const metadata = { name: '@deepseek-ai/dsh', versions: { '0.2.0-rc.2': { name: '@deepseek-ai/dsh', version: '0.2.0-rc.2', dist: { tarball: 'https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.0-rc.2.tgz', integrity } } }, 'dist-tags': { latest: '0.2.0-rc.2' } }
describe('trusted runtime assets', () => {
 it('lists npm published versions', async () => {
 const result = await listCatalogVersions('official-web', async () => ({ ok: true, status: 200, json: async () => metadata }))
 expect(result.versions.map(v => v.version)).toEqual(['0.2.0-rc.2'])
 })
 it('blocks community installers without network', async () => {
  const fetch = vi.fn()
  const result = await listCatalogVersions('community-desktop', fetch)
  // The community desktop may be certified in the shipped catalog (then it lists its version
  // without any network). What must never happen: a network fetch, or a candidate leaking.
  expect(fetch).not.toHaveBeenCalled()
  if (!result.ok) expect(result.error).toContain('免安装')
  else expect(result.versions.length).toBeGreaterThan(0)
 })
})

import { createHash } from 'node:crypto'
import { assetFromMetadata, resolveRuntimeAsset, verifyRuntimeIntegrity } from '../electron/runtime-assets'
describe('runtime resolution', () => {
 it('resolves trusted provenance for an exact release', async () => {
 const fetch = vi.fn(async (_url: string) => ({ ok: true, status: 200, json: async () => metadata }))
 const asset = await resolveRuntimeAsset('official-web', '0.2.0-rc.2', fetch)
 expect(fetch).toHaveBeenCalledWith('https://registry.npmjs.org/@deepseek-ai%2fdsh')
 expect(asset).toMatchObject({ kind: 'official-web', version: '0.2.0-rc.2', format: 'npm', adapterId: 'official-web', integrity, url: metadata.versions['0.2.0-rc.2'].dist.tarball })
 })
 it.each(['latest', '^0.2.0-rc.2', '9.9.9', '../setup.exe'])('rejects unapproved version %s', version => {
 expect(() => assetFromMetadata(version, metadata)).toThrow()
 })
 it.each([{ name: 'evil' }, { version: '2.0.0' }, { dist: { tarball: 'https://evil/setup.exe', integrity } }, { dist: { tarball: metadata.versions['0.2.0-rc.2'].dist.tarball } }])('rejects tampered metadata %j', replacement => {
 expect(() => assetFromMetadata('0.2.0-rc.2', { ...metadata, versions: { '0.2.0-rc.2': { ...metadata.versions['0.2.0-rc.2'], ...replacement } } })).toThrow()
 })
 it('verifies real bytes and rejects a corrupt archive', () => {
 const bytes = Buffer.from('trusted archive')
 const asset = { ...assetFromMetadata('0.2.0-rc.2', metadata), integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }
 expect(() => verifyRuntimeIntegrity(bytes, asset)).not.toThrow()
 expect(() => verifyRuntimeIntegrity(Buffer.from('corrupt'), asset)).toThrow('完整性')
 })
})
