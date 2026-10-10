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
import { zhCN, type TranslationKey } from '../src/i18n/translations/zh-CN'
import { en } from '../src/i18n/translations/en'
import { ja } from '../src/i18n/translations/ja'
import { ko } from '../src/i18n/translations/ko'
import { ru } from '../src/i18n/translations/ru'
import { fr } from '../src/i18n/translations/fr'
import { es } from '../src/i18n/translations/es'
import { ptBR } from '../src/i18n/translations/pt-BR'
import { de } from '../src/i18n/translations/de'

/**
 * 九语言键集一致性：所有语言包必须覆盖简中基准的每一个 key，
 * 且不得携带基准之外的键；占位符 {name} 集合必须逐 key 一致。
 * 缺词会导致运行时回退到简中，等于该语言界面上出现混杂文案。
 */

const dictionaries: Record<string, Record<string, string>> = {
  'zh-CN': zhCN as unknown as Record<string, string>,
  en: en as unknown as Record<string, string>,
  ja: ja as unknown as Record<string, string>,
  ko: ko as unknown as Record<string, string>,
  ru: ru as unknown as Record<string, string>,
  fr: fr as unknown as Record<string, string>,
  es: es as unknown as Record<string, string>,
  'pt-BR': ptBR as unknown as Record<string, string>,
  de: de as unknown as Record<string, string>,
}

const baselineKeys = Object.keys(zhCN) as TranslationKey[]

function placeholders(value: string): string[] {
  return Array.from(value.matchAll(/\{(\w+)\}/g)).map(match => match[1]).sort()
}

describe('九语言键集一致', () => {
  it('简中基准自身无重复键且占位符规范', () => {
    const seen = new Set<string>()
    for (const key of baselineKeys) {
      expect(seen.has(key), `重复键：${key}`).toBe(false)
      seen.add(key)
      expect(zhCN[key].length > 0, `空文案：${key}`).toBe(true)
    }
  })

  for (const [language, dictionary] of Object.entries(dictionaries)) {
    it(`${language} 覆盖基准全部键且无多余键`, () => {
      const keys = new Set(Object.keys(dictionary))
      const missing = baselineKeys.filter(key => !keys.has(key))
      const extra = [...keys].filter(key => !(key in zhCN))
      expect(missing, `${language} 缺少键`).toEqual([])
      expect(extra, `${language} 多余键`).toEqual([])
    })

    it(`${language} 占位符与简中逐 key 一致`, () => {
      for (const key of baselineKeys) {
        const expected = placeholders(zhCN[key])
        const actual = placeholders(dictionary[key] ?? '')
        expect(actual, `${language}/${key} 占位符不一致`).toEqual(expected)
      }
    })
  }
})
