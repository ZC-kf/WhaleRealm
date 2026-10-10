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

import type { ProjectReleaseInfo } from './types'

/**
 * 软件更新域模块（渲染层）。
 *
 * 版本数据来自主进程受信通道（project-release.ts）——本模块不再硬编码任何
 * "最新版本"占位。职责：
 * - compareVersion / isNewer：版本比较（纯函数）；
 * - runUpdateFlow：更新流程状态机（提示 → 停止实例〔含确认〕→ 下载 → 校验
 *   → 安装 → 延迟重启），每一步失败都有明确的阶段与错误信息。
 */

/** 比较两个 semver 版本号；a > b 返回正数，a < b 返回负数，相等返回 0。 */
export function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  const length = Math.max(pa.length, pb.length)
  for (let i = 0; i < length; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da !== db) return da - db
  }
  return 0
}

/** 发行版是否比当前版本新（比较去前导 v 后的语义版本）。 */
export function isNewer(release: Pick<ProjectReleaseInfo, 'version'>, currentVersion: string): boolean {
  return compareVersion(release.version, currentVersion) > 0
}

export type UpdateStage =
  | 'available'    // 已发现可用更新（提示）
  | 'stopping'     // 正在停止运行中的实例（用户已确认）
  | 'downloading'  // 受信下载中（主进程校验摘要）
  | 'installing'   // 安装中（主进程校验 staging 产物 + 受保护数据摘要）
  | 'restart-pending' // 安装完成，等待延迟重启
  | 'done'         // 已重启/流程收尾
  | 'cancelled'    // 用户在停止实例确认处取消
  | 'failed'       // 任一步失败（stage/error 说明位置与原因）

export interface UpdateFlowDeps {
  /** 列出运行中的实例（id + 名称），用于停止前确认与逐个停止。 */
  listRunning(): Promise<Array<{ id: string; name?: string }>>
  /** 停止实例前征求用户确认；返回 false 视为用户取消整个更新。 */
  confirmStop(instances: Array<{ id: string; name?: string }>): Promise<boolean>
  stopInstance(id: string): Promise<unknown>
  /** 受信下载（主进程按摘要校验后返回不透明句柄）。 */
  download(releaseId: number): Promise<{ artifactId: string }>
  /** 受信安装（主进程校验 staging 归属 + 受保护数据摘要不变）。 */
  install(artifactId: string): Promise<void>
  /** 延迟重启：延迟毫秒数由调用方决定；未提供则流程只到 restart-pending。 */
  restart?(): Promise<void>
  onStage(stage: UpdateStage, detail?: string): void
}

export interface UpdateFlowResult {
  ok: boolean
  stage: UpdateStage
  error?: string
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error)

/**
 * 更新流程状态机。严格顺序执行；任何一步失败即返回 {ok:false, stage,
 * error}，不再继续后续步骤。停止实例前必须经过用户确认。
 */
export async function runUpdateFlow(release: ProjectReleaseInfo, deps: UpdateFlowDeps): Promise<UpdateFlowResult> {
  const fail = (stage: UpdateStage, error: unknown): UpdateFlowResult => {
    deps.onStage('failed', message(error))
    return { ok: false, stage, error: message(error) }
  }
  try {
    deps.onStage('available')
    // 1. 停止运行中的实例（含确认）。
    const running = await deps.listRunning()
    if (running.length > 0) {
      const confirmed = await deps.confirmStop(running)
      if (!confirmed) {
        deps.onStage('cancelled')
        return { ok: false, stage: 'cancelled' }
      }
      deps.onStage('stopping')
      try {
        for (const instance of running) await deps.stopInstance(instance.id)
      } catch (error) {
        return fail('stopping', error)
      }
    }
    // 2. 受信下载（主进程校验摘要）。
    deps.onStage('downloading')
    let artifact: { artifactId: string }
    try {
      artifact = await deps.download(release.releaseId)
    } catch (error) {
      return fail('downloading', error)
    }
    // 3. 受信安装（主进程校验 staging 产物与受保护数据摘要不变）。
    deps.onStage('installing')
    try {
      await deps.install(artifact.artifactId)
    } catch (error) {
      return fail('installing', error)
    }
    // 4. 延迟重启（由调用方决定时机；未提供 restart 则停在 restart-pending）。
    deps.onStage('restart-pending')
    if (deps.restart) {
      try {
        await deps.restart()
      } catch (error) {
        return fail('restart-pending', error)
      }
      deps.onStage('done')
      return { ok: true, stage: 'done' }
    }
    return { ok: true, stage: 'restart-pending' }
  } catch (error) {
    return fail('available', error)
  }
}
