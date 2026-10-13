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

import { Layers3, LoaderCircle, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { LauncherApiProvider, resolveLauncherApi, useLauncherApi } from './api/client'
import { describeDeleteFailure } from './delete-feedback'
import { LauncherHome } from './components/LauncherHome'
import { FirstRunGuide } from './components/FirstRunGuide'
import { TrayPanel } from './components/TrayPanel'
import { Toast } from './components/Toast'
import { SettingsDialog } from './components/dialogs/SettingsDialog'
import { UnfinishedCreatesDialog } from './components/dialogs/UnfinishedCreatesDialog'
import { useLauncherStore } from './hooks/use-launcher-store'
import { I18nProvider, translate, useI18n } from './i18n'
import { DEFAULT_LANGUAGE } from './i18n/locales'
import type { TranslationKey } from './i18n/translations/zh-CN'
import type { UnfinishedCreateTask, ProjectReleaseInfo } from './types'
import { isNewer } from './update'
import packageMetadata from '../package.json'

/**
 * 应用根。单界面实例管理：
 * 提供主进程 API、组装实例首页（或托盘面板）、挂载设置对话框与引导。
 */
export default function App() {
  const api = useMemo(() => resolveLauncherApi(), [])
  const isTray = typeof window !== 'undefined' && window.location.hash === '#tray'
  return (
    <LauncherApiProvider value={api}>
      {isTray ? <TrayPanel /> : <LauncherShell />}
    </LauncherApiProvider>
  )
}

function LauncherShell() {
  const api = useLauncherApi()
  const store = useLauncherStore()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<string | undefined>(undefined)
  const [isMaximized, setIsMaximized] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<ProjectReleaseInfo | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [unfinishedCreates, setUnfinishedCreates] = useState<UnfinishedCreateTask[] | null>(null)
  const updateDismissedRef = useRef(false)

  // App 层（Provider 之外）的语言感知翻译，供 toast 文案使用。
  const t = (key: TranslationKey, params?: Record<string, string | number>) =>
    translate(store.settings?.language ?? DEFAULT_LANGUAGE, key, params)

  const dismissUpdate = () => {
    updateDismissedRef.current = true
    setUpdateInfo(null)
    setUpdateError(null)
  }

  // 安装器会关闭当前 Hub；由用户退出后手动安装，避免丢失安装后校验进程。
  const doUpdate = async (release: ProjectReleaseInfo) => {
    setUpdateError(null)
    try {
      await api.openExternal(release.pageUrl)
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : String(error))
    }
  }

  // 启动时通过主进程受信通道检查项目发行版；自动检查只提示，不执行安装。
  // 有更新则弹更新界面，叉掉后本次进程内不再显示。无发行版/网络失败静默
  // （手动检查入口在设置-关于，会给出如实提示）。
  useEffect(() => {
    if (!store.settings || store.settings.autoUpdate === false || updateDismissedRef.current) return
    let disposed = false
    void api.checkProjectRelease().then(result => {
      if (disposed || !result.release) return
      if (!isNewer(result.release, packageMetadata.version)) return
      setUpdateInfo(result.release)
    }).catch(() => undefined)
    return () => { disposed = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.settings])

  // 启动时只读发现上次未完成的创建任务；非空则弹恢复入口（确认清理由用户
  // 明确发起，主进程按任务所有权执行，见 UnfinishedCreatesDialog）。
  useEffect(() => {
    let cancelled = false
    void api.discoverUnfinishedCreates().then(tasks => {
      if (!cancelled && Array.isArray(tasks) && tasks.length > 0) setUnfinishedCreates(tasks)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [api])

  // 托盘面板「设置」→ 主窗口打开设置。
  useEffect(() => api.onOpenSettings(() => setSettingsOpen(true)), [api])

  useEffect(() => {
    document.documentElement.dataset.theme = store.settings?.uiTheme ?? 'graphite'
  }, [store.settings?.uiTheme])

  // 语言同步到 <html lang>，供 CSS hyphens 与无障碍正确断词。
  useEffect(() => {
    document.documentElement.lang = store.settings?.language ?? DEFAULT_LANGUAGE
  }, [store.settings?.language])

  // 自定义强调色：覆盖主题预设的 --accent / --accent-strong / --accent-soft。
  useEffect(() => {
    const root = document.documentElement
    const accent = store.settings?.customAccent
    if (accent) {
      root.style.setProperty('--accent', accent)
      root.style.setProperty('--accent-strong', accent)
      root.style.setProperty('--accent-soft', `${accent}33`)
    } else {
      root.style.removeProperty('--accent')
      root.style.removeProperty('--accent-strong')
      root.style.removeProperty('--accent-soft')
    }
  }, [store.settings?.customAccent])

  // 自定义主界面插图经 launcher-asset:// 协议注入 CSS 变量；置空回落内置默认背景图。
  useEffect(() => {
    const root = document.documentElement
    const background = store.settings?.launcherBackground
    if (background) root.style.setProperty('--launcher-background-image', `url("launcher-asset://${background}")`)
    else root.style.setProperty('--launcher-background-image', 'url("launcher-asset://launcher-background.png")')
  }, [store.settings?.launcherBackground])

  // 背景不透明度 + 暗度：注入 --launcher-opacity（0..1）与 --launcher-dim（rgba 遮罩）。
  useEffect(() => {
    const root = document.documentElement
    const opacity = store.settings?.launcherOpacity
    if (opacity !== undefined) root.style.setProperty('--launcher-opacity', String(opacity))
    else root.style.removeProperty('--launcher-opacity')
    const dim = store.settings?.launcherDim
    root.style.setProperty('--launcher-dim', `rgba(15, 20, 17, ${dim ?? 0.55})`)
  }, [store.settings?.launcherOpacity, store.settings?.launcherDim])

  // 实例列表上下边缘渐变（类型 + 范围）。
  useEffect(() => {
    const root = document.documentElement
    root.dataset.listFade = store.settings?.listFadeType ?? 'gradient'
    root.style.setProperty('--list-fade-size', `${store.settings?.listFadeSize ?? 40}px`)
  }, [store.settings?.listFadeType, store.settings?.listFadeSize])

  // 实例卡片样式：圆角 + 间距密度 + 背景色/背景图/透明度/字体颜色。
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--card-radius', `${store.settings?.cardRadius ?? 14}px`)
    root.dataset.cardDensity = store.settings?.cardDensity ?? 'normal'
    const cb = store.settings?.cardBackground
    if (cb) root.style.setProperty('--card-background', cb)
    else root.style.removeProperty('--card-background')
    const cbi = store.settings?.cardBackgroundImage
    if (cbi) root.style.setProperty('--card-background-image', `url("launcher-asset://${cbi}")`)
    else root.style.removeProperty('--card-background-image')
    root.style.setProperty('--card-background-opacity', String(store.settings?.cardBackgroundOpacity ?? 1))
    const ctc = store.settings?.cardTextColor
    if (ctc) root.style.setProperty('--card-text-color', ctc)
    else root.style.removeProperty('--card-text-color')
  }, [store.settings?.cardRadius, store.settings?.cardDensity, store.settings?.cardBackground, store.settings?.cardBackgroundImage, store.settings?.cardBackgroundOpacity, store.settings?.cardTextColor])

  // 设置界面背景色 + 背景图 + 透明度。
  useEffect(() => {
    const root = document.documentElement
    const bg = store.settings?.settingsBackground
    if (bg) root.style.setProperty('--settings-background', bg)
    else root.style.removeProperty('--settings-background')
    const bgi = store.settings?.settingsBackgroundImage
    if (bgi) root.style.setProperty('--settings-background-image', `url("launcher-asset://${bgi}")`)
    else root.style.removeProperty('--settings-background-image')
    root.style.setProperty('--settings-background-opacity', String(store.settings?.settingsBackgroundOpacity ?? 1))
  }, [store.settings?.settingsBackground, store.settings?.settingsBackgroundImage, store.settings?.settingsBackgroundOpacity])

  const closeWindow = () => void api.closeWindow()
  const minimizeWindow = () => void api.minimizeWindow()
  const toggleMaximizeWindow = () => {
    // Flip optimistically so the button always reflects the toggle immediately;
    // the main process mirrors this with its own in-memory maximized flag.
    setIsMaximized(current => !current)
    void api.toggleMaximizeWindow()
  }

  if (store.loading || !store.settings) {
    return (
      <I18nProvider language={DEFAULT_LANGUAGE}>
        <LoadingScreen />
      </I18nProvider>
    )
  }

  return (
    <I18nProvider language={store.settings.language ?? DEFAULT_LANGUAGE}>
      <FirstRunGuide />
      <div className="surface-stage">
        <LauncherHome
          instances={store.instances}
          instanceStates={store.instanceStates}
          selectedInstanceId={store.selectedInstanceId}
          usageByInstance={store.usageByInstance}
          mirrorChanges={store.mirrorChanges}
          dangerConfirm={store.settings.dangerConfirm !== false}
          removeShortcuts={store.settings.removeDesktopShortcuts === true}
          headerKicker={store.settings.headerKicker}
          headerTitle={store.settings.headerTitle}
          headerSubtitle={store.settings.headerSubtitle}
          footerSlogan={store.settings.footerSlogan}
          onSelectInstance={store.selectInstance}
          onStartInstance={async id => {
            const next = await store.startInstance(id)
            // 启动实例后自动关闭（隐藏到托盘）或自动最小化（设置里可关）。
            if (store.settings?.autoCloseOnStart === true) void api.hideWindow()
            else if (store.settings?.autoMinimizeOnStart !== false) void api.minimizeWindow()
            return next
          }}
          onStopInstance={store.stopInstance}
          onRestartInstance={store.restartInstance}
          onPauseInstance={store.pauseInstance}
          onResumeInstance={store.resumeInstance}
          onSetPortInstance={async (id, port) => {
            const next = await store.setInstancePort(id, port)
            store.showToast({ kind: 'success', message: t('toast.portSet', { port: next.port }) + (next.port !== port ? t('toast.portConflictSuffix') : '') })
          }}
          onRenameInstance={store.renameInstance}
          onDeleteInstance={async (id, options) => {
            try {
              const result = await store.deleteInstance(id, options)
              store.showToast({
                kind: 'success',
                message: options.mode === 'purge' ? t('toast.instanceDeleted') : t('toast.instanceUnregistered'),
              })
              return result
            } catch (error) {
              // 删除失败必须显式提示，否则对话框照常关闭、列表毫无变化，
              // 用户会误以为“删除无效”。旧版/共享实例缺少所有权证明时主进程
              // fail-closed 拒绝回收（文件保留），此处给出改用「仅移除注册」的引导。
              const feedback = describeDeleteFailure(error, t)
              const root = store.instances.find(item => item.id === id)?.root
              store.showToast({
                kind: 'error',
                message: feedback.message,
                action: feedback.ownershipBlocked && root
                  ? { label: t('toast.openInstanceFolder'), onClick: () => { void api.openPath(root) } }
                  : undefined,
              })
              return undefined
            }
          }}
          onDiscoverInstances={async () => {
            const result = await store.discoverInstances()
            if (!result.ok) { store.showToast({ kind: 'error', message: result.error ?? t('toast.scanFailed') }); return null }
            const roots = new Set(store.instances.map(item => (item.runtimeRoot ?? '').toLowerCase()))
            const pending = result.installs.filter(item => !roots.has(item.path.toLowerCase()))
            if (pending.length === 0) store.showToast({ kind: 'success', message: t('toast.discoveredNone') })
            return pending
          }}
          onImportInstance={async installPath => {
            const result = await store.importInstance(installPath)
            store.showToast({
              kind: result.ok ? 'success' : 'error',
              message: result.ok
                ? result.registered ? t('toast.importRegistered') : result.reason ?? t('toast.importListed')
                : result.error ?? t('toast.importFailed'),
            })
            // 收录后检测桌面快捷方式（设置开启时提示删除，只删快捷方式、移入回收站可还原）。
            if (result.ok && result.record && store.settings?.removeDesktopShortcuts === true) {
              const id = result.record.id
              const sc = await api.findInstanceShortcuts(id).catch(() => null)
              if (sc && sc.shortcuts.length > 0) {
                store.showToast({
                  kind: 'success',
                  message: t('toast.shortcutDetected', { count: sc.shortcuts.length }),
                  action: {
                    label: t('toast.trashShortcuts'),
                    onClick: () => {
                      void api.removeInstanceShortcuts(id).then(r => store.showToast({ kind: 'success', message: t('toast.shortcutsTrashed', { count: r.trashed.length }) }))
                    },
                  },
                })
              }
            }
            return result
          }}
          onCreateInstance={async input => {
            const result = await api.createInstance({ taskId: input.taskId, name: input.name, path: input.path, kind: input.kind, version: input.version.version, downloadUrl: input.version.downloadUrl })
            if (!result.ok) throw new Error(result.error ?? t('toast.createFailed'))
            store.showToast({ kind: 'success', message: t('toast.instanceCreated', { name: input.name }) })
            await store.refreshInstances()
          }}
          onOpenFolder={path => { void api.openPath(path) }}
          onOpenSettings={sectionId => { setSettingsSection(sectionId); setSettingsOpen(true) }}
          isMaximized={isMaximized}
          onMinimize={minimizeWindow}
          onToggleMaximize={toggleMaximizeWindow}
          onClose={closeWindow}
          balance={store.balance}
          balanceThreshold={store.settings.balanceThreshold ?? 5}
          onRecharge={() => { void api.openExternal('https://platform.deepseek.com/top_up') }}
        />
      </div>

      {settingsOpen && store.settings && (
        <SettingsDialog
          settings={store.settings}
          busy={store.busy === 'settings'}
          initialSection={settingsSection}
          onClose={() => { setSettingsOpen(false); setSettingsSection(undefined) }}
          onSave={next => store.saveSettings(next)}
          onNotify={(kind, message) => store.showToast({ kind, message })}
          onUpdateAvailable={release => {
            // 手动检查发现新版本 → 显示发行页入口与手动安装说明。
            updateDismissedRef.current = false
            setUpdateInfo(release)
            setUpdateError(null)
          }}
          onMinimize={minimizeWindow}
          onToggleMaximize={toggleMaximizeWindow}
          isMaximized={isMaximized}
        />
      )}

      {updateInfo && (
        <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) dismissUpdate() }}>
          <section className="modal update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-title">
            <header>
              <div><h2 id="update-title">{t('settings.about.updateAvailable')}</h2></div>
              <button type="button" className="icon-button" onClick={dismissUpdate} aria-label={t('common.close')}><X size={18} /></button>
            </header>
            <div className="modal-content">
              <p className="about-update-time"><strong>{t('settings.about.version')}</strong> {updateInfo.version} · <strong>{t('settings.about.releaseTime')}</strong> {updateInfo.publishedAt.slice(0, 10)}</p>
              <p className="about-changelog">{updateInfo.notes}</p>
              <p className="about-desc">{t('settings.about.manualUpdateHint')}</p>
              {updateError && <p className="about-desc" role="alert">{updateError}</p>}
              <div className="settings-inline-actions">
                <button type="button" className="primary-command" onClick={() => void doUpdate(updateInfo)}>{t('settings.about.openRelease')}</button>
                <button type="button" className="secondary-button" onClick={dismissUpdate}>{t('settings.about.updateLater')}</button>
              </div>
            </div>
          </section>
        </div>
      )}

      {unfinishedCreates && unfinishedCreates.length > 0 && (
        <UnfinishedCreatesDialog tasks={unfinishedCreates} onDismiss={() => setUnfinishedCreates(null)} />
      )}

      {store.toast && <Toast toast={store.toast} onClose={store.dismissToast} />}
    </I18nProvider>
  )
}

/** 加载态：位于 I18nProvider 内，文案随语言切换。 */
function LoadingScreen() {
  const { t } = useI18n()
  return (
    <div className="app-loading">
      <div className="brand-mark"><Layers3 size={22} /></div>
      <LoaderCircle className="spin" size={22} />
      <span>{t('app.loading')}</span>
    </div>
  )
}
