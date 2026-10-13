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
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { APP_RESOURCES_TOKEN, expandAppResourcesUrl } from '../electron/desktop-assets'

/*
 * `<appResources>` placeholder support.
 *
 * A certified catalog entry may ship its archive inside the installer (extraResources →
 * <resources>/runtimes/…zip), so the url is stored machine-independently as
 * `<appResources>/runtimes/<name>.zip` and expanded against `process.resourcesPath` at load
 * time. Non-Electron runs (vitest) have no resourcesPath: the entry must be dropped
 * (fail-closed), never crash.
 */

const ROOT = path.join(os.tmpdir(), 'wr-app-resources')

describe('expandAppResourcesUrl', () => {
  it('leaves a url without the token unchanged', () => {
    expect(expandAppResourcesUrl('https://example.com/x.zip', ROOT)).toBe('https://example.com/x.zip')
    expect(expandAppResourcesUrl('file:///abs/x.zip', null)).toBe('file:///abs/x.zip')
  })

  it('expands the token against an absolute resources root', () => {
    const expected = pathToFileURL(path.join(ROOT, 'runtimes', 'community-desktop-0.21.0-win-x64.zip')).href
    expect(expandAppResourcesUrl(`${APP_RESOURCES_TOKEN}/runtimes/community-desktop-0.21.0-win-x64.zip`, ROOT)).toBe(expected)
    // Leading separators are normalized either way.
    expect(expandAppResourcesUrl(`${APP_RESOURCES_TOKEN}runtimes\\a.zip`, ROOT)).toBe(pathToFileURL(path.join(ROOT, 'runtimes', 'a.zip')).href)
  })

  it('returns null (fail-closed) when the token cannot be resolved', () => {
    expect(expandAppResourcesUrl(`${APP_RESOURCES_TOKEN}/runtimes/a.zip`, null)).toBeNull()
    expect(expandAppResourcesUrl(`${APP_RESOURCES_TOKEN}/runtimes/a.zip`, 'relative/root')).toBeNull()
    expect(expandAppResourcesUrl(`${APP_RESOURCES_TOKEN}/`, ROOT)).toBeNull()
  })
})

describe('certifiedDesktopAssets honors <appResources>', () => {
  const manifestPath = fileURLToPath(new URL('../../manifests/isolated-runtimes.json', import.meta.url))
  const prior = Object.getOwnPropertyDescriptor(process, 'resourcesPath')

  afterEach(() => {
    vi.doUnmock(manifestPath)
    vi.resetModules()
    if (prior) Object.defineProperty(process, 'resourcesPath', prior)
    else delete (process as { resourcesPath?: string }).resourcesPath
  })

  function mockCertifiedManifest(): void {
    vi.resetModules()
    vi.doMock(manifestPath, () => ({
      default: {
        schemaVersion: 1,
        runtimes: [{
          schemaVersion: 1, kind: 'community-desktop', version: '0.21.0', adapterId: 'community-desktop-v1',
          sourceRef: 'aff39a991fda3558c5459b54fb3fa1c6984d3227', patchSha256: 'a'.repeat(64), executable: 'deepseek-harness-desktop.exe',
          assetId: 'community-desktop:0.21.0:aaaaaaaaaaaa',
          integrity: 'sha512-v+ErlGoqzMtejGVA2Y3GhEWNzsa1EeAnW2QpG2hwukNN0i6veAW7tqA8R4mTDXTX9Zfv/wmnwSdHxIT37hjVDA==',
          format: 'zip', url: `${APP_RESOURCES_TOKEN}/runtimes/community-desktop-0.21.0-win-x64.zip`,
          receiptSha256: 'b'.repeat(64), status: 'certified',
          acceptance: { evidenceSha256: 'd'.repeat(64), acceptedAt: '2026-10-08T05:21:37.955Z', checks: Object.fromEntries(['twoInstances', 'privateData', 'privateWebviews', 'distinctPorts', 'independentLocks', 'ownedProcessTree', 'stopIsolation', 'noGlobalRegistration', 'protectedPathsUnchanged', 'completeResources', 'coldLaunchWithoutBuildTools'].map(key => [key, true])) },
        }] as unknown[],
      },
    }))
  }

  it('expands the entry url when a resources root is present', async () => {
    Object.defineProperty(process, 'resourcesPath', { value: ROOT, configurable: true, writable: true })
    mockCertifiedManifest()
    const mod = await import('../electron/desktop-assets')
    const assets = mod.certifiedDesktopAssets('community-desktop')
    expect(assets).toHaveLength(1)
    expect(assets[0].url).toBe(pathToFileURL(path.join(ROOT, 'runtimes', 'community-desktop-0.21.0-win-x64.zip')).href)
  })

  it('drops the entry (fail-closed) when no resources root is available', async () => {
    delete (process as { resourcesPath?: string }).resourcesPath
    mockCertifiedManifest()
    const mod = await import('../electron/desktop-assets')
    expect(mod.certifiedDesktopAssets('community-desktop')).toEqual([])
  })
})
