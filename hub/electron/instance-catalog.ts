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

import type { CatalogResult, InstanceKind } from '../src/types'
import { assetFromMetadata, DESKTOP_UNSUPPORTED, NPM_METADATA_URL } from './runtime-assets'
import { resolveDesktopAssets } from './desktop-assets'
import { VERIFIED_WEB_VERSION } from './web-runtime'
export type CatalogFetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>
export function versionOfTag(tag: string): string { return tag.replace(/^dsh-v/i, '').replace(/^v/i, '') }
/** Legacy discovery helper; installer URLs are never creation assets. */
export function pickCommunityWindowsAsset(release: { assets?: Array<{ name: string; browser_download_url: string }> }): string | null {
  return release.assets?.find(item => /bundle.*\.exe$/i.test(item.name))?.browser_download_url
    ?? release.assets?.find(item => /x64-setup\.exe$/i.test(item.name))?.browser_download_url ?? null
}
export async function listCatalogVersions(kind: InstanceKind, fetchImpl: CatalogFetch): Promise<CatalogResult> {
  if (kind !== 'official-web') {
    // Acceptance-aware so the local harness sees its pending candidate in the catalog;
    // identical to the certified list in production (no WR_ACCEPTANCE_CANDIDATE).
    const assets = resolveDesktopAssets(kind)
    return assets.length ? { ok: true, source: 'WhaleRealm certified isolated runtimes', versions: assets.map(asset => ({ version: asset.version, downloadUrl: asset.url, publishedAt: asset.acceptance?.acceptedAt ?? '', prerelease: asset.version.includes('-'), latest: false })) } : { ok: false, versions: [], error: DESKTOP_UNSUPPORTED }
  }
  try {
    const res = await fetchImpl(NPM_METADATA_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const metadata = await res.json() as { versions?: Record<string, unknown>; time?: Record<string, string>; 'dist-tags'?: Record<string, string> }
    const versions = Object.keys(metadata.versions ?? {}).flatMap(version => {
      if (version !== VERIFIED_WEB_VERSION) return []
      try {
        const asset = assetFromMetadata(version, metadata)
        return [{ version, downloadUrl: asset.url, publishedAt: metadata.time?.[version] ?? '', prerelease: version.includes('-'), latest: metadata['dist-tags']?.latest === version }]
      } catch { return [] }
    }).sort((a, b) => Number(b.latest) - Number(a.latest) || b.publishedAt.localeCompare(a.publishedAt))
    if (!versions.length) throw new Error('npm 目录暂无带完整性凭据的可用版本')
    return { ok: true, versions, source: 'npm @deepseek-ai/dsh' }
  } catch (error) { return { ok: false, versions: [], error: error instanceof Error ? error.message : String(error) } }
}
