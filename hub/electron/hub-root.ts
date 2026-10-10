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

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 数据根（hubRoot）解析 —— 独立模块以便测试。
 *
 * 优先级（只对"从未确定过 root"的新装生效，已持久化的 root 永远保留不迁移）：
 * 1. DSH_HUB_ROOT 环境变量（开发 / 便携场景显式指定）
 * 2. userData/hub-root.txt 里持久化的历史值（老用户现有 root 原样保留）
 * 3. 打包态默认值：LOCALAPPDATA/WhaleRealm（系统盘用户目录，任何新机都存在且可写；
 *    无 LOCALAPPDATA 时退回 userData/hub）
 * 4. 开发态回退：cwd/..（仓库根）
 */

export interface HubRootOptions {
  /** 打包态（app.isPackaged）；决定无历史值时用哪个默认位置。 */
  packaged?: boolean
  /** 注入的环境变量值（缺省读 process.env.DSH_HUB_ROOT）。 */
  env?: string | undefined
  /** 注入的 cwd（缺省 process.cwd()）。 */
  cwd?: string
  /** 注入的 LOCALAPPDATA（缺省 process.env.LOCALAPPDATA）。 */
  localAppData?: string | undefined
}

export type HubRootSource = 'env' | 'persisted' | 'default' | 'dev-cwd'

export interface HubRootResolution {
  hubRoot: string
  source: HubRootSource
}

/** 读取持久化的历史 root；不存在或为空返回 null（读取失败同样视为未持久化）。 */
export function readPersistedHubRoot(userData: string): string | null {
  try {
    const persisted = readFileSync(path.join(userData, 'hub-root.txt'), 'utf8').trim()
    return persisted.length > 0 ? persisted : null
  } catch {
    return null
  }
}

/** 把解析结果写回 userData/hub-root.txt（失败不影响启动）。 */
export function persistHubRoot(userData: string, hubRoot: string): void {
  try {
    writeFileSync(path.join(userData, 'hub-root.txt'), `${hubRoot}\n`, 'utf8')
  } catch { /* 持久化失败不影响启动 */ }
}

/**
 * 打包态默认数据根：LOCALAPPDATA/WhaleRealm。
 * 选 LOCALAPPDATA 而非 Roaming：hub root 含 instances/runtimes 等大文件，
 * 按 Windows 约定这类数据放本地应用数据目录；调用方注入的 localAppData 为
 * 空/缺失（非 Windows 或极简环境）时退回 Electron userData 下。
 * 纯函数：不读环境变量，注入 undefined 即视为没有。
 */
export function defaultHubRoot(userData: string, localAppData: string | undefined): string {
  if (localAppData && localAppData.trim()) return path.join(path.resolve(localAppData), 'WhaleRealm')
  return path.join(userData, 'hub')
}

/** 解析 hub 数据根。规则见模块注释；只读，不做任何写动作。 */
export function resolveHubRoot(userData: string, options: HubRootOptions = {}): HubRootResolution {
  const env = options.env !== undefined ? options.env : process.env.DSH_HUB_ROOT
  if (env && env.trim()) return { hubRoot: path.resolve(env), source: 'env' }
  const persisted = readPersistedHubRoot(userData)
  if (persisted) return { hubRoot: path.resolve(persisted), source: 'persisted' }
  if (options.packaged) {
    const localAppData = options.localAppData !== undefined ? options.localAppData : process.env.LOCALAPPDATA
    return { hubRoot: defaultHubRoot(userData, localAppData), source: 'default' }
  }
  return { hubRoot: path.resolve(options.cwd ?? process.cwd(), '..'), source: 'dev-cwd' }
}
