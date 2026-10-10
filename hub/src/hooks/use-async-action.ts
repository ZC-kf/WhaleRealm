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

import { useCallback, useRef, useState } from 'react'
import { errorText } from '../lib/format'
import type { ToastState } from './use-toast'

/**
 * 异步动作执行器：把「置忙 → 执行 → 成功提示 / 失败提示 → 解忙」收敛为一处。
 *
 * busy 槽保存"当前占用者"的动作标识，组件据此只禁用相关按钮而非整个界面。
 * 并发语义：动作 A 执行中再起动作 B 时，B 接管忙碌槽；每个执行持有递增令牌，
 * 只有当前占用者才能在结束时清空忙碌槽——先完成的 A 不会误清 B 的忙碌状态，
 * 后结束者负责收尾（后到优先，与用户感知的"最后一次点击"一致）。
 */

/** 全局动作的忙碌标识；插件级动作直接用包名。 */
export const BUSY = {
  runtime: 'runtime',
  dshInstall: 'dsh-install',
  settings: 'settings',
  credential: 'credential',
  reorder: 'reorder',
} as const

export interface RunOptions<T> {
  /** 成功提示文案，可按执行结果动态生成。 */
  success?: string | ((result: T) => string)
  /** 自定义失败处理；缺省弹默认错误提示。 */
  onError?: (error: unknown) => void
}

export function useAsyncAction(showToast: (toast: ToastState) => void) {
  const [busy, setBusy] = useState<string | null>(null)
  const occupantRef = useRef(0)

  const run = useCallback(async <T>(
    key: string,
    action: () => Promise<T>,
    options: RunOptions<T> = {},
  ): Promise<T | undefined> => {
    occupantRef.current += 1
    const occupant = occupantRef.current
    setBusy(key)
    try {
      const result = await action()
      const success = options.success
      if (success !== undefined) {
        showToast({
          kind: 'success',
          message: typeof success === 'function' ? success(result) : success,
        })
      }
      return result
    } catch (error) {
      if (options.onError) options.onError(error)
      else showToast({ kind: 'error', message: errorText(error) })
      return undefined
    } finally {
      // 只有仍持有忙碌槽的动作才允许清空它。
      if (occupant === occupantRef.current) setBusy(null)
    }
  }, [showToast])

  return { busy, run }
}
