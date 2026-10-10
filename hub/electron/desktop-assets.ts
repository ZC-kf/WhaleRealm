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
import { lstatSync, readFileSync, type Stats } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import manifest from '../../manifests/isolated-runtimes.json'
import type { RuntimeAsset } from './runtime-adapter'
import type { InstanceKind } from '../src/types'

export interface CertifiedDesktopAsset extends RuntimeAsset {
  kind: 'official-desktop' | 'community-desktop'
  format: 'zip'
  /**
   * `certified` = published in the committed catalog (manifests/isolated-runtimes.json).
   * `pending-acceptance` = a build candidate reachable only through the local
   * acceptance harness (see `resolveDesktopAssets`); never a shipped catalog entry.
   */
  status: 'certified' | 'pending-acceptance'
  executable: string
  patchSha256: string
  receiptSha256: string
  acceptance?: { evidenceSha256: string; acceptedAt: string; checks: Record<string, boolean> }
}
/** Owner/repo pins the isolated builds must resolve to; also the acceptance-candidate source pins. */
const sources: Record<'official-desktop' | 'community-desktop', string> = { 'official-desktop': 'c36a83ff6bb95e3f82cf79f9be7c724270a8aa61', 'community-desktop': 'aff39a991fda3558c5459b54fb3fa1c6984d3227' }
export const DESKTOP_ACCEPTANCE_CHECKS = ['twoInstances', 'privateData', 'privateWebviews', 'distinctPorts', 'independentLocks', 'ownedProcessTree', 'stopIsolation', 'noGlobalRegistration', 'protectedPathsUnchanged', 'completeResources', 'coldLaunchWithoutBuildTools'] as const
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/
const INTEGRITY_PATTERN = /^sha512-[A-Za-z0-9+/]{86}==$/
const DIGEST_PATTERN = /^[a-f0-9]{64}$/
const EXECUTABLE_PATTERN = /^[^\\/:]+\.exe$/i
const MAX_MANIFEST_BYTES = 1024 * 1024
const isDesktopKind = (kind: InstanceKind): kind is 'official-desktop' | 'community-desktop' => kind === 'official-desktop' || kind === 'community-desktop'
const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
/** Key-order-independent canonical form so asset identity never depends on JSON field order. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  return JSON.stringify(value) ?? 'undefined'
}
export function certifiedDesktopAssets(kind: InstanceKind): CertifiedDesktopAsset[] {
  if (!(kind in sources) || manifest.schemaVersion !== 1) return []
  return (manifest.runtimes as unknown as CertifiedDesktopAsset[]).filter(asset => {
    try {
      const url = new URL(asset.url)
      return asset.kind === kind && asset.status === 'certified' && asset.sourceRef === sources[asset.kind]
        && asset.adapterId === `${kind}-v1` && asset.format === 'zip' && VERSION_PATTERN.test(asset.version)
        && ['https:', 'file:'].includes(url.protocol) && !url.username && !url.password && /\.zip$/i.test(url.pathname)
        && INTEGRITY_PATTERN.test(asset.integrity) && DIGEST_PATTERN.test(asset.patchSha256) && DIGEST_PATTERN.test(asset.receiptSha256)
        && EXECUTABLE_PATTERN.test(asset.executable) && DIGEST_PATTERN.test(asset.acceptance?.evidenceSha256 ?? '')
        && Number.isFinite(Date.parse(asset.acceptance?.acceptedAt ?? '')) && DESKTOP_ACCEPTANCE_CHECKS.every(key => asset.acceptance?.checks?.[key] === true)
    } catch { return false }
  })
}
export function certifiedDesktopAsset(kind: InstanceKind, version: string): CertifiedDesktopAsset {
  const matches = certifiedDesktopAssets(kind).filter(asset => asset.version === version)
  if (matches.length !== 1) throw new Error('该桌面版本尚无经隔离认证的免安装包（真实隔离验收未通过或未收录）；普通安装器和旧直接启动通道已禁用，现有数据保留。')
  return matches[0]
}
/*
 * Acceptance-candidate trust input.
 *
 * The certification gate is fail-closed: a managed Desktop can only deploy/launch
 * a version that is present in the certified catalog (manifests/isolated-runtimes.json).
 * That catalog is written only by the certification tool (certify.mjs) AFTER the real
 * two-instance acceptance run has passed — but that run needs to deploy and launch the
 * build first. This channel breaks that chicken-and-egg by letting a LOCAL acceptance
 * harness point at one still-uncertified build candidate.
 *
 * It is strictly opt-in and read-only:
 *   - enabled only when WR_ACCEPTANCE_CANDIDATE is an absolute path to a pending-manifest.json;
 *   - the candidate is validated against the code-pinned source/build chain before use;
 *   - the certified catalog always wins when it is non-empty;
 *   - nothing here writes the certified catalog (promotion still happens in certify.mjs);
 *   - renderer/instance processes cannot set this env var, and a production launch without
 *     it behaves exactly as before.
 */
