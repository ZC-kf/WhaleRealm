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

import path from 'node:path'
import type { DesktopInstanceRecord, InstancePathRoot } from './instance-types'
import type { InstanceLayout } from './runtime-adapter'

export function resolveManagedLayout(selectedRoot: string): InstanceLayout {
  const root = path.resolve(selectedRoot)
  return {
    root,
    runtimeRoot: path.join(root, 'runtime'),
    dshHome: path.join(root, 'data', 'dsh-home'),
    electronUserData: path.join(root, 'data', 'electron-user-data'),
    workspace: path.join(root, 'workspace'),
    logs: path.join(root, 'logs'),
    cache: path.join(root, 'cache'),
  }
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
function ensureId(id:string){ if(!ID_RE.test(id)) throw new Error(`invalid instance id: ${id}`) }
function inside(root:string,target:string){ const rel=path.relative(path.resolve(root),path.resolve(target)); return rel==='' || (!rel.startsWith('..'+path.sep) && rel!=='..' && !path.isAbsolute(rel)) }
export function resolveInstancePaths(hubRoot:string,id:string): InstancePathRoot {
  ensureId(id); const root=path.resolve(hubRoot,'instances',id)
  if(!inside(path.resolve(hubRoot),root)) throw new Error('instance root escapes hub root')
  const dshHome=path.join(root,'dsh-home')
  return {root,dshHome,electronUserData:path.join(root,'electron-user-data'),desktopProfile:path.join(dshHome,'profiles','desktop'),workspace:path.join(root,'workspace'),logs:path.join(root,'logs'),skills:path.join(dshHome,'skills')}
}
export function resolveInstanceRecord(hubRoot: string, id: string, partial: Partial<DesktopInstanceRecord> = {}): DesktopInstanceRecord {
  const legacy = resolveInstancePaths(hubRoot, id)
  const port = partial.port ?? 19387
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid port')
  const layout = partial.layoutVersion === 2 ? resolveManagedLayout(partial.root ?? legacy.root) : legacy
  const dshHome = partial.dshHome ?? layout.dshHome
  return {
    id,
    name: partial.name ?? id,
    version: partial.version ?? '0.1.7-alpha.1',
    runtimeRoot: partial.runtimeRoot ?? ('runtimeRoot' in layout ? layout.runtimeRoot : ''),
    root: partial.root ?? layout.root,
    dshHome,
    electronUserData: partial.electronUserData ?? layout.electronUserData,
    desktopProfile: partial.desktopProfile ?? path.join(dshHome, 'profiles', 'desktop'),
    workspace: partial.workspace ?? layout.workspace,
    logs: partial.logs ?? layout.logs,
    skills: partial.skills ?? path.join(dshHome, 'skills'),
    skillsSource: partial.skillsSource ?? path.join(hubRoot, 'shared', 'skills'),
    port,
    lockName: partial.lockName ?? `dsh-desktop-${id}`,
    enabled: partial.enabled ?? true,
    autoStart: partial.autoStart ?? false,
    instanceKind: partial.instanceKind,
    ...(partial.adapterId !== undefined ? { adapterId: partial.adapterId } : {}),
    ...(partial.cache !== undefined ? { cache: partial.cache } : {}),
    ...(partial.layoutVersion === 2 ? {
      layoutVersion: 2 as const,
      cache: partial.cache ?? ('cache' in layout ? layout.cache : undefined),
    } : {}),
  }
}
