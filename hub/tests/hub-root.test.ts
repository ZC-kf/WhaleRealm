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

import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readPersistedHubRoot, persistHubRoot, defaultHubRoot, resolveHubRoot } from '../electron/hub-root'

/**
 * 数据根解析合同：
 * - 环境变量最优先（开发/便携显式指定）；
 * - 已持久化的 root 永远原样保留（老用户不迁移）；
 * - 打包态新机（无 D 盘、无历史值）落到系统盘用户目录的稳定可写位置；
 * - 开发态回退 cwd/..。
 */

function tempDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix))
}

describe('hub-root 解析', () => {
  it('环境变量最优先：非空 DSH_HUB_ROOT 原样解析为绝对路径', () => {
    const userData = tempDir('hubroot-env-')
    try {
      const result = resolveHubRoot(userData, { env: 'D:\\custom\\root', packaged: true })
      expect(result).toEqual({ hubRoot: 'D:\\custom\\root', source: 'env' })
      // 空白环境变量视为未设置。
      expect(resolveHubRoot(userData, { env: '   ', packaged: true }).source).toBe('default')
    } finally { rmSync(userData, { recursive: true, force: true }) }
  })

  it('持久化 root 原样保留：老用户的现有数据根不迁移', () => {
    const userData = tempDir('hubroot-old-')
    const oldRoot = tempDir('hubroot-oldroot-')
    try {
      persistHubRoot(userData, oldRoot)
      expect(readPersistedHubRoot(userData)).toBe(oldRoot)
      // 即使是打包态、即使 LOCALAPPDATA 存在，持久化值仍然优先。
      const result = resolveHubRoot(userData, { packaged: true, localAppData: 'C:\\Users\\u\\AppData\\Local' })
      expect(result).toEqual({ hubRoot: oldRoot, source: 'persisted' })
      // 持久化根下面的数据文件不被解析过程触碰。
      const marker = path.join(oldRoot, 'instances', 'keep.txt')
      mkdirSync(path.dirname(marker), { recursive: true })
      writeFileSync(marker, 'keep')
      resolveHubRoot(userData, { packaged: true })
      expect(existsSync(marker)).toBe(true)
    } finally {
      rmSync(userData, { recursive: true, force: true })
      rmSync(oldRoot, { recursive: true, force: true })
    }
  })

  it('打包态新机默认根：LOCALAPPDATA/WhaleRealm（系统盘用户目录，稳定可写）', () => {
    const userData = tempDir('hubroot-new-')
    try {
      const localAppData = path.join(userData, 'AppData', 'Local')
      const result = resolveHubRoot(userData, { packaged: true, localAppData })
      expect(result.source).toBe('default')
      expect(result.hubRoot).toBe(path.join(localAppData, 'WhaleRealm'))
      expect(result.hubRoot.startsWith(userData)).toBe(true) // 在用户目录内，与安装目录无关
      // 无 LOCALAPPDATA（极端环境）退回 userData/hub，仍可写。
      const fallback = resolveHubRoot(userData, { packaged: true, localAppData: '' })
      expect(fallback).toEqual({ hubRoot: path.join(userData, 'hub'), source: 'default' })
    } finally { rmSync(userData, { recursive: true, force: true }) }
  })

  it('开发态回退 cwd/..（仓库根）', () => {
    const userData = tempDir('hubroot-dev-')
    try {
      const result = resolveHubRoot(userData, { packaged: false, cwd: 'D:\\repo\\hub' })
      expect(result).toEqual({ hubRoot: 'D:\\repo', source: 'dev-cwd' })
    } finally { rmSync(userData, { recursive: true, force: true }) }
  })

  it('defaultHubRoot 独立可测且拒绝空白 LOCALAPPDATA', () => {
    expect(defaultHubRoot('C:\\ud', 'C:\\Users\\u\\AppData\\Local')).toBe('C:\\Users\\u\\AppData\\Local\\WhaleRealm')
    expect(defaultHubRoot('C:\\ud', undefined)).toBe('C:\\ud\\hub')
    expect(defaultHubRoot('C:\\ud', '  ')).toBe('C:\\ud\\hub')
  })

  it('未持久化时 readPersistedHubRoot 返回 null（目录缺失不报错）', () => {
    expect(readPersistedHubRoot(path.join(tmpdir(), 'hubroot-missing-' + Date.now()))).toBeNull()
  })
})
