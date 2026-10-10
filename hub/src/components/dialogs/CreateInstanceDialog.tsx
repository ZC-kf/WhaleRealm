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

import { useEffect, useRef, useState } from 'react'
import { FolderOpen, Plus, RefreshCw, X } from 'lucide-react'
import { useLauncherApi } from '../../api/client'
import { useI18n } from '../../i18n'
import type { TranslationKey } from '../../i18n/translations/zh-CN'
import type { CatalogVersion, CreateStage, InstanceKind } from '../../types'

/**
 * 新建实例弹窗。
 *
 * 创建期间如实反馈主进程推送的真实阶段（核验 → 下载部署 → 自检 → 收录），
 * 显示任务标识（恢复/诊断用），支持中途取消（走取消 IPC，由主进程按任务
 * 所有权回滚）。创建中禁止重复提交与无主关闭（关闭按钮退化为取消任务）；
 * 失败如实显示且表单保留，可直接调整后重试。
 */

export interface CreateInstanceInput {
  taskId: string
  name: string
  path: string
  kind: InstanceKind
  version: CatalogVersion
}

interface CreateInstanceDialogProps {
  onClose: () => void
  onCreate: (input: CreateInstanceInput) => Promise<unknown>
}

const KIND_OPTIONS: Array<{ kind: InstanceKind; labelKey: 'instance.kind.officialWeb' | 'instance.kind.officialDesktop' | 'instance.kind.communityDesktop'; hintKey: 'create.kindHint.officialWeb' | 'create.kindHint.officialDesktop' | 'create.kindHint.communityDesktop' }> = [
  { kind: 'official-web', labelKey: 'instance.kind.officialWeb', hintKey: 'create.kindHint.officialWeb' },
  { kind: 'community-desktop', labelKey: 'instance.kind.communityDesktop', hintKey: 'create.kindHint.communityDesktop' },
  { kind: 'official-desktop', labelKey: 'instance.kind.officialDesktop', hintKey: 'create.kindHint.officialDesktop' },
]

/** 与主进程 CreateStage 一一对应的展示顺序（detailKey 映射到 create.stage.*）。 */
const TIMELINE_STAGES: Array<{ stage: CreateStage; labelKey: TranslationKey }> = [
  { stage: 'verify', labelKey: 'create.stage.verify' },
  { stage: 'deploy', labelKey: 'create.stage.download' },
  { stage: 'selfcheck', labelKey: 'create.stage.selfcheck' },
  { stage: 'register', labelKey: 'create.stage.register' },
]

