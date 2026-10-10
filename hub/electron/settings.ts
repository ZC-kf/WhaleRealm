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

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AppSettings, StylePreset, UiTheme } from '../src/types'
import { DEFAULT_LANGUAGE, isLanguageCode, type LanguageCode } from '../src/i18n/locales'

/**
 * 启动器设置的唯一权威来源：默认值、校验、持久化与内存缓存。
 * 不直接依赖 electron —— 路径由调用方注入，因此可以完整单测。
 * 单界面实例管理只保留：主题、主界面插图、托盘行为与危险确认。
 */

export function defaultSettings(): AppSettings {
  return {
    uiTheme: 'graphite',
    launcherBackground: null,
    trayMinimize: true,
    dangerConfirm: true,
    balanceThreshold: 5,
    customAccent: null,
    autoMinimizeOnStart: true,
    autoCloseOnStart: false,
    headerKicker: '',
    headerTitle: '',
    headerSubtitle: '',
    footerSlogan: '',
    stylePresets: [],
    trayBackground: null,
    trayBackgroundImage: null,
    trayTheme: 'auto',
    trayCustomAccent: null,
    trayStylePresets: [],
    launcherOpacity: 1,
    launcherDim: 0.55,
    trayBackgroundOpacity: 1,
    trayBackgroundDim: 0.55,
    removeDesktopShortcuts: false,
    windowWidth: 1400,
    windowHeight: 900,
    listFadeType: 'gradient',
    listFadeSize: 40,
    cardRadius: 14,
    cardDensity: 'normal',
    settingsBackground: null,
    cardBackground: null,
    cardBackgroundImage: null,
    cardBackgroundOpacity: 1,
    cardTextColor: null,
    settingsBackgroundImage: null,
    settingsBackgroundOpacity: 1,
    showToasts: true,
    autoUpdate: true,
    language: DEFAULT_LANGUAGE,
  }
}

const UI_THEMES = new Set<UiTheme>(['forest', 'ocean', 'berry', 'graphite'])

function validUiTheme(value: unknown): UiTheme {
  return typeof value === 'string' && UI_THEMES.has(value as UiTheme) ? value as UiTheme : 'graphite'
}

/** 主界面插图只接受「时间戳 + 白名单扩展名」的托管文件名，其余一律回落默认图。 */
function validLauncherBackground(value: unknown): string | null {
  return typeof value === 'string' && /^background-\d{10,16}\.(png|jpe?g|webp)$/.test(value)
    ? value
    : null
}

/** 托盘背景图：独立前缀 tray-background-，与主界面插图互不清理。 */
function validTrayBackgroundImage(value: unknown): string | null {
  return typeof value === 'string' && /^tray-background-\d{10,16}\.(png|jpe?g|webp)$/.test(value)
    ? value
    : null
}

/** 实例卡片背景图：独立前缀 card-background-。 */
function validCardBackgroundImage(value: unknown): string | null {
  return typeof value === 'string' && /^card-background-\d{10,16}\.(png|jpe?g|webp)$/.test(value)
    ? value
    : null
}

/** 设置界面背景图：独立前缀 settings-background-。 */
function validSettingsBackgroundImage(value: unknown): string | null {
  return typeof value === 'string' && /^settings-background-\d{10,16}\.(png|jpe?g|webp)$/.test(value)
    ? value
    : null
}

