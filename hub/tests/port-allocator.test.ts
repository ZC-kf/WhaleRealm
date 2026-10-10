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
import { allocateLoopbackPort } from '../electron/port-allocator'

describe('loopback port allocator', () => {
  it('skips reserved and unavailable ports', async () => {
    const port = await allocateLoopbackPort(19391, new Set([19391, 19392]), async candidate => candidate === 19393)
    expect(port).toBe(19393)
  })

  it('rejects invalid preferences', async () => {
    await expect(allocateLoopbackPort(0, new Set(), async () => true)).rejects.toThrow()
  })
})
