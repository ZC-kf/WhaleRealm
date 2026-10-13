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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, FolderOpen, Pause, Play, RefreshCw, Settings2, Square, X } from 'lucide-react'
import { useLauncherApi } from '../api/client'
import { NumberField } from './NumberField'
import { I18nProvider, useI18n } from '../i18n'
import { describeActionFailure } from '../delete-feedback'
import { DEFAULT_LANGUAGE } from '../i18n/locales'
import type { TranslationKey } from '../i18n/translations/zh-CN'
import type { AppSettings, DeepSeekBalanceResult, DeleteInstanceMode, DeleteInstanceOptions, DesktopInstance, InstanceRuntimeState, SkipScanMode } from '../types'

function statusLabel(t: (key: TranslationKey) => string, status: InstanceRuntimeState['status']): string {
  switch (status) {
    case 'ready': return t('status.ready')
    case 'starting': return t('status.starting')
    case 'paused': return t('status.paused')
    case 'crashed': return t('status.crashedShort')
    default: return t('status.stopped')
  }
}

const THEME_OPTIONS: Array<{ value: AppSettings['uiTheme']; labelKey: TranslationKey; dot: string }> = [
  { value: 'forest', labelKey: 'theme.forest', dot: '#4fbf8a' },
  { value: 'ocean', labelKey: 'theme.ocean', dot: '#4f9fe0' },
  { value: 'berry', labelKey: 'theme.berry', dot: '#d46bb0' },
  { value: 'graphite', labelKey: 'theme.graphite', dot: '#8b96a5' },
]

/** 托盘弹出面板：滚轮 + 左/双击快捷操作所有实例；右侧集成紧凑设置面板。 */
export function TrayPanel() {
  const api = useLauncherApi()
  const [settings, setSettings] = useState<AppSettings | null>(null)

  const refreshSettings = useCallback(async () => {
    try { setSettings(await api.getSettings()) } catch { /* 主进程不可达时保持现状 */ }
  }, [api])

  useEffect(() => {
    void refreshSettings()
    const timer = window.setInterval(() => { void refreshSettings() }, 4000)
    return () => window.clearInterval(timer)
  }, [refreshSettings])

  const saveSettings = useCallback(async (patch: Partial<AppSettings>) => {
    if (!settings) return
    const next = { ...settings, ...patch }
    setSettings(next)
    void api.saveSettings(next).catch(() => undefined)
  }, [api, settings])

  return (
    <I18nProvider language={settings?.language ?? DEFAULT_LANGUAGE}>
      <TrayPanelContent settings={settings} onSaveSettings={saveSettings} />
    </I18nProvider>
  )
}

