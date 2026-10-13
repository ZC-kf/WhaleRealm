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
import { buildInstanceEnvironment } from '../electron/instance-env'

describe('instance environment contract', () => {
  it('overrides inherited DSH state with the selected instance roots', () => {
    const env = buildInstanceEnvironment({
      id: 'stable',
      dshHome: 'D:\\whalerealm-test\\instances\\stable\\dsh-home',
      electronUserData: 'D:\\whalerealm-test\\instances\\stable\\electron-user-data',
      workspace: 'D:\\whalerealm-test\\instances\\stable\\workspace',
      port: 19391,
      lockName: 'dsh-desktop-stable',
    }, { DSH_HOME: '<user-profile>\\.dsh', PATH: 'test' })

    expect(env.DSH_HOME).toBe('D:\\whalerealm-test\\instances\\stable\\dsh-home')
    expect(env.DSH_DESKTOP_USER_DATA).toBe('D:\\whalerealm-test\\instances\\stable\\electron-user-data')
    expect(env.DSH_DESKTOP_WORKSPACE).toBe('D:\\whalerealm-test\\instances\\stable\\workspace')
    expect(env.DSH_DESKTOP_PORT).toBe('19391')
    expect(env.DSH_DESKTOP_INSTANCE_ID).toBe('stable')
    expect(env.DSH_HOME).not.toBe('<user-profile>\\.dsh')
  })

  it('drops inherited Electron node-mode so the runner launches as a desktop app', () => {
    const env = buildInstanceEnvironment({
      id: 'stable',
      dshHome: 'D:\\whalerealm-test\\instances\\stable\\dsh-home',
      electronUserData: 'D:\\whalerealm-test\\instances\\stable\\electron-user-data',
      workspace: 'D:\\whalerealm-test\\instances\\stable\\workspace',
      port: 19391,
      lockName: 'dsh-desktop-stable',
    }, { ELECTRON_RUN_AS_NODE: '1', PATH: 'test' })

    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect('ELECTRON_RUN_AS_NODE' in env).toBe(false)
  })
})