/** 校验并归一化一份来自渲染层的设置。任何一项不合法都直接抛错或回落安全默认。 */
export function validateSettings(input: AppSettings): AppSettings {
  if (!input || typeof input !== 'object') throw new Error('设置格式无效。')
  return {
    uiTheme: validUiTheme(input.uiTheme),
    launcherBackground: validLauncherBackground(input.launcherBackground),
    trayMinimize: input.trayMinimize !== false,
    dangerConfirm: input.dangerConfirm !== false,
    balanceThreshold: validBalanceThreshold(input.balanceThreshold),
    customAccent: validCustomAccent(input.customAccent),
    autoMinimizeOnStart: input.autoMinimizeOnStart !== false,
    autoCloseOnStart: input.autoCloseOnStart === true,
    headerKicker: validHeaderText(input.headerKicker),
    headerTitle: validHeaderText(input.headerTitle),
    headerSubtitle: validHeaderText(input.headerSubtitle),
    footerSlogan: validHeaderText(input.footerSlogan),
    stylePresets: validStylePresets(input.stylePresets),
    trayBackground: validCustomAccent(input.trayBackground),
    trayBackgroundImage: validTrayBackgroundImage(input.trayBackgroundImage),
    trayTheme: validTrayTheme(input.trayTheme),
    trayCustomAccent: validCustomAccent(input.trayCustomAccent),
    trayStylePresets: validStylePresets(input.trayStylePresets),
    launcherOpacity: validOpacity(input.launcherOpacity),
    launcherDim: validDim(input.launcherDim, 0.55),
    trayBackgroundOpacity: validOpacity(input.trayBackgroundOpacity),
    trayBackgroundDim: validDim(input.trayBackgroundDim, 0.55),
    removeDesktopShortcuts: input.removeDesktopShortcuts === true,
    windowWidth: validWindowSize(input.windowWidth, 1400, 640, 3840),
    windowHeight: validWindowSize(input.windowHeight, 900, 480, 2160),
    listFadeType: validFadeType(input.listFadeType),
    listFadeSize: validWindowSize(input.listFadeSize, 40, 0, 200),
    cardRadius: validWindowSize(input.cardRadius, 14, 0, 24),
    cardDensity: validCardDensity(input.cardDensity),
    settingsBackground: validCustomAccent(input.settingsBackground),
    cardBackground: validCustomAccent(input.cardBackground),
    cardBackgroundImage: validCardBackgroundImage(input.cardBackgroundImage),
    cardBackgroundOpacity: validOpacity(input.cardBackgroundOpacity),
    cardTextColor: validCustomAccent(input.cardTextColor),
    settingsBackgroundImage: validSettingsBackgroundImage(input.settingsBackgroundImage),
    settingsBackgroundOpacity: validOpacity(input.settingsBackgroundOpacity),
    showToasts: input.showToasts !== false,
    autoUpdate: input.autoUpdate !== false,
    language: validLanguage(input.language),
  }
}

/** 左上角自定义文字：纯文本，最长 80 字，去掉首尾空白。 */
function validHeaderText(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 80) : ''
}

function validBalanceThreshold(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : 5
}

function validCustomAccent(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null
}

function validOpacity(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : 1
}

/** 暗度（遮罩强度）：缺失或非法时回落到给定预设，而非 1（全黑）。 */
function validDim(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : fallback
}

function validWindowSize(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value)
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback
}

function validFadeType(value: unknown): 'gradient' | 'blur' | 'none' {
  return value === 'blur' || value === 'none' ? value : 'gradient'
}

function validCardDensity(value: unknown): 'compact' | 'normal' | 'cozy' {
  return value === 'compact' || value === 'cozy' ? value : 'normal'
}

function validTrayTheme(value: unknown): 'auto' | UiTheme {
  if (value === 'auto') return 'auto'
  return validUiTheme(value)
}

function validLanguage(value: unknown): LanguageCode {
  return isLanguageCode(value) ? value : DEFAULT_LANGUAGE
}

/** 样式预设：逐项校验，丢弃 id/name 缺失或字段非法的条目。 */
function validStylePresets(value: unknown): StylePreset[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map(item => ({
      id: typeof item.id === 'string' ? item.id : '',
      name: typeof item.name === 'string' ? item.name.trim().slice(0, 40) : '',
      uiTheme: validUiTheme(item.uiTheme),
      customAccent: validCustomAccent(item.customAccent),
      launcherBackground: validLauncherBackground(item.launcherBackground),
    }))
    .filter(item => item.id !== '' && item.name !== '')
}

