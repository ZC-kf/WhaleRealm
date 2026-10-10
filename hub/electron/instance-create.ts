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

import type { CreateInstanceRequest, CreateInstanceResult, InstanceKind } from '../src/types'
import type { InstanceLayout } from './runtime-adapter'
import type { CreateTransaction } from './create-transaction'

export type CreateStage = 'verify' | 'deploy' | 'selfcheck' | 'register'
export interface CreateProgress { taskId?: string; stage: CreateStage; percent: number; detail: string; detailKey: string }
export interface RegisterOutcome { ok: boolean; instanceId?: string; error?: string; deployed?: boolean; ownershipUncertain?: boolean }
export interface CreateDeps {
  fetchHead(url: string): Promise<{ ok: boolean; status: number }>
  beginTransaction(target: string): Promise<CreateTransaction>
  download(url: string, runtimeRoot: string, onProgress: (received: number, total: number | null) => void): Promise<void>
  verifyPackage(runtimeRoot: string): Promise<void>
  register(input: { name: string; path: string; kind: InstanceKind; version: string; layout: InstanceLayout }): Promise<RegisterOutcome>
  unregister(instanceId: string): Promise<void>
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

/** Deploy into owned staging, publish after recheck, then register final paths. */
export async function runCreatePipeline(
  request: CreateInstanceRequest,
  deps: CreateDeps,
  onProgress: (progress: CreateProgress) => void,
  signal?: AbortSignal,
): Promise<CreateInstanceResult> {
  let transaction: CreateTransaction | undefined
  let registeredId: string | undefined
  let stage: CreateStage = 'verify'
  const checkCancelled = () => { if (signal?.aborted) throw new Error('创建已取消') }
  const progress = (next: CreateStage, percent: number, detail: string, key: string) => {
    stage = next; onProgress({ stage: next, percent, detail, detailKey: `create.stage.${key}` })
  }
  try {
    progress('verify', 0, '核验下载链接与目标目录', 'verify')
    checkCancelled()
    if (!request.downloadUrl) return { ok: false, error: '该类型暂无自动部署通道（请前往官网下载后手动导入）' }
    const head = await deps.fetchHead(request.downloadUrl)
    if (!head.ok) return { ok: false, error: `下载链接不可用（HTTP ${head.status}）` }
    checkCancelled()
    transaction = await deps.beginTransaction(request.path)
    checkCancelled()
    progress('deploy', 5, '下载安装包', 'download')
    await deps.download(request.downloadUrl, transaction.layout.runtimeRoot, (received, total) => {
      const percent = total && total > 0 ? 5 + Math.round(received / total * 85) : 5
      progress('deploy', Math.min(percent, 90), '下载中', 'download')
    })
    checkCancelled()
    progress('selfcheck', 95, '完整性自检', 'selfcheck')
    await deps.verifyPackage(transaction.layout.runtimeRoot)
    checkCancelled()
    const layout = await transaction.publish()
    checkCancelled()
    progress('register', 98, '收录实例', 'register')
    const outcome = await deps.register({ name: request.name, path: layout.runtimeRoot, kind: request.kind, version: request.version, layout })
    if (outcome.ownershipUncertain) return { ok: false, cleanupPending: true, error: `${outcome.error ?? '收录状态无法确认'}；任务产物与日志已保留，等待恢复核对` }
    registeredId = outcome.instanceId
    if (!outcome.ok) throw new Error(outcome.error ?? '未知错误')
    checkCancelled()
  } catch (error) {
    const label = { verify: '', deploy: '下载失败：', selfcheck: '自检失败：', register: '收录失败：' }[stage]
    let detail = `${label}${message(error)}`
    if (error instanceof Error && 'cleanupUnsafe' in error) return { ok: false, cleanupPending: true, error: `${detail}；进程退出未确认，任务产物与日志已保留` }
    if (registeredId) {
      try { await deps.unregister(registeredId) } catch (unregisterError) {
        // A registered runtime must never lose its files because deregistration failed.
        return { ok: false, instanceId: registeredId, error: `${detail}；撤销收录失败，任务产物保留：${message(unregisterError)}` }
      }
    }
    if (transaction) {
      try { await transaction.rollback(); await transaction.release() }
      catch (cleanupError) { detail += `；清理失败，任务残留已保留：${message(cleanupError)}` }
    }
    return { ok: false, error: detail }
  }
  // Registration succeeded: failure to release metadata must preserve the registered instance.
  try { await transaction!.release() } catch (error) {
    return { ok: false, instanceId: registeredId, error: `实例已收录，但任务元数据清理失败：${message(error)}` }
  }
  progress('register', 100, '完成', 'done')
  return { ok: true, instanceId: registeredId }
}
