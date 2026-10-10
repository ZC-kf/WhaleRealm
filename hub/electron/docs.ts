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

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { isLanguageCode, type LanguageCode } from '../src/i18n/locales'

/**
 * 内置项目文档（设置-关于-项目文档）的读取核心。
 * 纯函数、无 electron 依赖，便于单元测试；IPC 注册在 main.ts。
 *
 * 目录约定：<docsRoot>/<语言代码>/<文档id>.md。
 * 读取回退链：请求语言 → en → zh-CN。
 */

/** 文档 id 白名单格式：小写字母/数字开头，只含小写字母、数字、连字符，最长 40。 */
const DOC_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/

export interface DocListResult {
  ok: boolean
  langs: LanguageCode[]
  ids: string[]
}

export interface DocReadResult {
  ok: boolean
  /** 实际命中语言（回退后）。 */
  lang: LanguageCode | null
  content: string | null
}

/** 列出 docs 根下所有语言目录与文档 id（并集，按 id 排序）。 */
export async function listDocs(root: string): Promise<DocListResult> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    const langs = entries
      .filter(entry => entry.isDirectory() && isLanguageCode(entry.name))
      .map(entry => entry.name as LanguageCode)
    const ids = new Set<string>()
    for (const lang of langs) {
      try {
        for (const file of await readdir(path.join(root, lang))) {
          if (file.endsWith('.md')) ids.add(file.slice(0, -3))
        }
      } catch { /* 单个语言目录读取失败不影响其他 */ }
    }
    return { ok: true, langs, ids: [...ids].sort() }
  } catch {
    return { ok: false, langs: [], ids: [] }
  }
}

/** 按回退链读取文档；id 或语言不合法时直接返回 ok:false，不抛错。 */
export async function readDocFile(root: string, id: string, lang: string): Promise<DocReadResult> {
  if (!DOC_ID_RE.test(id) || !isLanguageCode(lang)) return { ok: false, lang: null, content: null }
  const chain = [...new Set([lang, 'en', 'zh-CN'] as LanguageCode[])]
  for (const code of chain) {
    try {
      const content = await readFile(path.join(root, code, `${id}.md`), 'utf8')
      return { ok: true, lang: code, content }
    } catch { /* 尝试下一语言 */ }
  }
  return { ok: false, lang: null, content: null }
}
