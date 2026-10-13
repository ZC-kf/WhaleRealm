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

import { app, dialog, BrowserWindow, ipcMain, net, protocol, screen, shell } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { addSkipEntry, readActiveSkipPaths } from './install-skip'
import { findDesktopShortcuts } from './desktop-shortcut'
import { createMainWindow, normalWindowSize } from './app-window'
import { createInstanceRegistry } from './instance-registry'
import { releaseProtectedPaths } from './project-release'
import { createRuntimeSupervisor } from './runtime-supervisor'
import { registerInstanceIpcHandlers } from './instance-ipc'
import { diffMirror, snapshotMirror } from './instance-mirror'
import { createDesktopAdapter } from './adapters/desktop'
import { createOfficialWebAdapter } from './adapters/official-web'
import { isShutdownRequest } from './shutdown-control'
import { createSettingsStore, defaultSettings } from './settings'
import { createTray, type TrayController } from './tray'
import { registerIpcHandlers } from './ipc'
import { readCardBackground, readLauncherBackground, readSettingsBackground, readTrayBackground } from './launcher-asset'

import { shutdownOwnedProcesses } from './process-supervisor'
import { createDeepSeekBalanceService } from './deepseek-balance'
import { readDeepSeekApiKey } from './credentials'
import { listDocs, readDocFile } from './docs'
import { readLicenseText, readThirdPartyNotices } from './licenses'
import { listCatalogVersions } from './instance-catalog'
import { registerCreateInstanceHandler, shutdownCreateTasks } from './create-runtime'
import { resolveHubRoot as resolveHubRootWithSource, persistHubRoot } from './hub-root'
import type { CatalogResult, InstanceKind } from '../src/types'
import { IPC, IPC_EVENTS } from '../src/constants'

/**
 * 应用入口与装配根。
 * 单界面实例管理：装配实例注册表、运行时监督器、设置与窗口，仅此而已。
 */

