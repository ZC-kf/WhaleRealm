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
import * as fsPromises from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checkRelease, downloadRelease, installRelease, releaseProtectedPaths, SETUP_ASSET_PATTERN, versionOfReleaseTag } from '../electron/project-release'
import { resolveInstanceRecord } from '../electron/instance-paths'
import { PROJECT_OWNER, PROJECT_REPO } from '../src/constants'
import type { ReleaseCheckFetch } from '../electron/project-release'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, readdir: vi.fn(actual.readdir) }
})

/**
 * 受信发行通道合同：
 * - 无仓库 / 无发行版不猜地址，如实返回原因；
 * - 只下载带摘要凭据的绑定产物，摘要校验失败丢弃；
 * - 安装只接受不透明 artifactId，任意路径一律拒绝；
 * - 更新前后受保护数据摘要必须一致。
 */

const sha256 = (bytes: Buffer | string) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
const API = `https://api.github.com/repos/${PROJECT_OWNER}/${PROJECT_REPO}`
const HEADERS = { Accept: 'application/vnd.github+json', 'User-Agent': 'WhaleRealm-Hub' }

interface FetchScript {
  (url: string, init?: { headers?: Record<string, string> }): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>
}

/** 按序回放预设响应的 fetch 替身。status 显式给出时优先于 ok 推断。 */
function scriptedFetch(responses: Array<{ match: string | RegExp; status?: number; body?: unknown }>): FetchScript {
  return async (url, init) => {
    const entry = responses.find(item => (typeof item.match === 'string' ? url === item.match : item.match.test(url)))
    if (!entry) throw new Error(`unexpected fetch: ${url}`)
    const status = entry.status ?? 200
    return { ok: status < 400, status, json: async () => entry.body }
  }
}

const RELEASE_BODY = {
  id: 9001,
  tag_name: 'v1.2.0',
  published_at: '2026-10-09T01:02:03Z',
  body: '更新说明',
  assets: [{
    id: 777,
    name: 'WhaleRealm-1.2.0-setup.exe',
    browser_download_url: 'https://example.com/dl/WhaleRealm-1.2.0-setup.exe',
    digest: null as string | null,
    size: 12,
  }],
}

function repoOkFetch(releaseStatus = 200, releaseBody: unknown = RELEASE_BODY): FetchScript {
  return scriptedFetch([
    { match: /^https:\/\/api\.github\.com\/repos\/ZC-kf\/WhaleRealm$/, body: { name: PROJECT_REPO, owner: { login: PROJECT_OWNER } } },
    { match: /\/releases\/latest$/, status: releaseStatus, body: releaseStatus === 404 ? { message: 'Not Found' } : releaseBody },
  ])
}

