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

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 扫描跳过清单：移除注册时，用户可让某运行体目录在一段时间内（或永久）
 * 不再被「扫描收录」命中；手动导入不受影响（importByPath 不查此清单）。
 *
 * 存于 hub-data/skipped-installs.json，每项一条：
 *   { path, permanent, until }  —— permanent=true 或 until > now 时视为活跃跳过。
 */

export interface SkipEntry {
  path: string
  permanent: boolean
  /** 过期时间戳（毫秒）；permanent 时为 null。 */
  until: number | null
}

function readEntries(filePath: string): SkipEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as SkipEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** 读取当前「活跃」的跳过路径（permanent 或尚未过期）。同步，供扫描时直接过滤。 */
export function readActiveSkipPaths(filePath: string): string[] {
  const now = Date.now()
  return readEntries(filePath)
    .filter(entry => entry.permanent || (entry.until !== null && entry.until > now))
    .map(entry => entry.path)
}

/** 追加/更新一条跳过记录（同路径覆盖）。 */
export async function addSkipEntry(filePath: string, entry: SkipEntry): Promise<void> {
  const current = readEntries(filePath)
  const next = current.filter(item => item.path.toLowerCase() !== entry.path.toLowerCase())
  next.push(entry)
  await mkdir(path.dirname(filePath), { recursive: true })
  const temp = `${filePath}.tmp`
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  try { await rename(filePath, `${filePath}.bak`) } catch { /* 首次写入无备份 */ }
  await rename(temp, filePath)
}

/** 重新读取文件内容（供测试与验证用）。 */
export function readSkipEntries(filePath: string): SkipEntry[] {
  return readEntries(filePath)
}
