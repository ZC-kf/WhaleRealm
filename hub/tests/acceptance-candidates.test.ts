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
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolveDesktopAsset, resolveDesktopAssets, stableStringify, type CertifiedDesktopAsset } from '../electron/desktop-assets'

/*
 * Acceptance-candidate trust input.
 *
 * The certified catalog (manifests/isolated-runtimes.json) may be empty or populated with
 * certified runtimes; when populated, `certifiedDesktopAssets` returns those and production is
 * served from them. These tests pin the opt-in candidate channel used by the local acceptance
 * harness: fail-closed for uncertified kinds, code-pinned, build-chain-bound — and it must never
 * leak a candidate (pending-acceptance) asset while the channel is inactive.
 */

const OFFICIAL_SOURCE = 'c36a83ff6bb95e3f82cf79f9be7c724270a8aa61'
const COMMUNITY_SOURCE = 'aff39a991fda3558c5459b54fb3fa1c6984d3227'
const INTEGRITY = 'sha512-v+ErlGoqzMtejGVA2Y3GhEWNzsa1EeAnW2QpG2hwukNN0i6veAW7tqA8R4mTDXTX9Zfv/wmnwSdHxIT37hjVDA=='
const PATCH = 'a'.repeat(64)
const RECEIPT = 'b'.repeat(64)