const formatElapsed = (milliseconds: number) => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`
}

export function CreateInstanceDialog({ onClose, onCreate }: CreateInstanceDialogProps) {
  const api = useLauncherApi()
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [kind, setKind] = useState<InstanceKind | ''>('')
  const [versions, setVersions] = useState<CatalogVersion[] | null>(null)
  const [versionLoading, setVersionLoading] = useState(false)
  const [versionError, setVersionError] = useState<string | null>(null)
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cancelled, setCancelled] = useState(false)
  const [cancelRequested, setCancelRequested] = useState(false)
  const [progress, setProgress] = useState<{ stage: string; percent: number; detailKey: string } | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const requestSeq = useRef(0)
  const taskId = useRef<string | null>(null)
  // 取消标记用 ref 保存：confirm 闭包捕获的 state 在点击后不再更新，
  // 若只用 state，用户取消导致的 onCreate 失败会被误判为真实错误。
  const cancelRequestedRef = useRef(false)

  // 订阅创建进度（主进程推送），弹窗实时显示阶段与百分比。
  useEffect(() => api.onCreateInstanceProgress(value => { if (value.taskId === taskId.current) setProgress(value) }), [api])

  // 创建期间展示已用时间（每秒刷新一次；随创建结束归零）。
  useEffect(() => {
    if (!busy) { setElapsedMs(0); return }
    const startedAt = Date.now()
    setElapsedMs(0)
    const timer = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 1000)
    return () => window.clearInterval(timer)
  }, [busy])

  // 类型变化 → 实时拉取并校验版本；竞态用序号丢弃过期结果。
  useEffect(() => {
    if (!kind) { setVersions(null); setSelectedVersion(null); setVersionError(null); return }
    const seq = ++requestSeq.current
    setVersions(null)
    setSelectedVersion(null)
    setVersionError(null)
    setVersionLoading(true)
    void api.listCatalogVersions(kind).then(result => {
      if (seq !== requestSeq.current) return
      setVersionLoading(false)
      if (!result.ok) {
        setVersionError(result.error ?? t('create.versionFailed'))
        return
      }
      setVersions(result.versions)
      setSelectedVersion(result.versions[0]?.version ?? null)
    }).catch(() => {
      if (seq !== requestSeq.current) return
      setVersionLoading(false)
      setVersionError(t('create.versionFailed'))
    })
  }, [api, kind, t])

  const pickFolder = async () => {
    const chosen = await api.chooseFolder().catch(() => null)
    if (chosen) setPath(chosen)
  }

  const selected = versions?.find(item => item.version === selectedVersion) ?? null
  const canConfirm = name.trim().length > 0 && path.trim().length > 0 && selected !== null && !busy

  const confirm = async () => {
    if (!canConfirm || !selected || kind === '') return
    setBusy(true)
    setError(null)
    setCancelled(false)
    setCancelRequested(false)
    cancelRequestedRef.current = false
    setProgress(null)
    try {
      taskId.current = crypto.randomUUID()
      await onCreate({ taskId: taskId.current, name: name.trim(), path: path.trim(), kind, version: selected })
      onClose()
    } catch (err) {
      // 用户主动取消导致的失败不是错误：显示中性"已取消"状态。
      if (cancelRequestedRef.current) {
        setCancelled(true)
        setError(null)
      } else {
        setError(err instanceof Error ? err.message : t('create.unknownError'))
      }
    } finally {
      setBusy(false)
      setCancelRequested(false)
      cancelRequestedRef.current = false
      taskId.current = null
    }
  }

  // 关闭语义：空闲时直接关闭；创建中变为"取消任务"，且只能发起一次，
  // 关闭对话框必须等主进程确认收尾（防无主关闭留下无主任务）。
  const requestClose = async () => {
    if (!busy) { onClose(); return }
    if (cancelRequested || !taskId.current) return
    setCancelRequested(true)
    cancelRequestedRef.current = true
    try {
      const result = await api.cancelCreateInstance(taskId.current)
      if (!result.ok) setError(result.error ?? t('create.cancelFailed'))
    } catch (err) {
      setError(String(err))
      setCancelRequested(false)
      cancelRequestedRef.current = false
    }
  }

  const closeLabel = busy
    ? (cancelRequested ? t('create.cancelling') : t('create.cancelCreate'))
    : t('common.cancel')

  // 阶段时间线推进：以主进程推送的真实 stage 为准（未收到前全部待定）。
  const timelineActiveIndex = busy && progress
    ? TIMELINE_STAGES.findIndex(item => item.stage === progress.stage)
    : -1

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) void requestClose() }}>
      <section className="modal create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-dialog-title">
        <header>
          <div><Plus size={17} /><h2 id="create-dialog-title">{t('create.title')}</h2></div>
          <button type="button" className="icon-button" onClick={() => void requestClose()} aria-label={t('common.close')} disabled={busy && cancelRequested}><X size={18} /></button>
        </header>
        <div className="modal-content">
          <label className="form-field"><span>{t('create.nameLabel')}</span>
            <input value={name} maxLength={60} placeholder={t('create.namePlaceholder')} onChange={event => setName(event.target.value)} autoFocus disabled={busy} />
          </label>

          <label className="form-field"><span>{t('create.pathLabel')}</span>
            <div className="create-path-row">
              <input value={path} placeholder={t('create.pathPlaceholder')} onChange={event => setPath(event.target.value)} disabled={busy} />
              <button type="button" className="secondary-button" onClick={() => void pickFolder()} disabled={busy}><FolderOpen size={14} />{t('create.chooseFolder')}</button>
            </div>
            <small>{t('create.pathMustBeEmpty')}</small>
          </label>

          <label className="form-field"><span>{t('create.kindLabel')}</span>
            <select value={kind} onChange={event => setKind(event.target.value as InstanceKind)} disabled={busy}>
              <option value="">{t('create.kindPlaceholder')}</option>
              {KIND_OPTIONS.map(option => (
                <option key={option.kind} value={option.kind}>{t(option.labelKey)}</option>
              ))}
            </select>
            {kind !== '' && <small>{t(KIND_OPTIONS.find(option => option.kind === kind)!.hintKey)}</small>}
          </label>

          {kind !== '' && (
            <label className="form-field"><span>{t('create.versionLabel')}</span>
              {versionLoading ? (
                <span className="create-status"><RefreshCw size={13} className="spin" />{t('create.loadingVersions')}</span>
              ) : versionError ? (
                <span className="create-status create-status-error">{versionError}</span>
              ) : versions && versions.length > 0 ? (
                <select value={selectedVersion ?? ''} onChange={event => setSelectedVersion(event.target.value)} disabled={busy}>
                  {versions.map(item => (
                    <option key={item.version} value={item.version}>
                      {item.version}{item.latest ? ` · ${t('create.latest')}` : ''}{item.prerelease ? ` · ${t('create.prerelease')}` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="create-status">{t('create.noVersions')}</span>
              )}
            </label>
          )}

          {busy && (
            <div className="create-progress-block">
              <div className="create-progress-head">
                {taskId.current && (
                  <span className="create-task-id" title={taskId.current}>{t('create.taskId')}：{taskId.current.slice(0, 8)}</span>
                )}
                <span className="create-elapsed">{t('create.elapsed', { time: formatElapsed(elapsedMs) })}</span>
              </div>
              <span className="create-status" role="status" aria-live="polite">
                {progress ? `${t(progress.detailKey as TranslationKey)} · ${progress.percent}%` : t('create.working')}
              </span>
              <div className="create-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress?.percent ?? 0}>
                <div className="create-progress-fill" style={{ width: `${progress?.percent ?? 0}%` }} />
              </div>
              <ol className="create-timeline">
                {TIMELINE_STAGES.map((item, index) => {
                  const state = timelineActiveIndex === -1 ? 'pending' : index < timelineActiveIndex ? 'done' : index === timelineActiveIndex ? 'active' : 'pending'
                  return (
                    <li key={item.stage} className={`create-timeline-${state}`}>
                      <span className="create-timeline-marker" aria-hidden="true">
                        {state === 'done' ? '✓' : state === 'active' ? <RefreshCw size={10} className="spin" /> : null}
                      </span>
                      <span>{t(item.labelKey)}</span>
                    </li>
                  )
                })}
              </ol>
              {cancelRequested && <span className="create-status">{t('create.cancelling')}</span>}
            </div>
          )}
          {cancelled && !busy && <span className="create-status" role="status">{t('create.cancelled')}</span>}
          {error && (
            <span className="create-status create-status-error" role="alert">
              {error}
              {!busy && <small className="create-retry-hint">{t('create.failedRetryable')}</small>}
            </span>
          )}
        </div>
        <footer>
          <button type="button" className="secondary-button" onClick={() => void requestClose()} disabled={busy && cancelRequested}>{closeLabel}</button>
          <button type="button" className="primary-command" disabled={!canConfirm} onClick={() => void confirm()}>{t('common.confirm')}</button>
        </footer>
      </section>
    </div>
  )
}
