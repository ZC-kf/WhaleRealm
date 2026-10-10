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
import { defaultSettings, mergeStoredSettings, validateSettings } from '../electron/settings'
import type { AppSettings } from '../src/types'

const baseSettings: AppSettings = {
  uiTheme: 'graphite',
  launcherBackground: null,
  trayMinimize: true,
  dangerConfirm: true,
  balanceThreshold: 0,
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
  launcherDim: 0.72,
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
  language: 'zh-CN',
}

describe('defaultSettings', () => {
  it('provides safe defaults', () => {
    const settings = defaultSettings()
    expect(settings.uiTheme).toBe('graphite')
    expect(settings.launcherBackground).toBeNull()
    expect(settings.trayMinimize).toBe(true)
    expect(settings.dangerConfirm).toBe(true)
  })
})

describe('validateSettings', () => {
  it('keeps known values', () => {
    const validated = validateSettings({ ...baseSettings, uiTheme: 'ocean', trayMinimize: false, dangerConfirm: false })
    expect(validated.uiTheme).toBe('ocean')
    expect(validated.trayMinimize).toBe(false)
    expect(validated.dangerConfirm).toBe(false)
  })

  it('falls back to graphite for an unknown theme', () => {
    expect(validateSettings({ ...baseSettings, uiTheme: 'neon' as never }).uiTheme).toBe('graphite')
  })

  it('accepts a well-formed background filename and rejects others', () => {
    expect(validateSettings({ ...baseSettings, launcherBackground: 'background-1756800000000.png' }).launcherBackground).toBe('background-1756800000000.png')
    expect(validateSettings({ ...baseSettings, launcherBackground: '../evil.png' }).launcherBackground).toBeNull()
  })

  it('accepts a well-formed tray background filename and rejects others', () => {
    expect(validateSettings({ ...baseSettings, trayBackgroundImage: 'tray-background-1756800000000.jpg' }).trayBackgroundImage).toBe('tray-background-1756800000000.jpg')
    expect(validateSettings({ ...baseSettings, trayBackgroundImage: 'background-1756800000000.png' }).trayBackgroundImage).toBeNull()
    expect(validateSettings({ ...baseSettings, trayBackgroundImage: '../evil.png' }).trayBackgroundImage).toBeNull()
  })

  it('treats missing booleans as enabled (safe default)', () => {
    const validated = validateSettings({ ...baseSettings, trayMinimize: undefined as never, dangerConfirm: undefined as never })
    expect(validated.trayMinimize).toBe(true)
    expect(validated.dangerConfirm).toBe(true)
  })
})

describe('mergeStoredSettings', () => {
  it('returns defaults when nothing stored', () => {
    expect(mergeStoredSettings(baseSettings, null)).toEqual(baseSettings)
  })

  it('lets stored values win', () => {
    expect(mergeStoredSettings(baseSettings, { uiTheme: 'berry' }).uiTheme).toBe('berry')
  })

  it('discards an unknown stored theme', () => {
    expect(mergeStoredSettings(baseSettings, { uiTheme: 'neon' as never }).uiTheme).toBe('graphite')
  })
})
