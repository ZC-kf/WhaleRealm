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
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PROJECT_OWNER, PROJECT_REPO } from '../src/constants'
import type { ProjectReleaseCheckResult, ProjectReleaseInfo, ReleaseAssetInfo } from '../src/types'

/**
 * 受信项目发行通道（主进程）。
 *
 * 原则：
 * - 仓库身份唯一：OWNER/REPO 来自共享常量，不猜地址；无仓库 / 无发行版 /
 *   网络失败都如实返回，渲染层准确显示。
 * - 只下载已核验产物：资产必须带 GitHub 摘要凭据（sha256），下载后逐字节
 *   校验；缺失摘要即拒绝（fail-closed）。
 * - 只安装绑定产物：安装只接受 downloadRelease 返回的不透明 artifactId，
 *   渲染层无法传入任意路径；执行前重新校验摘要与 staging 归属。
 * - 更新不改用户数据：安装前后对受保护路径（设置 / 实例注册表 / 实例数据）
 *   做摘要对比，一旦被改动立即报错。
 */

const API_BASE = 'https://api.github.com'
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** NSIS setup 产物的命名约定（package.json build.nsis.artifactName）。 */
export const SETUP_ASSET_PATTERN = /^WhaleRealm-\d+\.\d+\.\d+(?:[\w.\-]*)-setup\.exe$/i
/** 从 release tag 提取语义版本号（去掉前导 v）。 */
export function versionOfReleaseTag(tag: string): string { return tag.replace(/^v/i, '') }

export interface ReleaseCheckFetch {
  (url: string, init?: { headers?: Record<string, string> }): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>
}

/** GitHub 仓库存在性响应（只取需要的字段）。 */
interface GitHubRepoResponse { name?: unknown; owner?: { login?: unknown } }
interface GitHubAssetResponse { id?: unknown; name?: unknown; browser_download_url?: unknown; digest?: unknown; size?: unknown }
interface GitHubReleaseResponse { id?: unknown; tag_name?: unknown; published_at?: unknown; body?: unknown; assets?: unknown }

function repoUrl(): string { return `${API_BASE}/repos/${PROJECT_OWNER}/${PROJECT_REPO}` }

function parseAsset(raw: unknown): ReleaseAssetInfo | null {
  if (typeof raw !== 'object' || raw === null) return null
  const asset = raw as GitHubAssetResponse
  if (typeof asset.id !== 'number' || typeof asset.name !== 'string' || typeof asset.browser_download_url !== 'string') return null
  if (typeof asset.size !== 'number') return null
  const digest = typeof asset.digest === 'string' && /^sha256:[0-9a-f]{64}$/i.test(asset.digest) ? asset.digest.toLowerCase() : null
  return { id: asset.id, name: asset.name, url: asset.browser_download_url, digest, size: asset.size }
}

function parseRelease(raw: unknown): ProjectReleaseInfo | null {
  if (typeof raw !== 'object' || raw === null) return null
  const release = raw as GitHubReleaseResponse
  if (typeof release.id !== 'number' || typeof release.tag_name !== 'string') return null
  const assets = Array.isArray(release.assets) ? release.assets.map(parseAsset).filter((a): a is ReleaseAssetInfo => a !== null) : []
  return {
    releaseId: release.id,
    version: versionOfReleaseTag(release.tag_name),
    publishedAt: typeof release.published_at === 'string' ? release.published_at : '',
    notes: typeof release.body === 'string' ? release.body : '',
    pageUrl: `https://github.com/${PROJECT_OWNER}/${PROJECT_REPO}/releases/tag/${release.tag_name}`,
    assets,
  }
}

/**
 * 检查项目发行版。两次请求区分"仓库不存在"与"仓库存在但没有发行版"，
 * 网络异常如实上报；任何情况下不返回猜测的地址。
 */
