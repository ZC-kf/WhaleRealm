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

// 应用支持的语言清单。语言包（翻译字典）随软件离线打包，运行时按需切换。

export type LanguageCode = 'zh-CN' | 'en' | 'ja' | 'ko' | 'ru' | 'fr' | 'es' | 'pt-BR' | 'de'

export interface Locale {
  code: LanguageCode
  /** 语言英文名（语言选择列表第二行展示）。 */
  name: string
  /** 语言原生名。 */
  native: string
}

export const LOCALES: Locale[] = [
  { code: 'zh-CN', name: 'Simplified Chinese', native: '简体中文' },
  { code: 'en', name: 'English', native: 'English' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', native: 'Português (Brasil)' },
  { code: 'de', name: 'German', native: 'Deutsch' },
]

export const DEFAULT_LANGUAGE: LanguageCode = 'zh-CN'

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === 'string' && LOCALES.some(locale => locale.code === value)
}
