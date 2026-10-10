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

import type {
  AppSettings,
  DesktopInstance,
  DiscoveredInstall,
  DshUsageResult,
  InstanceImportResult,
  InstanceRuntimeState,
  LauncherApi,
} from './types'

/** 浏览器里无 Electron 桥时的演示数据，供界面开发与预览。 */

let demoSettings: AppSettings = {
  uiTheme: 'graphite',
  launcherBackground: null,
  trayMinimize: true,
  dangerConfirm: true,
  balanceThreshold: 5,
  customAccent: null,
  autoMinimizeOnStart: true,
  autoCloseOnStart: false,
  headerKicker: '',
  headerTitle: '',
  headerSubtitle: '',
  footerSlogan: '',
  stylePresets: [],
  trayBackground: null,
  trayBackgroundImage: null,
  trayTheme: 'auto',
  trayCustomAccent: null,
  trayStylePresets: [],
  launcherOpacity: 1,
  launcherDim: 0.55,
  trayBackgroundOpacity: 1,
  trayBackgroundDim: 0.55,
  removeDesktopShortcuts: false,
  windowWidth: 1400,
  windowHeight: 900,
  listFadeType: 'gradient',
  listFadeSize: 40,
  cardRadius: 14,
  cardDensity: 'normal',
  settingsBackground: null,
  cardBackground: null,
  cardBackgroundImage: null,
  cardBackgroundOpacity: 1,
  cardTextColor: null,
  settingsBackgroundImage: null,
  settingsBackgroundOpacity: 1,
  showToasts: true,
  autoUpdate: true,
  language: 'zh-CN',
}

const demoInstances: DesktopInstance[] = [
  {
    id: 'demo-stable',
    name: 'DSH 0.1.7-alpha.1',
    version: '0.1.7-alpha.1',
    runtimeRoot: 'D:\\WhaleRealm-Demo\\runtimes\\0.1.7-alpha.1',
    root: 'D:\\WhaleRealm-Demo\\instances\\demo-stable',
    dshHome: 'D:\\WhaleRealm-Demo\\instances\\demo-stable\\dsh-home',
    electronUserData: 'D:\\WhaleRealm-Demo\\instances\\demo-stable\\electron-user-data',
    desktopProfile: 'D:\\WhaleRealm-Demo\\instances\\demo-stable\\dsh-home\\profiles\\desktop',
    workspace: 'D:\\WhaleRealm-Demo\\instances\\demo-stable\\workspace',
    logs: 'D:\\WhaleRealm-Demo\\instances\\demo-stable\\logs',
    skillsSource: 'D:\\WhaleRealm-Demo\\shared\\skills',
    port: 19387,
    lockName: 'dsh-desktop-demo-stable',
    enabled: true,
    autoStart: false,
    instanceKind: 'official-web',
  },
  {
    id: 'demo-beta',
    name: 'DSH 0.1.8-beta',
    version: '0.1.8-beta',
    runtimeRoot: 'D:\\WhaleRealm-Demo\\runtimes\\0.1.8-beta',
    root: 'D:\\WhaleRealm-Demo\\instances\\demo-beta',
    dshHome: 'D:\\WhaleRealm-Demo\\instances\\demo-beta\\dsh-home',
    electronUserData: 'D:\\WhaleRealm-Demo\\instances\\demo-beta\\electron-user-data',
    desktopProfile: 'D:\\WhaleRealm-Demo\\instances\\demo-beta\\dsh-home\\profiles\\desktop',
    workspace: 'D:\\WhaleRealm-Demo\\instances\\demo-beta\\workspace',
    logs: 'D:\\WhaleRealm-Demo\\instances\\demo-beta\\logs',
    skillsSource: 'D:\\WhaleRealm-Demo\\shared\\skills',
    port: 19388,
    lockName: 'dsh-desktop-demo-beta',
    enabled: true,
    autoStart: false,
    instanceKind: 'community-desktop',
  },
]

const demoStates: InstanceRuntimeState[] = [
  { instanceId: 'demo-stable', status: 'ready', pid: 10101, url: 'http://127.0.0.1:19387' },
  { instanceId: 'demo-beta', status: 'stopped', pid: null, url: null },
]

