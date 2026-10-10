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

import { execSync } from 'node:child_process'
import path from 'node:path'

/**
 * 桌面快捷方式检测与删除。
 * 检测：只读地用 PowerShell WScript.Shell 解析当前用户桌面所有 .lnk 的 TargetPath，
 * 精确匹配实例运行体目录下的 DeepSeek Harness.exe / dsh-desktop.exe，绝不误删无关快捷方式。
 * 删除：由调用方注入 trash（Electron shell.trashItem）——移入回收站，可还原，不影响实例本体。
 */

const EXE_NAMES = ['DeepSeek Harness.exe', 'dsh-desktop.exe']

/** 找出指向指定运行体目录的桌面快捷方式（绝对路径数组）。 */
export function findDesktopShortcuts(runtimeRoot: string): string[] {
  const targets = EXE_NAMES.map(name => path.join(runtimeRoot, name).toLowerCase())
  const script = `$w=New-Object -ComObject WScript.Shell;Get-ChildItem ([Environment]::GetFolderPath('Desktop')) -Filter *.lnk | ForEach-Object { Write-Output ($_.FullName+'|'+$w.CreateShortcut($_.FullName).TargetPath) }`
  let out = ''
  try {
    out = execSync(`powershell.exe -NoProfile -Command ${JSON.stringify(script)}`, { encoding: 'utf8', windowsHide: true, timeout: 20000 })
  } catch {
    return []
  }
  const found: string[] = []
  for (const line of out.split(/\r?\n/)) {
    const idx = line.lastIndexOf('|')
    if (idx <= 0) continue
    const lnk = line.slice(0, idx).trim()
    const target = line.slice(idx + 1).trim()
    if (target && targets.includes(path.resolve(target).toLowerCase())) found.push(lnk)
  }
  return found
}

/** 把给定快捷方式移入回收站（可还原），返回成功移入的路径。 */
export async function trashShortcuts(paths: string[], trash: (p: string) => Promise<void>): Promise<string[]> {
  const done: string[] = []
  for (const p of paths) {
    try { await trash(p); done.push(p) } catch { /* 单个失败忽略 */ }
  }
  return done
}
