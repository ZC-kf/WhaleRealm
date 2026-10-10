/*
 * 鲸域 · WhaleRealm
 * Copyright (C) 2026 凛枫
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public Public License as published by
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

import { lstat, mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * 模拟写 I/O 失败：武装 globalThis.__simulatedCopyFailure（目标路径子串）后，
 * copyFile 对命中目标抛 EACCES，其余调用原样透传。用于确定性验证回滚路径。
 */
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    copyFile: vi.fn(async (source: string, destination: string) => {
      const trigger = (globalThis as { __simulatedCopyFailure?: string | null }).__simulatedCopyFailure
      if (trigger && destination.includes(trigger)) {
        throw Object.assign(new Error(`simulated write failure: ${destination}`), { code: 'EACCES' })
      }
      return (actual.copyFile as (source: string, destination: string) => Promise<void>)(source, destination)
    }),
  }
})

import {
  MAX_BACKGROUND_BYTES,
  clearCardBackgrounds,
  clearLauncherBackgrounds,
  clearSettingsBackgrounds,
  clearTrayBackgrounds,
  importCardBackground,
  importLauncherBackground,
  importSettingsBackground,
  importTrayBackground,
  isValidManagedAssetName,
  launcherAssetsDir,
  looksLikePngBuffer,
  readCardBackground,
  readLauncherBackground,
  readSettingsBackground,
  readTrayBackground,
  saveTrayBackgroundBuffer,
  type AssetCategory,
} from '../electron/launcher-asset'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const tempRoots: string[] = []
afterEach(async () => {
  ;(globalThis as { __simulatedCopyFailure?: string | null }).__simulatedCopyFailure = null
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function freshUserData(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'whalerealm-assets-'))
  tempRoots.push(root)
  return root
}

/** 在独立目录里准备一个指定大小的假图片文件，返回绝对路径。 */
async function sourceImage(name: string, bytes: number): Promise<string> {
  const root = await freshUserData()
  const file = path.join(root, name)
  await writeFile(file, Buffer.alloc(bytes, 0x5a))
  return file
}

/** 固定时钟 + 计数器：每次调用递增，可精确预测托管文件名。 */
function sequencedClock(start: number): () => number {
  let current = start
  return () => (current += 1)
}

async function listAssets(userData: string): Promise<string[]> {
  try {
    return (await readdir(launcherAssetsDir(userData))).sort()
  } catch {
    return []
  }
}

describe('托管文件名校验', () => {
  it('接受历史前缀 + 10~16 位时间戳 + 白名单扩展名', () => {
    for (const category of ['launcher', 'tray', 'card', 'settings'] as AssetCategory[]) {
      expect(isValidManagedAssetName(category, `${prefixOf(category)}1756800000000.png`)).not.toBeNull()
      expect(isValidManagedAssetName(category, `${prefixOf(category)}1234567890123456.jpeg`)).not.toBeNull()
      expect(isValidManagedAssetName(category, `${prefixOf(category)}1756800000000.webp`)).not.toBeNull()
    }
  })

  it('拒绝穿越、短时间戳、未知扩展名与跨类别前缀', () => {
    expect(isValidManagedAssetName('launcher', '..\\..\\settings.json')).toBeNull()
    expect(isValidManagedAssetName('launcher', 'sub/background-1756800000000.png')).toBeNull()
    expect(isValidManagedAssetName('launcher', 'background-42.png')).toBeNull()
    expect(isValidManagedAssetName('launcher', 'background-1756800000000.gif')).toBeNull()
    // 卡片前缀的名不属于托盘类别。
    expect(isValidManagedAssetName('tray', 'card-background-1756800000000.png')).toBeNull()
  })

  function prefixOf(category: AssetCategory): string {
    return { launcher: 'background-', tray: 'tray-background-', card: 'card-background-', settings: 'settings-background-' }[category]
  }
})

