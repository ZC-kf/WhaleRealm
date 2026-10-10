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

import { useCallback, useEffect, useRef, useState } from 'react'

export interface ToastState {
  kind: 'success' | 'error'
  message: string
  /** 可选的右侧操作按钮（如「移入回收站」）。 */
  action?: { label: string; onClick: () => void }
}

/** 提示可见时长（毫秒）。 */
export const TOAST_DURATION = 1500
/** 淡出动画时长（毫秒），计入总停留时间。 */
export const TOAST_FADE_MS = 200

/**
 * 单条轻提示状态机：同一时刻只保留一条，新提示替换旧提示并把计时拨回起点。
 *
 * 计时器回调按"代数"对账——只允许当前代清空提示。这样即便把同一个对象
 * 连续展示两次（错误重试场景常见），第一代的陈旧计时器也不会在第二代
 * 还在展示时把它清掉；组件卸载与手动关闭都会作废在途计时器。
 */
export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null)
  const timerRef = useRef<number | null>(null)
  const generationRef = useRef(0)

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const showToast = useCallback((next: ToastState) => {
    cancelTimer()
    generationRef.current += 1
    const generation = generationRef.current
    setToast(next)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      // 期间若已有新提示接管（代数变化），本计时器作废。
      if (generation !== generationRef.current) return
      setToast(null)
    }, TOAST_DURATION + TOAST_FADE_MS)
  }, [cancelTimer])

  const dismissToast = useCallback(() => {
    cancelTimer()
    generationRef.current += 1
    setToast(null)
  }, [cancelTimer])

  // 卸载时停掉在途计时器，避免对已卸载组件 setState。
  useEffect(() => cancelTimer, [cancelTimer])

  return { toast, showToast, dismissToast }
}