const demoDiscovered: DiscoveredInstall[] = [
  {
    path: 'D:\\WhaleRealm-Demo\\runtimes\\0.1.7-alpha.1',
    executable: 'D:\\WhaleRealm-Demo\\runtimes\\0.1.7-alpha.1\\DeepSeek Harness.exe',
    exeName: 'DeepSeek Harness.exe',
    version: '0.1.7-alpha.1',
    source: 'drive-top',
    running: true,
    pid: 10101,
    isolatable: true,
    reason: '官方 0.1.7-alpha.1 本地构建，认 DSH_DESKTOP_USER_DATA / DSH_DESKTOP_PORT 隔离接口',
    flavor: 'desktop',
    verified: true,
  },
]

function demoUsage(tokensToday: number, cacheHitRate: number | null): DshUsageResult {
  return { status: 'ok', usage: { tokensToday, tokensTotal: Math.round(tokensToday * 7.4), cacheHitRate } }
}

export const demoApi: LauncherApi = {
  getSettings: async () => ({ ...demoSettings }),
  saveSettings: async settings => (demoSettings = { ...settings }),
  chooseLauncherBackground: async () => 'background-1756800000000.png',
  clearLauncherBackground: async () => undefined,
  chooseTrayBackground: async () => 'tray-background-1756800000000.png',
  clearTrayBackground: async () => undefined,
  saveCroppedTrayBackground: async () => 'tray-background-1756800000001.png',
  chooseCardBackground: async () => 'card-background-1756800000002.png',
  clearCardBackground: async () => undefined,
  chooseSettingsBackground: async () => 'settings-background-1756800000003.png',
  clearSettingsBackground: async () => undefined,
  writeClipboard: async () => undefined,
  // 演示替身：如实返回"网络失败"，不伪造发行版（与真实通道的 fail-closed 一致）。
  checkProjectRelease: async () => ({ release: null, reason: 'network', error: 'demo' }),
  downloadProjectRelease: async () => { throw new Error('演示环境不支持下载更新。') },
  installProjectRelease: async () => { throw new Error('演示环境不支持安装更新。') },
  restartApp: async () => undefined,

  listInstances: async () => demoInstances.map(instance => ({ ...instance })),
  discoverInstances: async () => ({ ok: true, installs: demoDiscovered.map(item => ({ ...item })) }),
  importInstance: async (path): Promise<InstanceImportResult> => {
    const found = demoDiscovered.find(item => item.path.toLowerCase() === path.toLowerCase())
    if (!found) return { ok: false, registered: false, error: '该目录下没有 DSH 桌面可执行文件。' }
    if (!found.isolatable) return { ok: true, registered: false, install: found, reason: '该发行体不可隔离托管，仅收录到清单。' }
    return { ok: true, registered: true, install: found }
  },
  selectInstance: async id => {
    const found = demoInstances.find(item => item.id === id)
    if (!found) throw new Error(`实例不存在：${id}`)
    return { ...found }
  },
  startInstance: async id => ({ instanceId: id, status: 'ready', pid: 20000, url: 'http://127.0.0.1:19387' }),
  openInstance: async () => undefined,
  stopInstance: async id => ({ instanceId: id, status: 'stopped', pid: null, url: null }),
  restartInstance: async id => ({ instanceId: id, status: 'ready', pid: 20001, url: 'http://127.0.0.1:19387' }),
  pauseInstance: async id => ({ instanceId: id, status: 'paused', pid: 20000, url: 'http://127.0.0.1:19387' }),
  resumeInstance: async id => ({ instanceId: id, status: 'ready', pid: 20000, url: 'http://127.0.0.1:19387' }),
  setInstancePort: async (id, port) => {
    const found = demoInstances.find(item => item.id === id)
    if (found) found.port = port
    return { ...(found ?? demoInstances[0]) }
  },
  listInstanceStates: async () => demoStates.map(state => ({ ...state })),
  instanceUsage: async dshHome => dshHome.includes('stable') ? demoUsage(92_400, 0.71) : demoUsage(4_800, 0.53),
  deepseekBalance: async () => ({ status: 'ok', balance: { isAvailable: true, infos: [{ currency: 'CNY', totalBalance: 12.34, grantedBalance: 10, toppedUpBalance: 2.34 }] } }),
  listDocs: async () => ({ ok: true, langs: ['zh-CN', 'en'], ids: ['introduction', 'quick-start', 'instance-guide', 'technical-overview', 'troubleshooting'] }),
  readDoc: async id => ({ ok: true, lang: 'zh-CN', content: `# ${id}\n\n浏览器预览用的演示文档内容。` }),
  readLicense: async () => 'GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007\n\n（浏览器预览用的演示许可证文本）',
  readThirdPartyNotices: async () => '# 第三方组件声明\n\n| 组件 | 许可证 |\n|---|---|\n| react / react-dom | **MIT License** |\n| lucide-react | **ISC License** |\n| Electron | **MIT License** |\n\n（浏览器预览用的演示清单）',
  listCatalogVersions: async kind => kind !== 'official-web' ? ({ ok: false, versions: [], error: '部署能力不足：尚无通过隔离认证的桌面免安装包；普通安装器禁止执行。' }) : ({
    ok: true,
    versions: [
      { version: '0.2.0-rc.2', publishedAt: new Date().toISOString(), downloadUrl: 'https://example.com/demo-only.tgz', prerelease: true, latest: true },
      { version: '0.1.7-alpha.2', publishedAt: new Date().toISOString(), downloadUrl: 'https://example.com/demo-only.tgz', prerelease: true, latest: false },
    ],
  }),
  chooseFolder: async () => 'D:\\WhaleRealm-Demo\\instances\\new-demo',
  cancelCreateInstance: async () => ({ ok: true }),
  listCreateTasks: async () => [],
  createInstance: async input => input.kind !== 'official-web' ? ({ ok: false, error: '部署能力不足：尚无通过隔离认证的桌面免安装包；普通安装器禁止执行。' }) : ({ ok: true, instanceId: `demo-created-${input.kind}` }),
  onCreateInstanceProgress: () => () => undefined,
  discoverUnfinishedCreates: async () => [],
  cleanupUnfinishedCreate: async () => ({ ok: false, error: '演示环境没有中断创建任务' }),
  renameInstance: async (id, name) => {
    const found = demoInstances.find(item => item.id === id)
    if (found) found.name = name
    return { ...(found ?? demoInstances[0]) }
  },
  instanceMirrorStatus: async () => ({ ok: true, hasSnapshot: true, snapshotAt: new Date().toISOString(), changed: [], added: [], removed: [] }),
  instanceMirrorUpdate: async () => ({ ok: true, hasSnapshot: true, snapshotAt: new Date().toISOString(), changed: [], added: [], removed: [] }),
  instanceMirrorRestore: async () => ({ ok: true, hasSnapshot: true, snapshotAt: new Date().toISOString(), changed: [], added: [], removed: [] }),
  instanceMirrorHistory: async () => ({ ok: true, history: [] }),
  instanceMirrorRestoreTo: async () => ({ ok: true, hasSnapshot: true, snapshotAt: new Date().toISOString(), changed: [], added: [], removed: [] }),
  deleteInstance: async (id, options) => {
    const index = demoInstances.findIndex(item => item.id === id)
    const root = index >= 0 ? demoInstances[index].root : ''
    if (index >= 0) demoInstances.splice(index, 1)
    return { ok: true, trashed: options.mode === 'purge' ? [root] : [], trashedShortcuts: [] }
  },
  findInstanceShortcuts: async () => ({ ok: true, shortcuts: [] }),
  removeInstanceShortcuts: async () => ({ ok: true, trashed: [] }),

  openExternal: async () => undefined,
  openPath: async () => undefined,
  minimizeWindow: async () => undefined,
  toggleMaximizeWindow: async () => false,
  closeWindow: async () => undefined,
  hideWindow: async () => undefined,
  closeTray: async () => undefined,
  showMainWindow: async () => undefined,
  showSettings: async () => undefined,
  quitApp: async () => undefined,
  onOpenSettings: () => () => undefined,
}
