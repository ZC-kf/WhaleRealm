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
import { runCreatePipeline, type CreateDeps } from '../electron/instance-create'
import type { CreateInstanceRequest } from '../src/types'
import { resolveManagedLayout } from '../electron/instance-paths'

function makeDeps(overrides: Partial<CreateDeps> = {}): { deps: CreateDeps; state: { cleared: number; downloads: number } } {
  const state = { cleared: 0, downloads: 0 }
  const deps: CreateDeps = {
    fetchHead: async () => ({ ok: true, status: 200 }),
    download: async (_url, _dir, onProgress) => { state.downloads += 1; onProgress(100, 100) },
    beginTransaction: async dir => ({ layout: resolveManagedLayout(dir + '-stage'), publish: async () => resolveManagedLayout(dir), rollback: async () => { state.cleared += 1 }, release: async () => undefined }),
    unregister: async () => undefined,
    verifyPackage: async () => undefined,
    register: async () => ({ ok: true, instanceId: 'created-1' }),

    ...overrides,
  }
  return { deps, state }
}

const baseRequest: CreateInstanceRequest = {
  name: '测试实例',
  path: 'C:\\temp\\new-instance',
  kind: 'community-desktop',
  version: '0.21.0',
  downloadUrl: 'https://example.com/bundle.exe',
}

describe('新建实例流水线（instance-create.ts）', () => {
  it('全流程成功：核验→下载→自检→收录，阶段顺序正确', async () => {
    const raw: string[] = []
    const { deps, state } = makeDeps()
    const result = await runCreatePipeline(baseRequest, deps, p => raw.push(p.stage))
    const stages = [...new Set(raw)]
    expect(result.ok).toBe(true)
    expect(result.instanceId).toBe('created-1')
    expect(stages).toEqual(['verify', 'deploy', 'selfcheck', 'register'])
    expect(state.cleared).toBe(0)
    expect(state.downloads).toBe(1)
  })

  it('无下载地址（官方桌面版）→ 直接失败且不清理目录', async () => {
    const { deps, state } = makeDeps()
    const result = await runCreatePipeline({ ...baseRequest, downloadUrl: null }, deps, () => undefined)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('自动部署通道')
    expect(state.cleared).toBe(0)
    expect(state.downloads).toBe(0)
  })

  it('链接探测失败（HTTP 404）→ 失败且不进入下载、不清理目录', async () => {
    const { deps, state } = makeDeps({ fetchHead: async () => ({ ok: false, status: 404 }) })
    const result = await runCreatePipeline(baseRequest, deps, () => undefined)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('404')
    expect(state.downloads).toBe(0)
    expect(state.cleared).toBe(0)
  })

  it('目标目录非空 → 失败且绝不清理目录（保护用户数据）', async () => {
    const { deps, state } = makeDeps({ beginTransaction: async () => { throw new Error('目标文件夹必须为空') } })
    const result = await runCreatePipeline(baseRequest, deps, () => undefined)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('必须为空')
    expect(state.downloads).toBe(0)
    expect(state.cleared).toBe(0)
  })

  it('下载失败 → 失败清目录', async () => {
    const { deps, state } = makeDeps({ download: async () => { throw new Error('网络中断') } })
    const result = await runCreatePipeline(baseRequest, deps, () => undefined)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('下载失败')
    expect(state.cleared).toBe(1)
  })

  it('自检失败 → 失败清目录（用户要求：自检出错清空目录回退）', async () => {
    const { deps, state } = makeDeps({ verifyPackage: async () => { throw new Error('安装包不是有效的 Windows 可执行文件') } })
    const result = await runCreatePipeline(baseRequest, deps, () => undefined)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('自检失败')
    expect(state.cleared).toBe(1)
  })

  it('收录失败 → 失败清目录', async () => {
    const { deps, state } = makeDeps({ register: async () => ({ ok: false, error: '该发行体不可隔离托管' }) })
    const result = await runCreatePipeline(baseRequest, deps, () => undefined)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('收录失败')
    expect(state.cleared).toBe(1)
  })

  it('部署成功但收录失败仍回滚任务产物', async () => {
    const { deps, state } = makeDeps({ register: async () => ({ ok: false, error: '该发行体不可隔离托管，仅收录清单', deployed: true }) })
    const result = await runCreatePipeline(baseRequest, deps, () => undefined)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('不可隔离托管')
    expect(state.cleared).toBe(1)
  })
})

const effects = vi.hoisted(() => ({ fetch: vi.fn(), spawnInstaller: vi.fn(), mkdir: vi.fn(), rm: vi.fn(), writeFile: vi.fn(), createWriteStream: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: {}, net: { fetch: effects.fetch } }))
vi.mock('node:child_process', () => ({ spawn: effects.spawnInstaller }))
vi.mock('node:fs', () => ({ createWriteStream: effects.createWriteStream }))
vi.mock('node:fs/promises', async original => ({ ...await original<typeof import('node:fs/promises')>(), mkdir: effects.mkdir, rm: effects.rm, writeFile: effects.writeFile }))

import { registerCreateInstanceHandler } from '../electron/create-runtime'
import { resolveDesktopAssets } from '../electron/desktop-assets'
describe('main creation admission', () => {
 it.each(['official-desktop', 'community-desktop'] as const)('never adopts a forged %s installer before side effects', async kind => {
 vi.clearAllMocks()
 let handler: (_event: unknown, input: unknown) => Promise<any> = async () => undefined
 registerCreateInstanceHandler({ handle: (channel: string, fn: typeof handler) => { if (channel === 'create:instance') handler = fn } } as never, {} as never, {} as never, () => undefined)
 const settled = await handler({}, { ...baseRequest, kind, downloadUrl: 'https://evil/installer.exe' }).then((result: any) => ({ result }), (error: unknown) => ({ error }))
 const certified = resolveDesktopAssets(kind)
 if (certified.length) {
   // 已收录隔离认证免安装包：渲染进程伪造的 downloadUrl 被目录解析出的可信地址替换，
   // 绝不进入普通安装包通道，也不产生任何下载/安装/文件系统副作用。
   expect(certified.every(asset => /^file:/.test(asset.url))).toBe(true)
   expect(certified.map(asset => asset.url).join(',')).not.toContain('evil')
 } else {
   // 无认证产物：在任何网络与部署副作用之前 fail-closed 拒绝。
   expect('result' in settled && settled.result?.ok).toBe(false)
   expect('result' in settled ? settled.result?.error : undefined).toContain('免安装')
 }
 for (const effect of Object.values(effects)) expect(effect).not.toHaveBeenCalled()
 })
})


it('main rejects an uncertified Web version before network or deploy effects', async () => {
 vi.clearAllMocks()
 effects.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ name: '@deepseek-ai/dsh', versions: {} }) })
 let handler: (_event: unknown, input: unknown) => Promise<any> = async () => undefined
 registerCreateInstanceHandler({ handle: (channel: string, fn: typeof handler) => { if (channel === 'create:instance') handler = fn } } as never, {} as never, {} as never, () => undefined)
 const result = await handler({}, { ...baseRequest, kind: 'official-web', version: '9.9.9', downloadUrl: 'https://evil/setup.exe' })
 expect(result.ok).toBe(false)
 expect(result.error).toContain('仅支持 0.2.0-rc.2')
 for (const effect of Object.values(effects)) expect(effect).not.toHaveBeenCalled()
})