const roots: string[] = []
afterEach(() => {
  delete process.env.WR_ACCEPTANCE_CANDIDATE
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wr-candidate-'))
  roots.push(dir)
  return dir
}

interface CandidateOptions {
  candidate?: Record<string, unknown>
  owner?: Record<string, unknown> | null
  zipName?: string
  rawManifest?: string
  omits?: string[]
}

function buildCandidate(dir: string, options: CandidateOptions = {}): { manifestFile: string; zip: string; candidate: Record<string, unknown> } {
  mkdirSync(dir, { recursive: true })
  const zip = path.join(dir, options.zipName ?? 'build.zip')
  writeFileSync(zip, 'PK\u0003\u0004dummy-archive')
  const candidate: Record<string, unknown> = {
    schemaVersion: 1,
    kind: 'official-desktop',
    version: '0.1.7-alpha.1',
    adapterId: 'official-desktop-v1',
    sourceRef: OFFICIAL_SOURCE,
    patchSha256: PATCH,
    executable: 'WhaleRealm Official.exe',
    assetId: 'official-desktop:0.1.7-alpha.1:aaaaaaaaaaaa',
    integrity: INTEGRITY,
    format: 'zip',
    url: pathToFileURL(zip).href,
    receiptSha256: RECEIPT,
    status: 'pending-acceptance',
    builtAt: '2026-10-08T05:21:37.955Z',
    ...options.candidate,
  }
  for (const key of options.omits ?? []) delete candidate[key]
  const manifestFile = path.join(dir, 'pending-manifest.json')
  writeFileSync(manifestFile, options.rawManifest ?? JSON.stringify(candidate, null, 2))
  if (options.owner !== null) {
    const owner = { kind: 'official-desktop', source: 'ignored', sourceRef: OFFICIAL_SOURCE, patchSha256: PATCH, ...options.owner }
    writeFileSync(path.join(dir, 'build-owner.json'), JSON.stringify(owner))
  }
  return { manifestFile, zip, candidate }
}

describe('resolveDesktopAssets fail-closed', () => {
  it('exposes no non-certified asset when the harness opt-in is absent', () => {
    // The candidate channel is closed without the opt-in: only certified entries (if the shipped
    // catalog has any) may be returned; a candidate (pending-acceptance) must never leak.
    for (const kind of ['official-desktop', 'community-desktop'] as const) {
      expect(resolveDesktopAssets(kind).filter(asset => asset.status !== 'certified')).toEqual([])
    }
  })

  it('rejects a relative candidate pointer', () => {
    process.env.WR_ACCEPTANCE_CANDIDATE = 'relative/pending-manifest.json'
    expect(resolveDesktopAssets('official-desktop')).toEqual([])
  })

  it('rejects a pointer to a missing file', () => {
    process.env.WR_ACCEPTANCE_CANDIDATE = path.join(tempDir(), 'nope.json')
    expect(resolveDesktopAssets('official-desktop')).toEqual([])
  })

  it('rejects a pointer to a directory', () => {
    const dir = tempDir()
    process.env.WR_ACCEPTANCE_CANDIDATE = dir
    expect(resolveDesktopAssets('official-desktop')).toEqual([])
  })

  it('rejects an oversized manifest (> 1MB)', () => {
    const dir = tempDir()
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'pending-manifest.json')
    writeFileSync(file, 'x'.repeat(1024 * 1024 + 1))
    process.env.WR_ACCEPTANCE_CANDIDATE = file
    expect(resolveDesktopAssets('official-desktop')).toEqual([])
  })

  it('rejects malformed JSON', () => {
    const dir = tempDir()
    const { manifestFile } = buildCandidate(dir, { rawManifest: '{ not json' })
    process.env.WR_ACCEPTANCE_CANDIDATE = manifestFile
    expect(resolveDesktopAssets('official-desktop')).toEqual([])
  })

  it('rejects a symbolic-link manifest when the OS allows creating one', () => {
    const dir = tempDir()
    const { manifestFile } = buildCandidate(dir)
    const link = path.join(dir, 'linked-manifest.json')
    try {
      symlinkSync(manifestFile, link, 'file')
    } catch { return } // symlink privilege unavailable / shimmed — nothing to assert
    process.env.WR_ACCEPTANCE_CANDIDATE = link
    expect(resolveDesktopAssets('official-desktop')).toEqual([])
  })

  it('rejects mismatched or missing required fields', () => {
    const cases: CandidateOptions[] = [
      { candidate: { schemaVersion: 2 } },
      { candidate: { kind: 'community-desktop' } },
      { candidate: { status: 'certified' } },
      { candidate: { sourceRef: 'deadbeef' } },
      { candidate: { adapterId: 'official-desktop-v2' } },
      { candidate: { format: 'npm' } },
      { candidate: { version: 'not-semver' } },
      { candidate: { integrity: 'sha512-short==' } },
      { candidate: { patchSha256: 'xyz' } },
      { candidate: { receiptSha256: 'nothex' } },
      { candidate: { executable: 'C:\\\\evil.exe' } },
      { candidate: { url: 'https://example.com/x.zip' } },
      { omits: ['receiptSha256'] },
    ]
    for (const options of cases) {
      const dir = tempDir()
      const { manifestFile } = buildCandidate(dir, options)
      process.env.WR_ACCEPTANCE_CANDIDATE = manifestFile
      expect(resolveDesktopAssets('official-desktop'), JSON.stringify(options)).toEqual([])
    }
  })

  it('rejects when the referenced archive is missing', () => {
    const dir = tempDir()
    const { manifestFile } = buildCandidate(dir, { candidate: { url: pathToFileURL(path.join(dir, 'ghost.zip')).href } })
    process.env.WR_ACCEPTANCE_CANDIDATE = manifestFile
    expect(resolveDesktopAssets('official-desktop')).toEqual([])
  })

  it('rejects when build-owner.json is absent or does not bind the candidate', () => {
    const noOwner = tempDir()
    const a = buildCandidate(noOwner, { owner: null })
    process.env.WR_ACCEPTANCE_CANDIDATE = a.manifestFile
    expect(resolveDesktopAssets('official-desktop')).toEqual([])

    const badOwner = tempDir()
    const b = buildCandidate(badOwner, { owner: { patchSha256: 'c'.repeat(64) } })
    process.env.WR_ACCEPTANCE_CANDIDATE = b.manifestFile
    expect(resolveDesktopAssets('official-desktop')).toEqual([])

    const wrongKind = tempDir()
    const c = buildCandidate(wrongKind, { owner: { kind: 'community-desktop' } })
    process.env.WR_ACCEPTANCE_CANDIDATE = c.manifestFile
    expect(resolveDesktopAssets('official-desktop')).toEqual([])
  })
})

