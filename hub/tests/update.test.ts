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

import { describe, expect, it, vi } from 'vitest'
import { compareVersion, isNewer, runUpdateFlow, type UpdateFlowDeps, type UpdateStage } from '../src/update'
import type { ProjectReleaseInfo } from '../src/types'

/**
 * 更新流程状态机合同：
 * - 顺序：提示 → 停止实例（含确认）→ 下载 → 安装 → 延迟重启；
 * - 停止前必须用户确认，拒绝则取消且不发生任何后续动作；
 * - 每步失败立即返回明确阶段与错误，不继续执行；
 * - 无运行实例时跳过停止环节（无需确认）。
 */

const release: ProjectReleaseInfo = {
  releaseId: 9001,
  version: '1.2.0',
  publishedAt: '2026-10-09T01:02:03Z',
  notes: 'notes',
  pageUrl: 'https://github.com/ZC-kf/WhaleRealm/releases/tag/v1.2.0',
  assets: [{ id: 777, name: 'WhaleRealm-1.2.0-setup.exe', url: 'https://example.com/dl', digest: 'sha256:' + 'a'.repeat(64), size: 12 }],
}

function deps(overrides: Partial<UpdateFlowDeps> = {}): UpdateFlowDeps & { stages: UpdateStage[] } {
  const stages: UpdateStage[] = []
  const base: UpdateFlowDeps = {
    listRunning: vi.fn(async () => []),
    confirmStop: vi.fn(async () => true),
    stopInstance: vi.fn(async () => undefined),
    download: vi.fn(async () => ({ artifactId: 'WhaleRealm-1.2.0-setup.exe' })),
    install: vi.fn(async () => undefined),
    restart: vi.fn(async () => undefined),
    onStage: stage => stages.push(stage),
  }
  return { ...base, ...overrides, stages }
}

describe('版本比较', () => {
  it('compareVersion / isNewer', () => {
    expect(compareVersion('1.2.0', '1.0.0')).toBeGreaterThan(0)
    expect(compareVersion('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersion('0.9.9', '1.0.0')).toBeLessThan(0)
    expect(isNewer({ version: '1.2.0' }, '1.0.0')).toBe(true)
    expect(isNewer({ version: '1.0.0' }, '1.0.0')).toBe(false)
    expect(isNewer({ version: '0.9.0' }, '1.0.0')).toBe(false)
  })
})

describe('runUpdateFlow 状态机', () => {
  it('全流程成功：available → stopping → downloading → installing → restart-pending → done', async () => {
    const d = deps({ listRunning: vi.fn(async () => [{ id: 'a', name: 'A' }, { id: 'b' }]) })
    const result = await runUpdateFlow(release, d)
    expect(result).toEqual({ ok: true, stage: 'done' })
    expect(d.stages).toEqual(['available', 'stopping', 'downloading', 'installing', 'restart-pending', 'done'])
    expect(d.confirmStop).toHaveBeenCalledTimes(1)
    expect(d.stopInstance).toHaveBeenCalledTimes(2)
    expect(d.download).toHaveBeenCalledWith(9001)
    expect(d.install).toHaveBeenCalledWith('WhaleRealm-1.2.0-setup.exe')
    expect(d.restart).toHaveBeenCalledTimes(1)
  })

  it('无运行实例：跳过停止环节（不弹确认）', async () => {
    const d = deps()
    const result = await runUpdateFlow(release, d)
    expect(result.ok).toBe(true)
    expect(d.stages).not.toContain('stopping')
    expect(d.confirmStop).not.toHaveBeenCalled()
    expect(d.stopInstance).not.toHaveBeenCalled()
  })

  it('用户在停止确认处取消：cancelled，且不下载不安装', async () => {
    const d = deps({
      listRunning: vi.fn(async () => [{ id: 'a' }]),
      confirmStop: vi.fn(async () => false),
    })
    const result = await runUpdateFlow(release, d)
    expect(result).toEqual({ ok: false, stage: 'cancelled' })
    expect(d.stages).toEqual(['available', 'cancelled'])
    expect(d.download).not.toHaveBeenCalled()
    expect(d.install).not.toHaveBeenCalled()
    expect(d.restart).not.toHaveBeenCalled()
  })

  it('停止实例失败：failed 于 stopping，带错误，不进入下载', async () => {
    const d = deps({
      listRunning: vi.fn(async () => [{ id: 'a' }]),
      stopInstance: vi.fn(async () => { throw new Error('实例 a 停止失败') }),
    })
    const result = await runUpdateFlow(release, d)
    expect(result.ok).toBe(false)
    expect(result.stage).toBe('stopping')
    expect(result.error).toContain('实例 a 停止失败')
    expect(d.stages).toEqual(['available', 'stopping', 'failed'])
    expect(d.download).not.toHaveBeenCalled()
  })

  it('下载失败：failed 于 downloading，不安装', async () => {
    const d = deps({ download: vi.fn(async () => { throw new Error('产物缺少摘要凭据') }) })
    const result = await runUpdateFlow(release, d)
    expect(result.stage).toBe('downloading')
    expect(result.error).toContain('摘要')
    expect(d.install).not.toHaveBeenCalled()
    expect(d.restart).not.toHaveBeenCalled()
  })

  it('安装失败：failed 于 installing（如受保护数据被改动），不重启', async () => {
    const d = deps({ install: vi.fn(async () => { throw new Error('更新过程修改了受保护数据') }) })
    const result = await runUpdateFlow(release, d)
    expect(result.stage).toBe('installing')
    expect(result.error).toContain('受保护数据')
    expect(d.restart).not.toHaveBeenCalled()
  })

  it('未提供 restart：完成安装后停在 restart-pending（延迟重启由 UI 接管）', async () => {
    const d = deps()
    const { restart: _omit, ...withoutRestart } = d
    const result = await runUpdateFlow(release, withoutRestart)
    expect(result).toEqual({ ok: true, stage: 'restart-pending' })
    expect(d.stages).toEqual(['available', 'downloading', 'installing', 'restart-pending'])
    expect(d.stages).not.toContain('done')
  })
})
