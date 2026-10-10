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

import { useState } from 'react'
import { History, Trash2, X } from 'lucide-react'
import { useLauncherApi } from '../../api/client'
import { useI18n } from '../../i18n'
import type { UnfinishedCreateTask } from '../../types'

/**
 * 未完成创建任务的恢复入口。
 *
 * 启动时主进程只读发现（journal）中断的任务；本弹窗把每条任务连同
 * 任务标识、目标路径与归属状态列给用户，由用户明确确认后才走清理 IPC
 * （主进程按任务所有权删除暂存产物，绝不越权）。清理失败如实展示，
 * 条目保留可重试；"稍后处理"只是收起弹窗，任务保持原样待下次启动再现。
 */

interface UnfinishedCreatesDialogProps {
  tasks: UnfinishedCreateTask[]
  onDismiss: () => void
}

export function UnfinishedCreatesDialog({ tasks, onDismiss }: UnfinishedCreatesDialogProps) {
  const api = useLauncherApi()
  const { t } = useI18n()
  const [cleaning, setCleaning] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [removed, setRemoved] = useState<Set<string>>(new Set())

  const confirmCleanup = async (task: UnfinishedCreateTask) => {
    if (cleaning !== null) return
    setCleaning(task.lockPath)
    try {
      const result = await api.cleanupUnfinishedCreate({ lockPath: task.lockPath, confirmed: true })
      if (result.ok) {
        setRemoved(previous => new Set(previous).add(task.lockPath))
      } else {
        setErrors(previous => ({ ...previous, [task.lockPath]: result.error ?? t('create.unfinished.cleanupFailed', { error: '-' }) }))
      }
    } catch (err) {
      setErrors(previous => ({ ...previous, [task.lockPath]: err instanceof Error ? err.message : String(err) }))
    } finally {
      setCleaning(null)
    }
  }

  const visible = tasks.filter(task => !removed.has(task.lockPath))

  // 全部任务都确认清理后弹窗自然消失（任务已从主进程 journal 移除，
  // 下次启动不会再发现）。
  if (visible.length === 0) return null

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal create-dialog" role="dialog" aria-modal="true" aria-labelledby="unfinished-title">
        <header>
          <div><History size={17} /><h2 id="unfinished-title">{t('create.unfinished.title')}</h2></div>
          <button type="button" className="icon-button" onClick={onDismiss} aria-label={t('common.close')}><X size={18} /></button>
        </header>
        <div className="modal-content">
          <p className="about-desc">{t('create.unfinished.desc')}</p>
          <ul className="unfinished-task-list">
            {visible.map(task => (
              <li key={task.lockPath} className="unfinished-task">
                <div className="unfinished-task-info">
                  <code>{task.taskId.slice(0, 8)}</code>
                  <span className="unfinished-task-path" title={task.target}>{task.target}</span>
                  {task.active && <small>{t('create.unfinished.activeWarning')}</small>}
                </div>
                <div className="unfinished-task-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void confirmCleanup(task)}
                    disabled={cleaning !== null}
                  >
                    <Trash2 size={14} />{cleaning === task.lockPath ? t('create.unfinished.cleaning') : t('create.unfinished.cleanup')}
                  </button>
                </div>
                {errors[task.lockPath] && <span className="create-status create-status-error" role="alert">{errors[task.lockPath]}</span>}
              </li>
            ))}
          </ul>
        </div>
        <footer>
          <button type="button" className="secondary-button" onClick={onDismiss}>{t('create.unfinished.dismiss')}</button>
        </footer>
      </section>
    </div>
  )
}

