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

import { Check, Database, Globe, ImagePlus, Info, LoaderCircle, Minus, Palette, PanelTop, RotateCcw, ScrollText, Search, Settings, Square, SquareSquare, X, BookOpen } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLauncherApi } from '../../api/client'
import { useI18n } from '../../i18n'
import { LOCALES } from '../../i18n/locales'
import type { TranslationKey } from '../../i18n/translations/zh-CN'
import { SETTINGS_SECTIONS, type SettingsCategoryId } from '../../settings-sections'
import { PROJECT_URL } from '../../constants'
import type { AppSettings, StylePreset, UiTheme } from '../../types'
import { CropDialog } from './CropDialog'
import { DocsDialog } from './DocsDialog'
import { LicenseDialog } from './LicenseDialog'
import { isNewer } from '../../update'
import type { ProjectReleaseInfo } from '../../types'
import packageMetadata from '../../../package.json'

/** 启动器设置：全屏、按「外观 / 行为 / 窗口 / 数据 / 关于」归类，带搜索。 */

interface SettingsDialogProps {
  settings: AppSettings
  busy: boolean
  /** 打开时直接定位到的功能区块 id（主界面搜索跳转用）。 */
  initialSection?: string
  onClose: () => void
  /** 保存设置（只保存、不关闭对话框），返回是否成功。 */
  onSave: (settings: AppSettings) => Promise<boolean>
  /** 无感提示（右上角 toast，自动消失）。 */
  onNotify: (kind: 'success' | 'error', message: string) => void
  /** 最小化主窗口。 */
  onMinimize: () => void
  /** 切换主窗口全屏/还原。 */
  onToggleMaximize: () => void
  /** 当前是否处于全屏。 */
  isMaximized: boolean
  /** 手动检查发现新版本时上抛：由 App 层受信更新流程弹窗接管（含停止实例确认）。 */
  onUpdateAvailable?: (release: ProjectReleaseInfo) => void
}

const UI_THEMES: Array<{ id: UiTheme; labelKey: TranslationKey }> = [
  { id: 'forest', labelKey: 'theme.forest' },
  { id: 'ocean', labelKey: 'theme.ocean' },
  { id: 'berry', labelKey: 'theme.berry' },
  { id: 'graphite', labelKey: 'theme.graphite' },
]

type CategoryId = SettingsCategoryId

const CATEGORIES: Array<{ id: CategoryId; label: TranslationKey; icon: ReactNode }> = [
  { id: 'appearance', label: 'settings.category.appearance', icon: <Palette size={16} /> },
  { id: 'behavior', label: 'settings.category.behavior', icon: <Settings size={16} /> },
  { id: 'tray', label: 'settings.category.tray', icon: <Square size={16} /> },
  { id: 'window', label: 'settings.category.window', icon: <PanelTop size={16} /> },
  { id: 'data', label: 'settings.category.data', icon: <Database size={16} /> },
  { id: 'language', label: 'settings.category.language', icon: <Globe size={16} /> },
  { id: 'about', label: 'settings.category.about', icon: <Info size={16} /> },
]

const FADE_TYPES: Array<{ id: AppSettings['listFadeType']; labelKey: TranslationKey }> = [
  { id: 'gradient', labelKey: 'settings.window.fadeGradient' },
  { id: 'blur', labelKey: 'settings.window.fadeBlur' },
  { id: 'none', labelKey: 'settings.window.fadeNone' },
]

const CARD_DENSITIES: Array<{ id: AppSettings['cardDensity']; labelKey: TranslationKey }> = [
  { id: 'compact', labelKey: 'settings.window.densityCompact' },
  { id: 'normal', labelKey: 'settings.window.densityNormal' },
  { id: 'cozy', labelKey: 'settings.window.densityCozy' },
]

/** 设置内可搜索/跳转的功能区块索引已抽到 src/settings-sections.ts，与主界面全局搜索共用。 */

