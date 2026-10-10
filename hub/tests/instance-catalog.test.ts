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
import { listCatalogVersions, pickCommunityWindowsAsset, versionOfTag, type CatalogFetch } from '../electron/instance-catalog'
import { resolveDesktopAssets } from '../electron/desktop-assets'

function mockFetch(body: unknown): CatalogFetch {
  return async () => ({ ok: true, status: 200, json: async () => body })
}

const COMMUNITY_RELEASES = [
  {
    tag_name: 'v0.21.0', published_at: '2026-10-02T14:56:18Z', prerelease: false,
    assets: [
      { name: 'Deepseek.Harness.Desktop_0.21.0_x64-setup.exe', browser_download_url: 'https://gh/setup.exe' },
      { name: 'Deepseek.Harness.Desktop_Bundle_0.21.0.exe', browser_download_url: 'https://gh/bundle.exe' },
      { name: 'Deepseek.Harness.Desktop_0.21.0_amd64.deb', browser_download_url: 'https://gh/x.deb' },
    ],
    zipball_url: 'https://gh/zip',
  },
  {
    tag_name: 'v0.20.1-beta.2', published_at: '2026-10-01T16:38:04Z', prerelease: true,
    assets: [{ name: 'Deepseek.Harness.Desktop_0.20.1-beta.2_x64.dmg', browser_download_url: 'https://gh/x.dmg' }],
    zipball_url: 'https://gh/zip',
  },
]

const OFFICIAL_RELEASES = [
  { tag_name: 'dsh-v0.2.0-rc.2', published_at: '2026-09-29T09:42:36Z', prerelease: true, assets: [], zipball_url: 'https://gh/zipball-020' },
  { tag_name: 'dsh-v0.1.7-alpha.2', published_at: '2026-09-22T15:49:49Z', prerelease: true, assets: [], zipball_url: 'https://gh/zipball-017' },
]

describe('新建实例版本目录（instance-catalog.ts）', () => {
  it('versionOfTag 规整版本号', () => {
    expect(versionOfTag('dsh-v0.2.0-rc.2')).toBe('0.2.0-rc.2')
    expect(versionOfTag('v0.21.0')).toBe('0.21.0')
  })

  it('pickCommunityWindowsAsset：优先 Bundle 离线包，回退 setup，无匹配返回 null', () => {
    expect(pickCommunityWindowsAsset(COMMUNITY_RELEASES[0] as never)).toBe('https://gh/bundle.exe')
    expect(pickCommunityWindowsAsset(COMMUNITY_RELEASES[1] as never)).toBe(null)
  })

  it('社区桌面版：普通 Windows 安装包不可用于创建', async () => {
    const result = await listCatalogVersions('community-desktop', mockFetch(COMMUNITY_RELEASES))
    const certified = resolveDesktopAssets('community-desktop')
    if (certified.length) {
      // 已收录隔离认证免安装包时，目录只暴露认证产物（file: 免安装包），
      // 绝不含 GitHub 普通安装包（setup/bundle/.deb）地址。
      expect(result.ok).toBe(true)
      expect(result.versions.map(v => v.downloadUrl)).toEqual(certified.map(asset => asset.url))
      expect(result.versions.every(v => v.downloadUrl !== null && /^file:/.test(v.downloadUrl))).toBe(true)
    } else {
      expect(result.ok).toBe(false)
      expect(result.versions).toEqual([])
      expect(result.error).toContain('免安装')
    }
  })

  it('官方网页版：下载地址为 npm 包 tarball，且只列通过完整性核验的已验证版本', async () => {
    const result = await listCatalogVersions('official-web', mockFetch({ name: '@deepseek-ai/dsh', versions: Object.fromEntries(OFFICIAL_RELEASES.map(r => { const v = versionOfTag(r.tag_name); return [v, { name: '@deepseek-ai/dsh', version: v, dist: { tarball: `https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-${v}.tgz`, integrity: `sha512-${Buffer.alloc(64).toString('base64')}` } }] })) }))
    expect(result.ok).toBe(true)
    // fail-closed：目录里有两个版本，但只有完成核验的 VERIFIED_WEB_VERSION 可创建。
    expect(result.versions.map(v => v.version)).toEqual(['0.2.0-rc.2'])
    expect(result.versions[0].downloadUrl).toBe('https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.0-rc.2.tgz')
  })

  it('官方桌面版：缺少认证免安装包时明确不支持', async () => {
    const result = await listCatalogVersions('official-desktop', mockFetch({ name: '@deepseek-ai/dsh', versions: Object.fromEntries(OFFICIAL_RELEASES.map(r => { const v = versionOfTag(r.tag_name); return [v, { name: '@deepseek-ai/dsh', version: v, dist: { tarball: `https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-${v}.tgz`, integrity: `sha512-${Buffer.alloc(64).toString('base64')}` } }] })) }))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('免安装')
    expect(result.versions).toEqual([])
  })

  it('网络失败 → ok:false 且带错误信息（fail-closed）', async () => {
    // 网络目录仅服务于官方网页版；桌面版由认证目录解析，不触网。
    const failing: CatalogFetch = async () => ({ ok: false, status: 503, json: async () => ({}) })
    const result = await listCatalogVersions('official-web', failing)
    expect(result.ok).toBe(false)
    expect(result.versions).toHaveLength(0)
    expect(result.error).toBeTruthy()
  })
})
