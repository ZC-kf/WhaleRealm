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

import { copyFile, lstat, mkdir, readdir, rm, stat, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * 用户自定义插图的托管存储。
 *
 * 四类插图（主界面 / 托盘 / 实例卡片 / 设置界面）共用 userData/launcher-assets
 * 一个目录，靠文件名前缀区分类别；每类只清理本类前缀的旧文件，互不影响，
 * 用户数据和无关文件永不触碰。托管文件名 = 类别前缀 + 10~16 位时间戳 +
 * 小写白名单扩展名，天然防碰撞、换图即破缓存。
 *
 * 读取侧（launcher-asset:// 协议）只接受与类别前缀完全匹配的 basename：
 * 拒绝路径分隔符、上级目录写法与未知扩展名，并通过 lstat 拒绝符号链接 /
 * 目录接替（junction），防止借合法文件名读取存储目录之外的任意文件。
 *
 * 兼容性承诺：历史版本已接受的托管文件名（同一组前缀与时间戳规则）至今
 * 仍全部可读——用户设置里保存的旧文件名不受本轮代码更替影响。
 */

export const LAUNCHER_ASSETS_DIRNAME = 'launcher-assets'
export const MAX_BACKGROUND_BYTES = 8 * 1024 * 1024

/** 四类插图的前缀表。launcher 类沿用历史前缀 background-（设置兼容，不改动）。 */
const CATEGORY_PREFIXES = {
  launcher: 'background-',
  tray: 'tray-background-',
  card: 'card-background-',
  settings: 'settings-background-',
} as const

export type AssetCategory = keyof typeof CATEGORY_PREFIXES

/** 白名单扩展名 → MIME 类型；扩展名一律以小写比对。 */
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

/** PNG 文件签名（前 8 字节）。 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function launcherAssetsDir(userData: string): string {
  return path.join(userData, LAUNCHER_ASSETS_DIRNAME)
}

/**
 * 目录级写操作互斥队列：同一托管目录上的导入/清理/裁剪保存串行执行。
 * 快照-写入-清理的事务语义只在串行下严密成立——没有它，并发导入会
 * 把对方刚落盘的文件当成"旧图"清掉，或因快照时序交错留下双份文件。
 */
const directoryWriteQueues = new Map<string, Promise<unknown>>()

async function serializedWrite<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  const previous = directoryWriteQueues.get(directory) ?? Promise.resolve()
  const chained = previous.catch(() => undefined).then(operation)
  directoryWriteQueues.set(directory, chained)
  try {
    return await chained
  } finally {
    if (directoryWriteQueues.get(directory) === chained) directoryWriteQueues.delete(directory)
  }
}

/** 本类别的托管文件名模式：前缀 + 10~16 位时间戳 + 白名单扩展名。 */
function managedNamePattern(category: AssetCategory): RegExp {
  const escapedPrefix = CATEGORY_PREFIXES[category].replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
  return new RegExp(`^${escapedPrefix}\\d{10,16}\\.(png|jpg|jpeg|webp)$`)
}

/**
 * 校验托管文件名是否属于指定类别：只允许纯 basename，显式拒绝路径分隔符、
 * 上级目录写法与不满足模式的名字。返回原样名字或 null。
 */
export function isValidManagedAssetName(category: AssetCategory, rawName: string): string | null {
  if (typeof rawName !== 'string') return null
  if (rawName.includes('/') || rawName.includes('\\') || rawName.includes('..')) return null
  return managedNamePattern(category).test(rawName) ? rawName : null
}

export function contentTypeForLauncherAsset(name: string): string | null {
  return IMAGE_MIME_BY_EXTENSION[path.extname(name).toLowerCase()] ?? null
}

/** 为一次导入选择不与现存文件冲突的托管名：时间戳被占用则逐位递增。 */
async function allocateManagedName(
  category: AssetCategory,
  directory: string,
  extension: string,
  clock: () => number,
): Promise<string> {
  const prefix = CATEGORY_PREFIXES[category]
  let stamp = clock()
  for (;;) {
    const candidate = `${prefix}${stamp}${extension}`
    try {
      await stat(path.join(directory, candidate))
    } catch {
      return candidate
    }
    stamp += 1
  }
}

/** 读目录清单；目录尚不存在返回空清单。 */
async function readDirectorySnapshot(directory: string): Promise<string[]> {
  try {
    return await readdir(directory)
  } catch {
    return []
  }
}

/** 从候选清单里删除本类别托管文件（可保留 keep）；单个删除失败不阻塞其余。 */
async function removeEntries(category: AssetCategory, directory: string, entries: string[], keep: string | null): Promise<void> {
  const pattern = managedNamePattern(category)
  const victims = entries.filter(entry => pattern.test(entry) && entry !== keep)
  await Promise.all(victims.map(entry => rm(path.join(directory, entry), { force: true }).catch(() => undefined)))
}

/**
 * 通用导入：校验来源（白名单扩展名、非空、不超 8MiB）→ 目录锁内执行
 * 「目录快照 → 复制新文件（失败即回滚半成品）→ 只清理快照里就存在的本类旧文件」。
 *
 * 快照 + 串行的组合语义：锁内每个操作看到的都是稳定的目录状态，并发调用
 * 自动排队，每个调用方拿到的托管名在返回时刻都真实存在；后到的导入按
 * 「换图即替换」清掉前一张。clock 仅测试注入用，生产恒为 Date.now。
 */