describe('checkRelease：不猜地址，如实报告', () => {
  it('仓库不存在 → no-repository，不返回任何猜测地址', async () => {
    const fetchImpl = scriptedFetch([{ match: /^https:\/\/api\.github\.com\/repos\//, status: 404, body: { message: 'Not Found' } }])
    const result = await checkRelease(fetchImpl)
    expect(result.release).toBeNull()
    expect(result.reason).toBe('no-repository')
  })

  it('仓库存在但无发行版 → no-release', async () => {
    const result = await checkRelease(repoOkFetch(404))
    expect(result.release).toBeNull()
    expect(result.reason).toBe('no-release')
  })

  it('网络异常 → network 且带原始错误', async () => {
    const failing: FetchScript = async () => { throw new Error('ETIMEDOUT') }
    const result = await checkRelease(failing)
    expect(result.release).toBeNull()
    expect(result.reason).toBe('network')
    expect(result.error).toContain('ETIMEDOUT')
  })

  it('仓库响应与固定身份不符 → bad-response，不用响应内容替代固定仓库', async () => {
    const fetchImpl = scriptedFetch([
      { match: /^https:\/\/api\.github\.com\/repos\/ZC-kf\/WhaleRealm$/, body: { name: 'other-repo', owner: { login: 'other' } } },
    ])
    const result = await checkRelease(fetchImpl)
    expect(result.reason).toBe('bad-response')
  })

  it('有发行版 → 完整信息（版本去 v、页面链接、资产列表）', async () => {
    const result = await checkRelease(repoOkFetch())
    expect(result.reason).toBeNull()
    const release = result.release!
    expect(release.releaseId).toBe(9001)
    expect(release.version).toBe('1.2.0')
    expect(release.pageUrl).toBe(`https://github.com/${PROJECT_OWNER}/${PROJECT_REPO}/releases/tag/v1.2.0`)
    expect(release.assets).toHaveLength(1)
  })

  it('versionOfReleaseTag 与 SETUP_ASSET_PATTERN 约定', () => {
    expect(versionOfReleaseTag('v1.2.0')).toBe('1.2.0')
    expect(SETUP_ASSET_PATTERN.test('WhaleRealm-1.2.0-setup.exe')).toBe(true)
    expect(SETUP_ASSET_PATTERN.test('WhaleRealm-1.2.0-beta.1-setup.exe')).toBe(true)
    expect(SETUP_ASSET_PATTERN.test('WhaleRealm-1.2.0-x64.zip')).toBe(false)
    expect(SETUP_ASSET_PATTERN.test('evil.exe')).toBe(false)
  })
})

describe('downloadRelease：只下载带摘要凭据的绑定产物', () => {
  const payload = Buffer.from('setup-bytes')

  function staging(): string { return mkdtempSync(path.join(tmpdir(), 'release-dl-')) }
  function releaseFetch(digest: string | null): FetchScript {
    return scriptedFetch([
      { match: /\/releases\/9001$/, body: { ...RELEASE_BODY, assets: [{ ...RELEASE_BODY.assets[0], digest, size: payload.length }] } },
    ])
  }
  function binaryFetch(bytes: Buffer): { ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> } {
    const copy = new ArrayBuffer(bytes.length)
    new Uint8Array(copy).set(bytes)
    return { ok: true, status: 200, arrayBuffer: async () => copy }
  }

  it('摘要齐全且校验一致 → 落盘产物与凭据，返回不透明句柄', async () => {
    const dir = staging()
    try {
      const digest = sha256(payload)
      const result = await downloadRelease(9001, { fetchJson: releaseFetch(digest), fetchBinary: async () => binaryFetch(payload), stagingDir: dir })
      expect(result.artifactId).toBe('WhaleRealm-1.2.0-setup.exe')
      expect(existsSync(path.join(dir, result.artifactId))).toBe(true)
      expect(existsSync(path.join(dir, `${result.artifactId}.receipt.json`))).toBe(true)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('资产缺摘要 → 拒绝下载（fail-closed），不落任何文件', async () => {
    const dir = staging()
    try {
      await expect(downloadRelease(9001, { fetchJson: releaseFetch(null), fetchBinary: async () => binaryFetch(payload), stagingDir: dir }))
        .rejects.toThrow('缺少摘要凭据')
      expect(existsSync(path.join(dir, 'WhaleRealm-1.2.0-setup.exe'))).toBe(false)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('下载内容与声明摘要不符 → 丢弃并报错', async () => {
    const dir = staging()
    try {
      await expect(downloadRelease(9001, { fetchJson: releaseFetch(sha256(Buffer.from('other'))), fetchBinary: async () => binaryFetch(payload), stagingDir: dir }))
        .rejects.toThrow('摘要校验失败')
      expect(existsSync(path.join(dir, 'WhaleRealm-1.2.0-setup.exe'))).toBe(false)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('发行版里没有符合命名的 setup 产物 → 明确报错', async () => {
    const dir = staging()
    try {
      const fetchImpl = scriptedFetch([
        { match: /\/releases\/9001$/, body: { ...RELEASE_BODY, assets: [{ id: 1, name: 'notes.txt', browser_download_url: 'https://x/n.txt', digest: sha256('x'), size: 1 }] } },
      ])
      await expect(downloadRelease(9001, { fetchJson: fetchImpl, fetchBinary: async () => binaryFetch(payload), stagingDir: dir }))
        .rejects.toThrow('没有符合约定的 setup 产物')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('非法 releaseId → 直接拒绝', async () => {
    const dir = staging()
    try {
      await expect(downloadRelease(0, { fetchJson: releaseFetch(sha256(payload)), fetchBinary: async () => binaryFetch(payload), stagingDir: dir }))
        .rejects.toThrow('发行版 ID 无效')
      await expect(downloadRelease(12.5, { fetchJson: releaseFetch(sha256(payload)), fetchBinary: async () => binaryFetch(payload), stagingDir: dir }))
        .rejects.toThrow('发行版 ID 无效')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('installRelease：任意路径拒绝 + 受保护数据不变', () => {
  const payload = Buffer.from('setup-bytes')

  async function stage(): Promise<{ dir: string; artifactId: string }> {
    const dir = mkdtempSync(path.join(tmpdir(), 'release-install-'))
    const artifactId = 'WhaleRealm-1.2.0-setup.exe'
    writeFileSync(path.join(dir, artifactId), payload)
    writeFileSync(path.join(dir, `${artifactId}.receipt.json`), JSON.stringify({
      releaseId: 9001, artifactId, name: artifactId, digest: sha256(payload), size: payload.length, verifiedAt: new Date().toISOString(),
    }))
    return { dir, artifactId }
  }

  it('合法句柄 + 受保护数据未变 → 执行安装且数据摘要前后一致', async () => {
    const { dir, artifactId } = await stage()
    const settings = path.join(dir, 'settings.json')
    const registry = path.join(dir, 'instances.json')
    const instanceData = path.join(dir, 'instance-data')
    try {
      writeFileSync(settings, '{"language":"zh-CN"}')
      writeFileSync(registry, '{"instances":[]}')
      mkdirSync(instanceData)
      writeFileSync(path.join(instanceData, 'keep.txt'), 'user-data')
      const executed: string[][] = []
      const result = await installRelease(artifactId, {
        stagingDir: dir,
        runInstaller: async (file, args) => { executed.push([file, ...args]); return { code: 0 } },
        protectedPaths: [settings, registry, instanceData, path.join(dir, 'absent')],
      })
      expect(result).toBeUndefined()
      expect(executed).toEqual([[path.join(dir, artifactId), '/S']])
      expect(existsSync(path.join(instanceData, 'keep.txt'))).toBe(true)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('渲染层传任意路径 → 全部拒绝且不执行安装器', async () => {
    const { dir, artifactId } = await stage()
    const outside = mkdtempSync(path.join(tmpdir(), 'release-outside-'))
    try {
      let executed = 0
      const runInstaller = async () => { executed += 1; return { code: 0 } }
      // 绝对路径、相对路径、盘符、路径分隔符、..、空串都拒绝。
      await expect(installRelease(path.join(outside, 'evil.exe'), { stagingDir: dir, runInstaller })).rejects.toThrow('产物句柄无效')
      await expect(installRelease('..\\evil.exe', { stagingDir: dir, runInstaller })).rejects.toThrow('产物句柄无效')
      await expect(installRelease('sub/evil.exe', { stagingDir: dir, runInstaller })).rejects.toThrow('产物句柄无效')
      await expect(installRelease('', { stagingDir: dir, runInstaller })).rejects.toThrow('产物句柄无效')
      // staging 内存在但无凭据的文件也拒绝。
      writeFileSync(path.join(dir, 'stray.exe'), 'x')
      await expect(installRelease('stray.exe', { stagingDir: dir, runInstaller })).rejects.toThrow('缺少校验凭据')
      expect(executed).toBe(0)
      expect(artifactId).toBeTruthy()
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('产物在下载后被改动 → 摘要不符拒绝执行', async () => {
    const { dir, artifactId } = await stage()
    try {
      writeFileSync(path.join(dir, artifactId), Buffer.concat([payload, Buffer.from('tampered')]))
      await expect(installRelease(artifactId, { stagingDir: dir, runInstaller: async () => ({ code: 0 }) }))
        .rejects.toThrow('下载后被改动')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('安装器修改了受保护数据 → 如实报错', async () => {
    const { dir, artifactId } = await stage()
    const settings = path.join(dir, 'settings.json')
    try {
      writeFileSync(settings, '{"language":"zh-CN"}')
      await expect(installRelease(artifactId, {
        stagingDir: dir,
        // 模拟坏安装器顺手改了设置。
        runInstaller: async () => { writeFileSync(settings, '{"language":"en"}'); return { code: 0 } },
        protectedPaths: [settings],
      })).rejects.toThrow('修改了受保护数据')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('安装器退出码非 0 → 报错', async () => {
    const { dir, artifactId } = await stage()
    try {
      await expect(installRelease(artifactId, { stagingDir: dir, runInstaller: async () => ({ code: 2 }) }))
        .rejects.toThrow('退出码异常')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it.each(['edit', 'add', 'delete', 'empty-directory', 'type-change'])('detects recursive protected directory changes: %s', async change => {
    const { dir, artifactId } = await stage()
    const data = path.join(dir, 'data')
    const nested = path.join(data, 'nested')
    const file = path.join(nested, 'keep.txt')
    try {
      mkdirSync(nested, { recursive: true })
      writeFileSync(file, 'original')
      await expect(installRelease(artifactId, {
        stagingDir: dir, protectedPaths: [data],
        runInstaller: async () => {
          if (change === 'edit') writeFileSync(file, 'changed')
          if (change === 'add') writeFileSync(path.join(nested, 'new.txt'), 'new')
          if (change === 'delete') rmSync(file)
          if (change === 'empty-directory') mkdirSync(path.join(nested, 'empty'))
          if (change === 'type-change') { rmSync(file); mkdirSync(file) }
          return { code: 0 }
        },
      })).rejects.toThrow('修改了受保护数据')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('rejects junctions in protected data and ancestors before invoking installer', async () => {
    const { dir, artifactId } = await stage()
    const data = path.join(dir, 'data')
    const outside = path.join(dir, 'outside')
    const link = path.join(data, 'linked')
    try {
      mkdirSync(data); mkdirSync(outside)
      writeFileSync(path.join(outside, 'keep.txt'), 'outside')
      symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
      let executions = 0
      for (const protectedPath of [data, link, path.join(link, 'keep.txt'), path.join(link, 'missing')]) {
        await expect(installRelease(artifactId, {
          stagingDir: dir, protectedPaths: [protectedPath],
          runInstaller: async () => { executions++; return { code: 0 } },
        })).rejects.toThrow('受保护路径')
      }
      expect(executions).toBe(0)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it.each(['create', 'remove'])('distinguishes missing roots from empty directories: %s', async change => {
    const { dir, artifactId } = await stage()
    const data = path.join(dir, 'data')
    try {
      if (change === 'remove') mkdirSync(data)
      await expect(installRelease(artifactId, {
        stagingDir: dir, protectedPaths: [data],
        runInstaller: async () => {
          if (change === 'create') mkdirSync(data)
          else rmSync(data, { recursive: true })
          return { code: 0 }
        },
      })).rejects.toThrow('修改了受保护数据')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it.each(['EACCES', 'EIO'])('fails closed on directory read error %s', async code => {
    const { dir, artifactId } = await stage()
    const data = path.join(dir, 'data')
    mkdirSync(data)
    const read = vi.mocked(fsPromises.readdir).mockRejectedValueOnce(Object.assign(new Error(code), { code }))
    let executions = 0
    try {
      await expect(installRelease(artifactId, {
        stagingDir: dir, protectedPaths: [data],
        runInstaller: async () => { executions++; return { code: 0 } },
      })).rejects.toThrow(code)
      expect(executions).toBe(0)
    } finally { read.mockClear(); rmSync(dir, { recursive: true, force: true }) }
  })

  it('protects actual registry generations and recorded external legacy data', () => {
    const hubRoot = path.resolve('test-hub')
    const settings = path.resolve('test-user-data/settings.json')
    const record = resolveInstanceRecord(hubRoot, 'legacy', {
      root: path.resolve('external-root'), dshHome: path.resolve('legacy-data'),
      workspace: path.resolve('legacy-workspace'), electronUserData: path.resolve('legacy-electron'),
    })
    expect(releaseProtectedPaths(hubRoot, settings, [record])).toEqual(expect.arrayContaining([
      settings, path.join(hubRoot, 'hub-data', 'instances.json'),
      path.join(hubRoot, 'hub-data', 'instances.json.bak'), path.join(hubRoot, 'instances'),
      record.root, record.dshHome, record.workspace, record.electronUserData, record.desktopProfile,
    ]))
  })
})
