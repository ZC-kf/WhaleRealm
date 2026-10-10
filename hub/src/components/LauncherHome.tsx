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

import { Minus, Settings, Square, SquareSquare, X } from 'lucide-react'
import packageMetadata from '../../package.json'
import { InstanceSwitcher } from './InstanceSwitcher'
import { useI18n } from '../i18n'
import type { DeepSeekBalanceResult, DeleteInstanceOptions, DesktopInstance, DiscoveredInstall, DshUsageResult, InstanceImportResult, InstanceRuntimeState } from '../types'
import type { CreateInstanceInput } from './dialogs/CreateInstanceDialog'

/** 从余额结果里取总余额（元）；取不到返回 null。 */
function balanceAmount(balance: DeepSeekBalanceResult | null): number | null {
  if (!balance || balance.status !== 'ok') return null
  const total = balance.balance.infos.reduce((sum, info) => sum + (info.totalBalance ?? 0), 0)
  return balance.balance.infos.length > 0 ? total : null
}

function BalanceBadge({ balance, threshold, onRecharge }: { balance: DeepSeekBalanceResult | null; threshold: number; onRecharge: () => void }) {
  const { t } = useI18n()
  if (!balance) return null
  const amount = balanceAmount(balance)
  const low = amount !== null && threshold > 0 && amount < threshold
  const label = amount !== null
    ? t('balance.label', { amount: amount.toFixed(2) })
    : balance.status === 'no-key' ? t('balance.noKey') : t('balance.failed')
  return (
    <div
      className={`launcher-balance${low ? ' low' : ''}`}
      title={low ? t('balance.lowHint') : balance.status === 'ok' ? t('balance.title') : label}
      onClick={low ? onRecharge : undefined}
    >
      <span>{label}</span>
      {low && <button type="button" className="launcher-balance-recharge" onClick={onRecharge}>{t('balance.recharge')}</button>}
    </div>
  )
}

/** 启动页（唯一界面）：实例首页，集中管理本机所有 DSH 桌面实例。 */

interface LauncherHomeProps {
  instances: DesktopInstance[]
  instanceStates: InstanceRuntimeState[]
  selectedInstanceId: string | null
  usageByInstance: Record<string, DshUsageResult>
  mirrorChanges: Record<string, { count: number; hasChanges: boolean }>
  dangerConfirm: boolean
  removeShortcuts: boolean
  headerKicker: string
  headerTitle: string
  headerSubtitle: string
  footerSlogan: string
  onSelectInstance: (id: string) => Promise<unknown>
  onStartInstance: (id: string) => Promise<unknown>
  onStopInstance: (id: string) => Promise<unknown>
  onRestartInstance: (id: string) => Promise<unknown>
  onPauseInstance: (id: string) => Promise<unknown>
  onResumeInstance: (id: string) => Promise<unknown>
  onSetPortInstance: (id: string, port: number) => Promise<unknown>
  onRenameInstance: (id: string, name: string) => Promise<unknown>
  onDeleteInstance: (id: string, options: DeleteInstanceOptions) => Promise<unknown>
  onDiscoverInstances: () => Promise<DiscoveredInstall[] | null>
  onImportInstance: (path: string) => Promise<InstanceImportResult>
  onCreateInstance: (input: CreateInstanceInput) => Promise<unknown>
  onOpenFolder: (path: string) => void
  onOpenSettings: (sectionId?: string) => void
  isMaximized: boolean
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose: () => void
  balance: DeepSeekBalanceResult | null
  balanceThreshold: number
  onRecharge: () => void
}

export function LauncherHome({
  instances,
  instanceStates,
  selectedInstanceId,
  usageByInstance,
  mirrorChanges,
  dangerConfirm,
  removeShortcuts,
  headerKicker,
  headerTitle,
  headerSubtitle,
  footerSlogan,
  onSelectInstance,
  onStartInstance,
  onStopInstance,
  onRestartInstance,
  onPauseInstance,
  onResumeInstance,
  onSetPortInstance,
  onRenameInstance,
  onDeleteInstance,
  onDiscoverInstances,
  onImportInstance,
  onCreateInstance,
  onOpenFolder,
  onOpenSettings,
  isMaximized,
  onMinimize,
  onToggleMaximize,
  onClose,
  balance,
  balanceThreshold,
  onRecharge,
}: LauncherHomeProps) {
  const { t } = useI18n()
  return (
    <div className={`launcher-home${isMaximized ? ' is-fullscreen' : ''}`}>
      <div className="launcher-drag-region" aria-hidden="true" />
      <BalanceBadge balance={balance} threshold={balanceThreshold} onRecharge={onRecharge} />
      <div className="launcher-window-controls">
        <button className="launcher-window-button" type="button" title={t('common.settings')} aria-label={t('window.settingsAria')} onClick={() => onOpenSettings()}>
          <Settings size={17} />
        </button>
        <button className="launcher-window-button minimize" type="button" title={t('window.minimize')} aria-label={t('window.minimize')} onClick={onMinimize}>
          <Minus size={17} />
        </button>
        <button className="launcher-window-button maximize" type="button" title={isMaximized ? t('window.restore') : t('window.fullscreen')} aria-label={isMaximized ? t('window.restore') : t('window.fullscreen')} onClick={onToggleMaximize}>
          {isMaximized ? <SquareSquare size={15} /> : <Square size={15} />}
        </button>
        <button className="launcher-window-close" type="button" title={t('common.close')} aria-label={t('common.close')} onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      <main className="launcher-stage">
        <InstanceSwitcher
          instances={instances}
          states={instanceStates}
          selectedId={selectedInstanceId ?? undefined}
          usage={usageByInstance}
          mirrorChanges={mirrorChanges}
          dangerConfirm={dangerConfirm}
          removeShortcuts={removeShortcuts}
          headerKicker={headerKicker}
          headerTitle={headerTitle}
          headerSubtitle={headerSubtitle}
          onSelect={onSelectInstance}
          onStart={onStartInstance}
          onStop={onStopInstance}
          onRestart={onRestartInstance}
          onPause={onPauseInstance}
          onResume={onResumeInstance}
          onSetPort={onSetPortInstance}
          onRename={onRenameInstance}
          onDelete={onDeleteInstance}
          onOpenFolder={onOpenFolder}
          onOpenSettings={onOpenSettings}
          onDiscover={onDiscoverInstances}
          onImport={onImportInstance}
          onCreateInstance={onCreateInstance}
        />
      </main>

      <footer className="launcher-footer">
        <span>鲸域 · WhaleRealm {packageMetadata.version}</span>
        <span>{footerSlogan || t('app.slogan')}</span>
        <span>{t('footer.stats', { count: instances.length, running: instances.filter(instance => instanceStates.some(state => state.instanceId === instance.id && (state.status === 'ready' || state.status === 'starting'))).length })}</span>
      </footer>
    </div>
  )
}