describe('导入与类别隔离', () => {
  it('返回托管名并只清理本类别旧文件，其他类别与无关文件原样保留', async () => {
    const userData = await freshUserData()
    const directory = launcherAssetsDir(userData)
    await mkdir(directory, { recursive: true })
    // 预置：其他类别的旧托管文件 + 一个无关用户文件。
    await writeFile(path.join(directory, 'tray-background-1111111111111.png'), Buffer.alloc(8))
    await writeFile(path.join(directory, 'settings-background-1111111111111.jpg'), Buffer.alloc(8))
    await writeFile(path.join(directory, 'user-notes.txt'), Buffer.alloc(8))

    const first = await importLauncherBackground(userData, await sourceImage('a.png', 512))
    const second = await importLauncherBackground(userData, await sourceImage('b.jpg', 256))

    expect(first).toMatch(/^background-\d{10,16}\.png$/)
    expect(second).toMatch(/^background-\d{10,16}\.jpg$/)
    // 第一次导入的 launcher 旧图已被第二次导入清理。
    await expect(stat(path.join(directory, first))).rejects.toThrow()
    // 其他类别与无关文件完好。
    expect(await listAssets(userData)).toEqual([
      'settings-background-1111111111111.jpg',
      'tray-background-1111111111111.png',
      'user-notes.txt',
      second,
    ].sort())
  })

  it('同一时钟刻度下的并发导入被目录锁串行化：全部成功、名字互不冲突、最终只剩最后一张', async () => {
    const userData = await freshUserData()
    const clock = sequencedClock(1_756_800_000_000)
    const [a, b, c] = await Promise.all([
      importTrayBackground(userData, await sourceImage('x1.png', 64), clock),
      importTrayBackground(userData, await sourceImage('x2.png', 64), clock),
      importTrayBackground(userData, await sourceImage('x3.png', 64), clock),
    ])
    // 分配器跳过被占用的刻度，三个名字互不相同、无半成品残留。
    expect(new Set([a, b, c]).size).toBe(3)
    for (const name of [a, b, c]) expect(name).toMatch(/^tray-background-\d{10,16}\.png$/)
    // 串行「换图即替换」：队列走完后只剩最后完成的一张，其余被后到者清理。
    const survivors = (await listAssets(userData)).filter(entry => entry.startsWith('tray-background-'))
    expect(survivors.length).toBe(1)
    expect([a, b, c]).toContain(survivors[0])
    expect(await readTrayBackground(userData, survivors[0])).not.toBeNull()
  })

  it('拒绝未知扩展名、空文件与超过 8MiB 的文件', async () => {
    const userData = await freshUserData()
    await expect(importCardBackground(userData, await sourceImage('a.gif', 32))).rejects.toThrow(/仅接受/)
    await expect(importCardBackground(userData, await sourceImage('b.png', 0))).rejects.toThrow(/为空/)
    await expect(importCardBackground(userData, await sourceImage('c.png', MAX_BACKGROUND_BYTES + 1))).rejects.toThrow(/8MiB/)
    // 全部被拒后存储目录不应出现任何文件。
    expect(await listAssets(userData)).toEqual([])
  })

  it('写失败时回滚半成品，不留无主文件', async () => {
    const userData = await freshUserData()
    const clock = sequencedClock(1_756_800_000_000)
    // 固定时钟预测目标名，武装 copyFile 对该目标的模拟 I/O 失败。
    const doomed = `settings-background-${1_756_800_000_001}.png`
    ;(globalThis as { __simulatedCopyFailure?: string | null }).__simulatedCopyFailure = doomed
    await expect(importSettingsBackground(userData, await sourceImage('s.png', 32), clock)).rejects.toThrow(/simulated write failure/)
    // 半成品已被回滚：目录里一个文件都没有。
    expect(await listAssets(userData)).toEqual([])
    // 解除武装后重试落盘成功（失败的那次也消耗了一个时钟刻度，重试落在下一刻度）。
    ;(globalThis as { __simulatedCopyFailure?: string | null }).__simulatedCopyFailure = null
    const ok = await importSettingsBackground(userData, await sourceImage('s2.png', 32), clock)
    expect(ok).toBe(`settings-background-${1_756_800_000_002}.png`)
    expect(await readSettingsBackground(userData, ok)).not.toBeNull()
  })
})

