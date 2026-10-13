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
import { describeActionFailure, describeDeleteFailure } from '../src/delete-feedback'
import { zhCN, type TranslationKey } from '../src/i18n/translations/zh-CN'

// 独立翻译函数（不依赖 React Provider），直接用简中基准字典。
const t = (key: TranslationKey, params?: Record<string, string | number>): string => {
  const template = zhCN[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => (params[name] === undefined ? `{${name}}` : String(params[name])))
}

describe('describeDeleteFailure', () => {
  it('所有权校验拒绝 → 命中 ownershipBlocked 并返回专用引导文案', () => {
    // 主进程抛错经 IPC 序列化后带 `Error invoking remote method…` 前缀。
    const error = new Error(
      "Error invoking remote method 'instances:delete': Error: Instance ownership cannot be verified; files preserved: missing instance.json",
    )
    const feedback = describeDeleteFailure(error, t)
    expect(feedback.ownershipBlocked).toBe(true)
    expect(feedback.message).toBe(zhCN['toast.deleteOwnershipBlocked'])
  })

  it('普通失败 → 附上原因，且不命中 ownershipBlocked', () => {
    const feedback = describeDeleteFailure(new Error('回收站能力不可用；实例文件保留'), t)
    expect(feedback.ownershipBlocked).toBe(false)
    expect(feedback.message).toBe(`删除失败：回收站能力不可用；实例文件保留`)
  })

  it('非 Error 值一律字符串化后附加', () => {
    expect(describeDeleteFailure('移入回收站失败', t).message).toBe('删除失败：移入回收站失败')
  })

  it('原因与兜底文案重复时不产生「删除失败：删除失败」', () => {
    const feedback = describeDeleteFailure(new Error(zhCN['toast.deleteFailed']), t)
    expect(feedback.ownershipBlocked).toBe(false)
    expect(feedback.message).toBe(zhCN['toast.deleteFailed'])
  })

  it('空/缺失原因时退化为兜底文案', () => {
    expect(describeDeleteFailure(undefined, t).message).toBe(zhCN['toast.deleteFailed'])
    expect(describeDeleteFailure('', t).message).toBe(zhCN['toast.deleteFailed'])
  })
})

describe('describeActionFailure（托盘等非删除动作共用）', () => {
  it('默认兜底键为「删除失败」', () => {
    expect(describeActionFailure(new Error('boom'), t).message).toBe('删除失败：boom')
  })

  it('可用自定义兜底键（托盘通用动作 → 操作失败）', () => {
    const feedback = describeActionFailure(new Error('端口被占用'), t, 'tray.actionFailed')
    expect(feedback.ownershipBlocked).toBe(false)
    expect(feedback.message).toBe('操作失败：端口被占用')
  })

  it('所有权拒绝优先于兜底键，始终给出专用引导', () => {
    const feedback = describeActionFailure(new Error('Instance ownership cannot be verified; files preserved'), t, 'tray.actionFailed')
    expect(feedback.ownershipBlocked).toBe(true)
    expect(feedback.message).toBe(zhCN['toast.deleteOwnershipBlocked'])
  })
})
