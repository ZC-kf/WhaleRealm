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
import { detectInstanceKind } from '../electron/instance-discovery'

describe('实例类别检测（detectInstanceKind）', () => {
  it('官方核心/网页形态 → official-web', () => {
    expect(detectInstanceKind({ exeName: 'DeepSeek Harness.exe', packageName: 'deepseek-harness', flavor: 'web' })).toBe('official-web')
    expect(detectInstanceKind({ exeName: 'DeepSeek Harness.exe', packageName: '@deepseek-ai/dsh-root', flavor: 'web' })).toBe('official-web')
    expect(detectInstanceKind({ exeName: 'DeepSeek Harness.exe', packageName: 'deepseek-harness-web', flavor: 'web' })).toBe('official-web')
  })

  it('官方桌面形态（官方命名 + desktop 关键词）→ official-desktop', () => {
    expect(detectInstanceKind({ exeName: 'DeepSeek Harness.exe', packageName: 'deepseek-harness-desktop', flavor: 'desktop' })).toBe('official-desktop')
    expect(detectInstanceKind({ exeName: 'DeepSeek Harness.exe', packageName: '@deepseek-ai/dsh-desktop', flavor: 'desktop' })).toBe('official-desktop')
  })

  it('社区桌面形态 → community-desktop', () => {
    expect(detectInstanceKind({ exeName: 'dsh-desktop.exe', packageName: '', flavor: 'desktop' })).toBe('community-desktop')
    expect(detectInstanceKind({ exeName: 'dsh-desktop.exe', packageName: 'dsh-tauri-desktop', flavor: 'desktop' })).toBe('community-desktop')
    // 局限：社区项目若与官方同包名（deepseek-harness-desktop），本地扫描会判为官方桌面；
    // 新建实例流程由下载来源精确写入类别，不走本地猜测。
    expect(detectInstanceKind({ exeName: 'DeepSeek Harness.exe', packageName: 'deepseek-harness-desktop', flavor: 'desktop' })).toBe('official-desktop')
  })

  it('仅有官方 exe 名时按 flavor 判定', () => {
    expect(detectInstanceKind({ exeName: 'DeepSeek Harness.exe', packageName: '', flavor: 'web' })).toBe('official-web')
    expect(detectInstanceKind({ exeName: 'DeepSeek Harness.exe', packageName: '', flavor: 'desktop' })).toBe('official-desktop')
  })

  it('无法判定 → null', () => {
    expect(detectInstanceKind({ exeName: '', packageName: '', flavor: 'unknown' })).toBe(null)
    expect(detectInstanceKind({ exeName: 'something-else.exe', packageName: '', flavor: 'unknown' })).toBe(null)
  })
})
