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
import { resolveManagedLayout } from './instance-paths'
import type { DesktopInstanceRecord } from './instance-types'
import type { InstanceLayout } from './runtime-adapter'
export const WEB_HOST_SWITCH = '--whalerealm-web-host'
export const WEB_HOST_ENV = 'WHALEREALM_WEB_HOST_BOOTSTRAP'
export interface WebHostBootstrap { record: DesktopInstanceRecord; controlPort: number; key: string }
export function managedWebHostLayout(record: DesktopInstanceRecord): InstanceLayout {
  if (!record || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(record.id) || record.layoutVersion !== 2 || record.adapterId !== 'official-web' || record.version !== '0.2.0-rc.2' || !Number.isInteger(record.port) || record.port < 1 || record.port > 65535 || record.port === 3080 || typeof record.root !== 'string' || !path.isAbsolute(record.root) || path.dirname(record.root) === record.root) throw new Error('Invalid managed Web host identity')
  const layout = resolveManagedLayout(record.root)
  for (const field of Object.keys(layout) as (keyof InstanceLayout)[]) {
    if (record[field] !== layout[field]) throw new Error('Invalid managed Web host layout')
  }
  return layout
}

