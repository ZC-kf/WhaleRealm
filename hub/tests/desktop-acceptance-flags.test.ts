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
import { ACCEPTANCE_CHROMIUM_FLAGS, acceptanceChromiumFlags } from '../electron/adapters/desktop'

const CANDIDATE = { WR_ACCEPTANCE_CANDIDATE: 'C:/builds/pending-manifest.json' }

describe('acceptance Chromium flags', () => {
  it('is inert while the acceptance channel is inactive', () => {
    // No candidate => production: whatever is requested is ignored.
    expect(acceptanceChromiumFlags({ WR_ACCEPTANCE_CHROMIUM_FLAGS: '--no-sandbox --disable-gpu' })).toEqual([])
    expect(acceptanceChromiumFlags({})).toEqual([])
    // Candidate active but flags unset => still nothing.
    expect(acceptanceChromiumFlags({ ...CANDIDATE })).toEqual([])
    expect(acceptanceChromiumFlags({ ...CANDIDATE, WR_ACCEPTANCE_CHROMIUM_FLAGS: '   ' })).toEqual([])
  })

  it('honors allowlisted tokens once the channel is active', () => {
    expect(acceptanceChromiumFlags({ ...CANDIDATE, WR_ACCEPTANCE_CHROMIUM_FLAGS: '--no-sandbox  --disable-gpu' })).toEqual(['--no-sandbox', '--disable-gpu'])
    expect(acceptanceChromiumFlags({ ...CANDIDATE, WR_ACCEPTANCE_CHROMIUM_FLAGS: ACCEPTANCE_CHROMIUM_FLAGS.join(' ') })).toEqual([...ACCEPTANCE_CHROMIUM_FLAGS])
    // Duplicates collapse; order is preserved; a fresh array is returned each call.
    const first = acceptanceChromiumFlags({ ...CANDIDATE, WR_ACCEPTANCE_CHROMIUM_FLAGS: '--disable-gpu --disable-gpu' })
    expect(first).toEqual(['--disable-gpu'])
    first.push('--no-sandbox')
    expect(acceptanceChromiumFlags({ ...CANDIDATE, WR_ACCEPTANCE_CHROMIUM_FLAGS: '--disable-gpu' })).toEqual(['--disable-gpu'])
  })

  it('rejects unknown or malformed tokens', () => {
    for (const flags of ['--no-sandbox --remote-debugging-port=9222', '--disable-gpu=1', '--no-sandbox;rm -rf /', '--user-data-dir=C:/x', '-no-sandbox', '--disable-GPU']) {
      expect(() => acceptanceChromiumFlags({ ...CANDIDATE, WR_ACCEPTANCE_CHROMIUM_FLAGS: flags }), flags).toThrow('非法验收 Chromium 参数')
    }
  })
})
