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

import { spawnOwnedProcess } from './process-supervisor'
import { mkdir } from 'node:fs/promises'
import type { InstanceEnvironmentContext } from './instance-types'
import { buildInstanceEnvironment } from './instance-env'

export interface OfficialRunnerInput extends InstanceEnvironmentContext { runnerExecutable: string }
export interface OfficialRunnerLaunchSpec { executable: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; windowsHide: boolean }
/**
 * Desktop 是 GUI 应用：`windowsHide` 会写入 STARTUPINFO 的 SW_HIDE，Chromium 随后创建
 * `Chrome_WidgetWin_1` 窗口时全部保持不可见，实例虽在运行却没有桌面窗口。因此显式为 false。
 */
export function buildRunnerLaunchSpec(input: OfficialRunnerInput): OfficialRunnerLaunchSpec { return { executable: input.runnerExecutable, args: ['--user-data-dir', input.electronUserData], cwd: input.workspace, env: buildInstanceEnvironment(input, process.env), windowsHide: false } }
export async function spawnOfficialDesktopRunner(input: OfficialRunnerInput, onOutput?: (text: string) => void, signal?: AbortSignal) {
  await mkdir(input.workspace, { recursive: true })
  const spec = buildRunnerLaunchSpec(input)
  return spawnOwnedProcess(spec.executable, spec.args, { cwd: spec.cwd, env: spec.env, windowsHide: spec.windowsHide, onOutput, signal })
}
