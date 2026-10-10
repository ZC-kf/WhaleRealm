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

import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const run = promisify(execFile)

/**
 * 第三方声明一致性：`generate-third-party-notices.mjs --check` 必须通过——
 * 声明文件、许可文本索引与 package-lock / 实际安装完全一致；
 * 分发 ASAR 内的每个生产依赖都必须有完整许可文本可展示（license IPC 固定路径）。
 */

const REPO_ROOT = path.resolve(process.cwd(), '..')
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'generate-third-party-notices.mjs')

describe('第三方声明（generate-third-party-notices.mjs）', () => {
  it('--check 通过：声明与锁文件及实际安装一致', { timeout: 60_000 }, async () => {
    const { stdout } = await run(process.execPath, [SCRIPT, '--check'], { cwd: REPO_ROOT })
    expect(stdout).toContain('--check 通过')
  })

  it('锁文件全部条目可追踪：声明与索引文件真实存在', async () => {
    const notices = path.join(REPO_ROOT, 'hub', 'licenses', 'THIRD_PARTY_NOTICES.md')
    const index = path.join(REPO_ROOT, 'hub', 'licenses', 'third-party-index.json')
    await expect(access(notices)).resolves.toBeUndefined()
    await expect(access(index)).resolves.toBeUndefined()
  })
})