function TrayPanelContent({ settings, onSaveSettings }: { settings: AppSettings | null; onSaveSettings: (patch: Partial<AppSettings>) => void }) {
  const api = useLauncherApi()
  const { t } = useI18n()
  const [instances, setInstances] = useState<DesktopInstance[]>([])
  const [states, setStates] = useState<InstanceRuntimeState[]>([])
  const [balance, setBalance] = useState<DeepSeekBalanceResult | null>(null)
  const [runningIndex, setRunningIndex] = useState(0)
  const [expandedStopped, setExpandedStopped] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [deleteMode, setDeleteMode] = useState<DeleteInstanceMode>('unregister')
  const [skipScan, setSkipScan] = useState<SkipScanMode>('none')
  const [skipDays, setSkipDays] = useState('7')
  const [purgeAck, setPurgeAck] = useState(false)
  const [shortcuts, setShortcuts] = useState<string[]>([])
  const [removeShortcuts, setRemoveShortcuts] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const stoppedClickRef = useRef<{ timer: number | null }>({ timer: null })
  const settingsBtnRef = useRef<HTMLButtonElement>(null)

  const refresh = async () => {
    try {
      const [insts, sts] = await Promise.all([api.listInstances(), api.listInstanceStates()])
      setInstances(insts)
      setStates(sts)
      void api.deepseekBalance().then(setBalance).catch(() => undefined)
    } catch { /* 主进程不可达时保持现状 */ }
  }

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 4000)
    return () => window.clearInterval(timer)
  }, [])

  // 托盘默认跟随主界面主题；可独立指定托盘主题/强调色/背景色。
  useEffect(() => {
    if (!settings) return
    const root = document.documentElement
    const theme = settings.trayTheme === 'auto' ? (settings.uiTheme ?? 'graphite') : settings.trayTheme
    root.dataset.theme = theme
    const accent = settings.trayTheme === 'auto' ? settings.customAccent : settings.trayCustomAccent
    if (accent) {
      root.style.setProperty('--accent', accent)
      root.style.setProperty('--accent-strong', accent)
      root.style.setProperty('--accent-soft', `${accent}33`)
    } else {
      root.style.removeProperty('--accent')
      root.style.removeProperty('--accent-strong')
      root.style.removeProperty('--accent-soft')
    }
    if (settings.trayBackground) root.style.setProperty('--tray-background', settings.trayBackground)
    else root.style.removeProperty('--tray-background')
    if (settings.trayBackgroundImage) root.style.setProperty('--tray-background-image', `url("launcher-asset://${settings.trayBackgroundImage}")`)
    else root.style.setProperty('--tray-background-image', 'url("launcher-asset://tray-background-default.png")')
    root.style.setProperty('--tray-background-dim', `rgba(15, 20, 17, ${settings.trayBackgroundDim ?? 0.55})`)
    root.style.setProperty('--tray-background-opacity', String(settings.trayBackgroundOpacity ?? 1))
  }, [settings])

  // 点击托盘内空白位置自动收回：设置抽屉 + 展开的未启动功能。
  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Element
      if (settingsOpen && !target.closest('.tray-settings') && !settingsBtnRef.current?.contains(target)) setSettingsOpen(false)
      if (expandedStopped && !target.closest('.tray-stopped-row')) setExpandedStopped(null)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [settingsOpen, expandedStopped])

  const running = useMemo(
    () => instances.filter(inst => states.some(s => s.instanceId === inst.id && (s.status === 'ready' || s.status === 'starting' || s.status === 'paused'))),
    [instances, states],
  )
  const stopped = useMemo(
    () => instances.filter(inst => !states.some(s => s.instanceId === inst.id && (s.status === 'ready' || s.status === 'starting' || s.status === 'paused'))),
    [instances, states],
  )
  const current = running.length > 0 ? running[((runningIndex % running.length) + running.length) % running.length] : null
  const currentState = current ? states.find(s => s.instanceId === current.id) : undefined
  const detailInst = detailId ? instances.find(i => i.id === detailId) : undefined
  const detailState = detailInst ? states.find(s => s.instanceId === detailInst.id) : undefined

  // 滚轮切换运行中的实例；覆盖运行区 + 功能按钮区，不跳转主界面。
  const onRunningWheel = (event: React.WheelEvent) => {
    if (running.length <= 1) return
    event.preventDefault()
    setRunningIndex(index => (index + (event.deltaY > 0 ? 1 : -1) + running.length) % running.length)
  }

  // 托盘独立窗口（#tray）与主窗口不共享 store：托盘内动作失败无法经主窗口 toast 呈现
  // （不存在该 IPC 通道），故在此聚合成面板顶部内联错误条。返回是否成功，
  // 供调用方决定后续（如仅启动成功后才「启动后自动关闭」）。
  const act = async (fn: () => Promise<unknown>, fallbackKey: TranslationKey = 'tray.actionFailed'): Promise<boolean> => {
    try { await fn(); setActionError(null); await refresh(); return true }
    catch (error) { setActionError(describeActionFailure(error, t, fallbackKey).message); return false }
  }

  // 未启动实例：单击展示功能，双击启动（无右键菜单）。
  const onStoppedClick = (inst: DesktopInstance) => {
    if (stoppedClickRef.current.timer) window.clearTimeout(stoppedClickRef.current.timer)
    stoppedClickRef.current.timer = window.setTimeout(() => {
      setExpandedStopped(cur => (cur === inst.id ? null : inst.id))
    }, 220)
  }
  const onStoppedDoubleClick = (inst: DesktopInstance) => {
    if (stoppedClickRef.current.timer) { window.clearTimeout(stoppedClickRef.current.timer); stoppedClickRef.current.timer = null }
    void startInstance(inst)
  }

  // 启动实例；若开启「启动后自动关闭」，随后关闭托盘弹出面板。
  const startInstance = async (inst: DesktopInstance) => {
    // 启动前校验镜像：与当前镜像不符时询问「更新镜像进入 / 还原镜像进入」。
    const status = await api.instanceMirrorStatus(inst.id).catch(() => null)
    if (status && status.hasSnapshot && status.changed.length + status.added.length + status.removed.length > 0) {
      const update = window.confirm(t('tray.mirrorMismatch', { name: inst.name ?? inst.id }))
      if (update) await api.instanceMirrorUpdate(inst.id).catch(() => undefined)
      else await api.instanceMirrorRestore(inst.id).catch(() => undefined)
    }
    const started = await act(() => api.startInstance(inst.id))
    if (started && settings?.autoCloseOnStart === true) void api.closeTray()
  }

  const openDelete = (inst: DesktopInstance) => {
    setDeleteTarget({ id: inst.id, name: inst.name ?? inst.id })
    setDeleteMode('unregister')
    setSkipScan('none')
    setSkipDays('7')
    setPurgeAck(false)
    setRemoveShortcuts(false)
    setShortcuts([])
    setExpandedStopped(null)
    if (settings?.removeDesktopShortcuts === true) {
      void api.findInstanceShortcuts(inst.id).then(result => setShortcuts(result.shortcuts ?? [])).catch(() => setShortcuts([]))
    }
  }

  const confirmDelete = () => {
    if (!deleteTarget) return
    if (deleteMode === 'purge' && settings?.dangerConfirm !== false && !purgeAck) return
    const options: DeleteInstanceOptions = {
      mode: deleteMode,
      skipScan: deleteMode === 'unregister' ? skipScan : 'none',
      skipScanDays: Math.max(0, Math.floor(Number(skipDays) || 0)),
      removeShortcuts: removeShortcuts && shortcuts.length > 0,
    }
    void act(() => api.deleteInstance(deleteTarget.id, options), 'toast.deleteFailed')
    setDeleteTarget(null)
  }

  const balanceText = balance && balance.status === 'ok'
    ? t('balance.label', { amount: balance.balance.infos.reduce((sum, info) => sum + (info.totalBalance ?? 0), 0).toFixed(2) })
    : balance?.status === 'no-key' ? t('tray.balanceNoKey') : ''

  return (
    <div className="tray-panel">
      <div className="tray-main">
        <div className="tray-panel-header">
          <span>鲸域 · WhaleRealm</span>
          <span className="tray-panel-balance">{balanceText}</span>
        </div>

        {actionError && (
          <div className="tray-error-strip" role="alert">
            <span>{actionError}</span>
            <button type="button" className="icon-button" aria-label={t('common.close')} onClick={() => setActionError(null)}><X size={14} /></button>
          </div>
        )}

        {detailInst ? (
          <div className="tray-panel-section tray-detail">
            <div className="tray-detail-head">
              <button type="button" onClick={() => setDetailId(null)}>{t('tray.back')}</button>
              <strong>{detailInst.name ?? detailInst.id}</strong>
              <small>{statusLabel(t, detailState?.status ?? 'stopped')} · :{detailInst.port}</small>
            </div>
            <dl className="tray-detail-list">
              <div><dt>{t('detail.version')}</dt><dd>{detailInst.version ?? t('instance.official')}</dd></div>
              <div><dt>{t('detail.pid')}</dt><dd>{detailState?.pid ?? '—'}</dd></div>
              <div><dt>{t('detail.url')}</dt><dd>{detailState?.url ?? '—'}</dd></div>
              <div><dt>{t('detail.runtime')}</dt><dd>{detailInst.runtimeRoot ?? '—'}</dd></div>
              <div><dt>{t('detail.stateRoot')}</dt><dd>{detailInst.dshHome}</dd></div>
              <div><dt>{t('detail.electronUserData')}</dt><dd>{detailInst.electronUserData}</dd></div>
              <div><dt>{t('detail.workspace')}</dt><dd>{detailInst.workspace}</dd></div>
              <div><dt>{t('detail.logs')}</dt><dd>{detailInst.logs}</dd></div>
              <div><dt>{t('detail.lock')}</dt><dd>{detailInst.lockName}</dd></div>
            </dl>
          </div>
        ) : (
          <>
            <div className="tray-panel-section tray-running" onWheel={onRunningWheel}>
              <div className="tray-panel-title">{t('tray.running')}{running.length > 1 ? t('tray.wheelSwitch') : ''}</div>
              {current ? (
                <>
                  <div className="tray-current">
                    <span className={`tray-status-dot status-${currentState?.status ?? 'stopped'}`} />
                    <strong>{current.name ?? current.id}</strong>
                    <small>{statusLabel(t, currentState?.status ?? 'stopped')} · :{current.port}</small>
                  </div>
                  <div className="tray-panel-actions" onWheel={onRunningWheel}>
                    {currentState?.status === 'paused'
                      ? <button type="button" onClick={() => void act(() => api.resumeInstance(current.id))}><Play size={13} />{t('action.resume')}</button>
                      : <button type="button" onClick={() => void act(() => api.stopInstance(current.id))}><Square size={13} />{t('action.stop')}</button>}
                    <button type="button" disabled={currentState?.status === 'paused'} onClick={() => void act(() => api.pauseInstance(current.id))}><Pause size={13} />{t('action.pause')}</button>
                    <button type="button" onClick={() => void act(() => api.restartInstance(current.id))}><RefreshCw size={13} />{t('action.restart')}</button>
                    <button type="button" disabled={currentState?.status !== 'ready' || !currentState?.url} onClick={() => void act(() => api.openInstance(current.id))} title={t('tray.openUrlHint')}><ExternalLink size={13} />{t('action.openUrl')}</button>
                    <button type="button" onClick={() => void api.openPath(current.root)} title={t('action.folder')}><FolderOpen size={13} />{t('action.folder')}</button>
                    <button type="button" onClick={() => void act(async () => { for (const inst of running) await api.stopInstance(inst.id).catch(() => undefined) })}><Square size={13} />{t('action.stopAll')}</button>
                  </div>
                </>
              ) : (
                <div className="tray-panel-empty">{t('tray.emptyRunning')}</div>
              )}
            </div>

            <div className="tray-panel-section tray-stopped">
              <div className="tray-panel-title">{t('tray.stopped')}{stopped.length > 0 ? t('tray.clickHint') : ''}</div>
              <div className="tray-stopped-list">
                {stopped.map(inst => {
                  const state = states.find(s => s.instanceId === inst.id)
                  return (
                    <div
                      key={inst.id}
                      className="tray-stopped-row"
                      onClick={() => onStoppedClick(inst)}
                      onDoubleClick={() => onStoppedDoubleClick(inst)}
                    >
                      <span className={`tray-status-dot status-${state?.status ?? 'stopped'}`} />
                      <strong>{inst.name ?? inst.id}</strong>
                      <small>:{inst.port}</small>
                      {expandedStopped === inst.id && (
                        <div className="tray-stopped-functions" onClick={event => event.stopPropagation()}>
                          <button type="button" onClick={() => void startInstance(inst)}>{t('action.start')}</button>
                          <button type="button" onClick={() => { setDetailId(inst.id); setExpandedStopped(null) }}>{t('action.detail')}</button>
                          <button type="button" onClick={() => void api.openPath(inst.root)} title={t('action.folder')}>{t('action.folder')}</button>
                          <button type="button" onClick={() => openDelete(inst)}>{t('action.remove')}</button>
                        </div>
                      )}
                    </div>
                  )
                })}
                {stopped.length === 0 && <div className="tray-panel-empty">{t('tray.emptyStopped')}</div>}
              </div>
            </div>
          </>
        )}

        <div className="tray-panel-footer">
          <button type="button" onClick={() => { void api.showMainWindow() }}>{t('action.openMain')}</button>
          <button type="button" ref={settingsBtnRef} className={settingsOpen ? 'is-active' : ''} onClick={() => setSettingsOpen(cur => !cur)}><Settings2 size={13} />{t('common.settings')}</button>
          <button type="button" className="tray-quit" onClick={() => { void api.quitApp() }}>{t('action.quit')}</button>
        </div>
      </div>

      {settingsOpen && settings && (
        <aside className="tray-settings" aria-label={t('tray.settingsPanelAria')}>
          <div className="tray-settings-head">
            <span>{t('tray.settingsPanel')}</span>
            <button type="button" className="icon-button" aria-label={t('tray.closeSettingsAria')} onClick={() => setSettingsOpen(false)}><X size={14} /></button>
          </div>
          <div className="tray-settings-body">
            <div className="tray-setting-group">
              <span className="tray-setting-label">{t('tray.theme')}</span>
              <div className="tray-theme-grid">
                {THEME_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`tray-theme-option${settings.uiTheme === opt.value ? ' is-active' : ''}`}
                    title={t(opt.labelKey)}
                    onClick={() => void onSaveSettings({ uiTheme: opt.value })}
                  >
                    <span className="tray-theme-dot" style={{ background: opt.dot }} />
                    {t(opt.labelKey)}
                  </button>
                ))}
              </div>
            </div>

            <label className="tray-setting-group">
              <span className="tray-setting-label">{t('tray.accent')}</span>
              <input type="color" value={settings.customAccent ?? '#4fbf8a'} onChange={event => void onSaveSettings({ customAccent: event.target.value })} />
            </label>

            <div className="tray-setting-group">
              <span className="tray-setting-label">{t('tray.backgroundColor')}</span>
              <input type="color" value={settings.trayBackground ?? '#0f1512'} onChange={event => void onSaveSettings({ trayBackground: event.target.value })} />
              {settings.trayBackground && <button type="button" className="secondary-button" onClick={() => void onSaveSettings({ trayBackground: null })}>{t('tray.followMain')}</button>}
            </div>

            <div className="tray-setting-group">
              <span className="tray-setting-label">{t('tray.balanceThreshold')}</span>
              <input type="number" min={0} value={settings.balanceThreshold ?? 5} onChange={event => void onSaveSettings({ balanceThreshold: Number(event.target.value) || 0 })} />
            </div>

            {[
              { key: 'trayMinimize' as const, labelKey: 'tray.closeToTray' as TranslationKey },
              { key: 'dangerConfirm' as const, labelKey: 'tray.dangerConfirm' as TranslationKey },
            ].map(item => (
              <button
                key={item.key}
                type="button"
                className={`tray-toggle${settings[item.key] !== false ? ' is-on' : ''}`}
                onClick={() => void onSaveSettings({ [item.key]: settings[item.key] === false })}
              >
                <span className="tray-toggle-track"><span className="tray-toggle-thumb" /></span>
                {t(item.labelKey)}
              </button>
            ))}
            <button
              type="button"
              className={`tray-toggle${settings.autoMinimizeOnStart !== false ? ' is-on' : ''}`}
              onClick={() => void onSaveSettings({ autoMinimizeOnStart: settings.autoMinimizeOnStart === false, autoCloseOnStart: settings.autoMinimizeOnStart === false ? false : settings.autoCloseOnStart })}
            >
              <span className="tray-toggle-track"><span className="tray-toggle-thumb" /></span>
              {t('tray.autoMinimize')}
            </button>
            <button
              type="button"
              className={`tray-toggle${settings.autoCloseOnStart === true ? ' is-on' : ''}`}
              onClick={() => void onSaveSettings({ autoCloseOnStart: settings.autoCloseOnStart !== true, autoMinimizeOnStart: settings.autoCloseOnStart !== true ? false : settings.autoMinimizeOnStart })}
            >
              <span className="tray-toggle-track"><span className="tray-toggle-thumb" /></span>
              {t('tray.autoClose')}
            </button>
          </div>
        </aside>
      )}

      {deleteTarget && (
        <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setDeleteTarget(null) }}>
          <section className="modal delete-dialog" role="dialog" aria-modal="true" aria-labelledby="tray-delete-title">
            <header><div><h2 id="tray-delete-title">{t('dialog.deleteTitle', { name: deleteTarget.name })}</h2></div><button type="button" className="icon-button" onClick={() => setDeleteTarget(null)} aria-label={t('dialog.deleteClose')}><X size={16} /></button></header>
            <div className="modal-content">
              <label className={`delete-mode-option${deleteMode === 'unregister' ? ' is-selected' : ''}`}>
                <input type="radio" name="tray-delete-mode" checked={deleteMode === 'unregister'} onChange={() => setDeleteMode('unregister')} />
                <span className="delete-mode-body">
                  <strong>{t('dialog.deleteUnregister')}</strong>
                  <p>{t('tray.deleteUnregisterDesc')}</p>
                </span>
              </label>
              {deleteMode === 'unregister' && (
                <div className="delete-skip-options">
                  <label><input type="radio" name="tray-skip" checked={skipScan === 'none'} onChange={() => setSkipScan('none')} /> {t('dialog.deleteSkipNone')}</label>
                  <label><input type="radio" name="tray-skip" checked={skipScan === 'temporary'} onChange={() => setSkipScan('temporary')} /> <NumberField value={Number(skipDays) || 0} min={1} max={365} onChange={next => setSkipDays(String(next))} /> {t('tray.deleteSkipTemp')}</label>
                  <label><input type="radio" name="tray-skip" checked={skipScan === 'permanent'} onChange={() => setSkipScan('permanent')} /> {t('dialog.deleteSkipPermanent')}</label>
                </div>
              )}
              <label className={`delete-mode-option danger${deleteMode === 'purge' ? ' is-selected' : ''}`}>
                <input type="radio" name="tray-delete-mode" checked={deleteMode === 'purge'} onChange={() => setDeleteMode('purge')} />
                <span className="delete-mode-body">
                  <strong>{t('dialog.deletePurge')}</strong>
                  <p>{t('tray.deletePurgeDesc')}</p>
                </span>
              </label>
              {deleteMode === 'purge' && settings?.dangerConfirm !== false && (
                <label className="check-field delete-ack">
                  <input type="checkbox" checked={purgeAck} onChange={event => setPurgeAck(event.target.checked)} />
                  <span><strong>{t('dialog.deleteAckTitle')}</strong><small>{t('dialog.deleteAckDesc')}</small></span>
                </label>
              )}
              {shortcuts.length > 0 && (
                <label className="check-field delete-ack">
                  <input type="checkbox" checked={removeShortcuts} onChange={event => setRemoveShortcuts(event.target.checked)} />
                  <span><strong>{t('dialog.deleteShortcutTitle', { count: shortcuts.length })}</strong><small>{t('dialog.deleteShortcutDesc')}</small></span>
                </label>
              )}
            </div>
            <footer>
              <button type="button" className="secondary-button" onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</button>
              <button type="button" className={`primary-command${deleteMode === 'purge' ? ' danger' : ''}`} disabled={deleteMode === 'purge' && settings?.dangerConfirm !== false && !purgeAck} onClick={confirmDelete}>
                {deleteMode === 'purge' ? t('dialog.deletePurgeConfirm') : t('dialog.deleteConfirm')}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  )
}
