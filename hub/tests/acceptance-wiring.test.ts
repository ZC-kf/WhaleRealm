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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRuntimeAsset } from '../electron/runtime-assets'
import { listCatalogVersions } from '../electron/instance-catalog'

/*
 * The create pipeline resolves a Desktop asset through resolveRuntimeAsset, and the
 * creation UI lists versions through listCatalogVersions. Both must see the same
 * acceptance-aware view as the adapter, otherwise the local harness could list a
 * candidate but not create it (or vice versa).
 */

const OFFICIAL_SOURCE = 'c36a83ff6bb95e3f82cf79f9be7c724270a8aa61'
const INTEGRITY = 'sha512-v+ErlGoqzMtejGVA2Y3GhEWNzsa1EeAnW2QpG2hwukNN0i6veAW7tqA8R4mTDXTX9Zfv/wmnwSdHxIT37hjVDA=='

const roots: string[] = []
afterEach(() => {
  delete process.env.WR_ACCEPTANCE_CANDIDATE
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function activateCandidate(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wr-wiring-'))
  roots.push(dir)
  mkdirSync(dir, { recursive: true })
  const zip = path.join(dir, 'official-desktop-0.1.7-alpha.1-win-x64.zip')
  writeFileSync(zip, 'PK\u0003\u0004dummy-archive')
  const patchSha256 = 'a'.repeat(64)
  writeFileSync(path.join(dir, 'pending-manifest.json'), JSON.stringify({
    schemaVersion: 1, kind: 'official-desktop', version: '0.1.7-alpha.1', adapterId: 'official-desktop-v1',
    sourceRef: OFFICIAL_SOURCE, patchSha256, executable: 'WhaleRealm Official.exe',
    assetId: 'official-desktop:0.1.7-alpha.1:aaaaaaaaaaaa', integrity: INTEGRITY, format: 'zip',
    url: pathToFileURL(zip).href, receiptSha256: 'b'.repeat(64), status: 'pending-acceptance',
    builtAt: '2026-10-08T05:21:37.955Z',
  }, null, 2))
  writeFileSync(path.join(dir, 'build-owner.json'), JSON.stringify({ kind: 'official-desktop', source: dir, sourceRef: OFFICIAL_SOURCE, patchSha256 }))
  process.env.WR_ACCEPTANCE_CANDIDATE = path.join(dir, 'pending-manifest.json')
  return zip
}

describe('runtime-assets routes Desktop kinds through the acceptance-aware resolver', () => {
  it('stays fail-closed when the channel is inactive (no candidate leak)', async () => {
    const fetch = vi.fn()
    // official-desktop has no certified asset → fail-closed regardless of catalog state.
    await expect(resolveRuntimeAsset('official-desktop', '0.1.7-alpha.1', fetch)).rejects.toThrow(/尚无经隔离认证/)
    // community-desktop may be certified in the shipped catalog; if so it is served *as certified*
    // (never as a candidate) — and if the catalog is empty it stays fail-closed.
    const community = await resolveRuntimeAsset('community-desktop', '0.21.0', fetch).catch(error => error as Error)
    if (!(community instanceof Error)) expect(community).toMatchObject({ kind: 'community-desktop', status: 'certified' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns the active candidate without any network call', async () => {
    const zip = activateCandidate()
    const fetch = vi.fn()
    const asset = await resolveRuntimeAsset('official-desktop', '0.1.7-alpha.1', fetch)
    expect(asset).toMatchObject({ kind: 'official-desktop', version: '0.1.7-alpha.1', adapterId: 'official-desktop-v1', integrity: INTEGRITY, url: pathToFileURL(zip).href })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('still rejects a version the candidate does not provide', async () => {
    activateCandidate()
    await expect(resolveRuntimeAsset('official-desktop', '9.9.9', vi.fn())).rejects.toThrow(/验收候选不匹配/)
  })
})

describe('listCatalogVersions shows the same acceptance-aware view', () => {
  it('reports unsupported when the channel is inactive', async () => {
    const result = await listCatalogVersions('official-desktop', vi.fn())
    expect(result.ok).toBe(false)
    expect(result.versions).toEqual([])
    expect(result.error).toContain('免安装')
  })

  it('lists the active candidate version', async () => {
    activateCandidate()
    const result = await listCatalogVersions('official-desktop', vi.fn())
    expect(result.ok).toBe(true)
    expect(result.versions.map(v => v.version)).toEqual(['0.1.7-alpha.1'])
  })
})