export function SettingsDialog({ settings, busy, initialSection, onClose, onSave, onNotify, onMinimize, onToggleMaximize, isMaximized, onUpdateAvailable }: SettingsDialogProps) {
  const api = useLauncherApi()
  const { t, language } = useI18n()
  const [draft, setDraft] = useState(settings)
  const [search, setSearch] = useState('')
  const [searchActive, setSearchActive] = useState(-1)
  const [category, setCategory] = useState<CategoryId>('appearance')
  const [presetName, setPresetName] = useState('')
  const [communityDialog, setCommunityDialog] = useState<'telegram' | 'qq' | null>(null)
  const [docsOpen, setDocsOpen] = useState(false)
  const [licenseKind, setLicenseKind] = useState<'gpl' | 'third-party' | null>(null)
  const [changelogOpen, setChangelogOpen] = useState(false)
  const GUIDE_KEY = 'dsh-launcher:first-run-guide'
  const [guideAutoShow, setGuideAutoShowState] = useState<boolean>(() => {
    try { return window.localStorage.getItem(GUIDE_KEY) !== 'dismissed' } catch { return true }
  })
  // 记录打开设置时的初始值，用于未保存检测；实际写入延迟到「保存设置」。
  const guideInitialRef = useRef(guideAutoShow)
  const setGuideAutoShow = (next: boolean): void => {
    setGuideAutoShowState(next)
  }
  /** 把「启动时自动显示使用引导」写入 localStorage（在保存设置时调用）。 */
  const persistGuide = (value: boolean): void => {
    try {
      if (value) window.localStorage.removeItem(GUIDE_KEY)
      else window.localStorage.setItem(GUIDE_KEY, 'dismissed')
    } catch { /* 私有模式下存储不可用 */ }
  }

  // 未保存改动检测：草稿与已保存设置逐字段（JSON）比较，加上「使用引导」开关的变化。
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(settings) || guideAutoShow !== guideInitialRef.current, [draft, settings, guideAutoShow])
  const [unsavedTarget, setUnsavedTarget] = useState<{ type: 'category' | 'close'; category?: CategoryId } | null>(null)

  const requestCategory = (next: CategoryId) => {
    if (next === category) return
    if (dirty) { setUnsavedTarget({ type: 'category', category: next }); return }
    setCategory(next)
  }
  const requestClose = () => {
    if (dirty) { setUnsavedTarget({ type: 'close' }); return }
    onClose()
  }
  const confirmUnsaved = async () => {
    if (!unsavedTarget) return
    const ok = await onSave(draft)
    if (!ok) return
    persistGuide(guideAutoShow)
    if (unsavedTarget.type === 'category' && unsavedTarget.category) setCategory(unsavedTarget.category)
    else if (unsavedTarget.type === 'close') onClose()
    setUnsavedTarget(null)
  }
  const discardUnsaved = () => {
    if (!unsavedTarget) return
    setDraft(settings) // 丢弃未保存改动，恢复为已保存值（否则"不保存"后改动仍残留在草稿里）
    setGuideAutoShowState(guideInitialRef.current) // 丢弃「使用引导」开关的未保存改动
    if (unsavedTarget.type === 'category' && unsavedTarget.category) setCategory(unsavedTarget.category)
    else if (unsavedTarget.type === 'close') onClose()
    setUnsavedTarget(null)
  }

  const q = search.trim().toLowerCase()
  const show = (_keywords: string) => true
  // 搜索匹配的功能区块（实时下拉列表）。
  const searchMatches = q
    ? SETTINGS_SECTIONS.filter(section => `${t(section.labelKey)} ${t(section.keywordsKey)}`.toLowerCase().includes(q))
    : []
  const goToSection = (section: { id: string; category: CategoryId }) => {
    requestCategory(section.category)
    setSearch('')
    setSearchActive(-1)
    window.setTimeout(() => {
      document.getElementById(section.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 60)
  }

  // 主界面搜索跳转：打开时定位到指定功能区块（category 切换 + 滚动）。
  useEffect(() => {
    if (!initialSection) return
    const section = SETTINGS_SECTIONS.find(item => item.id === initialSection)
    if (!section) return
    setCategory(section.category)
    window.setTimeout(() => {
      document.getElementById(section.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
    // 仅在打开时执行一次，避免后续重复渲染反复滚动。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const chooseBackground = async () => {
    const name = await api.chooseLauncherBackground().catch(() => null)
    if (name) setDraft(current => ({ ...current, launcherBackground: name }))
  }

  const [cropDialog, setCropDialog] = useState<string | null>(null)
  const chooseTrayBackground = async () => {
    const name = await api.chooseTrayBackground().catch(() => null)
    if (name) setCropDialog(name)
  }
  const confirmCrop = async (dataUrl: string) => {
    const name = await api.saveCroppedTrayBackground(dataUrl).catch(() => null)
    if (name) setDraft(current => ({ ...current, trayBackgroundImage: name }))
    setCropDialog(null)
  }
  const chooseCardBackground = async () => {
    const name = await api.chooseCardBackground().catch(() => null)
    if (name) setDraft(current => ({ ...current, cardBackgroundImage: name }))
  }
  const chooseSettingsBackground = async () => {
    const name = await api.chooseSettingsBackground().catch(() => null)
    if (name) setDraft(current => ({ ...current, settingsBackgroundImage: name }))
  }

  // 关于页：手动检查更新（主进程受信通道）。结果如实提示：
  // 有更新上抛给 App 层受信更新流程弹窗（含停止实例确认）；无更新/无发行版/
  // 未配置/网络失败分别给准确文案。
  const checkUpdate = async () => {
    try {
      const result = await api.checkProjectRelease()
      if (result.release && isNewer(result.release, packageMetadata.version)) {
        if (onUpdateAvailable) onUpdateAvailable(result.release)
        else onNotify('success', t('settings.about.updateAvailable'))
        return
      }
      if (result.release) { onNotify('success', t('settings.about.latest', { version: packageMetadata.version })); return }
      if (result.reason === 'no-release') onNotify('error', t('settings.about.updateNoRelease'))
      else if (result.reason === 'no-repository') onNotify('error', t('settings.about.updateUnconfigured'))
      else onNotify('error', t('settings.about.updateCheckFailed', { error: result.error ?? '' }))
    } catch (error) {
      onNotify('error', t('settings.about.updateCheckFailed', { error: error instanceof Error ? error.message : String(error) }))
    }
  }
  const copyCommunity = async () => {
    const text = communityDialog === 'telegram' ? 'https://t.me/LF_WhaleRealm' : '1125566250'
    await api.writeClipboard(text).catch(() => undefined)
    onNotify('success', t('settings.about.copied'))
    setCommunityDialog(null)
  }

  const savePreset = () => {
    const name = presetName.trim()
    if (!name) return
    const preset: StylePreset = {
      id: `preset-${Date.now().toString(36)}`,
      name,
      uiTheme: draft.uiTheme ?? 'graphite',
      customAccent: draft.customAccent,
      launcherBackground: draft.launcherBackground,
    }
    setDraft({ ...draft, stylePresets: [...(draft.stylePresets ?? []), preset] })
    setPresetName('')
  }
  const applyPreset = (preset: StylePreset) => {
    setDraft({ ...draft, uiTheme: preset.uiTheme, customAccent: preset.customAccent, launcherBackground: preset.launcherBackground })
  }
  const removePreset = (id: string) => {
    setDraft({ ...draft, stylePresets: (draft.stylePresets ?? []).filter(item => item.id !== id) })
  }
  const themeLabel = (theme: UiTheme): string => {
    const item = UI_THEMES.find(i => i.id === theme)
    return item ? t(item.labelKey) : theme
  }

  // 托盘独立样式预设
  const [trayPresetName, setTrayPresetName] = useState('')
  const saveTrayPreset = () => {
    const name = trayPresetName.trim()
    if (!name) return
    const preset: StylePreset = {
      id: `tray-preset-${Date.now().toString(36)}`,
      name,
      uiTheme: draft.trayTheme === 'auto' ? (draft.uiTheme ?? 'graphite') : draft.trayTheme,
      customAccent: draft.trayCustomAccent,
      launcherBackground: draft.trayBackground,
    }
    setDraft({ ...draft, trayStylePresets: [...(draft.trayStylePresets ?? []), preset] })
    setTrayPresetName('')
  }
  const applyTrayPreset = (preset: StylePreset) => {
    setDraft({ ...draft, trayTheme: preset.uiTheme, trayCustomAccent: preset.customAccent, trayBackground: preset.launcherBackground })
  }
  const removeTrayPreset = (id: string) => {
    setDraft({ ...draft, trayStylePresets: (draft.trayStylePresets ?? []).filter(item => item.id !== id) })
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) requestClose() }}>
      <section className="modal settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header>
          <div><Settings size={19} /><h2 id="settings-title">{t('settings.title')}</h2></div>
          <div className="settings-header-search-wrap">
            <label className="settings-header-search">
              <Search size={15} />
              <input
                aria-label={t('settings.searchAria')}
                value={search}
                onChange={event => { setSearch(event.target.value); setSearchActive(-1) }}
                onKeyDown={event => {
                  if (searchMatches.length === 0) return
                  if (event.key === 'ArrowDown') { event.preventDefault(); setSearchActive(cur => (cur + 1) % searchMatches.length) }
                  else if (event.key === 'ArrowUp') { event.preventDefault(); setSearchActive(cur => (cur <= 0 ? searchMatches.length - 1 : cur - 1)) }
                  else if (event.key === 'Enter') { if (searchActive >= 0 && searchActive < searchMatches.length) { event.preventDefault(); goToSection(searchMatches[searchActive]) } }
                  else if (event.key === 'Escape') setSearchActive(-1)
                }}
                placeholder={t('settings.searchPlaceholder')}
              />
            </label>
            {searchMatches.length > 0 && (
              <div className="settings-search-results">
                {searchMatches.map((section, index) => (
                  <button
                    key={`${section.id}-${section.labelKey}`}
                    type="button"
                    className={`settings-search-result${index === searchActive ? ' is-active' : ''}`}
                    onMouseEnter={() => setSearchActive(index)}
                    onClick={() => goToSection(section)}
                  >
                    <span className="search-result-source source-setting">{t(CATEGORIES.find(c => c.id === section.category)?.label ?? 'settings.title')}</span>
                    <span className="search-result-label">{t(section.labelKey)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="icon-button" title={t('window.minimize')} aria-label={t('window.minimize')} onClick={onMinimize}><Minus size={17} /></button>
          <button type="button" className="icon-button" title={isMaximized ? t('window.restore') : t('window.fullscreen')} aria-label={isMaximized ? t('window.restore') : t('window.fullscreen')} onClick={onToggleMaximize}>{isMaximized ? <SquareSquare size={15} /> : <Square size={15} />}</button>
          <button type="button" className="icon-button settings-close-button" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); requestClose() }} aria-label={t('settings.closeAria')}><X size={18} /></button>
        </header>

        <div className="settings-layout">
          <aside className="settings-sidebar" aria-label={t('settings.sidebarAria')}>
            {CATEGORIES.map(item => (
              <button
                key={item.id}
                type="button"
                className={`settings-category${category === item.id ? ' is-active' : ''}`}
                onClick={() => requestCategory(item.id)}
              >
                {item.icon}
                <span>{t(item.label)}</span>
              </button>
            ))}
          </aside>

          <div className="settings-content">
            <div className="settings-content-scroll">
              {category === 'appearance' && (
                <>
                  {show('界面主题 配色 颜色 强调色 外观 石墨 松林 海湾 莓果') && (
                    <>
                      <div className="form-section theme-section-title"><Palette size={16} /><h3 id="sec-theme">{t('settings.appearance.theme')}</h3></div>
                      <div className="theme-options" role="radiogroup" aria-label={t('settings.appearance.theme')}>
                        {UI_THEMES.map(theme => (
                          <button
                            key={theme.id}
                            type="button"
                            role="radio"
                            aria-checked={(draft.uiTheme ?? 'graphite') === theme.id}
                            className={`theme-option ${(draft.uiTheme ?? 'graphite') === theme.id ? 'selected' : ''}`}
                            onClick={() => setDraft({ ...draft, uiTheme: theme.id })}
                          >
                            <span className={`theme-swatch ${theme.id}`} aria-hidden="true"><i /><i /><i /></span>
                            <span>{t(theme.labelKey)}</span>
                            {(draft.uiTheme ?? 'graphite') === theme.id && <Check size={14} />}
                          </button>
                        ))}
                      </div>
                      <label className="check-field custom-accent-field"><Palette size={15} /><span><strong>{t('settings.appearance.customAccent')}</strong><small>{t('settings.appearance.customAccentDesc')}</small></span><input type="color" value={draft.customAccent ?? '#8b96a5'} onChange={event => setDraft({ ...draft, customAccent: event.target.value })} />{draft.customAccent && <button type="button" className="secondary-button" onClick={() => setDraft({ ...draft, customAccent: null })}>{t('common.restoreDefault')}</button>}</label>
                    </>
                  )}

                  {show('主界面插图 背景 图片 更换 透明度 透明') && (
                    <>
                      <div className="form-section divided"><h3 id="sec-background">{t('settings.appearance.background')}</h3><p>{t('settings.appearance.backgroundDesc')}</p></div>
                      <div className="launcher-background-picker">
                        <img className="launcher-background-preview" src={draft.launcherBackground ? `launcher-asset://${draft.launcherBackground}` : 'launcher-asset://launcher-background.png'} alt={t('settings.appearance.backgroundPreviewAlt')} />
                        <div className="launcher-background-actions">
                          <div>
                            <button type="button" className="secondary-button" disabled={busy} onClick={() => void chooseBackground()}><ImagePlus size={15} />{t('settings.appearance.changeBackground')}</button>
                            {draft.launcherBackground && <button type="button" className="secondary-button" disabled={busy} onClick={() => setDraft({ ...draft, launcherBackground: null })}><RotateCcw size={15} />{t('common.restoreDefault')}</button>}
                          </div>
                          <small>{t('settings.appearance.savedHint')}</small>
                        </div>
                      </div>
                      <label className="check-field opacity-field"><span><strong>{t('settings.appearance.opacity')}</strong><small>{t('settings.appearance.opacityDesc')}</small></span><input type="range" min={0} max={100} step={5} value={Math.round((draft.launcherOpacity ?? 1) * 100)} onChange={event => setDraft({ ...draft, launcherOpacity: Number(event.target.value) / 100 })} /><small className="opacity-value">{Math.round((draft.launcherOpacity ?? 1) * 100)}%</small></label>
                      <label className="check-field opacity-field"><span><strong>{t('settings.appearance.dim')}</strong><small>{t('settings.appearance.dimDesc')}</small></span><input type="range" min={0} max={100} step={5} value={Math.round((draft.launcherDim ?? 0.55) * 100)} onChange={event => setDraft({ ...draft, launcherDim: Number(event.target.value) / 100 })} /><small className="opacity-value">{Math.round((draft.launcherDim ?? 0.55) * 100)}%</small></label>
                    </>
                  )}

                  {show('样式预设 保存 切换 皮肤 样式') && (
                    <>
                      <div className="form-section divided"><h3 id="sec-presets">{t('settings.appearance.presets')}</h3><p>{t('settings.appearance.presetsDesc')}</p></div>
                      <div className="preset-save-row">
                        <input className="preset-name-input" value={presetName} maxLength={40} placeholder={t('settings.appearance.presetName')} onChange={event => setPresetName(event.target.value)} />
                        <button type="button" className="secondary-button" disabled={!presetName.trim()} onClick={savePreset}>{t('settings.appearance.savePreset')}</button>
                      </div>
                      {(draft.stylePresets ?? []).length > 0 && (
                        <div className="preset-list">
                          {draft.stylePresets.map(preset => (
                            <div key={preset.id} className="preset-item">
                              <span className="preset-dot" style={{ background: preset.customAccent ?? '#8b96a5' }} />
                              <span className="preset-item-name">{preset.name}</span>
                              <small>{themeLabel(preset.uiTheme)}{preset.launcherBackground ? ` · ${t('settings.appearance.customImage')}` : ''}</small>
                              <button type="button" className="secondary-button" onClick={() => applyPreset(preset)}>{t('common.apply')}</button>
                              <button type="button" className="secondary-button danger" onClick={() => removePreset(preset.id)}>{t('common.delete')}</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {show('左上角 文字 标题 名称 标语 说明') && (
                    <>
                      <div className="form-section divided"><h3 id="sec-header-text">{t('settings.appearance.headerText')}</h3><p>{t('settings.appearance.headerTextDesc')}</p></div>
                      <label className="form-field"><span>{t('settings.appearance.headerKicker')}</span><input value={draft.headerKicker} maxLength={80} placeholder="DeepSeek Harness 实例" onChange={event => setDraft({ ...draft, headerKicker: event.target.value })} /></label>
                      <label className="form-field"><span>{t('settings.appearance.headerTitle')}</span><input value={draft.headerTitle} maxLength={80} placeholder="鲸域 · WhaleRealm" onChange={event => setDraft({ ...draft, headerTitle: event.target.value })} /></label>
                      <label className="form-field"><span>{t('settings.appearance.headerSubtitle')}</span><input value={draft.headerSubtitle} maxLength={80} placeholder={t('app.headerSubtitle')} onChange={event => setDraft({ ...draft, headerSubtitle: event.target.value })} /></label>
                      <label className="form-field"><span>{t('settings.appearance.headerFooter')}</span><input value={draft.footerSlogan} maxLength={80} placeholder={t('app.slogan')} onChange={event => setDraft({ ...draft, footerSlogan: event.target.value })} /></label>
                    </>
                  )}
                </>
              )}

              {category === 'behavior' && (
                <>
                  {show('行为 最小化 危险 确认 启动 快捷方式 提示') && (
                    <>
                      <div className="form-section"><h3 id="sec-behavior">{t('settings.behavior.title')}</h3><p>{t('settings.behavior.titleDesc')}</p></div>
                      <label className="check-field"><input type="checkbox" checked={draft.autoMinimizeOnStart !== false} onChange={event => setDraft({ ...draft, autoMinimizeOnStart: event.target.checked, autoCloseOnStart: event.target.checked ? false : draft.autoCloseOnStart })} /><span><strong>{t('settings.behavior.autoMinimize')}</strong><small>{t('settings.behavior.autoMinimizeDesc')}</small></span></label>
                      <label className="check-field"><input type="checkbox" checked={draft.dangerConfirm !== false} onChange={event => setDraft({ ...draft, dangerConfirm: event.target.checked })} /><span><strong>{t('settings.behavior.dangerConfirm')}</strong><small>{t('settings.behavior.dangerConfirmDesc')}</small></span></label>
                      <label className="check-field"><input type="checkbox" checked={draft.removeDesktopShortcuts === true} onChange={event => setDraft({ ...draft, removeDesktopShortcuts: event.target.checked })} /><span><strong>{t('settings.behavior.removeShortcuts')}</strong><small>{t('settings.behavior.removeShortcutsDesc')}</small></span></label>
                      <label className="check-field"><input type="checkbox" checked={draft.showToasts !== false} onChange={event => setDraft({ ...draft, showToasts: event.target.checked })} /><span><strong>{t('settings.behavior.showToasts')}</strong><small>{t('settings.behavior.showToastsDesc')}</small></span></label>
                    </>
                  )}
                </>
              )}

              {category === 'tray' && (
                <>
                  {show('托盘 样式 主题 背景 颜色 独立 关闭 隐藏 启动 装饰') && (
                    <>
                      <div className="form-section"><h3 id="sec-tray-behavior">{t('settings.tray.behavior')}</h3><p>{t('settings.tray.behaviorDesc')}</p></div>
                      <label className="check-field"><input type="checkbox" checked={draft.trayMinimize !== false} onChange={event => setDraft({ ...draft, trayMinimize: event.target.checked })} /><span><strong>{t('settings.tray.trayMinimize')}</strong><small>{t('settings.tray.trayMinimizeDesc')}</small></span></label>
                      <label className="check-field"><input type="checkbox" checked={draft.autoCloseOnStart === true} onChange={event => setDraft({ ...draft, autoCloseOnStart: event.target.checked, autoMinimizeOnStart: event.target.checked ? false : draft.autoMinimizeOnStart })} /><span><strong>{t('settings.tray.autoClose')}</strong><small>{t('settings.tray.autoCloseDesc')}</small></span></label>
                      <div className="form-section divided"><h3 id="sec-tray-style">{t('settings.tray.style')}</h3><p>{t('settings.tray.styleDesc')}</p></div>
                      <div className="theme-options" role="radiogroup" aria-label={t('settings.tray.themeAria')}>
                        <button type="button" role="radio" aria-checked={draft.trayTheme === 'auto'} className={`theme-option ${draft.trayTheme === 'auto' ? 'selected' : ''}`} onClick={() => setDraft({ ...draft, trayTheme: 'auto' })}>
                          <span>{t('settings.tray.followMain')}</span>{draft.trayTheme === 'auto' && <Check size={14} />}
                        </button>
                        {UI_THEMES.map(theme => (
                          <button key={theme.id} type="button" role="radio" aria-checked={draft.trayTheme === theme.id} className={`theme-option ${draft.trayTheme === theme.id ? 'selected' : ''}`} onClick={() => setDraft({ ...draft, trayTheme: theme.id })}>
                            <span className={`theme-swatch ${theme.id}`} aria-hidden="true"><i /><i /><i /></span>
                            <span>{t(theme.labelKey)}</span>
                            {draft.trayTheme === theme.id && <Check size={14} />}
                          </button>
                        ))}
                      </div>
                      <label className="check-field custom-accent-field"><Palette size={15} /><span><strong>{t('settings.tray.accent')}</strong><small>{t('settings.tray.accentDesc')}</small></span><input type="color" value={draft.trayCustomAccent ?? '#8b96a5'} onChange={event => setDraft({ ...draft, trayCustomAccent: event.target.value })} />{draft.trayCustomAccent && <button type="button" className="secondary-button" onClick={() => setDraft({ ...draft, trayCustomAccent: null })}>{t('common.restoreDefault')}</button>}</label>
                      <label className="check-field tray-bg-field"><span><strong>{t('settings.tray.backgroundColor')}</strong><small>{t('settings.tray.backgroundColorDesc')}</small></span><input type="color" value={draft.trayBackground ?? '#0f1512'} onChange={event => setDraft({ ...draft, trayBackground: event.target.value })} />{draft.trayBackground && <button type="button" className="secondary-button" onClick={() => setDraft({ ...draft, trayBackground: null })}>{t('common.restoreDefault')}</button>}</label>
                      <div className="form-section divided"><h3 id="sec-tray-background">{t('settings.tray.backgroundImage')}</h3><p>{t('settings.tray.backgroundImageDesc')}</p></div>
                      <div className="launcher-background-picker">
                        <img className="launcher-background-preview" src={draft.trayBackgroundImage ? `launcher-asset://${draft.trayBackgroundImage}` : 'launcher-asset://tray-background-default.png'} alt={t('settings.appearance.trayBackgroundPreviewAlt')} />
                        <div className="launcher-background-actions">
                          <div>
                            <button type="button" className="secondary-button" disabled={busy} onClick={() => void chooseTrayBackground()}><ImagePlus size={15} />{t('settings.tray.changeBackground')}</button>
                            {draft.trayBackgroundImage && <button type="button" className="secondary-button" disabled={busy} onClick={() => setDraft({ ...draft, trayBackgroundImage: null })}><RotateCcw size={15} />{t('common.restoreDefault')}</button>}
                          </div>
                          <small>{t('settings.appearance.savedHint')}</small>
                        </div>
                      </div>
                      <label className="check-field opacity-field"><span><strong>{t('settings.tray.backgroundOpacity')}</strong><small>{t('settings.tray.backgroundOpacityDesc')}</small></span><input type="range" min={0} max={100} step={5} value={Math.round((draft.trayBackgroundOpacity ?? 1) * 100)} onChange={event => setDraft({ ...draft, trayBackgroundOpacity: Number(event.target.value) / 100 })} /><small className="opacity-value">{Math.round((draft.trayBackgroundOpacity ?? 1) * 100)}%</small></label>
                      <label className="check-field opacity-field"><span><strong>{t('settings.tray.backgroundDim')}</strong><small>{t('settings.tray.backgroundDimDesc')}</small></span><input type="range" min={0} max={100} step={5} value={Math.round((draft.trayBackgroundDim ?? 0.55) * 100)} onChange={event => setDraft({ ...draft, trayBackgroundDim: Number(event.target.value) / 100 })} /><small className="opacity-value">{Math.round((draft.trayBackgroundDim ?? 0.55) * 100)}%</small></label>
                      <div className="preset-save-row">
                        <input className="preset-name-input" value={trayPresetName} maxLength={40} placeholder={t('settings.tray.presetName')} onChange={event => setTrayPresetName(event.target.value)} />
                        <button type="button" className="secondary-button" disabled={!trayPresetName.trim()} onClick={saveTrayPreset}>{t('settings.tray.savePreset')}</button>
                      </div>
                      {(draft.trayStylePresets ?? []).length > 0 && (
                        <div className="preset-list">
                          {draft.trayStylePresets.map(preset => (
                            <div key={preset.id} className="preset-item">
                              <span className="preset-dot" style={{ background: preset.customAccent ?? '#8b96a5' }} />
                              <span className="preset-item-name">{preset.name}</span>
                              <small>{themeLabel(preset.uiTheme)}{preset.launcherBackground ? ` · ${t('settings.appearance.customBackground')}` : ''}</small>
                              <button type="button" className="secondary-button" onClick={() => applyTrayPreset(preset)}>{t('common.apply')}</button>
                              <button type="button" className="secondary-button danger" onClick={() => removeTrayPreset(preset.id)}>{t('common.delete')}</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {category === 'window' && (
                <>
                  {show('窗口 尺寸 大小 初始') && (
                    <>
                      <div className="form-section"><h3 id="sec-window-size">{t('settings.window.size')}</h3><p>{t('settings.window.sizeDesc')}</p></div>
                      <div className="window-size-row">
                        <label className="form-field"><span>{t('settings.window.width')}</span><input type="number" min={640} max={3840} value={draft.windowWidth} onChange={event => setDraft({ ...draft, windowWidth: Number(event.target.value) || 640 })} /></label>
                        <label className="form-field"><span>{t('settings.window.height')}</span><input type="number" min={480} max={2160} value={draft.windowHeight} onChange={event => setDraft({ ...draft, windowHeight: Number(event.target.value) || 900 })} /></label>
                      </div>
                    </>
                  )}

                  {show('渐变 模糊 边缘 列表') && (
                    <>
                      <div className="form-section divided"><h3 id="sec-list-fade">{t('settings.window.listFade')}</h3><p>{t('settings.window.listFadeDesc')}</p></div>
                      <div className="fade-type-row">
                        {FADE_TYPES.map(item => (
                          <button
                            key={item.id}
                            type="button"
                            className={`theme-option fade-type${draft.listFadeType === item.id ? ' selected' : ''}`}
                            onClick={() => setDraft({ ...draft, listFadeType: item.id })}
                          >
                            <span>{t(item.labelKey)}</span>
                            {draft.listFadeType === item.id && <Check size={14} />}
                          </button>
                        ))}
                      </div>
                      {draft.listFadeType !== 'none' && (
                        <label className="form-field" style={{ marginTop: 10 }}><span>{t('settings.window.fadeSize')}</span><input type="number" min={0} max={200} value={draft.listFadeSize} onChange={event => setDraft({ ...draft, listFadeSize: Number(event.target.value) || 0 })} /></label>
                      )}

                      <div className="form-section divided"><h3 id="sec-card">{t('settings.window.card')}</h3><p>{t('settings.window.cardDesc')}</p></div>
                      <label className="check-field opacity-field"><span><strong>{t('settings.window.cardRadius')}</strong><small>{t('settings.window.cardRadiusDesc')}</small></span><input type="range" min={0} max={24} step={2} value={draft.cardRadius ?? 14} onChange={event => setDraft({ ...draft, cardRadius: Number(event.target.value) || 0 })} /><small className="opacity-value">{draft.cardRadius ?? 14}px</small></label>
                      <div className="fade-type-row">
                        {CARD_DENSITIES.map(item => (
                          <button
                            key={item.id}
                            type="button"
                            className={`theme-option fade-type${draft.cardDensity === item.id ? ' selected' : ''}`}
                            onClick={() => setDraft({ ...draft, cardDensity: item.id })}
                          >
                            <span>{t(item.labelKey)}</span>
                            {draft.cardDensity === item.id && <Check size={14} />}
                          </button>
                        ))}
                      </div>

                      <div className="form-section divided"><h3 id="sec-settings-bg">{t('settings.window.settingsBackground')}</h3><p>{t('settings.window.settingsBackgroundDesc')}</p></div>
                      <label className="check-field tray-bg-field"><span><strong>{t('settings.window.settingsBackgroundColor')}</strong><small>{t('settings.window.settingsBackgroundColorDesc')}</small></span><input type="color" value={draft.settingsBackground ?? '#181c1f'} onChange={event => setDraft({ ...draft, settingsBackground: event.target.value })} />{draft.settingsBackground && <button type="button" className="secondary-button" onClick={() => setDraft({ ...draft, settingsBackground: null })}>{t('common.restoreDefault')}</button>}</label>
                      <label className="check-field tray-bg-field"><span><strong>{t('settings.window.settingsBackgroundImage')}</strong><small>{t('settings.window.settingsBackgroundImageDesc')}</small></span><button type="button" className="secondary-button" disabled={busy} onClick={() => void chooseSettingsBackground()}><ImagePlus size={15} />{t('settings.window.chooseImage')}</button>{draft.settingsBackgroundImage && <button type="button" className="secondary-button" onClick={() => setDraft({ ...draft, settingsBackgroundImage: null })}>{t('common.restoreDefault')}</button>}</label>
                      <label className="check-field opacity-field"><span><strong>{t('settings.window.settingsBackgroundOpacity')}</strong><small>{t('settings.window.settingsBackgroundOpacityDesc')}</small></span><input type="range" min={0} max={100} step={5} value={Math.round((draft.settingsBackgroundOpacity ?? 1) * 100)} onChange={event => setDraft({ ...draft, settingsBackgroundOpacity: Number(event.target.value) / 100 })} /><small className="opacity-value">{Math.round((draft.settingsBackgroundOpacity ?? 1) * 100)}%</small></label>

                      <div className="form-section divided"><h3 id="sec-card-bg">{t('settings.window.cardBackground')}</h3><p>{t('settings.window.cardBackgroundDesc')}</p></div>
                      <label className="check-field tray-bg-field"><span><strong>{t('settings.window.cardBackgroundColor')}</strong><small>{t('settings.window.cardBackgroundColorDesc')}</small></span><input type="color" value={draft.cardBackground ?? '#18201b'} onChange={event => setDraft({ ...draft, cardBackground: event.target.value })} />{draft.cardBackground && <button type="button" className="secondary-button" onClick={() => setDraft({ ...draft, cardBackground: null })}>{t('common.restoreDefault')}</button>}</label>
                      <label className="check-field tray-bg-field"><span><strong>{t('settings.window.cardBackgroundImage')}</strong><small>{t('settings.window.cardBackgroundImageDesc')}</small></span><button type="button" className="secondary-button" disabled={busy} onClick={() => void chooseCardBackground()}><ImagePlus size={15} />{t('settings.window.chooseImage')}</button>{draft.cardBackgroundImage && <button type="button" className="secondary-button" onClick={() => setDraft({ ...draft, cardBackgroundImage: null })}>{t('common.restoreDefault')}</button>}</label>
                      <label className="check-field opacity-field"><span><strong>{t('settings.window.cardBackgroundOpacity')}</strong><small>{t('settings.window.cardBackgroundOpacityDesc')}</small></span><input type="range" min={0} max={100} step={5} value={Math.round((draft.cardBackgroundOpacity ?? 1) * 100)} onChange={event => setDraft({ ...draft, cardBackgroundOpacity: Number(event.target.value) / 100 })} /><small className="opacity-value">{Math.round((draft.cardBackgroundOpacity ?? 1) * 100)}%</small></label>
                      <label className="check-field tray-bg-field"><span><strong>{t('settings.window.cardTextColor')}</strong><small>{t('settings.window.cardTextColorDesc')}</small></span><input type="color" value={draft.cardTextColor ?? '#e8ece9'} onChange={event => setDraft({ ...draft, cardTextColor: event.target.value })} />{draft.cardTextColor && <button type="button" className="secondary-button" onClick={() => setDraft({ ...draft, cardTextColor: null })}>{t('common.restoreDefault')}</button>}</label>
                    </>
                  )}
                </>
              )}

              {category === 'data' && (
                <>
                  {show('API 余额 阈值 充值 告警') && (
                    <>
                      <div className="form-section"><h3 id="sec-balance">{t('settings.data.balance')}</h3><p>{t('settings.data.balanceDesc')}</p></div>
                      <label className="form-field"><span>{t('settings.data.balanceThreshold')}</span><input type="number" min={0} value={draft.balanceThreshold ?? 5} onChange={event => setDraft({ ...draft, balanceThreshold: Number(event.target.value) || 0 })} /></label>
                    </>
                  )}

                  {show('使用引导 教学 巡游') && (
                    <>
                      <div className="form-section divided"><h3 id="sec-guide">{t('settings.data.guide')}</h3><p>{t('settings.data.guideDesc')}</p></div>
                      <label className="check-field" aria-label={t('settings.data.guideAria')}><input type="checkbox" checked={guideAutoShow} onChange={event => setGuideAutoShow(event.target.checked)} /><span><strong>{t('settings.data.guideAuto')}</strong><small>{t('settings.data.guideAutoDesc')}</small></span></label>
                      <div className="settings-inline-actions">
                        <button type="button" className="secondary-button" aria-label={t('settings.data.openGuideAria')} onClick={async () => { setGuideAutoShow(true); const ok = await onSave(draft); if (!ok) return; persistGuide(true); window.dispatchEvent(new Event('dsh-first-run-guide:open')); onClose() }}>{t('settings.data.openGuide')}</button>
                        <small>{t('settings.data.openGuideHint')}</small>
                      </div>
                    </>
                  )}
                </>
              )}

              {category === 'language' && (
                <>
                  {show('语言 界面语言 Language') && (
                    <>
                      <div className="form-section"><h3 id="sec-language">{t('settings.language.title')}</h3><p>{t('settings.language.desc')}</p></div>
                      <div className="theme-options" role="radiogroup" aria-label={t('settings.language.label')}>
                        {LOCALES.map(locale => (
                          <button
                            key={locale.code}
                            type="button"
                            role="radio"
                            aria-checked={draft.language === locale.code}
                            className={`theme-option ${draft.language === locale.code ? 'selected' : ''}`}
                            title={locale.name}
                            onClick={() => setDraft({ ...draft, language: locale.code })}
                          >
                            <span>{locale.native}</span>
                            {draft.language === locale.code && <Check size={14} />}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}

              {category === 'about' && (
                <>
                  {show('关于 检查更新 版本 更新 交流群 开源') && (
                    <>
                      <div className="form-section"><h3 id="sec-about">{t('settings.about.softwareInfo')}</h3></div>
                      <div className="about-brand">
                        <h4>鲸域 · WhaleRealm</h4>
                        <p className="about-slogan">{t('app.slogan')}</p>
                      </div>
                      <p className="about-desc">{t('settings.about.intro')}</p>

                      <div className="form-section divided"><h3>{t('settings.about.basicInfo')}</h3></div>
                      <dl className="instance-detail-list">
                        <div><dt>{t('settings.about.appName')}</dt><dd>{t('settings.about.appNameValue')}</dd></div>
                        <div><dt>{t('settings.about.developer')}</dt><dd>{t('settings.about.developerValue')}</dd></div>
                        <div><dt>{t('settings.about.projectUrl')}</dt><dd><button type="button" className="about-link" onClick={() => void api.openExternal(PROJECT_URL)} title={PROJECT_URL}>{PROJECT_URL}</button></dd></div>
                        <div><dt>{t('settings.about.license')}</dt><dd>GPL-3.0-or-later</dd></div>
                      </dl>

                      <div className="form-section divided"><h3 id="sec-update">{t('settings.about.updateSection')}</h3></div>
                      <div className="about-update-block">
                        <div className="about-update-row"><span>{t('settings.about.version')}</span><strong>{packageMetadata.version}</strong></div>
                        <label className="check-field"><input type="checkbox" checked={draft.autoUpdate !== false} onChange={event => setDraft({ ...draft, autoUpdate: event.target.checked })} /><span><strong>{t('settings.about.autoUpdate')}</strong><small>{t('settings.about.autoUpdateDesc')}</small></span></label>
                        <div className="settings-inline-actions">
                          <button type="button" className="secondary-button" onClick={checkUpdate}>{t('settings.about.checkUpdate')}</button>
                          <button type="button" className="secondary-button" onClick={() => setChangelogOpen(true)}>{t('settings.about.changelog')}</button>
                        </div>
                      </div>

                      <div className="form-section divided"><h3>{t('settings.about.author')}</h3></div>
                      <p className="about-desc">{t('settings.about.authorDesc')}</p>
                      <p className="about-contact">{t('settings.about.contact')}</p>

                      <div className="form-section divided"><h3 id="sec-community">{t('settings.about.community')}</h3></div>
                      <p className="about-desc">{t('settings.about.communityDesc')}</p>
                      <p className="about-community-name">{t('settings.about.communityNameValue')}</p>
                      <div className="community-actions">
                        <button type="button" className="secondary-button" onClick={() => setCommunityDialog('telegram')}>{t('settings.about.joinTelegram')}</button>
                        <button type="button" className="secondary-button" onClick={() => setCommunityDialog('qq')}>{t('settings.about.joinQQ')}</button>
                      </div>
                      <div className="about-notes">
                        <p><strong>{t('settings.about.notesFeedbackTitle')}</strong>{t('settings.about.notesFeedback')}</p>
                        <p><strong>{t('settings.about.notesSuggestTitle')}</strong>{t('settings.about.notesSuggest')}</p>
                        <p><strong>{t('settings.about.notesTrackTitle')}</strong>{t('settings.about.notesTrack')}</p>
                        <p><strong>{t('settings.about.thanksTitle')}</strong>{t('settings.about.thanks')}</p>
                      </div>

                      <div className="form-section divided"><h3 id="sec-docs">{t('settings.about.docsSection')}</h3></div>
                      <p className="about-desc">{t('settings.about.docsIntro')}</p>
                      <div className="community-actions">
                        <button type="button" className="secondary-button" onClick={() => setDocsOpen(true)}><BookOpen size={14} />{t('settings.about.viewDocs')}</button>
                      </div>

                      <div className="form-section divided"><h3 id="sec-open-source">{t('settings.about.openSource')}</h3></div>
                      <p className="about-desc">{t('settings.about.openSourceDesc1')}</p>
                      <p className="about-desc">{t('settings.about.openSourceDesc2')}</p>

                      <details className="about-details">
                        <summary>{t('settings.about.dependenciesTitle')}</summary>
                        <p className="about-desc about-deps">{t('settings.about.dependenciesContent')}</p>
                      </details>
                      <details className="about-details">
                        <summary>{t('settings.about.notesTitle')}</summary>
                        <p className="about-desc">{t('settings.about.notesContent')}</p>
                      </details>

                      <div className="form-section divided"><h3 id="sec-license">{t('settings.about.licenseSection')}</h3></div>
                      <p className="about-desc">{t('settings.about.licenseLine')}</p>
                      <p className="about-desc">{t('settings.about.copyrightLine')}</p>
                      <p className="about-desc">{t('settings.about.attributionRequirement')}</p>
                      <div className="community-actions">
                        <button type="button" className="secondary-button" onClick={() => setLicenseKind('gpl')}><ScrollText size={14} />{t('settings.about.viewGplText')}</button>
                        <button type="button" className="secondary-button" onClick={() => setLicenseKind('third-party')}><ScrollText size={14} />{t('settings.about.viewThirdParty')}</button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <footer>
          <button type="button" className="secondary-button" onClick={requestClose}>{t('common.cancel')}</button>
          <button type="button" className="primary-command" disabled={busy} onClick={async () => { if (await onSave(draft)) { persistGuide(guideAutoShow); onClose() } }}>{busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{t('settings.save')}</button>
        </footer>
      </section>

      {unsavedTarget && (
        <div className="modal-backdrop unsaved-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setUnsavedTarget(null) }}>
          <section className="modal unsaved-dialog" role="dialog" aria-modal="true" aria-labelledby="unsaved-title">
            <header><div><h2 id="unsaved-title">{t('settings.unsaved.title')}</h2></div></header>
            <div className="modal-content">
              <p>{t('settings.unsaved.desc')}</p>
            </div>
            <footer>
              <button type="button" className="secondary-button" onClick={() => setUnsavedTarget(null)}>{t('common.cancel')}</button>
              <button type="button" className="secondary-button" onClick={discardUnsaved}>{t('settings.unsaved.discard')}</button>
              <button type="button" className="primary-command" disabled={busy} onClick={() => void confirmUnsaved()}>{busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{t('settings.unsaved.save')}</button>
            </footer>
          </section>
        </div>
      )}

      {cropDialog && (
        <CropDialog imageName={cropDialog} onCancel={() => setCropDialog(null)} onConfirm={dataUrl => void confirmCrop(dataUrl)} />
      )}

      {docsOpen && <DocsDialog language={language} onClose={() => setDocsOpen(false)} />}

      {licenseKind && <LicenseDialog kind={licenseKind} onClose={() => setLicenseKind(null)} />}

      {communityDialog && (
        <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setCommunityDialog(null) }}>
          <section className="modal community-qr-modal" role="dialog" aria-modal="true" aria-labelledby="community-title">
            <header>
              <div><h2 id="community-title">{communityDialog === 'telegram' ? t('settings.about.telegramChannelTitle') : t('settings.about.qqGroupTitle')}</h2></div>
              <button type="button" className="icon-button" onClick={() => setCommunityDialog(null)} aria-label={t('common.close')}><X size={18} /></button>
            </header>
            <div className="modal-content">
              <img
                className="community-qr"
                src={communityDialog === 'telegram' ? 'launcher-asset://telegram-qr.jpg' : 'launcher-asset://qq-group-qr.jpg'}
                alt={communityDialog === 'telegram' ? t('settings.about.telegramQrAlt') : t('settings.about.qqQrAlt')}
              />
              <button type="button" className="secondary-button community-qr-copy" onClick={() => void copyCommunity()}>{communityDialog === 'telegram' ? t('settings.about.copyLink') : t('settings.about.copyGroupId')}</button>
            </div>
          </section>
        </div>
      )}

      {changelogOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setChangelogOpen(false) }}>
          <section className="modal changelog-dialog" role="dialog" aria-modal="true" aria-labelledby="changelog-title">
            <header>
              <div><h2 id="changelog-title">{t('settings.about.changelogTitle')}</h2></div>
              <button type="button" className="icon-button" onClick={() => setChangelogOpen(false)} aria-label={t('common.close')}><X size={18} /></button>
            </header>
            <div className="modal-content">
              <p className="about-changelog">{t('settings.about.changelogContent')}</p>
            </div>
          </section>
        </div>
      )}

    </div>
  )
}
