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
import { trashShortcuts } from '../electron/desktop-shortcut'

describe('trashShortcuts', () => {
  it('moves shortcuts to recycle bin and skips individual failures', async () => {
    const moved: string[] = []
    const trash = async (p: string) => {
      if (p.includes('fail')) throw new Error('locked')
      moved.push(p)
    }
    const done = await trashShortcuts(['C:/ok-a.lnk', 'C:/fail.lnk', 'C:/ok-b.lnk'], trash)
    expect(done).toEqual(['C:/ok-a.lnk', 'C:/ok-b.lnk'])
    expect(moved).toEqual(['C:/ok-a.lnk', 'C:/ok-b.lnk'])
  })
})
