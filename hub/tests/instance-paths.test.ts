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
import path from 'node:path'
import { resolveInstancePaths, resolveInstanceRecord, resolveManagedLayout } from '../electron/instance-paths'

describe('instance path contract', () => {
  it('keeps the complete new layout under its selected root and preserves recorded legacy paths', () => {
    const root = path.resolve('new selected root')
    const layout = resolveManagedLayout(root)
    expect(layout.runtimeRoot).toBe(path.join(root, 'runtime'))
    expect(layout.dshHome).toBe(path.join(root, 'data', 'dsh-home'))
    expect(layout.cache).toBe(path.join(root, 'cache'))
    const current = resolveInstanceRecord('hub', 'new', { ...layout, layoutVersion: 2, adapterId: 'official-web' })
    expect(current.root).toBe(root)
    expect(current.runtimeRoot).toBe(path.join(root, 'runtime'))
    expect(current.adapterId).toBe('official-web')
    const legacy = resolveInstanceRecord('hub', 'old', { root: 'old-root', dshHome: 'old-home', workspace: 'old-work', electronUserData: 'old-profile', desktopProfile: 'old-desktop', logs: 'old-logs', skills: 'old-skills' })
    expect(legacy.root).toBe('old-root'); expect(legacy.dshHome).toBe('old-home'); expect(legacy.workspace).toBe('old-work')
    expect(legacy.electronUserData).toBe('old-profile'); expect(legacy.logs).toBe('old-logs')
    expect(legacy.skills).toBe('old-skills')
  })
  it('creates separate mutable roots below each instance id', () => {
    const a = resolveInstancePaths('D:\\Dsh-Hub-HIDM', 'stable')
    const b = resolveInstancePaths('D:\\Dsh-Hub-HIDM', 'beta')

    expect(a.dshHome).not.toBe(b.dshHome)
    expect(a.electronUserData).not.toBe(b.electronUserData)
    expect(a.desktopProfile).toBe(`${a.dshHome}\\profiles\\desktop`)
    expect(a.logs).not.toBe(b.logs)
    expect(a.dshHome.startsWith('D:\\Dsh-Hub-HIDM\\instances\\stable')).toBe(true)
  })

  it('rejects traversal and unsafe ids', () => {
    expect(() => resolveInstancePaths('D:\\Dsh-Hub-HIDM', '..\\escape')).toThrow()
    expect(() => resolveInstancePaths('D:\\Dsh-Hub-HIDM', 'bad/name')).toThrow()
  })

  it('preserves instanceKind through record resolution（类别字段不得被白名单丢弃）', () => {
    const record = resolveInstanceRecord('D:\\Dsh-Hub-HIDM', 'stable', { instanceKind: 'community-desktop' })
    expect(record.instanceKind).toBe('community-desktop')
    const none = resolveInstanceRecord('D:\\Dsh-Hub-HIDM', 'stable')
    expect(none.instanceKind).toBeUndefined()
  })
})
