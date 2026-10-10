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

/**
 * 界面文本的两个微型纯函数：错误文案提取与 Token 数量缩写。
 * 均为无状态纯函数，时间相关的格式化一律由调用方注入（本文件不依赖 Date）。
 */

/** 从任意抛出物中取出可展示的文本：Error 取 message，其余走 String()。 */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

const TOKEN_ABBREV_TIERS = [
  { threshold: 1_000_000, unit: 'M' },
  { threshold: 1_000, unit: 'k' },
] as const

/**
 * Token 数量 → 紧凑缩写。
 * 规则：非有限或非正 → '0'；≥1M → 一位小数 + M；≥1k → 一位小数 + k；其余四舍五入取整。
 */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  for (const tier of TOKEN_ABBREV_TIERS) {
    if (value >= tier.threshold) return `${(value / tier.threshold).toFixed(1)}${tier.unit}`
  }
  return String(Math.round(value))
}