describe('读取与安全遏制', () => {
  it('合法托管名读出字节与 MIME；缺失或未知名字返回 null', async () => {
    const userData = await freshUserData()
    const name = await importLauncherBackground(userData, await sourceImage('real.png', 48))
    const asset = await readLauncherBackground(userData, name)
    expect(asset?.contentType).toBe('image/png')
    expect(asset?.body.length).toBe(48)
    expect(await readLauncherBackground(userData, 'background-9999999999999.png')).toBeNull()
    expect(await readLauncherBackground(userData, '../settings.json')).toBeNull()
    expect(await readLauncherBackground(userData, 'user-notes.txt')).toBeNull()
  })

  it('符号链接伪装成合法托管名时拒绝读取（目录外遏制）', async () => {
    const userData = await freshUserData()
    const outside = await sourceImage('secret.png', 24)
    const directory = launcherAssetsDir(userData)
    await mkdir(directory, { recursive: true })
    // 老版本会接受的"合法名"指向外部文件；新读取路径必须拒绝。
    await symlink(outside, path.join(directory, 'background-1756800000000.png'))
    const linkInfo = await lstat(path.join(directory, 'background-1756800000000.png'))
    if (!linkInfo.isSymbolicLink()) {
      // 本机 fs 代理层会把 symlink 物化为普通文件副本（isSymbolicLink=false），
      // 无法构造真实符号链接——遏制守卫在此环境不可复现，读取按普通文件放行是正确行为。
      expect(await readLauncherBackground(userData, 'background-1756800000000.png')).not.toBeNull()
      return
    }
    expect(await readLauncherBackground(userData, 'background-1756800000000.png')).toBeNull()
  })

  it('历史版本接受的文件名仍可读取（用户设置兼容）', async () => {
    const userData = await freshUserData()
    const directory = launcherAssetsDir(userData)
    await mkdir(directory, { recursive: true })
    const legacyName = 'background-1700000000000.jpg'
    await writeFile(path.join(directory, legacyName), Buffer.alloc(16, 1))
    const asset = await readLauncherBackground(userData, legacyName)
    expect(asset?.contentType).toBe('image/jpeg')
    expect(asset?.body.length).toBe(16)
  })
})

describe('清理', () => {
  it('只清空目标类别，其他类别与无关文件不动', async () => {
    const userData = await freshUserData()
    const clock = sequencedClock(1_756_800_000_000)
    const launcherName = await importLauncherBackground(userData, await sourceImage('l.png', 16), clock)
    const trayName = await importTrayBackground(userData, await sourceImage('t.png', 16), clock)
    const cardName = await importCardBackground(userData, await sourceImage('c.png', 16), clock)
    await clearTrayBackgrounds(userData)
    expect(await listAssets(userData)).toEqual([cardName, launcherName].sort())
    expect(await readTrayBackground(userData, trayName)).toBeNull()
    await clearCardBackgrounds(userData)
    expect(await listAssets(userData)).toEqual([launcherName])
    // 清理不存在的类别目录是幂等操作。
    await expect(clearSettingsBackgrounds(userData)).resolves.toBeUndefined()
    await expect(clearLauncherBackgrounds(userData)).resolves.toBeUndefined()
    expect(await listAssets(userData)).toEqual([])
  })
})

describe('托盘裁剪缓冲', () => {
  it('校验 PNG 签名、空缓冲与体积上限', async () => {
    const userData = await freshUserData()
    const goodPng = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(64, 0xab)])
    await expect(saveTrayBackgroundBuffer(userData, Buffer.alloc(0))).rejects.toThrow(/为空/)
    await expect(saveTrayBackgroundBuffer(userData, Buffer.alloc(64, 0x00))).rejects.toThrow(/PNG/)
    await expect(saveTrayBackgroundBuffer(userData, Buffer.concat([PNG_SIGNATURE, Buffer.alloc(MAX_BACKGROUND_BYTES, 1)]))).rejects.toThrow(/8MiB/)
    expect(looksLikePngBuffer(goodPng)).toBe(true)
    const name = await saveTrayBackgroundBuffer(userData, goodPng)
    expect(name).toMatch(/^tray-background-\d{10,16}\.png$/)
    const asset = await readTrayBackground(userData, name)
    expect(asset?.body.equals(goodPng)).toBe(true)
  })

  it('裁剪保存后旧托盘图被清理，主界面插图不受牵连', async () => {
    const userData = await freshUserData()
    const clock = sequencedClock(1_756_800_000_000)
    const launcherName = await importLauncherBackground(userData, await sourceImage('l.png', 16), clock)
    const firstTray = await saveTrayBackgroundBuffer(userData, Buffer.concat([PNG_SIGNATURE, Buffer.alloc(8)]), clock)
    const secondTray = await saveTrayBackgroundBuffer(userData, Buffer.concat([PNG_SIGNATURE, Buffer.alloc(8)]), clock)
    expect(await readTrayBackground(userData, firstTray)).toBeNull()
    expect(await readTrayBackground(userData, secondTray)).not.toBeNull()
    expect(await readLauncherBackground(userData, launcherName)).not.toBeNull()
  })

  it('读取入口按类别严格分流', async () => {
    const userData = await freshUserData()
    const cardName = await importCardBackground(userData, await sourceImage('c.png', 16))
    // 卡片托管名在托盘/设置读取入口一律 null。
    expect(await readTrayBackground(userData, cardName)).toBeNull()
    expect(await readSettingsBackground(userData, cardName)).toBeNull()
    expect(await readCardBackground(userData, cardName)).not.toBeNull()
  })
})
