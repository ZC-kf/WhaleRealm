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

import type { InstanceKind } from '../src/types'

export interface DesktopInstanceRecord {
  layoutVersion?: 2
  adapterId?: string
  cache?: string
  skills?: string
  id: string
  name?: string
  version?: string
  runtimeRoot?: string
  root: string
  dshHome: string
  electronUserData: string
  desktopProfile: string
  workspace: string
  logs: string
  skillsSource: string
  port: number
  lockName: string
  enabled?: boolean
  autoStart?: boolean
  /** 实例类别（官方网页/官方桌面/社区桌面）。 */
  instanceKind?: InstanceKind
}

export interface InstancePathRoot {
  root: string
  dshHome: string
  electronUserData: string
  desktopProfile: string
  workspace: string
  logs: string
  skills: string
}

export interface InstanceEnvironmentContext {
  id: string
  dshHome: string
  electronUserData: string
  workspace: string
  port: number
  lockName: string
}
