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

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FolderOpen,
  LayoutGrid,
  List,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldX,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { useLauncherApi } from '../api/client'
import { NumberField } from './NumberField'
import { formatTokens } from '../lib/format'
import { useI18n } from '../i18n'
import type { TranslationKey } from '../i18n/translations/zh-CN'
import { SETTINGS_SECTIONS } from '../settings-sections'
import { CreateInstanceDialog, type CreateInstanceInput } from './dialogs/CreateInstanceDialog'
import type { DeleteInstanceMode, DeleteInstanceOptions, DesktopInstance, DiscoveredInstall, DshUsageResult, InstanceImportResult, InstanceKind, InstanceMirrorStatus, InstanceRuntimeState, SkipScanMode } from '../types'

type ViewMode = 'list' | 'card'
type UsageMode = 'today' | 'total'

interface InstanceSwitcherProps {
  instances: DesktopInstance[]
  states: InstanceRuntimeState[]
  selectedId?: string
  usage: Record<string, DshUsageResult>
  mirrorChanges: Record<string, { count: number; hasChanges: boolean }>
  dangerConfirm: boolean
  removeShortcuts: boolean
  headerKicker: string
  headerTitle: string
  headerSubtitle: string
  onSelect: (id: string) => Promise<unknown>
  onStart: (id: string) => Promise<unknown>
  onStop: (id: string) => Promise<unknown>
  onRestart: (id: string) => Promise<unknown>
  onPause: (id: string) => Promise<unknown>
  onResume: (id: string) => Promise<unknown>
  onSetPort: (id: string, port: number) => Promise<unknown>
  onRename: (id: string, name: string) => Promise<unknown>
  onDelete: (id: string, options: DeleteInstanceOptions) => Promise<unknown>
  onOpenFolder: (path: string) => void
  onOpenSettings: (sectionId?: string) => void
  /** 扫描收录：返回未收录的发行体清单（无未收录返回空数组或 null）。 */
  onDiscover?: () => Promise<DiscoveredInstall[] | null>
  onImport?: (path: string) => Promise<InstanceImportResult>
  /** 新建实例（流水线由 App 层实现）。 */
  onCreateInstance?: (input: CreateInstanceInput) => Promise<unknown>
}

function statusLabel(t: (key: TranslationKey) => string, status: InstanceRuntimeState['status']): string {
  switch (status) {
    case 'ready': return t('status.ready')
    case 'starting': return t('status.starting')
    case 'stopping': return t('status.stopping')
    case 'crashed': return t('status.crashed')
    case 'paused': return t('status.paused')
    default: return t('status.stopped')
  }
}

function tokensOf(usage: DshUsageResult | undefined, mode: UsageMode): number {
  if (!usage || usage.status !== 'ok') return 0
  return mode === 'today' ? usage.usage.tokensToday : usage.usage.tokensTotal
}

function kindLabel(t: (key: TranslationKey) => string, kind?: InstanceKind): string {
  switch (kind) {
    case 'official-web': return t('instance.kind.officialWeb')
    case 'official-desktop': return t('instance.kind.officialDesktop')
    case 'community-desktop': return t('instance.kind.communityDesktop')
    default: return t('instance.kind.unknown')
  }
}

