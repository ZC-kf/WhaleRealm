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
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { listDocs, readDocFile } from '../electron/docs'

async function makeDocsRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'whalerealm-docs-'))
  await mkdir(path.join(root, 'zh-CN'), { recursive: true })
  await mkdir(path.join(root, 'en'), { recursive: true })
  await writeFile(path.join(root, 'zh-CN', 'introduction.md'), '# 软件介绍\n中文内容', 'utf8')
  await writeFile(path.join(root, 'zh-CN', 'quick-start.md'), '# 快速开始\n中文内容', 'utf8')
  await writeFile(path.join(root, 'en', 'introduction.md'), '# Introduction\nEnglish content', 'utf8')
  await writeFile(path.join(root, 'en', 'troubleshooting.md'), '# FAQ\nEnglish content', 'utf8')
  // 干扰项：非语言目录与非法文件名，不应出现在结果里。
  await mkdir(path.join(root, 'assets'), { recursive: true })
  await writeFile(path.join(root, 'en', 'notes.txt'), 'ignore', 'utf8')
  return root
}

describe('内置项目文档读取（docs.ts）', () => {
  it('listDocs 返回语言与文档 id 的并集（排序、忽略非语言目录与非 md 文件）', async () => {
    const root = await makeDocsRoot()
    try {
      const result = await listDocs(root)
      expect(result.ok).toBe(true)
      expect(result.langs.sort()).toEqual(['en', 'zh-CN'])
      expect(result.ids).toEqual(['introduction', 'quick-start', 'troubleshooting'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('readDocFile 按请求语言命中，缺失时回退 en 再回退 zh-CN', async () => {
    const root = await makeDocsRoot()
    try {
      // 直接命中 zh-CN
      const zh = await readDocFile(root, 'introduction', 'zh-CN')
      expect(zh.ok).toBe(true)
      expect(zh.lang).toBe('zh-CN')
      expect(zh.content).toContain('中文内容')
      // 直接命中 en
      const en = await readDocFile(root, 'introduction', 'en')
      expect(en.ok).toBe(true)
      expect(en.lang).toBe('en')
      expect(en.content).toContain('English content')
      // ja 未提供 → 回退 en
      const ja = await readDocFile(root, 'introduction', 'ja')
      expect(ja.ok).toBe(true)
      expect(ja.lang).toBe('en')
      // quick-start 只有 zh-CN：请求 en → 回退 zh-CN
      const qsEn = await readDocFile(root, 'quick-start', 'en')
      expect(qsEn.ok).toBe(true)
      expect(qsEn.lang).toBe('zh-CN')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('非法文档 id 与非法语言返回 ok:false，不抛错、不越出目录', async () => {
    const root = await makeDocsRoot()
    try {
      for (const bad of ['../evil', '..\\evil', 'UPPER', '', 'a/b', 'a'.repeat(41)]) {
        const result = await readDocFile(root, bad, 'en')
        expect(result.ok).toBe(false)
      }
      const badLang = await readDocFile(root, 'introduction', 'xx-XX')
      expect(badLang.ok).toBe(false)
      const missingDoc = await readDocFile(root, 'no-such-doc', 'zh-CN')
      expect(missingDoc.ok).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('docs 根不存在时 listDocs 返回 ok:false', async () => {
    const result = await listDocs(path.join(tmpdir(), 'whalerealm-docs-missing'))
    expect(result.ok).toBe(false)
  })
})