export async function checkRelease(fetchImpl: ReleaseCheckFetch): Promise<ProjectReleaseCheckResult> {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'WhaleRealm-Hub' }
  let repoResponse: { ok: boolean; status: number }
  try {
    repoResponse = await fetchImpl(repoUrl(), { headers })
  } catch (error) {
    return { release: null, reason: 'network', error: error instanceof Error ? error.message : String(error) }
  }
  if (!repoResponse.ok) {
    if (repoResponse.status === 404) return { release: null, reason: 'no-repository', error: null }
    return { release: null, reason: 'network', error: `仓库请求失败：HTTP ${repoResponse.status}` }
  }
  try {
    const repoBody = await fetchImpl(repoUrl(), { headers }).then(result => result.json()) as GitHubRepoResponse
    if (repoBody?.owner?.login !== PROJECT_OWNER || repoBody?.name !== PROJECT_REPO) {
      // 响应与固定仓库身份不符（代理改写/错误内容）：按坏响应处理，不猜地址。
      return { release: null, reason: 'bad-response', error: '仓库响应与固定身份不符' }
    }
  } catch (error) {
    return { release: null, reason: 'bad-response', error: error instanceof Error ? error.message : String(error) }
  }
  let releaseResponse: { ok: boolean; status: number; json(): Promise<unknown> }
  try {
    releaseResponse = await fetchImpl(`${repoUrl()}/releases/latest`, { headers })
  } catch (error) {
    return { release: null, reason: 'network', error: error instanceof Error ? error.message : String(error) }
  }
  if (!releaseResponse.ok) {
    // 仓库存在但没有 release 时 GitHub 对 /releases/latest 返回 404。
    if (releaseResponse.status === 404) return { release: null, reason: 'no-release', error: null }
    return { release: null, reason: 'network', error: `发行版请求失败：HTTP ${releaseResponse.status}` }
  }
  try {
    const release = parseRelease(await releaseResponse.json())
    if (!release) return { release: null, reason: 'bad-response', error: '发行版响应缺少必要字段' }
    return { release, reason: null, error: null }
  } catch (error) {
    return { release: null, reason: 'bad-response', error: error instanceof Error ? error.message : String(error) }
  }
}

export interface DownloadDeps {
  fetchJson: ReleaseCheckFetch
  /** 二进制下载通道：跟随资产 url 取回完整字节。 */
  fetchBinary(url: string, init?: { headers?: Record<string, string> }): Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>
  /** 主进程拥有的 staging 目录（产物与校验凭据都落在这里）。 */
  stagingDir: string
}

/** staging 内校验凭据文件的内容合同。 */
export interface ArtifactReceipt {
  releaseId: number
  artifactId: string
  name: string
  digest: string
  size: number
  verifiedAt: string
}

function artifactPathOf(stagingDir: string, artifactId: string): string {
  // artifactId 必须是裸文件名：不允许任何路径分隔符/盘符/..
  if (!/^[A-Za-z0-9._-]+$/.test(artifactId) || artifactId.includes('..') || artifactId.includes('/') || artifactId.includes('\\')) {
    throw new Error('产物句柄无效')
  }
  const target = path.resolve(stagingDir, artifactId)
  if (!target.startsWith(path.resolve(stagingDir) + path.sep)) throw new Error('产物句柄越界')
  return target
}

/**
 * 受信下载：按 releaseId 重新取回发行版，挑出符合命名约定的 setup 产物，
 * 要求其带 sha256 摘要，下载后逐字节校验并写入凭据文件。
 * 摘要缺失 / 无匹配资产 / 校验失败都抛错（fail-closed）。
 */
