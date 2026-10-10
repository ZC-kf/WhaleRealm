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

import { app, BrowserWindow, clipboard, dialog, ipcMain, net, shell } from 'electron'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { IPC } from '../src/constants'
import type { AppSettings } from '../src/types'
import type { SettingsStore } from './settings'
import { clearCardBackgrounds, clearLauncherBackgrounds, clearSettingsBackgrounds, clearTrayBackgrounds, importCardBackground, importLauncherBackground, importSettingsBackground, importTrayBackground, saveTrayBackgroundBuffer } from './launcher-asset'
import { readDshUsage } from './dsh-usage'
import type { DeepSeekBalanceService } from './deepseek-balance'
import { checkRelease, downloadRelease, installRelease } from './project-release'

/**
 * 渲染层能触达主进程的全部入口（实例生命周期通道由 registerInstanceIpcHandlers 单独注册）。
 * 每个 handler 都先校验入参再进业务逻辑。
 */

export interface IpcDependencies {
  settings: SettingsStore
  /** userData 根目录：主界面插图存于其下 launcher-assets/。 */
  launcherAssetsUserData: string
  getWindow: () => BrowserWindow | null
  /** Toggle maximize and return the intended next state (true = maximized). */
  toggleMaximize: () => boolean
  deepSeekBalance: DeepSeekBalanceService
  /** 受信发行通道的 staging 目录（主进程所有；userData/release-staging）。 */
  releaseStagingDir: string
  /** 受保护数据路径：更新安装前后摘要必须一致（设置 / 实例注册表 / 实例数据根）。 */
  releaseProtectedPaths: () => string[]
}

export function registerIpcHandlers(deps: IpcDependencies): void {
  const { settings, launcherAssetsUserData } = deps

  ipcMain.handle(IPC.settingsGet, () => settings.read())
  ipcMain.handle(IPC.settingsSave, async (_event, next: AppSettings) => {
    const saved = await settings.save(next)
    // 插图被换掉或恢复默认后，这里统一清理不再被引用的本地文件。
    if (saved.launcherBackground == null) await clearLauncherBackgrounds(launcherAssetsUserData)
    return saved
  })
  ipcMain.handle(IPC.settingsChooseBackground, async () => {
    const window = deps.getWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      title: '选择主界面插图',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return importLauncherBackground(launcherAssetsUserData, result.filePaths[0])
  })
  ipcMain.handle(IPC.settingsClearBackground, async () => {
    await clearLauncherBackgrounds(launcherAssetsUserData)
  })
  ipcMain.handle(IPC.settingsChooseTrayBackground, async () => {
    const window = deps.getWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      title: '选择托盘背景图',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return importTrayBackground(launcherAssetsUserData, result.filePaths[0])
  })
  ipcMain.handle(IPC.settingsClearTrayBackground, async () => {
    await clearTrayBackgrounds(launcherAssetsUserData)
  })
  ipcMain.handle(IPC.settingsSaveCroppedTrayBackground, async (_event, dataUrl: string) => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) throw new Error('裁剪数据无效。')
    const buffer = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64')
    return saveTrayBackgroundBuffer(launcherAssetsUserData, buffer)
  })
  ipcMain.handle(IPC.settingsChooseCardBackground, async () => {
    const window = deps.getWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      title: '选择实例卡片背景图',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return importCardBackground(launcherAssetsUserData, result.filePaths[0])
  })
  ipcMain.handle(IPC.settingsClearCardBackground, async () => {
    await clearCardBackgrounds(launcherAssetsUserData)
  })
  ipcMain.handle(IPC.settingsChooseSettingsBackground, async () => {
    const window = deps.getWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      title: '选择设置界面背景图',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return importSettingsBackground(launcherAssetsUserData, result.filePaths[0])
  })
  ipcMain.handle(IPC.settingsClearSettingsBackground, async () => {
    await clearSettingsBackgrounds(launcherAssetsUserData)
  })
  ipcMain.handle(IPC.dialogChooseFolder, async () => {
    const window = deps.getWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      title: '选择实例目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.instancesUsage, async (_event, dshHome: string) => {
    if (typeof dshHome !== 'string' || !dshHome.trim()) throw new Error('实例 DSH_HOME 无效。')
    return readDshUsage(dshHome.trim())
  })
  ipcMain.handle(IPC.deepseekBalance, (_event, force?: boolean) => deps.deepSeekBalance.get(force === true))

  ipcMain.handle(IPC.windowMinimize, () => deps.getWindow()?.minimize())
  ipcMain.handle(IPC.windowToggleMaximize, () => deps.toggleMaximize())
  ipcMain.handle(IPC.windowClose, () => deps.getWindow()?.close())
  ipcMain.handle(IPC.openExternal, (_event, url: string) => {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('只允许打开网页链接。')
    return shell.openExternal(parsed.toString())
  })
  ipcMain.handle(IPC.openPath, async (_event, target: string) => {
    if (!path.isAbsolute(target)) throw new Error('路径无效。')
    await shell.openPath(target)
  })
  ipcMain.handle(IPC.clipboardWriteText, (_event, text: string) => {
    if (typeof text !== 'string') throw new Error('剪贴板内容无效。')
    clipboard.writeText(text)
  })
  // ===== 受信发行通道（project-release.ts，主进程统一实现）=====
  // 渲染层不再能传任意下载地址或安装路径：check/download/install 都只在主进程
  // 侧按固定仓库身份 + 摘要凭据执行，任意路径在 installRelease 内部直接拒绝。
  const jsonFetch = async (url: string, init?: { headers?: Record<string, string> }) => {
    const response = await net.fetch(url, init)
    return { ok: response.ok, status: response.status, json: () => response.json() as Promise<unknown> }
  }
  const binaryFetch = async (url: string, init?: { headers?: Record<string, string> }) => {
    const response = await net.fetch(url, init)
    return { ok: response.ok, status: response.status, arrayBuffer: () => response.arrayBuffer() }
  }
  ipcMain.handle(IPC.releaseCheck, async () => checkRelease(jsonFetch))
  ipcMain.handle(IPC.releaseDownload, async (_event, releaseId: unknown) => {
    if (typeof releaseId !== 'number' || !Number.isInteger(releaseId)) throw new Error('发行版 ID 无效。')
    return downloadRelease(releaseId, { fetchJson: jsonFetch, fetchBinary: binaryFetch, stagingDir: deps.releaseStagingDir })
  })
  ipcMain.handle(IPC.releaseInstall, async (_event, artifactId: unknown) => {
    if (typeof artifactId !== 'string' || !artifactId) throw new Error('产物句柄无效。')
    await installRelease(artifactId, {
      stagingDir: deps.releaseStagingDir,
      runInstaller: (file, args) => new Promise(resolve => {
        // NSIS 静默安装（/S）；等待退出码后再做受保护数据摘要对比。
        const child = spawn(file, args, { detached: true, stdio: 'ignore' })
        child.on('exit', code => resolve({ code: code ?? -1 }))
        child.on('error', () => resolve({ code: -1 }))
      }),
      protectedPaths: deps.releaseProtectedPaths(),
    })
  })
  ipcMain.handle(IPC.updateRestart, () => {
    spawn(process.execPath, [], { detached: true, stdio: 'ignore' }).unref()
    app.quit()
  })
}
