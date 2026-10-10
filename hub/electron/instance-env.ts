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

import type { InstanceEnvironmentContext } from './instance-types'
import path from 'node:path'
import type { InstanceLayout } from './runtime-adapter'

/**
 * Hub 自身可能运行在 Electron 的 node 模式下（例如从 DSH 宿主里启动），该变量会被继承。
 * 若透传给 Desktop runner，runner 会退化成纯 Node 并拒绝 `--user-data-dir` 等 Electron 参数，
 * 导致实例根本无法启动，因此必须在实例环境中显式移除。
 */
const INHERITED_ELECTRON_NODE_MODE_VARS = ['ELECTRON_RUN_AS_NODE'] as const

export function buildInstanceEnvironment(context: InstanceEnvironmentContext, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...base,
    DSH_HOME: context.dshHome,
    DSH_DESKTOP_INSTANCE_ID: context.id,
    DSH_DESKTOP_USER_DATA: context.electronUserData,
    DSH_DESKTOP_WORKSPACE: context.workspace,
    DSH_DESKTOP_PORT: String(context.port),
    DSH_DESKTOP_LOCK: context.lockName,
  }
  for (const name of INHERITED_ELECTRON_NODE_MODE_VARS) delete env[name]
  return env
}

/** Web/npm receive only OS bootstrap facts, never ambient secrets or user npm/Node policy. */
export function buildWebEnvironment(layout: Pick<InstanceLayout, 'dshHome' | 'cache' | 'workspace'>, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of ['SystemRoot', 'WINDIR', 'ComSpec', 'PATH', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE']) {
    const entry = Object.entries(base).find(([name]) => name.toLowerCase() === key.toLowerCase())
    if (entry) env[key] = entry[1]
  }
  return { ...env, DSH_HOME: layout.dshHome, DSH_TELEMETRY_DISABLED: '1',
    HOME: path.join(layout.cache, 'home'), USERPROFILE: path.join(layout.cache, 'home'),
    APPDATA: path.join(layout.cache, 'app-data'), LOCALAPPDATA: path.join(layout.cache, 'local-app-data'),
    TEMP: path.join(layout.cache, 'temp'), TMP: path.join(layout.cache, 'temp'),
    npm_config_cache: layout.cache, npm_config_userconfig: path.join(layout.cache, 'npmrc'),
    npm_config_globalconfig: path.join(layout.cache, 'global-npmrc'), npm_config_ignore_scripts: 'true',
    npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' }
}