interface AcceptanceCandidate extends CertifiedDesktopAsset { schemaVersion: 1; builtAt?: string }
function regularFile(file: string): Stats | null {
  try {
    const info = lstatSync(file, { throwIfNoEntry: false })
    return info && info.isFile() && !info.isSymbolicLink() ? info : null
  } catch { return null }
}
function readBoundedJson(file: string): unknown {
  const info = regularFile(file)
  if (!info || info.size > MAX_MANIFEST_BYTES) return undefined
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return undefined }
}
function validCandidate(value: unknown, kind: InstanceKind): value is AcceptanceCandidate {
  if (!isDesktopKind(kind) || !isPlainObject(value)) return false
  return value.schemaVersion === 1 && value.kind === kind && value.status === 'pending-acceptance'
    && value.sourceRef === sources[kind] && value.adapterId === `${kind}-v1` && value.format === 'zip'
    && typeof value.version === 'string' && VERSION_PATTERN.test(value.version)
    && typeof value.integrity === 'string' && INTEGRITY_PATTERN.test(value.integrity)
    && typeof value.patchSha256 === 'string' && DIGEST_PATTERN.test(value.patchSha256)
    && typeof value.receiptSha256 === 'string' && DIGEST_PATTERN.test(value.receiptSha256)
    && typeof value.executable === 'string' && EXECUTABLE_PATTERN.test(value.executable)
    && typeof value.assetId === 'string' && value.assetId.length > 0
    && typeof value.url === 'string' && isFileUrl(value.url)
}
function isFileUrl(url: string): boolean {
  try { return new URL(url).protocol === 'file:' } catch { return false }
}
function acceptanceCandidateAssets(kind: InstanceKind): CertifiedDesktopAsset[] {
  if (!isDesktopKind(kind)) return []
  const pointer = process.env.WR_ACCEPTANCE_CANDIDATE
  if (!pointer || !path.isAbsolute(pointer)) return []
  const candidate = readBoundedJson(pointer)
  if (!validCandidate(candidate, kind)) return []
  // The archive the candidate points at must exist as its own regular file.
  let archive: string
  try { archive = fileURLToPath(candidate.url) } catch { return [] }
  if (!regularFile(archive)) return []
  // Build-chain binding: the candidate must sit next to the build-owner proof that
  // produced it, and the owner's kind/sourceRef/patchSha256 must match exactly.
  const owner = readBoundedJson(path.join(path.dirname(pointer), 'build-owner.json'))
  if (!isPlainObject(owner) || owner.kind !== candidate.kind || owner.sourceRef !== candidate.sourceRef || owner.patchSha256 !== candidate.patchSha256) return []
  return [candidate]
}
/**
 * Resolve the Desktop assets available for a kind. The certified catalog always
 * wins; the acceptance candidate is consulted only when the catalog is empty and
 * the harness opt-in is set. Fail-closed: anything suspicious yields `[]`.
 */
export function resolveDesktopAssets(kind: InstanceKind): CertifiedDesktopAsset[] {
  const certified = certifiedDesktopAssets(kind)
  if (certified.length) return certified
  return acceptanceCandidateAssets(kind)
}
/**
 * Resolve exactly one Desktop asset by version. Throws with a reason that
 * distinguishes "no certified build" from "candidate/version mismatch" so the
 * operator and the acceptance harness get an actionable signal.
 */
export function resolveDesktopAsset(kind: InstanceKind, version: string): CertifiedDesktopAsset {
  const assets = resolveDesktopAssets(kind)
  const matches = assets.filter(asset => asset.version === version)
  if (matches.length === 1) return matches[0]
  if (assets.some(asset => asset.status === 'pending-acceptance')) {
    throw new Error(`验收候选不匹配：候选版本 ${assets.map(asset => asset.version).join('、')} 与请求版本 ${version} 不一致；该通道仅供本机验收 harness（WR_ACCEPTANCE_CANDIDATE）使用。`)
  }
  throw new Error('该桌面版本尚无经隔离认证的免安装包（真实隔离验收未通过或未收录）；普通安装器和旧直接启动通道已禁用，现有数据保留。')
}