export async function importManagedAsset(
  category: AssetCategory,
  userData: string,
  sourcePath: string,
  clock: () => number = Date.now,
): Promise<string> {
  const extension = path.extname(sourcePath).toLowerCase()
  if (!(extension in IMAGE_MIME_BY_EXTENSION)) {
    throw new Error('不支持的图片格式：仅接受 PNG / JPG / WebP。')
  }
  const source = await stat(sourcePath)
  if (source.size === 0) throw new Error('图片文件为空，无法导入。')
  if (source.size > MAX_BACKGROUND_BYTES) throw new Error('图片超过 8MiB 上限，请先压缩。')

  const directory = launcherAssetsDir(userData)
  return serializedWrite(directory, async () => {
    await mkdir(directory, { recursive: true })
    const snapshot = await readDirectorySnapshot(directory)
    const name = await allocateManagedName(category, directory, extension, clock)
    const target = path.join(directory, name)
    try {
      await copyFile(sourcePath, target)
    } catch (error) {
      // 回滚半成品，不留无主文件；回滚自身失败不掩盖原始错误。
      await rm(target, { force: true }).catch(() => undefined)
      throw error
    }
    await removeEntries(category, directory, snapshot, name)
    return name
  })
}

/** 通用清理：锁内删除该类别在快照时刻的全部托管文件（恢复默认）。 */
export async function clearManagedAssets(category: AssetCategory, userData: string): Promise<void> {
  const directory = launcherAssetsDir(userData)
  await serializedWrite(directory, async () => {
    await removeEntries(category, directory, await readDirectorySnapshot(directory), null)
  })
}

/**
 * 通用读取：只接受本类别合法 basename，且必须是存储目录下的真实普通文件
 * （lstat 拒绝符号链接/目录），否则返回 null。
 */
export async function readManagedAsset(
  category: AssetCategory,
  userData: string,
  rawName: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  const name = isValidManagedAssetName(category, rawName)
  if (!name) return null
  const contentType = contentTypeForLauncherAsset(name)
  if (!contentType) return null
  const filePath = path.join(launcherAssetsDir(userData), name)
  try {
    const info = await lstat(filePath)
    if (!info.isFile()) return null
    return { body: await readFile(filePath), contentType }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 四个类别的具名门面：ipc.ts 与协议处理器按类别调用，行为与通用实现一致。
// ---------------------------------------------------------------------------

export function importLauncherBackground(userData: string, sourcePath: string, clock?: () => number): Promise<string> {
  return importManagedAsset('launcher', userData, sourcePath, clock)
}

export function importTrayBackground(userData: string, sourcePath: string, clock?: () => number): Promise<string> {
  return importManagedAsset('tray', userData, sourcePath, clock)
}

export function importCardBackground(userData: string, sourcePath: string, clock?: () => number): Promise<string> {
  return importManagedAsset('card', userData, sourcePath, clock)
}

export function importSettingsBackground(userData: string, sourcePath: string, clock?: () => number): Promise<string> {
  return importManagedAsset('settings', userData, sourcePath, clock)
}

export function clearLauncherBackgrounds(userData: string): Promise<void> {
  return clearManagedAssets('launcher', userData)
}

export function clearTrayBackgrounds(userData: string): Promise<void> {
  return clearManagedAssets('tray', userData)
}

export function clearCardBackgrounds(userData: string): Promise<void> {
  return clearManagedAssets('card', userData)
}

export function clearSettingsBackgrounds(userData: string): Promise<void> {
  return clearManagedAssets('settings', userData)
}

export function readLauncherBackground(userData: string, rawName: string) {
  return readManagedAsset('launcher', userData, rawName)
}

export function readTrayBackground(userData: string, rawName: string) {
  return readManagedAsset('tray', userData, rawName)
}

export function readCardBackground(userData: string, rawName: string) {
  return readManagedAsset('card', userData, rawName)
}

export function readSettingsBackground(userData: string, rawName: string) {
  return readManagedAsset('settings', userData, rawName)
}

// ---------------------------------------------------------------------------
// 托盘裁剪缓冲：渲染层裁剪后回传的 PNG 字节，直接落盘。
// 与文件导入同一套上限与安全规则，另加 PNG 签名校验（内容写入校验）。
// ---------------------------------------------------------------------------

/** 缓冲区是否带 PNG 文件签名。 */
export function looksLikePngBuffer(buffer: Buffer): boolean {
  return buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
}

export async function saveTrayBackgroundBuffer(userData: string, buffer: Buffer, clock: () => number = Date.now): Promise<string> {
  if (buffer.length === 0) throw new Error('裁剪结果为空。')
  if (buffer.length > MAX_BACKGROUND_BYTES) throw new Error('裁剪结果超过 8MiB 上限。')
  if (!looksLikePngBuffer(buffer)) throw new Error('裁剪结果不是有效的 PNG 数据。')

  const directory = launcherAssetsDir(userData)
  return serializedWrite(directory, async () => {
    await mkdir(directory, { recursive: true })
    const snapshot = await readDirectorySnapshot(directory)
    const name = await allocateManagedName('tray', directory, '.png', clock)
    const target = path.join(directory, name)
    try {
      await writeFile(target, buffer)
    } catch (error) {
      await rm(target, { force: true }).catch(() => undefined)
      throw error
    }
    await removeEntries('tray', directory, snapshot, name)
    return name
  })
}
