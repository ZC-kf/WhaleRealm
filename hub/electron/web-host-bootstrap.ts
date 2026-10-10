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
import { app } from 'electron'
import { lstatSync, mkdirSync, realpathSync } from 'node:fs'
import path from 'node:path'

import { managedWebHostLayout, WEB_HOST_ENV, WEB_HOST_SWITCH, type WebHostBootstrap } from './web-host-contract'
export function isWebHostInvocation(): boolean {
  return process.argv.includes(WEB_HOST_SWITCH) || process.env[WEB_HOST_ENV] !== undefined
}
function privateDirectory(directory: string): void {
  let current = path.resolve(directory)
  for (;;) {
    try { if (lstatSync(current).isSymbolicLink()) throw new Error('Linked Web host directory') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const parent = path.dirname(current); if (parent === current) break; current = parent
  }
  mkdirSync(directory, { recursive: true })
  if (!lstatSync(directory).isDirectory() || realpathSync(directory).toLowerCase() !== path.resolve(directory).toLowerCase()) throw new Error('Invalid Web host directory')
}
/** Synchronous: Electron receives private paths before its first ready event. */
export function consumeWebHostBootstrap(): WebHostBootstrap {
  const raw = process.env[WEB_HOST_ENV]; delete process.env[WEB_HOST_ENV]
  if (!process.argv.includes(WEB_HOST_SWITCH) || !raw || raw.length > 32768 || app.isReady()) throw new Error('Invalid Web host bootstrap')
  const bootstrap = JSON.parse(raw) as WebHostBootstrap
  if (!/^[a-f0-9]{64}$/.test(bootstrap.key) || !Number.isInteger(bootstrap.controlPort) || bootstrap.controlPort < 1 || bootstrap.controlPort > 65535 || bootstrap.controlPort === 3080) throw new Error('Invalid Web host channel')
  const layout = managedWebHostLayout(bootstrap.record)
  for (const directory of Object.values(layout)) {
    // A launch can use an existing managed deployment only.
    if (!lstatSync(directory).isDirectory()) throw new Error('Missing Web host layout')
    privateDirectory(directory)
  }
  const userData = path.join(layout.cache, 'browser-host')
  const defaultSession = path.join(userData, 'default-session')
  const crashes = path.join(layout.logs, 'browser-crashes')
  for (const directory of [userData, defaultSession, crashes, path.join(userData, 'disk-cache')]) privateDirectory(directory)
  app.setPath('userData', userData)
  app.setPath('sessionData', defaultSession)
  app.setPath('crashDumps', crashes)
  app.setAppLogsPath(layout.logs)
  app.commandLine.appendSwitch('user-data-dir', userData)
  app.commandLine.appendSwitch('disk-cache-dir', path.join(userData, 'disk-cache'))
  app.on('window-all-closed', () => { /* Manual close retains this instance's authenticated Session. */ })
  return bootstrap
}