export function InstanceSwitcher(props: InstanceSwitcherProps) {
  const api = useLauncherApi()
  const { t } = useI18n()
  const [busy, setBusy] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searchActive, setSearchActive] = useState(-1)
  const [viewMode, setViewMode] = useState<ViewMode>('card')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [usageMode, setUsageMode] = useState<Record<string, UsageMode>>({})
  const [mirror, setMirror] = useState<InstanceMirrorStatus | null>(null)
  const [mirrorBusy, setMirrorBusy] = useState(false)
  const [mirrorHistory, setMirrorHistory] = useState<Array<{ timestamp: string; snapshotAt: string; restorable?: boolean }>>([])
  const [mirrorStartDialog, setMirrorStartDialog] = useState<{ id: string; name: string; changes: number } | null>(null)
  const [portDialog, setPortDialog] = useState<{ id: string; name: string; current: number } | null>(null)
  const [portInput, setPortInput] = useState('')
  const [renameDialog, setRenameDialog] = useState<{ id: string; current: string } | null>(null)
  const [renameInput, setRenameInput] = useState('')
  const [importDialog, setImportDialog] = useState(false)
  const [importInput, setImportInput] = useState('')
  const [discoverDialog, setDiscoverDialog] = useState<DiscoveredInstall[] | null>(null)
  const [importBusyPath, setImportBusyPath] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [repairId, setRepairId] = useState<string | null>(null)
  const [deleteDialog, setDeleteDialog] = useState<{ id: string; name: string } | null>(null)
  const [deleteMode, setDeleteMode] = useState<DeleteInstanceMode>('unregister')
  const [skipScan, setSkipScan] = useState<SkipScanMode>('none')
  const [skipDays, setSkipDays] = useState('7')
  const [purgeAck, setPurgeAck] = useState(false)
  const [shortcuts, setShortcuts] = useState<string[]>([])
  const [removeShortcuts, setRemoveShortcuts] = useState(false)
  const nameClickRef = useRef<{ id: string; count: number; timer: number | null }>({ id: '', count: 0, timer: null })
  const listWrapRef = useRef<HTMLDivElement>(null)
  const listScrollRef = useRef<HTMLDivElement>(null)
  const showMirrorError = (error: unknown) => setMirror(previous => ({
    ...(previous ?? { ok: false, hasSnapshot: false, snapshotAt: null, changed: [], added: [], removed: [] }),
    ok: false, error: error instanceof Error ? error.message : t('dialog.mirrorReadError'),
  }))

  const refreshMirror = async (id: string) => {
    setMirrorBusy(true)
    try {
      setMirror(await api.instanceMirrorStatus(id))
      const history = await api.instanceMirrorHistory(id)
      setMirrorHistory(history.history ?? [])
    } catch (error) {
      setMirror({ ok: false, hasSnapshot: false, snapshotAt: null, changed: [], added: [], removed: [], error: error instanceof Error ? error.message : t('dialog.mirrorReadError') })
      setMirrorHistory([])
    } finally {
      setMirrorBusy(false)
    }
  }

  const restoreToHistory = async (id: string, timestamp: string) => {
    if (!window.confirm(t('dialog.confirmRestoreHistory'))) return
    setMirrorBusy(true)
    try {
      setMirror(await api.instanceMirrorRestoreTo(id, timestamp))
      await refreshMirror(id)
    } catch (error) { showMirrorError(error) } finally { setMirrorBusy(false) }
  }

  /** 启动前校验镜像：与当前镜像不符时弹出选择（更新镜像进入 / 还原镜像进入 / 取消）。 */
  const startWithCheck = async (instance: DesktopInstance) => {
    const status = await api.instanceMirrorStatus(instance.id).catch(() => null)
    if (status && status.hasSnapshot && status.changed.length + status.added.length + status.removed.length > 0) {
      setMirrorStartDialog({ id: instance.id, name: instance.name ?? instance.id, changes: status.changed.length + status.added.length + status.removed.length })
      return
    }
    void act(instance.id, () => props.onStart(instance.id))
  }

  const confirmMirrorStart = async (action: 'update' | 'restore' | 'cancel') => {
    if (!mirrorStartDialog) return
    const { id } = mirrorStartDialog
    setMirrorStartDialog(null)
    if (action === 'cancel') return
    void act(id, async () => {
      const result = action === 'update' ? await api.instanceMirrorUpdate(id) : await api.instanceMirrorRestore(id)
      if (!result.ok) throw new Error(result.error ?? t('dialog.mirrorReadError'))
      await props.onStart(id)
    })
  }

  useEffect(() => {
    if (detailId) {
      setMirror(null)
      void refreshMirror(detailId)
    } else {
      setMirror(null)
    }
  }, [detailId])

  const updateMirror = async (id: string) => {
    if (!window.confirm(t('dialog.confirmUpdate'))) return
    setMirrorBusy(true)
    try { setMirror(await api.instanceMirrorUpdate(id)); await refreshMirror(id) } catch (error) { showMirrorError(error) } finally { setMirrorBusy(false) }
  }

  const restoreMirror = async (id: string) => {
    if (!window.confirm(t('dialog.confirmRestore'))) return
    setMirrorBusy(true)
    try { setMirror(await api.instanceMirrorRestore(id)) } catch (error) { showMirrorError(error) } finally { setMirrorBusy(false) }
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle
      ? props.instances.filter(item => [item.name, item.id, item.version, item.root].some(value => value?.toLowerCase().includes(needle)))
      : props.instances
  }, [props.instances, query])

  // 实例放置区上下边缘淡出：滚到顶/底时关闭对应边缘的淡出。
  useEffect(() => {
    const list = listScrollRef.current
    const wrap = listWrapRef.current
    if (!list || !wrap) return
    const update = () => {
      const atTop = list.scrollTop <= 1
      const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1
      wrap.classList.toggle('fade-top', !atTop)
      wrap.classList.toggle('fade-bottom', !atBottom)
    }
    update()
    list.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      list.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [visible.length, viewMode])

  // 搜索软件内全部信息：实例 + 设置项；每条结果左侧标明来源。
  const searchResults = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return [] as Array<{ kind: 'instance' | 'setting'; id: string; label: string; source: string; hint: string; sectionId?: string }>
    const results: Array<{ kind: 'instance' | 'setting'; id: string; label: string; source: string; hint: string; sectionId?: string }> = []
    for (const instance of props.instances) {
      if ([instance.name, instance.id, instance.version, instance.root, instance.dshHome, instance.workspace, instance.runtimeRoot, String(instance.port), instance.lockName, kindLabel(t, instance.instanceKind)].some(value => value?.toLowerCase().includes(needle))) {
        results.push({ kind: 'instance', id: instance.id, label: instance.name ?? instance.id, source: t('search.sourceInstance'), hint: `:${instance.port} · ${instance.root}` })
      }
    }
    for (const section of SETTINGS_SECTIONS) {
      const label = t(section.labelKey)
      const kw = t(section.keywordsKey)
      if (`${label} ${kw}`.toLowerCase().includes(needle)) {
        results.push({ kind: 'setting', id: section.id, label, source: t('search.sourceSetting'), hint: kw.split(' ').slice(0, 3).join(' / '), sectionId: section.id })
      }
    }
    return results.slice(0, 12)
  }, [query, props.instances, t])

  // 打开某条搜索结果：实例 → 进入详情；设置项 → 跳转设置对应分区。
  const openSearchResult = (result: { kind: 'instance' | 'setting'; id: string; sectionId?: string }) => {
    setQuery('')
    setSearchActive(-1)
    if (result.kind === 'instance') setDetailId(result.id)
    else props.onOpenSettings(result.sectionId)
  }

  const act = async (id: string, action: () => Promise<unknown>) => { setBusy(id); try { await action() } finally { setBusy(null) } }

  const detailInstance = props.instances.find(item => item.id === detailId) ?? null
  const detailState = detailInstance ? props.states.find(item => item.instanceId === detailInstance.id) : undefined
  const repairInstance = props.instances.find(item => item.id === repairId) ?? null
  const repairState = repairInstance ? props.states.find(item => item.instanceId === repairInstance.id) : undefined

  const openDelete = (instance: DesktopInstance) => {
    setDeleteDialog({ id: instance.id, name: instance.name ?? instance.id })
    setDeleteMode('unregister')
    setSkipScan('none')
    setSkipDays('7')
    setPurgeAck(false)
    setRemoveShortcuts(false)
    setShortcuts([])
    if (props.removeShortcuts) {
      void api.findInstanceShortcuts(instance.id).then(result => setShortcuts(result.shortcuts ?? [])).catch(() => setShortcuts([]))
    }
  }

  const confirmDelete = () => {
    if (!deleteDialog) return
    if (deleteMode === 'purge' && props.dangerConfirm && !purgeAck) return
    const options: DeleteInstanceOptions = {
      mode: deleteMode,
      skipScan: deleteMode === 'unregister' ? skipScan : 'none',
      skipScanDays: Math.max(0, Math.floor(Number(skipDays) || 0)),
      removeShortcuts: removeShortcuts && shortcuts.length > 0,
    }
    void act(deleteDialog.id, () => props.onDelete(deleteDialog.id, options))
    setDeleteDialog(null)
  }

  const openPortDialog = (instance: DesktopInstance) => {
    setPortDialog({ id: instance.id, name: instance.name ?? instance.id, current: instance.port })
    setPortInput(String(instance.port))
  }

  const confirmPort = () => {
    if (!portDialog) return
    const port = Number(portInput)
    if (!Number.isInteger(port) || port < 1 || port > 65535) return
    void act(portDialog.id, () => props.onSetPort(portDialog.id, port))
    setPortDialog(null)
  }

  /** 连续三击实例名 → 改名。 */
  const handleNameClick = (instance: DesktopInstance) => {
    const ref = nameClickRef.current
    if (ref.id !== instance.id) { ref.id = instance.id; ref.count = 0 }
    if (ref.timer) window.clearTimeout(ref.timer)
    ref.count += 1
    if (ref.count >= 3) {
      ref.count = 0
      setRenameDialog({ id: instance.id, current: instance.name ?? instance.id })
      setRenameInput(instance.name ?? instance.id)
      return
    }
    ref.timer = window.setTimeout(() => { ref.count = 0 }, 600)
  }

  const confirmRename = () => {
    if (!renameDialog) return
    const name = renameInput.trim()
    if (!name) return
    void act(renameDialog.id, () => props.onRename(renameDialog.id, name))
    setRenameDialog(null)
  }

  const openRepair = (id: string) => {
    setRepairId(id)
    void refreshMirror(id)
  }

  const confirmImport = () => {
    const path = importInput.trim()
    setImportDialog(false)
    if (path && props.onImport) void props.onImport(path)
  }

  /** 扫描收录：结果由 App 层过滤出未收录条目；有则弹中间弹窗。 */
  const handleDiscover = async () => {
    if (!props.onDiscover) return
    const pending = await props.onDiscover()
    if (pending && pending.length > 0) setDiscoverDialog(pending)
  }

  /** 弹窗内收录某条：成功后从弹窗列表移除；全部收完弹窗自动消失。 */
  const importFromDialog = async (item: DiscoveredInstall) => {
    if (!props.onImport) return
    setImportBusyPath(item.path)
    try {
      const result = await props.onImport(item.path)
      if (result.ok) setDiscoverDialog(cur => (cur ? cur.filter(x => x.path !== item.path) : null))
    } finally {
      setImportBusyPath(null)
    }
  }

  const toggleUsageMode = (id: string) => {
    setUsageMode(current => ({ ...current, [id]: current[id] === 'today' ? 'total' : 'today' }))
  }

  return (
    <section aria-label="DSH Desktop instances" className="instance-switcher">
      <header className="instance-switcher__header">
        <div className="instance-header-text">
          <span className="launcher-kicker">{props.headerKicker || t('app.headerKicker')}</span>
          <h2 className="launcher-title-brand">{props.headerTitle || '鲸域 · WhaleRealm'}</h2>
        </div>
        <div className="instance-header-bottom">
          <p>{props.headerSubtitle || t('app.headerSubtitle')}</p>
          <div className="instance-switcher__toolbar">
          <div className="view-toggle" role="radiogroup" aria-label={t('view.mode')}>
            <button type="button" className={viewMode === 'list' ? 'active' : ''} aria-pressed={viewMode === 'list'} title={t('view.list')} onClick={() => setViewMode('list')}><List size={15} /></button>
            <button type="button" className={viewMode === 'card' ? 'active' : ''} aria-pressed={viewMode === 'card'} title={t('view.card')} onClick={() => setViewMode('card')}><LayoutGrid size={15} /></button>
          </div>
          <div className="instance-search-wrap">
            <label className="instance-search"><Search size={15} /><input
              aria-label={t('search.instanceAria')}
              value={query}
              onChange={event => { setQuery(event.target.value); setSearchActive(-1) }}
              onKeyDown={event => {
                if (searchResults.length === 0) return
                if (event.key === 'ArrowDown') { event.preventDefault(); setSearchActive(cur => (cur + 1) % searchResults.length) }
                else if (event.key === 'ArrowUp') { event.preventDefault(); setSearchActive(cur => (cur <= 0 ? searchResults.length - 1 : cur - 1)) }
                else if (event.key === 'Enter') { if (searchActive >= 0 && searchActive < searchResults.length) { event.preventDefault(); openSearchResult(searchResults[searchActive]) } }
                else if (event.key === 'Escape') setSearchActive(-1)
              }}
              placeholder={t('search.placeholder')}
            /></label>
            {searchResults.length > 0 && (
              <div className="search-results">
                {searchResults.map((result, index) => (
                  <button
                    key={`${result.kind}:${result.id}`}
                    type="button"
                    className={`search-result${index === searchActive ? ' is-active' : ''}`}
                    onMouseEnter={() => setSearchActive(index)}
                    onClick={() => openSearchResult(result)}
                  >
                    <span className={`search-result-source source-${result.kind}`}>{result.source}</span>
                    <span className="search-result-label">{result.label}</span>
                    <span className="search-result-hint">{result.hint}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {props.onCreateInstance && <button type="button" className="secondary-button" onClick={() => setCreateOpen(true)}><Plus size={14} />{t('create.button')}</button>}
          {props.onDiscover && <button type="button" className="secondary-button" onClick={() => void handleDiscover()}><RefreshCw size={14} />{t('discover.scan')}</button>}
          {props.onImport && <button type="button" className="secondary-button" onClick={() => { setImportInput(''); setImportDialog(true) }}><FolderOpen size={14} />{t('discover.import')}</button>}
          </div>
        </div>
      </header>

      <div className="instance-list-wrap" ref={listWrapRef}>
        <div ref={listScrollRef} className={`instance-switcher__list${viewMode === 'card' ? ' instance-switcher__list--card' : ''}`}>
        {visible.map(instance => {
          const state = props.states.find(item => item.instanceId === instance.id)
          const status = state?.status ?? 'stopped'
          const running = status === 'ready' || status === 'starting'
          const paused = status === 'paused'
          const selected = props.selectedId === instance.id
          const usage = props.usage[instance.id]
          const mode = usageMode[instance.id] ?? 'today'
          const statusClass = running ? ' is-running' : paused ? ' is-paused' : status === 'crashed' ? ' is-crashed' : ''
          const isolationOk = status !== 'crashed'
          return (
            <article key={instance.id} className={`instance-card${selected ? ' is-selected' : ''}${statusClass}`} onClick={() => void props.onSelect(instance.id)}>
              <div className="instance-card__main">
                <button className="instance-card__select" aria-pressed={selected}>
                  <span className="instance-card__title">
                    <strong className="instance-card__name" title={t('instance.renameHint')} onClick={() => handleNameClick(instance)}>{instance.name ?? instance.id}</strong>
                    <span className={`instance-status-dot status-${status}`} title={statusLabel(t, status)} />
                  </span>
                  <span className="instance-card__meta">
                    <code>{instance.version ?? t('instance.official')}</code> · {t('instance.portLabel')} :{instance.port} · {statusLabel(t, status)}
                  </span>
                  <small className="instance-card__path" title={instance.root}>{instance.root}</small>
                </button>
                <div className="instance-card__facts">
                  <div className={`instance-card__isolation${isolationOk ? ' isolation-ok' : ' isolation-failed'}`}>
                    {isolationOk ? <ShieldCheck size={14} /> : <ShieldX size={14} />}
                    <span>{isolationOk ? t('isolation.ok') : t('isolation.failed')}</span>
                  </div>
                  <small className="instance-card__path" title={`DSH_HOME ${instance.dshHome}`}>DSH_HOME {instance.dshHome}</small>
                  <button
                    type="button"
                    className={`instance-health${props.mirrorChanges[instance.id]?.hasChanges ? ' abnormal' : ' normal'}`}
                    title={props.mirrorChanges[instance.id]?.hasChanges ? t('instance.mirrorChangedHint', { count: props.mirrorChanges[instance.id].count }) : t('instance.mirrorCleanHint')}
                    onClick={() => { if (props.mirrorChanges[instance.id]?.hasChanges) openRepair(instance.id) }}
                  >
                    <span>{props.mirrorChanges[instance.id]?.hasChanges ? t('instance.abnormal') : t('instance.normal')}</span>
                    {props.mirrorChanges[instance.id]?.hasChanges ? <ShieldX size={14} /> : <ShieldCheck size={14} />}
                  </button>
                </div>
                <div className="instance-card__usage-row">
                  <button className="instance-card__usage" title={t('token.toggleTitle')} onClick={() => toggleUsageMode(instance.id)}>
                    <span>{mode === 'today' ? t('token.today') : t('token.total')} Token</span>
                    <small>{formatTokens(tokensOf(usage, mode))}</small>
                  </button>
                </div>
                <div className="instance-card__actions">
                  {paused
                    ? <button disabled={busy === instance.id} onClick={() => void act(instance.id, () => props.onResume(instance.id))}><Play size={13} />{t('action.resume')}</button>
                    : !running
                      ? <button disabled={busy === instance.id} onClick={() => void startWithCheck(instance)}><Play size={13} />{t('action.start')}</button>
                      : <button disabled={busy === instance.id} onClick={() => void act(instance.id, () => props.onStop(instance.id))}><Square size={13} />{t('action.stop')}</button>}
                  <button disabled={!running || busy === instance.id} onClick={() => void act(instance.id, () => props.onPause(instance.id))}><Pause size={13} />{t('action.pause')}</button>
                  <button disabled={busy === instance.id} onClick={() => void act(instance.id, () => props.onRestart(instance.id))}><RefreshCw size={13} />{t('action.restart')}</button>
                  <button onClick={() => props.onOpenFolder(instance.root)} title={t('action.folder')}><FolderOpen size={13} />{t('action.folder')}</button>
                  <button disabled={running} onClick={() => openPortDialog(instance)} title={t('instance.portHint')}><Square size={13} />{t('action.port')}</button>
                  <button className="instance-card__detail-toggle" onClick={() => setDetailId(instance.id)} title={t('instance.detailHint')}>{t('action.detail')}</button>
                  <button className="instance-card__repair" onClick={() => openRepair(instance.id)} title={t('instance.repairHint')}>{t('action.repair')}</button>
                  <button className="instance-card__remove" disabled={running || paused} onClick={() => openDelete(instance)} title={running || paused ? t('instance.deleteDisabledHint') : t('instance.deleteHint')}><Trash2 size={13} /></button>
                </div>
              </div>
            </article>
          )
        })}
        {visible.length === 0 && <p className="instance-switcher__empty">{t('instance.empty')}</p>}
        </div>
      </div>

      {createOpen && props.onCreateInstance && <CreateInstanceDialog onClose={() => setCreateOpen(false)} onCreate={props.onCreateInstance} />}

      {discoverDialog && discoverDialog.length > 0 && (
        <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setDiscoverDialog(null) }}>
          <section className="modal discover-dialog" role="dialog" aria-modal="true" aria-labelledby="discover-dialog-title">
            <header><div><h2 id="discover-dialog-title">{t('discover.dialogTitle')}</h2></div><button type="button" className="icon-button" onClick={() => setDiscoverDialog(null)} aria-label={t('common.close')}><X size={18} /></button></header>
            <div className="modal-content">
              <p className="about-desc">{t('discover.dialogDesc')}</p>
              <div className="discover-dialog-list">
                {discoverDialog.map(item => (
                  <div key={item.executable} className="instance-discovery-row">
                    <span className={`isolatable-badge ${item.isolatable ? 'isolatable' : 'not-isolatable'}`}>
                      {item.isolatable ? <ShieldCheck size={12} /> : <ShieldX size={12} />}
                      {item.isolatable ? t('discover.isolatable') : t('discover.notIsolatable')}
                    </span>
                    {!item.verified && <span className="flavor-badge unverified">{t('discover.unverified')}</span>}
                    <span>{item.version ?? t('discover.unknownVersion')}</span>
                    <code title={item.path}>{item.path}</code>
                    <small>{item.running ? t('discover.running', { pid: item.pid ?? 0 }) : item.reason}</small>
                    {props.onImport && <button type="button" disabled={!item.verified || importBusyPath === item.path} title={item.verified ? undefined : t('discover.unverified')} onClick={() => void importFromDialog(item)}>{t('discover.include')}</button>}
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}

      {detailInstance && (
        <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setDetailId(null) }}>
          <section className="modal instance-detail-modal" role="dialog" aria-modal="true" aria-labelledby="instance-detail-title">
            <header><div><h2 id="instance-detail-title">{t('detail.title')} · {detailInstance.name ?? detailInstance.id}</h2></div><button type="button" className="icon-button" onClick={() => setDetailId(null)} aria-label={t('common.close')}><X size={18} /></button></header>
            <div className="modal-content">
              <dl className="instance-detail-list">
                <div><dt>{t('detail.status')}</dt><dd>{statusLabel(t, detailState?.status ?? 'stopped')} · {t('instance.portLabel')} :{detailInstance.port}</dd></div>
                <div><dt>{t('detail.pid')}</dt><dd>{detailState?.pid ?? '—'}</dd></div>
                <div><dt>{t('detail.url')}</dt><dd>{detailState?.url ? <code>{detailState.url}</code> : '—'}</dd></div>
                <div><dt>{t('detail.version')}</dt><dd>{detailInstance.version ?? t('instance.official')}</dd></div>
                <div><dt>{t('detail.kind')}</dt><dd>{kindLabel(t, detailInstance.instanceKind)}</dd></div>
                <div><dt>{t('detail.runtime')}</dt><dd><code>{detailInstance.runtimeRoot ?? '—'}</code></dd></div>
                <div><dt>{t('detail.stateRoot')}</dt><dd><code>{detailInstance.dshHome}</code></dd></div>
                <div><dt>{t('detail.electronUserData')}</dt><dd><code>{detailInstance.electronUserData}</code></dd></div>
                <div><dt>{t('detail.desktopProfile')}</dt><dd><code>{detailInstance.desktopProfile}</code></dd></div>
                <div><dt>{t('detail.workspace')}</dt><dd><code>{detailInstance.workspace}</code></dd></div>
                <div><dt>{t('detail.skillsSource')}</dt><dd><code>{detailInstance.skillsSource}</code></dd></div>
                <div><dt>{t('detail.logs')}</dt><dd><code>{detailInstance.logs}</code></dd></div>
                <div><dt>{t('detail.lock')}</dt><dd><code>{detailInstance.lockName}</code></dd></div>
                <div><dt>{t('detail.enabled')}</dt><dd>{detailInstance.enabled !== false ? t('detail.enabledYes') : t('detail.enabledNo')}</dd></div>
                <div><dt>{t('detail.autoStart')}</dt><dd>{detailInstance.autoStart === true ? t('detail.yes') : t('detail.no')}</dd></div>
                <div><dt>{t('detail.mirrorSnapshot')}</dt><dd>{mirror?.snapshotAt ? new Date(mirror.snapshotAt).toLocaleString() : t('detail.noMirror')}</dd></div>
                <div><dt>{t('detail.tokensToday')}</dt><dd>{formatTokens(tokensOf(props.usage[detailInstance.id], 'today'))}</dd></div>
                <div><dt>{t('detail.tokensTotal')}</dt><dd>{formatTokens(tokensOf(props.usage[detailInstance.id], 'total'))}</dd></div>
              </dl>
            </div>
          </section>
        </div>
      )}

      {portDialog && (
        <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setPortDialog(null) }}>
          <section className="modal port-dialog" role="dialog" aria-modal="true" aria-labelledby="port-dialog-title">
            <header><div><h2 id="port-dialog-title">{t('dialog.portTitle', { name: portDialog.name })}</h2></div><button type="button" className="icon-button" onClick={() => setPortDialog(null)} aria-label={t('common.close')}><X size={18} /></button></header>
            <div className="modal-content">
              <label className="form-field"><span>{t('dialog.portLabel')}</span><NumberField value={Number(portInput) || 0} min={1} max={65535} onChange={next => setPortInput(String(next))} /></label>
              <small>{t('dialog.portCurrent', { port: portDialog.current })}</small>
            </div>
            <footer>
              <button type="button" className="secondary-button" onClick={() => setPortDialog(null)}>{t('common.cancel')}</button>
              <button type="button" className="primary-command" onClick={confirmPort}>{t('common.confirm')}</button>
            </footer>
          </section>
        </div>
      )}

      {renameDialog && (
        <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setRenameDialog(null) }}>
          <section className="modal port-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-title">
            <header><div><h2 id="rename-title">{t('dialog.renameTitle')}</h2></div><button type="button" className="icon-button" onClick={() => setRenameDialog(null)} aria-label={t('common.close')}><X size={18} /></button></header>
            <div className="modal-content">
              <label className="form-field"><span>{t('dialog.renameLabel')}</span><input value={renameInput} maxLength={60} onChange={event => setRenameInput(event.target.value)} autoFocus /></label>
            </div>
            <footer>
              <button type="button" className="secondary-button" onClick={() => setRenameDialog(null)}>{t('common.cancel')}</button>
              <button type="button" className="primary-command" onClick={confirmRename}>{t('common.confirm')}</button>
            </footer>
          </section>
        </div>
      )}

      {importDialog && (
        <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setImportDialog(false) }}>
          <section className="modal port-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
            <header><div><h2 id="import-title">{t('dialog.importTitle')}</h2></div><button type="button" className="icon-button" onClick={() => setImportDialog(false)} aria-label={t('common.close')}><X size={18} /></button></header>
            <div className="modal-content">
              <label className="form-field"><span>{t('dialog.importLabel')}</span><input value={importInput} onChange={event => setImportInput(event.target.value)} placeholder="D:\DSH-Desktop" autoFocus /></label>
            </div>
            <footer>
              <button type="button" className="secondary-button" onClick={() => setImportDialog(false)}>{t('common.cancel')}</button>
              <button type="button" className="primary-command" onClick={confirmImport}>{t('dialog.importConfirm')}</button>
            </footer>
          </section>
        </div>
      )}

      {deleteDialog && (
        <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setDeleteDialog(null) }}>
          <section className="modal delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title">
            <header><div><h2 id="delete-title">{t('dialog.deleteTitle', { name: deleteDialog.name })}</h2></div><button type="button" className="icon-button" onClick={() => setDeleteDialog(null)} aria-label={t('dialog.deleteClose')}><X size={18} /></button></header>
            <div className="modal-content">
              <label className={`delete-mode-option${deleteMode === 'unregister' ? ' is-selected' : ''}`}>
                <input type="radio" name="delete-mode" checked={deleteMode === 'unregister'} onChange={() => setDeleteMode('unregister')} />
                <span className="delete-mode-body">
                  <strong>{t('dialog.deleteUnregister')}</strong>
                  <p>{t('dialog.deleteUnregisterDesc')}</p>
                </span>
              </label>

              {deleteMode === 'unregister' && (
                <div className="delete-skip-options">
                  <label><input type="radio" name="skip-scan" checked={skipScan === 'none'} onChange={() => setSkipScan('none')} /> {t('dialog.deleteSkipNone')}</label>
                  <label><input type="radio" name="skip-scan" checked={skipScan === 'temporary'} onChange={() => setSkipScan('temporary')} /> <NumberField value={Number(skipDays) || 0} min={1} max={365} onChange={next => setSkipDays(String(next))} /> {t('dialog.deleteSkipTemp')}</label>
                  <label><input type="radio" name="skip-scan" checked={skipScan === 'permanent'} onChange={() => setSkipScan('permanent')} /> {t('dialog.deleteSkipPermanent')}</label>
                </div>
              )}

              <label className={`delete-mode-option danger${deleteMode === 'purge' ? ' is-selected' : ''}`}>
                <input type="radio" name="delete-mode" checked={deleteMode === 'purge'} onChange={() => setDeleteMode('purge')} />
                <span className="delete-mode-body">
                  <strong>{t('dialog.deletePurge')}</strong>
                  <p>{t('dialog.deletePurgeDesc')}</p>
                </span>
              </label>

              {deleteMode === 'purge' && props.dangerConfirm && (
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
              <button type="button" className="secondary-button" onClick={() => setDeleteDialog(null)}>{t('common.cancel')}</button>
              <button
                type="button"
                className={`primary-command${deleteMode === 'purge' ? ' danger' : ''}`}
                disabled={deleteMode === 'purge' && props.dangerConfirm && !purgeAck}
                onClick={confirmDelete}
              >
                {deleteMode === 'purge' ? t('dialog.deletePurgeConfirm') : t('dialog.deleteConfirm')}
              </button>
            </footer>
          </section>
        </div>
      )}

      {repairInstance && (() => {
        const status = repairState?.status ?? 'stopped'
        const stopped = ['stopped', 'crashed'].includes(status) && !repairState?.pid && !repairState?.cleanupPending
        const changes = mirror ? mirror.changed.length + mirror.added.length + mirror.removed.length : 0
        return (
          <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setRepairId(null) }}>
            <section className="modal repair-dialog" role="dialog" aria-modal="true" aria-labelledby="repair-title">
              <header><div><h2 id="repair-title">{t('dialog.repairTitle', { name: repairInstance.name ?? repairInstance.id })}</h2></div><button type="button" className="icon-button" onClick={() => setRepairId(null)} aria-label={t('dialog.repairClose')}><X size={18} /></button></header>
              <div className="modal-content">
                <div className="form-section"><h3>{t('dialog.diagnosis')}</h3><p>{t('dialog.diagnosisDesc')}</p></div>
                <dl className="instance-detail-list">
                  <div><dt>{t('dialog.runningState')}</dt><dd>{statusLabel(t, status)} · {t('instance.portLabel')} :{repairInstance.port}</dd></div>
                  <div><dt>{t('dialog.isolationState')}</dt><dd>{status === 'crashed' ? t('isolation.failed') : t('isolation.ok')}</dd></div>
                  <div><dt>{t('dialog.mirrorDiff')}</dt><dd>{mirror?.hasSnapshot ? `${changes} 处` : t('detail.noMirror')}</dd></div>
                </dl>
                <div className="repair-actions">
                  <button type="button" className="secondary-button" disabled={mirrorBusy} onClick={() => void refreshMirror(repairInstance.id)}><RefreshCw size={13} />{t('dialog.rediagnose')}</button>
                  <button type="button" className="secondary-button" disabled={status === 'ready' || status === 'starting' || busy === repairInstance.id} onClick={() => void act(repairInstance.id, () => props.onSetPort(repairInstance.id, repairInstance.port + 1))}>{t('dialog.fixPort')}</button>
                  <button type="button" className="secondary-button" disabled={status === 'starting' || busy === repairInstance.id} onClick={() => void act(repairInstance.id, () => props.onRestart(repairInstance.id))}>{t('dialog.restartInstance')}</button>
                </div>
                <div className="form-section divided"><h3>{t('dialog.mirrorSection')}</h3><p>{t('dialog.mirrorDesc')}</p></div>
                {mirror === null ? (
                  <div className="mirror-status">{t('dialog.reading')}</div>
                ) : (
                  <div className="mirror-status">
                    <div>{t('dialog.snapshotAt', { time: mirror.snapshotAt ? new Date(mirror.snapshotAt).toLocaleString() : t('detail.noMirror') })}</div>
                    {mirror.error && <div role="alert">{mirror.error}</div>}
                    {mirror.requiresRebaseline && <div role="alert">{t('dialog.mirrorRebaseline')}</div>}
                    <div>{t('dialog.changes', { count: changes, changed: mirror.changed.length, added: mirror.added.length, removed: mirror.removed.length })}</div>
                    <div className="mirror-actions">
                      <button type="button" className="secondary-button" disabled={mirrorBusy || !stopped} onClick={() => void updateMirror(repairInstance.id)}>{t('dialog.update')}</button>
                      <button type="button" className="secondary-button danger" disabled={mirrorBusy || !stopped || mirror.requiresRebaseline || !mirror.hasSnapshot || changes === 0} onClick={() => void restoreMirror(repairInstance.id)}>{t('dialog.restore')}</button>
                    </div>
                  </div>
                )}

                <div className="mirror-history">
                  <div className="mirror-history-title">{t('dialog.historyTitle')}</div>
                  {mirrorHistory.length === 0 ? (
                    <div className="mirror-history-empty">{t('dialog.historyEmpty')}</div>
                  ) : (
                    mirrorHistory.map(item => (
                      <div key={item.timestamp} className="mirror-history-item">
                        <small>{new Date(item.snapshotAt).toLocaleString()}</small>
                        <button type="button" className="secondary-button" disabled={mirrorBusy || !stopped || item.restorable === false} onClick={() => void restoreToHistory(repairInstance.id, item.timestamp)}>{t('dialog.restoreTo')}</button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>
          </div>
        )
      })()}

      {mirrorStartDialog && (
        <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setMirrorStartDialog(null) }}>
          <section className="modal port-dialog" role="dialog" aria-modal="true" aria-labelledby="mirror-start-title">
            <header><div><h2 id="mirror-start-title">{t('dialog.mirrorStartTitle', { name: mirrorStartDialog.name })}</h2></div><button type="button" className="icon-button" onClick={() => setMirrorStartDialog(null)} aria-label={t('common.cancel')}><X size={18} /></button></header>
            <div className="modal-content">
              <p className="mirror-start-hint">{t('dialog.mirrorStartHint', { count: mirrorStartDialog.changes })}</p>
              <div className="mirror-start-actions">
                <button type="button" className="secondary-button" onClick={() => void confirmMirrorStart('update')}>{t('dialog.mirrorStartUpdate')}</button>
                <button type="button" className="secondary-button" onClick={() => void confirmMirrorStart('restore')}>{t('dialog.mirrorStartRestore')}</button>
                <button type="button" className="secondary-button" onClick={() => void confirmMirrorStart('cancel')}>{t('common.cancel')}</button>
              </div>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}
