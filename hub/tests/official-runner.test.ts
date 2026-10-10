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

import { describe, expect, it } from 'vitest'
import { buildRunnerLaunchSpec } from '../electron/official-runner'

describe('official runner launch spec', () => {
  it('passes instance userData, DSH_HOME, port, workspace and lock context', () => {
    const spec = buildRunnerLaunchSpec({ id: 'stable', runnerExecutable: 'D:\\runtime\\DeepSeek Harness.exe', dshHome: 'D:\\instances\\stable\\dsh-home', electronUserData: 'D:\\instances\\stable\\electron-user-data', workspace: 'D:\\instances\\stable\\workspace', port: 19391, lockName: 'dsh-desktop-stable' })
    expect(spec.args).toEqual(['--user-data-dir', 'D:\\instances\\stable\\electron-user-data'])
    expect(spec.env.DSH_HOME).toBe('D:\\instances\\stable\\dsh-home')
    expect(spec.env.DSH_DESKTOP_PORT).toBe('19391')
    expect(spec.env.DSH_DESKTOP_LOCK).toBe('dsh-desktop-stable')
    expect(spec.cwd).toBe('D:\\instances\\stable\\workspace')
  })

  it('launches the Desktop window visibly instead of hiding it', () => {
    const spec = buildRunnerLaunchSpec({ id: 'stable', runnerExecutable: 'D:\\runtime\\DeepSeek Harness.exe', dshHome: 'D:\\instances\\stable\\dsh-home', electronUserData: 'D:\\instances\\stable\\electron-user-data', workspace: 'D:\\instances\\stable\\workspace', port: 19391, lockName: 'dsh-desktop-stable' })
    expect(spec.windowsHide).toBe(false)
  })
})
