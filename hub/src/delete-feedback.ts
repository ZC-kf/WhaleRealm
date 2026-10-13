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

import type { TranslationKey } from './i18n/translations/zh-CN'

/** App 层动作失败时的提示反馈（主窗口与托盘共用同一口径）。 */
export interface ActionFailureFeedback {
  /** 失败是否为「旧版/共享实例缺少所有权证明」导致的主进程 fail-closed 拒绝。 */
  ownershipBlocked: boolean
  /** 面向用户的本地化提示文案。 */
  message: string
}

/** 所有权校验失败时主进程抛出的错误片段（见 electron/instance-ownership.ts）。 */
const OWNERSHIP_BLOCKED_PATTERN = /ownership cannot be verified/i

/** 语言感知的翻译函数签名。 */
type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string

/**
 * 把动作失败的原因转换为给用户的提示。
 *
 * 主进程在 `purge` 分支对无法验证所有权的旧版/共享实例 fail-closed 拒绝
 * （文件保留），抛出以 `Instance ownership cannot be verified` 开头的错误。
 * 这类失败需要专门的引导文案——提示改用「仅移除注册」并说明文件会保留——
 * 而不是笼统的失败文案，否则用户会误以为操作无声失效。所有权分支与调用者的
 * `fallbackKey` 无关（只有删除会触发），因此主窗口与托盘共用同一实现。
 *
 * @param error 捕获到的错误。IPC 拒绝时消息会带有 `Error invoking…` 前缀，
 *   因此使用子串匹配而非全等比较。
 * @param t 语言感知的翻译函数。
 * @param fallbackKey 非所有权失败时的兜底文案键（默认删除失败）。
 * @returns 是否命中所有权拒绝，以及应当展示的提示文案。
 */
export function describeActionFailure(error: unknown, t: Translate, fallbackKey: TranslationKey = 'toast.deleteFailed'): ActionFailureFeedback {
  const reason = error instanceof Error ? error.message : String(error ?? '')
  if (OWNERSHIP_BLOCKED_PATTERN.test(reason)) {
    return { ownershipBlocked: true, message: t('toast.deleteOwnershipBlocked') }
  }
  const fallback = t(fallbackKey)
  // 无附加原因、或原因与兜底文案重复时，避免出现「<兜底>：<兜底>」。
  const message = reason && reason !== fallback ? `${fallback}：${reason}` : fallback
  return { ownershipBlocked: false, message }
}

/** 删除实例失败的提示（主窗口 App 层使用，等同兜底键为「删除失败」）。 */
export function describeDeleteFailure(error: unknown, t: Translate): ActionFailureFeedback {
  return describeActionFailure(error, t, 'toast.deleteFailed')
}