/** 把磁盘上的设置合并到默认值上，丢弃结构不对的字段。 */
export function mergeStoredSettings(defaults: AppSettings, stored: Partial<AppSettings> | null): AppSettings {
  if (!stored || typeof stored !== 'object') return defaults
  return {
    uiTheme: validUiTheme(stored.uiTheme),
    launcherBackground: validLauncherBackground(stored.launcherBackground),
    trayMinimize: stored.trayMinimize !== false,
    dangerConfirm: stored.dangerConfirm !== false,
    balanceThreshold: validBalanceThreshold(stored.balanceThreshold),
    customAccent: validCustomAccent(stored.customAccent),
    autoMinimizeOnStart: stored.autoMinimizeOnStart !== false,
    autoCloseOnStart: stored.autoCloseOnStart === true,
    headerKicker: validHeaderText(stored.headerKicker),
    headerTitle: validHeaderText(stored.headerTitle),
    headerSubtitle: validHeaderText(stored.headerSubtitle),
    footerSlogan: validHeaderText(stored.footerSlogan),
    stylePresets: validStylePresets(stored.stylePresets),
    trayBackground: validCustomAccent(stored.trayBackground),
    trayBackgroundImage: validTrayBackgroundImage(stored.trayBackgroundImage),
    trayTheme: validTrayTheme(stored.trayTheme),
    trayCustomAccent: validCustomAccent(stored.trayCustomAccent),
    trayStylePresets: validStylePresets(stored.trayStylePresets),
    launcherOpacity: validOpacity(stored.launcherOpacity),
    launcherDim: validDim(stored.launcherDim, 0.55),
    trayBackgroundOpacity: validOpacity(stored.trayBackgroundOpacity),
    trayBackgroundDim: validDim(stored.trayBackgroundDim, 0.55),
    removeDesktopShortcuts: stored.removeDesktopShortcuts === true,
    windowWidth: validWindowSize(stored.windowWidth, 1400, 640, 3840),
    windowHeight: validWindowSize(stored.windowHeight, 900, 480, 2160),
    listFadeType: validFadeType(stored.listFadeType),
    listFadeSize: validWindowSize(stored.listFadeSize, 40, 0, 200),
    cardRadius: validWindowSize(stored.cardRadius, 14, 0, 24),
    cardDensity: validCardDensity(stored.cardDensity),
    settingsBackground: validCustomAccent(stored.settingsBackground),
    cardBackground: validCustomAccent(stored.cardBackground),
    cardBackgroundImage: validCardBackgroundImage(stored.cardBackgroundImage),
    cardBackgroundOpacity: validOpacity(stored.cardBackgroundOpacity),
    cardTextColor: validCustomAccent(stored.cardTextColor),
    settingsBackgroundImage: validSettingsBackgroundImage(stored.settingsBackgroundImage),
    settingsBackgroundOpacity: validOpacity(stored.settingsBackgroundOpacity),
    showToasts: stored.showToasts !== false,
    autoUpdate: stored.autoUpdate !== false,
    language: validLanguage(stored.language),
  }
}

export interface SettingsStore {
  read(): Promise<AppSettings>
  /** 同步读取缓存（首次 read 后可用）；未加载时回落默认值。 */
  readSync(): AppSettings
  save(input: AppSettings): Promise<AppSettings>
}

export interface SettingsStoreOptions {
  filePath: string
  createDefaults: () => AppSettings
}

export function createSettingsStore(options: SettingsStoreOptions): SettingsStore {
  let cache: AppSettings | null = null

  return {
    readSync(): AppSettings {
      return cache ?? options.createDefaults()
    },

    async read(): Promise<AppSettings> {
      if (cache) return cache
      const defaults = options.createDefaults()
      let stored: Partial<AppSettings> | null = null
      try {
        stored = JSON.parse(await readFile(options.filePath, 'utf8')) as Partial<AppSettings>
      } catch {
        stored = null
      }
      cache = mergeStoredSettings(defaults, stored)
      return cache
    },

    async save(input: AppSettings): Promise<AppSettings> {
      const next = validateSettings(input)
      await mkdir(path.dirname(options.filePath), { recursive: true })
      await writeFile(options.filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
      cache = next
      return next
    },
  }
}