describe('resolveDesktopAssets accepts a well-formed candidate', () => {
  it('returns the candidate with exactly the manifest fields', () => {
    const dir = tempDir()
    const { manifestFile, candidate } = buildCandidate(dir)
    process.env.WR_ACCEPTANCE_CANDIDATE = manifestFile
    const assets = resolveDesktopAssets('official-desktop')
    expect(assets).toHaveLength(1)
    const asset = assets[0]
    expect(asset.kind).toBe('official-desktop')
    expect(asset.version).toBe(candidate.version)
    expect(asset.adapterId).toBe('official-desktop-v1')
    expect(asset.sourceRef).toBe(OFFICIAL_SOURCE)
    expect(asset.patchSha256).toBe(PATCH)
    expect(asset.receiptSha256).toBe(RECEIPT)
    expect(asset.integrity).toBe(INTEGRITY)
    expect(asset.executable).toBe('WhaleRealm Official.exe')
    expect(asset.url).toBe(candidate.url)
    expect(asset.status).toBe('pending-acceptance')
  })

  it('accepts a community candidate for its own kind only', () => {
    const dir = tempDir()
    const { manifestFile } = buildCandidate(dir, {
      candidate: { kind: 'community-desktop', adapterId: 'community-desktop-v1', sourceRef: COMMUNITY_SOURCE, executable: 'deepseek-harness-desktop.exe' },
      owner: { kind: 'community-desktop', sourceRef: COMMUNITY_SOURCE },
    })
    process.env.WR_ACCEPTANCE_CANDIDATE = manifestFile
    expect(resolveDesktopAssets('community-desktop')).toHaveLength(1)
    expect(resolveDesktopAssets('official-desktop')).toEqual([])
  })
})

describe('resolveDesktopAsset', () => {
  it('throws the certified-missing message when nothing is available', () => {
    expect(() => resolveDesktopAsset('official-desktop', '0.1.7-alpha.1')).toThrow(/尚无经隔离认证/)
  })

  it('throws a distinct candidate-mismatch message when a candidate exists but the version differs', () => {
    const dir = tempDir()
    const { manifestFile } = buildCandidate(dir)
    process.env.WR_ACCEPTANCE_CANDIDATE = manifestFile
    expect(() => resolveDesktopAsset('official-desktop', '9.9.9')).toThrow(/验收候选不匹配/)
    expect(resolveDesktopAsset('official-desktop', '0.1.7-alpha.1').version).toBe('0.1.7-alpha.1')
  })
})

describe('stableStringify', () => {
  it('is independent of object key order', () => {
    expect(stableStringify({ a: 1, b: { x: 2, y: 3 } })).toBe(stableStringify({ b: { y: 3, x: 2 }, a: 1 }))
    expect(stableStringify([{ a: 1, b: 2 }])).toBe(stableStringify([{ b: 2, a: 1 }]))
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 1, b: 2 }))
  })
})

describe('certified catalog precedence', () => {
  it('returns the certified entry (not the candidate) when the catalog is populated', async () => {
    const dir = tempDir()
    const { manifestFile } = buildCandidate(dir)
    process.env.WR_ACCEPTANCE_CANDIDATE = manifestFile
    const manifestPath = fileURLToPath(new URL('../../manifests/isolated-runtimes.json', import.meta.url))
    vi.resetModules()
    vi.doMock(manifestPath, () => ({
      default: {
        schemaVersion: 1,
        runtimes: [{
          assetId: 'official-desktop:0.1.7-alpha.1:certified', kind: 'official-desktop', version: '0.1.7-alpha.1', adapterId: 'official-desktop-v1',
          url: pathToFileURL(path.join(dir, 'build.zip')).href, integrity: INTEGRITY, format: 'zip', sourceRef: OFFICIAL_SOURCE,
          status: 'certified', executable: 'WhaleRealm Official.exe', patchSha256: PATCH, receiptSha256: RECEIPT,
          acceptance: { evidenceSha256: 'd'.repeat(64), acceptedAt: '2026-10-08T05:21:37.955Z', checks: Object.fromEntries(['twoInstances', 'privateData', 'privateWebviews', 'distinctPorts', 'independentLocks', 'ownedProcessTree', 'stopIsolation', 'noGlobalRegistration', 'protectedPathsUnchanged', 'completeResources', 'coldLaunchWithoutBuildTools'].map(key => [key, true])) },
        }] as unknown[],
      },
    }))
    try {
      const mod = await import('../electron/desktop-assets')
      expect(mod.certifiedDesktopAssets('official-desktop'), 'catalog mock must be active').toHaveLength(1)
      const assets = mod.resolveDesktopAssets('official-desktop')
      expect(assets).toHaveLength(1)
      expect(assets[0].status).toBe('certified')
      expect((assets[0] as CertifiedDesktopAsset).acceptance?.evidenceSha256).toBe('d'.repeat(64))
    } finally {
      vi.doUnmock(manifestPath)
      vi.resetModules()
    }
  })
})
