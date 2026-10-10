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
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * 读取软件内置许可证文本（设置-关于-开源协议页展示）。
 * 纯函数、无 electron 依赖，便于单元测试；IPC 注册在 main.ts。
 * 路径固定为 <licensesRoot>/GPL-3.0.txt，只读，不暴露目录遍历能力。
 */

export const LICENSE_FILE = 'GPL-3.0.txt'
export const THIRD_PARTY_FILE = 'THIRD_PARTY_NOTICES.md'

export async function readLicenseText(root: string): Promise<string | null> {
  try {
    return await readFile(path.join(root, LICENSE_FILE), 'utf8')
  } catch {
    return null
  }
}

/** 读取第三方组件声明（markdown，随软件分发），供关于页弹窗渲染。 */
export async function readThirdPartyNotices(root: string): Promise<string | null> {
  try {
    return await readFile(path.join(root, THIRD_PARTY_FILE), 'utf8')
  } catch {
    return null
  }
}