export async function downloadRelease(releaseId: number, deps: DownloadDeps): Promise<{ artifactId: string }> {
  if (!Number.isInteger(releaseId) || releaseId <= 0) throw new Error('发行版 ID 无效')
  await mkdir(deps.stagingDir, { recursive: true })
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'WhaleRealm-Hub' }
  const response = await deps.fetchJson(`${repoUrl()}/releases/${releaseId}`, { headers })
  if (!response.ok) throw new Error(`发行版请求失败：HTTP ${response.status}`)
  const release = parseRelease(await response.json())
  if (!release || release.releaseId !== releaseId) throw new Error('发行版响应与请求 ID 不符')
  const asset = release.assets.find(item => SETUP_ASSET_PATTERN.test(item.name))
  if (!asset) throw new Error('该发行版没有符合约定的 setup 产物（WhaleRealm-<version>-setup.exe）')
  if (!asset.digest) throw new Error(`产物 ${asset.name} 缺少摘要凭据，拒绝下载（fail-closed）`)
  const binary = await deps.fetchBinary(asset.url, { headers: { Accept: 'application/octet-stream', 'User-Agent': 'WhaleRealm-Hub' } })
  if (!binary.ok) throw new Error(`产物下载失败：HTTP ${binary.status}`)
  const bytes = Buffer.from(await binary.arrayBuffer())
  const actual = `sha256:${sha256(bytes)}`
  if (actual !== asset.digest) throw new Error('产物摘要校验失败，已丢弃（下载内容与发行方声明不符）')
  if (bytes.length !== asset.size) throw new Error('产物大小与发行方声明不符，已丢弃')
  const artifactId = `WhaleRealm-${release.version}-setup.exe`
  const target = artifactPathOf(deps.stagingDir, artifactId)
  await rm(target, { force: true })
  await rm(`${target}.receipt.json`, { force: true })
  await writeFile(target, bytes)
  const receipt: ArtifactReceipt = { releaseId, artifactId, name: asset.name, digest: asset.digest, size: bytes.length, verifiedAt: new Date().toISOString() }
  await writeFile(`${target}.receipt.json`, JSON.stringify(receipt), { flag: 'wx' })
  return { artifactId }
}

export interface InstallDeps {
  stagingDir: string
  /** 执行安装器（等待退出码）；注入以便测试。 */
  runInstaller(file: string, args: string[]): Promise<{ code: number }>
  /** 受保护路径：安装前后摘要必须一致，否则视为更新破坏用户数据。 */
  protectedPaths?: string[]
}

async function digestFile(file: string): Promise<string> {
  const bytes = await readFile(file)
  return `sha256:${sha256(bytes)}`
}

/**
 * 受信安装：只接受 downloadRelease 发行的 artifactId。执行前重新校验
 * staging 归属、凭据文件与产物摘要；执行后对比受保护路径摘要，确认更新
 * 没有重置设置 / 实例注册表 / 实例数据。
 */
export async function installRelease(artifactId: string, deps: InstallDeps): Promise<void> {
  const target = artifactPathOf(deps.stagingDir, artifactId)
  const info = await lstat(target)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('产物不是 staging 内的普通文件')
  let receipt: ArtifactReceipt
  try {
    receipt = JSON.parse(await readFile(`${target}.receipt.json`, 'utf8')) as ArtifactReceipt
  } catch {
    throw new Error('产物缺少校验凭据，拒绝执行')
  }
  if (receipt.artifactId !== artifactId || !SETUP_ASSET_PATTERN.test(receipt.name)) throw new Error('产物凭据与句柄不符，拒绝执行')
  const actual = await digestFile(target)
  if (actual !== receipt.digest) throw new Error('产物在下载后被改动，摘要不符，拒绝执行')

  // 安装前快照受保护数据（缺失文件记为空串摘要）。
  const snapshot = new Map<string, string>()
  for (const protectedPath of deps.protectedPaths ?? []) {
    snapshot.set(path.resolve(protectedPath), await digestFile(protectedPath).catch(() => 'sha256:<missing>'))
  }
  const exit = await deps.runInstaller(target, ['/S'])
  if (exit.code !== 0) throw new Error(`安装器退出码异常：${exit.code}`)
  for (const [protectedPath, before] of snapshot) {
    const after = await digestFile(protectedPath).catch(() => 'sha256:<missing>')
    if (before !== after) throw new Error(`更新过程修改了受保护数据：${protectedPath}`)
  }
}
