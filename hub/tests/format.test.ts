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
import { errorText, formatTokens } from '../src/lib/format'

describe('errorText', () => {
  it('提取 Error 的 message 字段', () => {
    expect(errorText(new Error('实例启动失败'))).toBe('实例启动失败')
  })

  it('非 Error 值一律字符串化', () => {
    expect(errorText('端口被占用')).toBe('端口被占用')
    expect(errorText(19430)).toBe('19430')
    expect(errorText(undefined)).toBe('undefined')
    expect(errorText({ toString: () => 'custom' } as unknown)).toBe('custom')
  })
})

describe('formatTokens', () => {
  it('非有限值与非正数一律为 0', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(-42)).toBe('0')
    expect(formatTokens(Number.NaN)).toBe('0')
    expect(formatTokens(Number.POSITIVE_INFINITY)).toBe('0')
  })

  it('千位以下四舍五入取整', () => {
    expect(formatTokens(1)).toBe('1')
    expect(formatTokens(649)).toBe('649')
    expect(formatTokens(649.6)).toBe('650')
  })

  it('千位起一位小数加 k 后缀', () => {
    expect(formatTokens(1_000)).toBe('1.0k')
    expect(formatTokens(18_400)).toBe('18.4k')
    expect(formatTokens(999_999)).toBe('1000.0k')
  })

  it('百万位起一位小数加 M 后缀', () => {
    expect(formatTokens(1_000_000)).toBe('1.0M')
    expect(formatTokens(2_340_000)).toBe('2.3M')
    expect(formatTokens(1_280_000_000)).toBe('1280.0M')
  })
})
