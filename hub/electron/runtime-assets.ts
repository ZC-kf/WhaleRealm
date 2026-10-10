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

import { createHash } from 'node:crypto'
import type { InstanceKind } from '../src/types'
import type { CatalogFetch } from './instance-catalog'
import type { RuntimeAsset } from './runtime-adapter'
import { resolveDesktopAsset } from './desktop-assets'
import { VERIFIED_WEB_VERSION } from './web-runtime'
export const NPM_METADATA_URL = 'https://registry.npmjs.org/@deepseek-ai%2fdsh'
export const DESKTOP_UNSUPPORTED = '部署能力不足：尚无通过隔离认证的桌面免安装包；普通安装器禁止执行。'
export function assetFromMetadata(version: string, metadata: unknown): RuntimeAsset {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('必须选择已发布的精确版本')
  const body = metadata as { name?: string; versions?: Record<string, { name?: string; version?: string; dist?: { tarball?: string; integrity?: string } }> }
  const item = body?.versions?.[version]
  if (body?.name !== '@deepseek-ai/dsh' || item?.name !== '@deepseek-ai/dsh' || item.version !== version) throw new Error('该精确版本未在可信 npm 目录发布')
  const url = item.dist?.tarball
  const integrity = item.dist?.integrity
  if (url !== `https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-${version}.tgz`
    || !integrity || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity)) throw new Error('npm 资产来源或完整性凭据无效')
  return { assetId: `official-web:${version}`, kind: 'official-web', version, adapterId: 'official-web', url, integrity, format: 'npm', sourceRef: NPM_METADATA_URL }
}
export async function resolveRuntimeAsset(kind: InstanceKind, version: string, fetchImpl: CatalogFetch): Promise<RuntimeAsset> {
  // Desktop kinds route through the acceptance-aware resolver so the local harness can drive
  // the full create pipeline (create-runtime.ts) against a pending candidate; in production
  // (no WR_ACCEPTANCE_CANDIDATE) it is exactly the certified-catalog gate.
  if (kind !== 'official-web') return resolveDesktopAsset(kind, version)
  if (version !== VERIFIED_WEB_VERSION) throw new Error('该 Web 版本尚未通过隔离契约认证；仅支持 0.2.0-rc.2')
  const res = await fetchImpl(NPM_METADATA_URL)
  if (!res.ok) throw new Error(`npm 目录 HTTP ${res.status}`)
  return assetFromMetadata(version, await res.json())
}
export function verifyRuntimeIntegrity(bytes: Uint8Array, asset: RuntimeAsset): void {
  if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== asset.integrity) throw new Error('运行包完整性校验失败')
}
