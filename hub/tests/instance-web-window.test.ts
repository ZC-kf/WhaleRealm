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

import { expect, it } from 'vitest'
import { instanceWebPartition, isAllowedWebNavigation, webWindowPreferences } from '../electron/instance-web-window'
it('isolates sessions and does not grant Hub preload or Node privileges',()=>{
 expect(instanceWebPartition('a')).not.toBe(instanceWebPartition('b'))
 expect(webWindowPreferences('a')).toMatchObject({partition:instanceWebPartition('a'),nodeIntegration:false,contextIsolation:true,sandbox:true})
 expect(webWindowPreferences('a')).not.toHaveProperty('preload')
})
it('blocks another instance, credentials, nonloopback and non-http navigation',()=>{
 const origin='http://127.0.0.1:19430'
 expect(isAllowedWebNavigation(origin+'/settings',origin)).toBe(true)
 for(const url of ['http://127.0.0.1:19431/','http://localhost:19430/','http://user:pass@127.0.0.1:19430/','file:///tmp','https://example.org'])expect(isAllowedWebNavigation(url,origin)).toBe(false)
})
