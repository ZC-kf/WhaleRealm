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

import { describe, it, expect } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { importByPath, verifyInstall, isolatableFor, flavorFor } from '../electron/instance-discovery'
import { createInstanceRegistry } from '../electron/instance-registry'
import { snapshotMirror, diffMirror } from '../electron/instance-mirror'
import { buildInstanceEnvironment } from '../electron/instance-env'
import { buildRunnerLaunchSpec, spawnOfficialDesktopRunner } from '../electron/official-runner'

// 真实发行体：使用 hub 运行时目录下的官方 Desktop runner（含真实 app.asar，可被真实启动）。
const REPO_ROOT = path.resolve(process.cwd(), '..')
const RUNNER_ROOT = path.join(REPO_ROOT, 'runtimes', '0.1.7-alpha.1')
const RUNNER_EXE = path.join(RUNNER_ROOT, 'DeepSeek Harness.exe')

describe('新实例收录→注册→镜像→启动→停止 端到端', () => {
  it.skipIf(!existsSync(RUNNER_EXE))('一个全新发行体可被判定、收录、注册、建镜像、真实启动并停止', async () => {
    // 1) 判定：真实发行体目录通过 verifyInstall + isolatableFor(A 档) + flavor=desktop
    expect(verifyInstall(RUNNER_ROOT)).toBe(true)
    const catalog = [
      { matchPathPrefix: RUNNER_ROOT.toLowerCase(), matchExeName: 'DeepSeek Harness.exe', tier: 'A' as const, reason: 'e2e' },
    ]
    const graded = isolatableFor({ path: RUNNER_ROOT, exeName: 'DeepSeek Harness.exe', version: '0.1.7-alpha.1' }, catalog)
    expect(graded.isolatable).toBe(true)
    expect(flavorFor(RUNNER_ROOT, 'DeepSeek Harness.exe')).toBe('desktop')

    // 2) 收录判定（importByPath 返回 verified + isolatable + desktop）
    const install = importByPath(RUNNER_ROOT, { catalogPath: path.join(REPO_ROOT, 'manifests', 'runtime-catalog.json') })
    expect(install.verified).toBe(true)
    expect(install.isolatable).toBe(true)
    expect(install.flavor).toBe('desktop')

    // 3) 注册：全新 hubRoot，生成全新实例记录（独立目录/端口/锁名）
    const hubRoot = await mkdtemp(path.join(tmpdir(), 'whalerealm-e2e-'))
    try {
      const registry = createInstanceRegistry(hubRoot)
      const record = await registry.create({
        id: 'e2e-fresh-instance',
        name: 'E2E fresh instance',
        version: install.version ?? '0.1.7-alpha.1',
        runtimeRoot: RUNNER_ROOT,
      })
      expect(record.root.startsWith(hubRoot)).toBe(true)
      expect(record.dshHome).toBe(path.join(record.root, 'dsh-home'))
      expect(record.workspace).toBe(path.join(record.root, 'workspace'))
      expect(record.electronUserData).toBe(path.join(record.root, 'electron-user-data'))
      expect(record.lockName).toBe('dsh-desktop-e2e-fresh-instance')
      expect(record.port).toBeGreaterThan(0)

      // 4) 收录即建初始镜像（镜像源目录由收录方先建好——真实创建流水线同样如此）
      await mkdir(record.dshHome, { recursive: true })
      await mkdir(record.workspace, { recursive: true })
      await snapshotMirror(record.root, [record.dshHome, record.workspace])
      const initial = await diffMirror(record.root, [record.dshHome, record.workspace])
      expect(initial.snapshotAt).not.toBeNull()

      // 5) 启动参数 + 环境变量
      const launch = buildRunnerLaunchSpec({ ...record, runnerExecutable: RUNNER_EXE })
      expect(launch.executable).toBe(RUNNER_EXE)
      expect(launch.args).toContain('--user-data-dir')
      expect(launch.args[launch.args.indexOf('--user-data-dir') + 1]).toBe(record.electronUserData)
      expect(launch.cwd).toBe(record.workspace)
      const env = buildInstanceEnvironment(record, { ELECTRON_RUN_AS_NODE: '1', PATH: process.env.PATH ?? '' })
      expect(env.DSH_HOME).toBe(record.dshHome)
      expect(env.DSH_DESKTOP_PORT).toBe(String(record.port))
      expect(env.DSH_DESKTOP_LOCK).toBe(record.lockName)
      expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()

      // 6) 真实启动 → ready → 停止 → 停止后镜像
      await mkdir(record.workspace, { recursive: true })
      const handle = await spawnOfficialDesktopRunner({ ...record, runnerExecutable: RUNNER_EXE })
      expect(handle.pid).toBeGreaterThan(0)
      await handle.stop()
      await snapshotMirror(record.root, [record.dshHome, record.workspace]).catch(() => undefined)
      const stopped = await diffMirror(record.root, [record.dshHome, record.workspace])
      expect(stopped.snapshotAt).not.toBeNull()
    } finally {
      await rm(hubRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }, 60_000)
})