// 自定义插图协议必须在 app ready 之前声明为安全 scheme，渲染层的 CSS 才能引用。
protocol.registerSchemesAsPrivileged([
  { scheme: 'launcher-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])

/** 内置资源（打包进 app，走协议绝对 URL，避免 CSS 变量相对路径被解析到 dist/assets 下）。 */
const BUILTIN_LAUNCHER_ASSETS: Record<string, string> = {
  'launcher-background.png': 'image/png',
  'tray-background-default.png': 'image/png',
  'qq-group-qr.jpg': 'image/jpeg',
  'telegram-qr.jpg': 'image/jpeg',
}

/** launcher-asset://<文件名> —— 只读暴露 userData/launcher-assets 下的自定义插图，以及内置资源。 */
function registerLauncherAssetProtocol(userData: string): void {
  const resourceDir = path.join(path.dirname(fileURLToPath(import.meta.url)), app.isPackaged ? '../dist' : '../public')
  protocol.handle('launcher-asset', async request => {
    const name = decodeURIComponent(new URL(request.url).hostname)
    const builtinType = BUILTIN_LAUNCHER_ASSETS[name]
    if (builtinType) {
      try {
        const body = readFileSync(path.join(resourceDir, name))
        return new Response(new Uint8Array(body), { headers: { 'content-type': builtinType, 'cache-control': 'no-store' } })
      } catch {
        return new Response('Not Found', { status: 404 })
      }
    }
    const asset = (await readLauncherBackground(userData, name)) ?? (await readTrayBackground(userData, name)) ?? (await readCardBackground(userData, name)) ?? (await readSettingsBackground(userData, name))
    if (!asset) return new Response('Not Found', { status: 404 })
    return new Response(new Uint8Array(asset.body), {
      headers: { 'content-type': asset.contentType, 'cache-control': 'no-store' },
    })
  })
}

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
// 窗口图标与托盘图标共用同一资源；dev 取 public/，打包取 dist/。
const launcherIconPath = path.join(moduleDirectory, app.isPackaged ? '../dist/launcher-icon.png' : '../public/launcher-icon.png')

/**
 * 数据根（hubRoot）解析 —— 规则与实现见 electron/hub-root.ts（独立模块可测）。
 * 桌面快捷方式 / 开始菜单启动已安装版时没有 DSH_HUB_ROOT 环境变量，因此把解析
 * 结果持久化到 userData/hub-root.txt。已持久化的 root 永远保留不迁移；
 * 打包态新机默认 LOCALAPPDATA/WhaleRealm（系统盘用户目录，无 D 盘也可用）。
 */
function resolveHubRoot(userData: string): string {
  return resolveHubRootWithSource(userData, { packaged: app.isPackaged }).hubRoot
}

let mainWindow: BrowserWindow | null = null
let mainWindowFullscreen = false

let quitCleanupStarted = false
let allowFinalQuit = false
// 关闭按钮只隐藏到托盘；before-quit 置位后放行真正的关闭。
let isQuitting = false
let tray: TrayController | null = null
let trayPopup: BrowserWindow | null = null
let backgroundNoticeShown = false

const getWindow = (): BrowserWindow | null => mainWindow

interface Services {
  settings: ReturnType<typeof createSettingsStore>
  instances: ReturnType<typeof createInstanceRegistry>
  runtimeSupervisor: ReturnType<typeof createRuntimeSupervisor>
  deepSeekBalance: ReturnType<typeof createDeepSeekBalanceService>
}

let services: Services | null = null

function createServices(): Services {
  const userData = app.getPath('userData')
  const hubRoot = resolveHubRoot(userData)
  const instances = createInstanceRegistry(hubRoot)
  const runtimeSupervisor = createRuntimeSupervisor({
    onExit: id => { void instances.markStopped(id).catch(error => console.error(error)) },
    spawn: async (context, signal) => {
      const record = await instances.get(context.id)
      if (record.instanceKind === 'official-web') {
        const adapter = createOfficialWebAdapter({download: async () => { throw new Error('Launch cannot deploy runtime assets') }})
        return adapter.launch(record, signal)
      }
      const kind = record.instanceKind === 'community-desktop' ? 'community-desktop' : 'official-desktop'
      return createDesktopAdapter(kind, { download: async () => { throw new Error('Launch cannot deploy runtime assets') } }).launch(record, signal)
    },
  })

  const settings = createSettingsStore({
    filePath: path.join(userData, 'settings.json'),
    createDefaults: () => defaultSettings(),
  })

  const deepSeekBalance = createDeepSeekBalanceService({
    fetchImpl: (input, init) => net.fetch(input as string, init),
    readApiKey: () => readDeepSeekApiKey(path.join(os.homedir(), '.dsh')),
  })

  return { settings, instances, runtimeSupervisor, deepSeekBalance }
}

function openMainWindow(): void {
  const stored = services?.settings.readSync()
  const window = createMainWindow({
    preloadPath: path.join(moduleDirectory, 'preload.mjs'),
    iconPath: launcherIconPath,
    devServerUrl: process.env.VITE_DEV_SERVER_URL,
    indexPath: path.join(moduleDirectory, '../dist/index.html'),
    initialSize: stored ? { width: stored.windowWidth, height: stored.windowHeight } : undefined,
    onClosed: () => {
      mainWindow = null
    },
  })
  // 点 X 或 Alt+F4 只隐藏到托盘继续后台运行；托盘菜单「退出」经 app.quit()
  // 触发 before-quit 置位 isQuitting 后，这里才放行关闭。设置 trayMinimize=false 时直接退出。
  window.on('close', event => {
    if (isQuitting) return
    const minimizeToTray = services?.settings.readSync().trayMinimize !== false
    if (!minimizeToTray) return
    event.preventDefault()
    window.hide()
    if (!backgroundNoticeShown) {
      backgroundNoticeShown = true
      tray?.notifyBackground()
    }
  })
  // 全屏状态由事件回写，避免 isFullScreen() 在过渡期的竞态；Esc 退出全屏也能同步。
  // 全屏时禁止边框缩放；退出全屏恢复。
  window.on('enter-full-screen', () => { mainWindowFullscreen = true; window.setResizable(false) })
  window.on('leave-full-screen', () => { mainWindowFullscreen = false; window.setResizable(true) })
  // A2：基础尺寸拖到屏幕顶端 → 自动全屏（类似系统 snap）。
  window.on('moved', () => {
    if (mainWindowFullscreen || window.isDestroyed()) return
    const bounds = window.getBounds()
    const { workArea } = screen.getDisplayMatching(bounds)
    if (bounds.y <= workArea.y + 4) {
      mainWindowFullscreen = true
      window.setFullScreen(true)
      window.setResizable(false)
    }
  })
  // A1：全屏时拖动顶部 → 退出全屏回到基础尺寸，随后跟随拖动。
  window.on('will-move', () => {
    if (!mainWindowFullscreen || window.isDestroyed()) return
    window.setFullScreen(false)
  })
  mainWindow = window
}

/**
 * 在「基础尺寸 ↔ 全屏」之间切换（右上角按钮）。
 * 返回切换后的状态：true = 全屏，false = 基础尺寸。
 */
function toggleMaximize(): boolean {
  const window = getWindow()
  if (!window || window.isDestroyed()) return false
  mainWindowFullscreen = !mainWindowFullscreen
  window.setFullScreen(mainWindowFullscreen)
  if (mainWindowFullscreen) {
    // 全屏后把窗口边界钳制到显示器 bounds，避免 DPI 缩放导致窗口比屏幕多出几像素、底部溢出。
    const { bounds } = screen.getPrimaryDisplay()
    window.setBounds(bounds)
  }
  window.setResizable(!mainWindowFullscreen)
  return mainWindowFullscreen
}

/** 从托盘或第二实例唤起主窗口；窗口不存在时重建。 */
function showMainWindow(): void {
  const window = getWindow()
  if (!window || window.isDestroyed()) {
    openMainWindow()
    return
  }
  if (window.isMinimized()) window.restore()
  // 无边框透明窗口从后台唤起时常抢不到焦点，短暂置顶可确保激活。
  window.setAlwaysOnTop(true, 'screen-saver')
  window.show()
  window.focus()
  window.setAlwaysOnTop(false, 'screen-saver')
}

/** 托盘弹出面板：一个无边框小窗，显示运行中/未启动实例与快捷操作。 */
function toggleTrayPopup(): void {
  if (trayPopup && !trayPopup.isDestroyed()) {
    trayPopup.close()
    trayPopup = null
    return
  }
  const { workArea } = screen.getPrimaryDisplay()
  const width = 400
  const height = 560
  trayPopup = new BrowserWindow({
    width,
    height: Math.min(height, workArea.height - 12),
    x: workArea.x + workArea.width - width - 8,
    y: workArea.y + workArea.height - Math.min(height, workArea.height - 12) - 8,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    transparent: true,
    roundedCorners: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(moduleDirectory, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  trayPopup.setMenuBarVisibility(false)
  trayPopup.on('blur', () => {
    if (trayPopup && !trayPopup.isDestroyed()) trayPopup.close()
    trayPopup = null
  })
  trayPopup.on('closed', () => { trayPopup = null })
  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    void trayPopup.loadURL(`${devServerUrl}#tray`)
  } else {
    void trayPopup.loadFile(path.join(moduleDirectory, '../dist/index.html'), { hash: 'tray' })
  }
  trayPopup.once('ready-to-show', () => trayPopup?.show())
}

// 第二个实例直接退出，由已运行实例通过 second-instance 唤起前台窗口。
const shutdownRequested = isShutdownRequest(process.argv)
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (isShutdownRequest(commandLine)) {
      app.quit()
      return
    }
    showMainWindow()
  })
}

app.whenReady().then(async () => {
  if (shutdownRequested) {
    app.quit()
    return
  }
  services = createServices()
  registerLauncherAssetProtocol(app.getPath('userData'))
  // 补齐缺失的镜像：尚无快照的实例建立初始镜像（后台，不阻塞启动）。
  void (async () => {
    const records = await services.instances.list().catch(() => [])
    for (const record of records) {
      const status = await diffMirror(record.root, [record.dshHome, record.workspace]).catch(() => null)
      if (status && status.snapshotAt === null) {
        await snapshotMirror(record.root, [record.dshHome, record.workspace]).catch(() => undefined)
      }
    }
  })()
  const hubRoot = resolveHubRoot(app.getPath('userData'))
  persistHubRoot(app.getPath('userData'), hubRoot)
  const skipFile = path.join(hubRoot, 'hub-data', 'skipped-installs.json')
  const scanOptions = {
    catalogPath: path.join(hubRoot, 'manifests', 'runtime-catalog.json'),
    hubRuntimesRoot: path.join(hubRoot, 'runtimes'),
  }
  registerInstanceIpcHandlers(ipcMain, services.instances, services.runtimeSupervisor, undefined, scanOptions, {
    trash: targetPath => shell.trashItem(targetPath),
    openExternal: url => shell.openExternal(url),
    readSkipPaths: () => readActiveSkipPaths(skipFile),
    addSkip: (targetPath, permanent, until) => addSkipEntry(skipFile, { path: targetPath, permanent, until }),
    findShortcuts: runtimeRoot => findDesktopShortcuts(runtimeRoot),
  })
  registerCreateInstanceHandler(ipcMain, services.instances, scanOptions, progress => {
    // 创建进度推给渲染层（弹窗实时阶段显示）；窗口未就绪时静默丢弃。
    mainWindow?.webContents.send(IPC_EVENTS.createInstanceProgress, progress)
  })
  registerIpcHandlers({
    settings: services.settings,
    launcherAssetsUserData: app.getPath('userData'),
    getWindow,
    toggleMaximize,
    deepSeekBalance: services.deepSeekBalance,
    // 受信发行通道：staging 在 userData 下；受保护数据 = 设置 + 实例注册表 +
    // 实例数据根（更新安装前后摘要必须一致，见 project-release.installRelease）。
    releaseStagingDir: path.join(app.getPath('userData'), 'release-staging'),
    releaseProtectedPaths: async () => releaseProtectedPaths(
      hubRoot, path.join(app.getPath('userData'), 'settings.json'), await services!.instances.list(),
    ),
  })
  // 内置项目文档：只读暴露打包目录 docs/<语言>/ 下的手册（回退链 lang → en → zh-CN）。
  ipcMain.handle(IPC.docsList, () => listDocs(path.join(app.getAppPath(), 'docs')))
  ipcMain.handle(IPC.docsRead, (_event, id: unknown, lang: unknown) =>
    readDocFile(path.join(app.getAppPath(), 'docs'), typeof id === 'string' ? id : '', typeof lang === 'string' ? lang : ''))
  // 开源协议：只读读取打包目录 licenses/GPL-3.0.txt（路径固定，供关于页展示）。
  ipcMain.handle(IPC.licenseRead, () => readLicenseText(path.join(app.getAppPath(), 'licenses')))
  ipcMain.handle(IPC.licenseReadThirdParty, () => readThirdPartyNotices(path.join(app.getAppPath(), 'licenses')))
  // 新建实例版本目录：GitHub Releases 实时拉取，内存缓存 5 分钟（fail-closed）。
  const catalogCache = new Map<string, { at: number; result: CatalogResult }>()
  ipcMain.handle(IPC.catalogList, async (_event, kind: unknown) => {
    if (typeof kind !== 'string' || !['official-web', 'official-desktop', 'community-desktop'].includes(kind)) throw new Error('实例类型无效。')
    const cached = catalogCache.get(kind)
    if (cached && Date.now() - cached.at < 5 * 60_000) return cached.result
    const fetchImpl = async (url: string) => {
      const res = await net.fetch(url)
      return { ok: res.ok, status: res.status, json: () => res.json() }
    }
    const result = await listCatalogVersions(kind as InstanceKind, fetchImpl)
    catalogCache.set(kind, { at: Date.now(), result })
    return result
  })
  openMainWindow()
  // 托盘弹出面板相关的 IPC：显示主窗口 / 打开设置 / 退出。
  ipcMain.handle('window:show', () => { showMainWindow(); trayPopup?.close() })
  ipcMain.handle('window:show-settings', () => {
    showMainWindow()
    const w = getWindow()
    if (w && !w.isDestroyed()) w.webContents.send('dsh:open-settings')
    trayPopup?.close()
  })
  ipcMain.handle('app:quit', () => { app.quit() })
  // 启动实例后自动「关闭」：主窗口隐藏到托盘（不退出），托盘弹出面板关闭。
  ipcMain.handle('window:hide', () => {
    const w = getWindow()
    if (w && !w.isDestroyed()) {
      w.hide()
      if (!backgroundNoticeShown) { backgroundNoticeShown = true; tray?.notifyBackground() }
    }
  })
  ipcMain.handle('window:close-tray', () => { trayPopup?.close(); trayPopup = null })
  tray = createTray({ iconPath: launcherIconPath, onToggle: toggleTrayPopup })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

async function shutdownLauncherProcesses(): Promise<void> {
  const results = await Promise.allSettled([shutdownCreateTasks(), services?.runtimeSupervisor.stopAll()])
  try { await shutdownOwnedProcesses() } catch (error) { results.push({ status: 'rejected', reason: error }) }
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Launcher shutdown failed')
}
// 无论是正常关闭还是异常退出，所有由启动器登记的进程树都必须一起结束。
app.on('before-quit', event => {
  if (allowFinalQuit) return
  event.preventDefault()
  if (quitCleanupStarted) return
  quitCleanupStarted = true
  // 放行窗口 close：清理完成后窗口随退出流程正常关闭。
  isQuitting = true
  void shutdownLauncherProcesses().then(() => {
    allowFinalQuit = true
    app.quit()
  }).catch(error => {
    console.error(error)
    quitCleanupStarted = false; isQuitting = false
    dialog.showErrorBox('Shutdown failed', String(error))
  })
})

// will-quit 在 before-quit 清理完成后触发，此时移除托盘图标。
app.on('will-quit', () => {
  tray?.destroy()
  tray = null
})
