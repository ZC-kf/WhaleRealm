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

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { DEFAULT_LANGUAGE, type LanguageCode } from './locales'
import { zhCN, type TranslationKey } from './translations/zh-CN'
import { en } from './translations/en'
import { ja } from './translations/ja'
import { ko } from './translations/ko'
import { ru } from './translations/ru'
import { fr } from './translations/fr'
import { es } from './translations/es'
import { ptBR } from './translations/pt-BR'
import { de } from './translations/de'

type Dictionary = Partial<Record<TranslationKey, string>>

const dictionaries: Record<LanguageCode, Dictionary> = {
  'zh-CN': zhCN as Dictionary,
  en,
  ja,
  ko,
  ru,
  fr,
  es,
  'pt-BR': ptBR,
  de,
}

export interface I18n {
  language: LanguageCode
  /** 取当前语言文案；支持 {name} 插值；缺词 fallback 到简体中文。 */
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18n>({
  language: DEFAULT_LANGUAGE,
  t: key => zhCN[key] ?? key,
})

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name]
    return value === undefined ? `{${name}}` : String(value)
  })
}

/** 脱离 Provider 的独立翻译：给定语言与 key 返回文案（缺词 fallback 到简体中文）。 */
export function translate(language: LanguageCode, key: TranslationKey, params?: Record<string, string | number>): string {
  const dict = dictionaries[language] ?? zhCN
  const template = dict[key] ?? zhCN[key] ?? key
  return interpolate(template, params)
}

export function I18nProvider({ language, children }: { language: LanguageCode; children: ReactNode }) {
  const value = useMemo<I18n>(() => {
    return {
      language,
      t: (key, params) => translate(language, key, params),
    }
  }, [language])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18n {
  return useContext(I18nContext)
}
