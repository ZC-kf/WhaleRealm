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

/** 设置对话框的分区 id。 */
export type SettingsCategoryId = 'appearance' | 'behavior' | 'tray' | 'window' | 'data' | 'language' | 'about'

/** 设置内可搜索/跳转的功能区块索引（主界面全局搜索与设置搜索栏共用，保证两侧边界一致）。 */
export interface SettingsSection {
  id: string
  category: SettingsCategoryId
  labelKey: TranslationKey
  /** 搜索关键词（空格分隔的同义词，随语言切换翻译）。 */
  keywordsKey: TranslationKey
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'sec-theme', category: 'appearance', labelKey: 'settings.appearance.theme', keywordsKey: 'search.kw.theme' },
  { id: 'sec-theme', category: 'appearance', labelKey: 'settings.appearance.customAccent', keywordsKey: 'search.kw.customAccent' },
  { id: 'sec-background', category: 'appearance', labelKey: 'settings.appearance.background', keywordsKey: 'search.kw.background' },
  { id: 'sec-background', category: 'appearance', labelKey: 'settings.appearance.opacity', keywordsKey: 'search.kw.opacity' },
  { id: 'sec-presets', category: 'appearance', labelKey: 'settings.appearance.presets', keywordsKey: 'search.kw.presets' },
  { id: 'sec-header-text', category: 'appearance', labelKey: 'settings.appearance.headerText', keywordsKey: 'search.kw.headerText' },
  { id: 'sec-tray-style', category: 'tray', labelKey: 'settings.tray.style', keywordsKey: 'search.kw.trayStyle' },
  { id: 'sec-tray-background', category: 'tray', labelKey: 'settings.tray.backgroundImage', keywordsKey: 'search.kw.trayBackground' },
  { id: 'sec-tray-behavior', category: 'tray', labelKey: 'settings.tray.behavior', keywordsKey: 'search.kw.trayBehavior' },
  { id: 'sec-behavior', category: 'behavior', labelKey: 'settings.behavior.title', keywordsKey: 'search.kw.behavior' },
  { id: 'sec-window-size', category: 'window', labelKey: 'settings.window.size', keywordsKey: 'search.kw.windowSize' },
  { id: 'sec-list-fade', category: 'window', labelKey: 'settings.window.listFade', keywordsKey: 'search.kw.listFade' },
  { id: 'sec-card', category: 'window', labelKey: 'settings.window.card', keywordsKey: 'search.kw.card' },
  { id: 'sec-card-bg', category: 'window', labelKey: 'settings.window.cardBackground', keywordsKey: 'search.kw.cardBackground' },
  { id: 'sec-settings-bg', category: 'window', labelKey: 'settings.window.settingsBackground', keywordsKey: 'search.kw.settingsBackground' },
  { id: 'sec-balance', category: 'data', labelKey: 'settings.data.balance', keywordsKey: 'search.kw.balance' },
  { id: 'sec-guide', category: 'data', labelKey: 'settings.data.guide', keywordsKey: 'search.kw.guide' },
  { id: 'sec-language', category: 'language', labelKey: 'settings.language.title', keywordsKey: 'search.kw.language' },
  { id: 'sec-about', category: 'about', labelKey: 'settings.about.title', keywordsKey: 'search.kw.about' },
  { id: 'sec-community', category: 'about', labelKey: 'settings.about.community', keywordsKey: 'search.kw.community' },
  { id: 'sec-docs', category: 'about', labelKey: 'settings.about.docsSection', keywordsKey: 'search.kw.docs' },
  { id: 'sec-license', category: 'about', labelKey: 'settings.about.licenseSection', keywordsKey: 'search.kw.openSource' },
  { id: 'sec-update', category: 'about', labelKey: 'settings.about.updateSection', keywordsKey: 'search.kw.update' },
  { id: 'sec-open-source', category: 'about', labelKey: 'settings.about.openSource', keywordsKey: 'search.kw.openSource' },
]
