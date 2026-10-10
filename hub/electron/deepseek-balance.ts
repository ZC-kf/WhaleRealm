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

import type { DeepSeekBalanceInfo, DeepSeekBalanceResult } from '../src/types'

const BALANCE_URL = 'https://api.deepseek.com/user/balance'

function toNumber(value: string | undefined | null): number | null {
  if (value === undefined || value === null) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/** 查询 DeepSeek 官方账户余额（Bearer 鉴权）。 */
export async function readDeepSeekBalance(apiKey: string, fetchImpl: typeof fetch): Promise<DeepSeekBalanceResult> {
  try {
    const response = await fetchImpl(BALANCE_URL, { headers: { Authorization: `Bearer ${apiKey}` } })
    if (response.status === 401) return { status: 'no-key' }
    if (!response.ok) return { status: 'error', message: `余额查询失败（HTTP ${response.status}）` }
    const data = await response.json() as {
      is_available?: boolean
      balance_infos?: Array<{ currency?: string; total_balance?: string; granted_balance?: string; topped_up_balance?: string }>
    }
    const infos: DeepSeekBalanceInfo[] = (data.balance_infos ?? []).map(info => ({
      currency: info.currency ?? 'CNY',
      totalBalance: toNumber(info.total_balance),
      grantedBalance: toNumber(info.granted_balance),
      toppedUpBalance: toNumber(info.topped_up_balance),
    }))
    return { status: 'ok', balance: { isAvailable: data.is_available !== false, infos } }
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : '余额查询失败' }
  }
}

/** 60 秒内存缓存 + in-flight 去重。 */
export interface DeepSeekBalanceService { get(force?: boolean): Promise<DeepSeekBalanceResult> }

export function createDeepSeekBalanceService(deps: { fetchImpl: typeof fetch; readApiKey: () => Promise<string | null>; cacheMs?: number }): DeepSeekBalanceService {
  const cacheMs = deps.cacheMs ?? 60_000
  let cached: { at: number; result: DeepSeekBalanceResult } | null = null
  let inflight: Promise<DeepSeekBalanceResult> | null = null
  return {
    async get(force = false): Promise<DeepSeekBalanceResult> {
      if (!force && cached && Date.now() - cached.at < cacheMs) return cached.result
      if (inflight) return inflight
      inflight = (async () => {
        try {
          const apiKey = await deps.readApiKey()
          if (!apiKey) return { status: 'no-key' as const }
          const result = await readDeepSeekBalance(apiKey, deps.fetchImpl)
          cached = { at: Date.now(), result }
          return result
        } finally {
          inflight = null
        }
      })()
      return inflight
    },
  }
}
