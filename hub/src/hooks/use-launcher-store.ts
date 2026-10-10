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

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLauncherApi } from '../api/client'
import { errorText } from '../lib/format'
import { translate } from '../i18n'
import { DEFAULT_LANGUAGE } from '../i18n/locales'
import type { TranslationKey } from '../i18n/translations/zh-CN'
import type {
  AppSettings,
  DeepSeekBalanceResult,
  DeleteInstanceOptions,
  DesktopInstance,
  DiscoveredInstall,
  DshUsageResult,
  InstanceImportResult,
  InstanceMirrorStatus,
  InstanceRuntimeState,
} from '../types'
import { BUSY, useAsyncAction } from './use-async-action'
import { useToast, type ToastState } from './use-toast'

/**
 * 单界面实例管理的领域状态与全部写操作。
 * 界面导航、对话框开关等纯展示状态不在这里 —— 那些由 App 自己持有。
 */

export function useLauncherStore() {
  const api = useLauncherApi()
  const { toast, showToast: baseShowToast, dismissToast } = useToast()
  const settingsRef = useRef<AppSettings | null>(null)
  // 设置里关闭提示弹窗时，静默吞掉所有 toast。
  const showToast = useCallback((next: ToastState) => {
    if (settingsRef.current?.showToasts === false) return
    baseShowToast(next)
  }, [baseShowToast])
  const { busy, run } = useAsyncAction(showToast)

  // 领域层（Provider 之外）的语言感知翻译，供错误/成功提示使用。
  const tr = (key: TranslationKey, params?: Record<string, string | number>) =>
    translate(settingsRef.current?.language ?? DEFAULT_LANGUAGE, key, params)

  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [instances, setInstances] = useState<DesktopInstance[]>([])
  const [instanceStates, setInstanceStates] = useState<InstanceRuntimeState[]>([])
  const instanceStatesRef = useRef<InstanceRuntimeState[]>([])
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null)
  const [discoveredInstalls, setDiscoveredInstalls] = useState<DiscoveredInstall[]>([])
  const [usageByInstance, setUsageByInstance] = useState<Record<string, DshUsageResult>>({})
  const [balance, setBalance] = useState<DeepSeekBalanceResult | null>(null)
  const [mirrorChanges, setMirrorChanges] = useState<Record<string, { count: number; hasChanges: boolean }>>({})
  const [loading, setLoading] = useState(true)

  // 同步 settings 到 ref，供 showToast 判断是否静默。
  useEffect(() => { settingsRef.current = settings }, [settings])
  // 同步 instanceStates 到 ref，供镜像轮询读取最新状态（避免因状态变化重建轮询定时器）。
  useEffect(() => { instanceStatesRef.current = instanceStates }, [instanceStates])

  const applyMirrorStatus = useCallback((id: string, status: InstanceMirrorStatus) => {
    const count = status.changed.length + status.added.length + status.removed.length
    setMirrorChanges(current => ({ ...current, [id]: { count, hasChanges: status.hasSnapshot && count > 0 } }))
  }, [])

  const refreshMirrorStatus = useCallback(async (id: string) => {
    try { applyMirrorStatus(id, await api.instanceMirrorStatus(id)) } catch { /* 忽略单实例比对失败 */ }
  }, [api, applyMirrorStatus])

  const clearMirrorStatus = useCallback((id: string) => {
    setMirrorChanges(current => ({ ...current, [id]: { count: 0, hasChanges: false } }))
  }, [])

  const selectInstance = useCallback(async (id: string) => {
    // 乐观更新：立即框住白框，避免「先选中才可操作」的卡顿感。
    setSelectedInstanceId(id)
    try {
      const next = await api.selectInstance(id)
      setSelectedInstanceId(next.id)
      return next
    } catch {
      return undefined
    }
  }, [api])

  const startInstance = useCallback(async (id: string) => {
    const next = await api.startInstance(id)
    setInstanceStates(current => [...current.filter(item => item.instanceId !== id), next])
    clearMirrorStatus(id) // 运行中不再按镜像判异常
    return next
  }, [api, clearMirrorStatus])

  const stopInstance = useCallback(async (id: string) => {
    const next = await api.stopInstance(id)
    setInstanceStates(current => [...current.filter(item => item.instanceId !== id), next])
    void refreshMirrorStatus(id) // 停止即已重建镜像，立即刷新为正常
    return next
  }, [api, refreshMirrorStatus])

  const restartInstance = useCallback(async (id: string) => {
    const next = await api.restartInstance(id)
    setInstanceStates(current => [...current.filter(item => item.instanceId !== id), next])
    clearMirrorStatus(id)
    return next
  }, [api, clearMirrorStatus])

  const pauseInstance = useCallback(async (id: string) => {
    const next = await api.pauseInstance(id)
    setInstanceStates(current => [...current.filter(item => item.instanceId !== id), next])
    clearMirrorStatus(id) // 暂停属会话中，不按镜像判异常
    return next
  }, [api, clearMirrorStatus])

  const resumeInstance = useCallback(async (id: string) => {
    const next = await api.resumeInstance(id)
    setInstanceStates(current => [...current.filter(item => item.instanceId !== id), next])
    clearMirrorStatus(id)
    return next
  }, [api, clearMirrorStatus])

  const setInstancePort = useCallback(async (id: string, port: number) => {
    const next = await api.setInstancePort(id, port)
    setInstances(current => current.map(item => (item.id === id ? next : item)))
    return next
  }, [api])

  const renameInstance = useCallback(async (id: string, name: string) => {
    const next = await api.renameInstance(id, name)
    setInstances(current => current.map(item => (item.id === id ? next : item)))
    return next
  }, [api])

  const refreshInstances = useCallback(async () => {
    const next = await api.listInstances()
    setInstances(next)
    return next
  }, [api])

  const refreshBalance = useCallback(async (force = false) => {
    try {
      setBalance(await api.deepseekBalance(force))
    } catch (error) {
      setBalance({ status: 'error', message: errorText(error) })
    }
  }, [api])

  // 余额周期性刷新（10s），保证右上角余额实时。
  useEffect(() => {
    const timer = window.setInterval(() => { void refreshBalance(true) }, 10_000)
    return () => window.clearInterval(timer)
  }, [refreshBalance])

  // 实例运行状态实时轮询（5s），让卡片状态与圆点实时刷新。
  useEffect(() => {
    let disposed = false
    const poll = async () => {
      try {
        const next = await api.listInstanceStates()
        if (!disposed) setInstanceStates(next)
      } catch { /* 主进程不可达时保持现状 */ }
    }
    const timer = window.setInterval(poll, 5000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [api])

  const deleteInstance = useCallback(async (id: string, options: DeleteInstanceOptions) => {
    const result = await api.deleteInstance(id, options)
    if (!result.ok) throw new Error(result.error ?? tr('toast.deleteFailed'))
    setInstances(current => current.filter(item => item.id !== id))
    setInstanceStates(current => current.filter(item => item.instanceId !== id))
    setUsageByInstance(current => {
      const next = { ...current }
      delete next[id]
      return next
    })
    setSelectedInstanceId(current => (current === id ? null : current))
    return result
  }, [api])

  const discoverInstances = useCallback(async () => {
    const result = await api.discoverInstances()
    if (result.ok) setDiscoveredInstalls(result.installs)
    return result
  }, [api])

  const refreshUsageFor = useCallback(async (list: DesktopInstance[]) => {
    const entries = await Promise.all(list.map(async instance => {
      try {
        return [instance.id, await api.instanceUsage(instance.dshHome)] as const
      } catch {
        return [instance.id, { status: 'error' as const, message: tr('toast.usageFailed') }] as const
      }
    }))
    setUsageByInstance(Object.fromEntries(entries))
  }, [api])

  const importInstance = useCallback(async (installPath: string): Promise<InstanceImportResult> => {
    const result = await api.importInstance(installPath)
    if (result.ok && result.registered) {
      const next = await api.listInstances()
      setInstances(next)
      if (result.record) setSelectedInstanceId(result.record.id)
      await refreshUsageFor(next)
    }
    return result
  }, [api, refreshUsageFor])

  useEffect(() => {
    let disposed = false
    void Promise.all([
      api.getSettings(),
      api.listInstances(),
      api.listInstanceStates(),
    ])
      .then(async ([nextSettings, nextInstances, nextInstanceStates]) => {
        if (disposed) return
        setSettings(nextSettings)
        setInstances(nextInstances)
        setInstanceStates(nextInstanceStates)
        setSelectedInstanceId(nextInstances[0]?.id ?? null)
        // Token 用量独立于实例列表加载，失败不阻塞首页。
        const entries = await Promise.all(nextInstances.map(async instance => {
          try {
            return [instance.id, await api.instanceUsage(instance.dshHome)] as const
          } catch {
            return [instance.id, { status: 'error' as const, message: tr('toast.usageFailed') }] as const
          }
        }))
        if (!disposed) setUsageByInstance(Object.fromEntries(entries))
      })
      .catch(error => showToast({ kind: 'error', message: errorText(error) }))
      .finally(() => { if (!disposed) setLoading(false) })
    // 余额后台加载，失败不阻塞首页。
    void api.deepseekBalance().then(setBalance).catch(() => setBalance({ status: 'error', message: tr('balance.failed') }))
    return () => { disposed = true }
  }, [api, showToast])

  // 低消耗实时自动比对：周期轮询停止中实例的镜像差异。
  // 只依赖 instances（状态经 ref 读取），避免 instanceStates 每 5s 刷新导致本 effect
  // 反复重建、丢弃在途结果，进而让列表靠后的实例永远比对不到（饥饿）。
  useEffect(() => {
    let disposed = false
    const poll = async () => {
      if (disposed) return
      const states = instanceStatesRef.current
      const stoppedIds = instances
        .filter(instance => !states.some(state => state.instanceId === instance.id && (state.status === 'ready' || state.status === 'starting' || state.status === 'paused')))
        .map(instance => instance.id)
      await Promise.all(stoppedIds.map(id => refreshMirrorStatus(id)))
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 5_000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [instances, refreshMirrorStatus])

  const saveSettings = useCallback(async (next: AppSettings): Promise<boolean> => {
    const saved = await run(BUSY.settings, async () => {
      const stored = await api.saveSettings(next)
      setSettings(stored)
      return stored
    }, { success: translate(next.language ?? DEFAULT_LANGUAGE, 'toast.settingsSaved') })
    return saved !== undefined
  }, [api, run])

  return {
    loading,
    settings,
    instances,
    instanceStates,
    selectedInstanceId,
    discoveredInstalls,
    usageByInstance,
    mirrorChanges,
    balance,
    busy,
    toast,
    selectInstance,
    startInstance,
    stopInstance,
    restartInstance,
    pauseInstance,
    resumeInstance,
    setInstancePort,
    renameInstance,
    refreshInstances,
    deleteInstance,
    discoverInstances,
    importInstance,
    saveSettings,
    refreshUsageFor,
    refreshBalance,
    dismissToast,
    showToast,
  }
}
