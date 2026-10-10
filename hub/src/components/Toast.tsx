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

import type { CSSProperties } from 'react'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { TOAST_DURATION, TOAST_FADE_MS, type ToastState } from '../hooks/use-toast'

const LIFETIME_MS = TOAST_DURATION + TOAST_FADE_MS

/**
 * 顶部轻提示条。动画全程由 CSS 变量 --toast-lifetime 驱动（styles.css 的
 * toast-fade 关键帧），组件本身只负责结构与可选操作按钮；按钮触发后立刻关闭。
 */
export function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  const fireAction = () => {
    toast.action?.onClick()
    onClose()
  }
  return (
    <div
      className={`toast ${toast.kind}`}
      role="status"
      style={{ '--toast-lifetime': `${LIFETIME_MS}ms` } as CSSProperties}
    >
      {toast.kind === 'success'
        ? <CircleCheck size={18} aria-hidden />
        : <CircleAlert size={18} aria-hidden />}
      <span>{toast.message}</span>
      {toast.action && (
        <button type="button" className="toast-action" onClick={fireAction}>
          {toast.action.label}
        </button>
      )}
    </div>
  )
}
