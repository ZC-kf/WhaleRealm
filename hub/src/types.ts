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

// 鲸域 · WhaleRealm —— 单界面实例管理软件的共享类型契约。
// 与 constants.ts 一样，本文件是主进程与渲染进程的公共契约，两侧共用一份定义。

import type { LanguageCode } from './i18n/locales'

/** 界面主题。 */
export type UiTheme = 'forest' | 'ocean' | 'berry' | 'graphite'

/** 启动器设置。只保留单界面实例管理真正需要的字段。 */
export interface AppSettings {
  /** 启动器界面配色。 */
  uiTheme: UiTheme
  /** 自定义主界面插图文件名（存于 userData/launcher-assets）；null 表示使用内置默认图。 */
  launcherBackground: string | null
  /** 托盘行为：关闭窗口时隐藏到系统托盘（true，默认）或直接退出。 */
  trayMinimize: boolean
  /** 危险操作二次确认：删除实例等破坏性操作前弹二次确认（true，默认）。 */
  dangerConfirm: boolean
  /** API 余额告警阈值（元）；余额低于该值时为红色字体（默认 0 = 不告警）。 */
  balanceThreshold: number
  /** 自定义强调色（十六进制，如 #4fbf8a）；null 表示使用主题预设。 */
  customAccent: string | null
  /** 启动实例后自动最小化启动器窗口（true，默认）。 */
  autoMinimizeOnStart: boolean
  /** 启动实例后自动关闭主界面（隐藏到托盘）与托盘弹出面板（true 时优先于自动最小化）。 */
  autoCloseOnStart: boolean
  /** 主界面左上角三行文字的自定义（留空使用默认）。 */
  headerKicker: string
  headerTitle: string
  headerSubtitle: string
  /** 主界面底部标语（留空使用默认「一鲸一域，一域一星海」）。 */
  footerSlogan: string
  /** 保存的样式预设（主题 + 强调色 + 主界面插图），可一键切换。 */
  stylePresets: StylePreset[]
  /** 托盘背景色（十六进制）；null 表示跟随主界面主题。 */
  trayBackground: string | null
  /** 托盘背景图文件名（存于 userData/launcher-assets）；null 表示无自定义背景图。 */
  trayBackgroundImage: string | null
  /** 托盘主题：'auto' 跟随主界面（默认），或独立指定一个主题。 */
  trayTheme: 'auto' | UiTheme
  /** 托盘自定义强调色；null 表示跟随托盘主题预设。 */
  trayCustomAccent: string | null
  /** 托盘样式预设（可保存多套，一键切换）。 */
  trayStylePresets: StylePreset[]
  /** 主界面背景不透明度 0..1（默认 1 = 完全不透明，越小越透出桌面）。 */
  launcherOpacity: number
  /** 主界面背景暗度（遮罩强度 0..1，默认 0.55，越大越暗）。 */
  launcherDim: number
  /** 托盘背景图不透明度 0..1（默认 1）。 */
  trayBackgroundOpacity: number
  /** 托盘背景图暗度（遮罩强度 0..1，默认 0.55，越大越暗）。 */
  trayBackgroundDim: number
  /** 删除实例/收录时，检测到桌面快捷方式则提示一并删除（默认关）。 */
  removeDesktopShortcuts: boolean
  /** 初始窗口尺寸（宽，像素；默认 1400）。 */
  windowWidth: number
  /** 初始窗口尺寸（高，像素；默认 900）。 */
  windowHeight: number
  /** 实例列表上下边缘的渐变类型。 */
  listFadeType: 'gradient' | 'blur' | 'none'
  /** 实例列表上下边缘渐变的范围高度（像素）。 */
  listFadeSize: number
  /** 实例卡片圆角（像素，默认 14，0..24）。 */
  cardRadius: number
  /** 实例卡片间距（compact=紧凑 / normal=标准 / cozy=宽松）。 */
  cardDensity: 'compact' | 'normal' | 'cozy'
  /** 设置界面背景色（十六进制）；null 表示跟随主题默认。 */
  settingsBackground: string | null
  /** 实例卡片背景色（十六进制）；null 跟随主题默认。 */
  cardBackground: string | null
  /** 实例卡片背景图文件名（存于 userData/launcher-assets）；null 表示无。 */
  cardBackgroundImage: string | null
  /** 实例卡片背景不透明度 0..1（默认 1）。 */
  cardBackgroundOpacity: number
  /** 实例卡片字体颜色（十六进制）；null 跟随主题默认。 */
  cardTextColor: string | null
  /** 设置界面背景图文件名（存于 userData/launcher-assets）；null 表示无。 */
  settingsBackgroundImage: string | null
  /** 设置界面背景图不透明度 0..1（默认 1）。 */
  settingsBackgroundOpacity: number
  /** 是否显示右下角操作提示弹窗（true，默认）。 */
  showToasts: boolean
  /** 自动更新：true 时启动检查到新版本自动下载并安装（默认）；false 时改为手动点击更新。 */
  autoUpdate: boolean
  /** 界面显示语言（语言包随软件离线打包）。 */
  language: LanguageCode
}

/** 一套可保存/切换的样式预设。 */
export interface StylePreset {
  id: string
  name: string
  uiTheme: UiTheme
  customAccent: string | null
  launcherBackground: string | null
}

/** 本机 DSH 桌面发行体的发现来源。 */
export type DiscoverSource = 'drive-top' | 'programs' | 'localappdata' | 'registry' | 'running-process' | 'manual'

/** 发行体类别：桌面版（Electron 桌面 shell）、原生态 web 版、未知。 */
export type DshFlavor = 'desktop' | 'web' | 'unknown'

/** 扫描/导入发现的一套 DSH 桌面发行体。 */
export interface DiscoveredInstall {
  path: string
  executable: string
  exeName: string
  version: string | null
  source: DiscoverSource
  running: boolean
  pid: number | null
  /** 是否可被 Hub 隔离托管（认 DSH_DESKTOP_USER_DATA / DSH_DESKTOP_PORT / DSH_HOME）。 */
  isolatable: boolean
  /** 判定依据（可托管原因，或不可托管的 fail-closed 说明）。 */
  reason: string
  /** 发行体类别：desktop = Electron 桌面；web = 原生态 web 版（打标记，仍可隔离启动）。 */
  flavor: DshFlavor
  /** 是否通过「真实实例 + 可运行」校验（存在 resources 打包结构）。 */
  verified: boolean
}

export interface InstanceDiscoveryResult {
  ok: boolean
  installs: DiscoveredInstall[]
  error?: string
}

export interface InstanceImportResult {
  ok: boolean
  registered: boolean
  install?: DiscoveredInstall
  record?: DesktopInstance
  existing?: DesktopInstance
  reason?: string
  error?: string
}

/** 实例类别：官方网页版 / 官方桌面版 / 社区桌面版。 */
export type InstanceKind = 'official-web' | 'official-desktop' | 'community-desktop'

/** 新建实例的候选版本（实时拉取并校验）。 */
export interface CatalogVersion {
  version: string
  publishedAt: string
  /** 目录显示用地址；创建时主进程重新解析可信资产。 */
  downloadUrl: string | null
  prerelease: boolean
  latest: boolean
}

export interface CatalogResult {
  ok: boolean
  versions: CatalogVersion[]
  error?: string
  /** 数据源说明（如社区仓库、官网）。 */
  source?: string
}

/** 新建实例请求（弹窗输入 + 已选版本）。 */
export interface CreateInstanceRequest {
  taskId?: string
  name: string
  /** 目标目录（必须为空或不存在）。 */
  path: string
  kind: InstanceKind
  version: string
  /** 兼容旧调用方；主进程忽略此字段。 */
  downloadUrl?: string | null
}

export interface CreateInstanceResult {
  ok: boolean
  instanceId?: string
  error?: string
  /** Ownership is unresolved; files, journals and the pending lease remain held. */
  cleanupPending?: boolean
}

export interface UnfinishedCreateTask {
  lockPath: string
  taskId: string
  target: string
  pid: number
  active: boolean
  phase: string
}

/** 创建流水线阶段与进度（主进程推送，渲染层按 detailKey 翻译显示）。 */
export type CreateStage = 'verify' | 'deploy' | 'selfcheck' | 'register'

export interface CreateInstanceProgress {
  taskId?: string
  stage: CreateStage
  percent: number
  /** 日志用描述（中文，仅作诊断）。 */
  detail: string
  /** 渲染层翻译键：create.stage.* */
  detailKey: string
}

/** 一个由 Hub 集中管理的 DSH 桌面实例（每套实例有独立状态根、端口与锁）。 */
export interface DesktopInstance {
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
  /** 实例类别（收录/新建时按特征检测；老实例由主进程补种）。 */
  instanceKind?: InstanceKind
}

/** 实例镜像（快照）状态。 */
export interface InstanceMirrorStatus {
  ok: boolean
  hasSnapshot: boolean
  snapshotAt: string | null
  changed: string[]
  added: string[]
  removed: string[]
  requiresRebaseline?: boolean
  error?: string
}

/** 内置项目文档清单：可用语言与文档 id（并集）。 */
export interface DocListResult {
  ok: boolean
  langs: LanguageCode[]
  ids: string[]
}

/** 单篇内置文档的读取结果；lang 为实际命中的语言（回退后）。 */
export interface DocReadResult {
  ok: boolean
  lang: LanguageCode | null
  content: string | null
}

export type InstanceStatus = 'stopped' | 'starting' | 'ready' | 'stopping' | 'crashed' | 'paused'

/** 实例运行时的实时状态。 */
export interface InstanceRuntimeState {
  cleanupPending?: boolean
  instanceId: string
  status: InstanceStatus
  pid: number | null
  url: string | null
}

/** 删除实例的两种模式：仅移除注册 / 完全删除（移入回收站）。 */
export type DeleteInstanceMode = 'unregister' | 'purge'
/** 移除注册后对该运行体目录的扫描跳过策略。 */
export type SkipScanMode = 'none' | 'temporary' | 'permanent'
export interface DeleteInstanceOptions {
  mode: DeleteInstanceMode
  /** 仅移除注册时生效：是否跳过后续扫描（仍可手动导入）。 */
  skipScan?: SkipScanMode
  /** skipScan='temporary' 时的跳过天数。 */
  skipScanDays?: number
  /** 是否一并删除指向该实例的桌面快捷方式（移入回收站）。 */
  removeShortcuts?: boolean
}
export interface DeleteInstanceResult {
  ok: boolean
  /** 完全删除时，被移入回收站的目录。 */
  trashed?: string[]
  /** 被移入回收站的桌面快捷方式路径。 */
  trashedShortcuts?: string[]
  error?: string
}

/** 桌面快捷方式检测结果。 */
export interface InstanceShortcutsResult {
  ok: boolean
  shortcuts: string[]
}

/** DSH 本地会话日志聚合出的用量（今日 Token、历史总和与缓存命中率）。 */
export interface DshUsage {
  tokensToday: number
  /** 历史会话用量总和。 */
  tokensTotal: number
  /** 0..1；本地暂无输入侧数据时为 null。 */
  cacheHitRate: number | null
}

export type DshUsageResult =
  | { status: 'ok'; usage: DshUsage }
  | { status: 'no-data' }
  | { status: 'error'; message: string }

/** DeepSeek 官方账户余额。 */
export interface DeepSeekBalanceInfo {
  currency: string
  totalBalance: number | null
  grantedBalance: number | null
  toppedUpBalance: number | null
}

export interface DeepSeekBalance {
  isAvailable: boolean
  infos: DeepSeekBalanceInfo[]
}

export type DeepSeekBalanceResult =
  | { status: 'no-key' }
  | { status: 'ok'; balance: DeepSeekBalance }
  | { status: 'error'; message: string }

/** 项目发行版里一个可下载资产（来自 GitHub Releases，须带摘要凭据才可下载）。 */
export interface ReleaseAssetInfo {
  id: number
  name: string
  /** 浏览器下载地址（仅展示/跳转用；受信下载走主进程二进制通道）。 */
  url: string
  /** GitHub 资产摘要（形如 sha256:<hex>）；缺失视为不可信，拒绝下载。 */
  digest: string | null
  size: number
}

/** 主进程 checkRelease 返回的项目发行版信息。 */
export interface ProjectReleaseInfo {
  /** GitHub Release 数字 ID（后续 downloadRelease 的入参）。 */
  releaseId: number
  /** 去掉前导 v 的语义版本号。 */
  version: string
  /** ISO 时间戳。 */
  publishedAt: string
  notes: string
  /** Release 页面链接。 */
  pageUrl: string
  assets: ReleaseAssetInfo[]
}

/**
 * checkRelease 的完整结果：release 为 null 时 reason 说明原因，
 * 渲染层据此准确显示，不猜测任何地址。
 */
export type ProjectReleaseCheckResult =
  | { release: ProjectReleaseInfo; reason: null; error: null }
  | { release: null; reason: 'no-repository' | 'no-release' | 'network' | 'bad-response'; error: string | null }

/** 主进程受信下载产物句柄：渲染层只拿到这个不透明 ID，不能传任意路径。 */
export interface ReleaseArtifactHandle {
  artifactId: string
}

/** 渲染层能触达主进程的全部入口。 */
export interface LauncherApi {
  getSettings(): Promise<AppSettings>
  saveSettings(settings: AppSettings): Promise<AppSettings>
  chooseLauncherBackground(): Promise<string | null>
  clearLauncherBackground(): Promise<void>
  /** 选择并导入托盘背景图，返回托管文件名（取消返回 null）。 */
  chooseTrayBackground(): Promise<string | null>
  /** 清除托盘背景图（恢复默认）。 */
  clearTrayBackground(): Promise<void>
  /** 保存裁剪后的托盘背景图（PNG dataURL），返回新文件名。 */
  saveCroppedTrayBackground(dataUrl: string): Promise<string | null>
  /** 选择并导入实例卡片背景图，返回托管文件名（取消返回 null）。 */
  chooseCardBackground(): Promise<string | null>
  /** 清除实例卡片背景图（恢复默认）。 */
  clearCardBackground(): Promise<void>
  /** 选择并导入设置界面背景图，返回托管文件名（取消返回 null）。 */
  chooseSettingsBackground(): Promise<string | null>
  /** 清除设置界面背景图（恢复默认）。 */
  clearSettingsBackground(): Promise<void>
  /** 把文本写入系统剪贴板。 */
  writeClipboard(text: string): Promise<void>
  /** 检查项目发行版：无仓库/无发行版/网络失败均如实返回，不猜测地址。 */
  checkProjectRelease(): Promise<ProjectReleaseCheckResult>
  /** 受信下载：主进程只下载并校验带摘要凭据的绑定产物，返回不透明 artifactId。 */
  downloadProjectRelease(releaseId: number): Promise<ReleaseArtifactHandle>
  /** 受信安装：只执行 staging 内已通过摘要校验的绑定产物；不接受任意路径。 */
  installProjectRelease(artifactId: string): Promise<void>
  /** 重启到新版本。 */
  restartApp(): Promise<void>

  listInstances(): Promise<DesktopInstance[]>
  discoverInstances(): Promise<InstanceDiscoveryResult>
  importInstance(path: string): Promise<InstanceImportResult>
  selectInstance(id: string): Promise<DesktopInstance>
  startInstance(id: string): Promise<InstanceRuntimeState>
  openInstance(id: string): Promise<void>
  stopInstance(id: string): Promise<InstanceRuntimeState>
  restartInstance(id: string): Promise<InstanceRuntimeState>
  /** 暂停实例（冻结进程树，保留状态）；暂停后 startInstance 恢复。 */
  pauseInstance(id: string): Promise<InstanceRuntimeState>
  /** 恢复已暂停的实例。 */
  resumeInstance(id: string): Promise<InstanceRuntimeState>
  /** 设置实例端口（自动检测冲突，冲突则更换）。 */
  setInstancePort(id: string, preferred: number): Promise<DesktopInstance>
  /** 重命名实例（只改显示名，不影响路径）。 */
  renameInstance(id: string, name: string): Promise<DesktopInstance>
  listInstanceStates(): Promise<InstanceRuntimeState[]>
  /** 读取某实例 DSH_HOME 的 Token 用量（今日 + 历史总和，本地日志聚合，无网络请求）。 */
  instanceUsage(dshHome: string): Promise<DshUsageResult>
  /** 读取 DeepSeek 官方账户余额。 */
  deepseekBalance(force?: boolean): Promise<DeepSeekBalanceResult>
  /** 删除实例：仅移除注册（可选跳过扫描）或完全删除（移入回收站）。 */
  deleteInstance(id: string, options: DeleteInstanceOptions): Promise<DeleteInstanceResult>
  /** 检测指向该实例运行体的桌面快捷方式。 */
  findInstanceShortcuts(id: string): Promise<InstanceShortcutsResult>
  /** 把指向该实例运行体的桌面快捷方式移入回收站。 */
  removeInstanceShortcuts(id: string): Promise<{ ok: boolean; trashed: string[] }>
  /** 实例镜像：比对当前状态与镜像。 */
  instanceMirrorStatus(id: string): Promise<InstanceMirrorStatus>
  /** 实例镜像：更新镜像（接受当前状态为新镜像）。 */
  instanceMirrorUpdate(id: string): Promise<InstanceMirrorStatus>
  /** 实例镜像：校正还原（把独立状态还原回镜像）。 */
  instanceMirrorRestore(id: string): Promise<InstanceMirrorStatus>
  /** 实例镜像：列出历史镜像（时间戳列表）。 */
  instanceMirrorHistory(id: string): Promise<{ ok: boolean; history: Array<{ timestamp: string; snapshotAt: string; restorable?: boolean }> }>
  /** 实例镜像：回撤到某个历史镜像。 */
  instanceMirrorRestoreTo(id: string, timestamp: string): Promise<InstanceMirrorStatus>

  /** 列出内置项目文档的可用语言与文档 id。 */
  listDocs(): Promise<DocListResult>
  /** 按语言回退链（lang → en → zh-CN）读取一篇内置文档。 */
  readDoc(id: string, lang: LanguageCode): Promise<DocReadResult>
  /** 读取软件内置 GPLv3 许可证全文（关于页展示）；读取失败返回 null。 */
  readLicense(): Promise<string | null>
  /** 读取随软件分发的第三方组件声明（markdown）；读取失败返回 null。 */
  readThirdPartyNotices(): Promise<string | null>
  /** 拉取某类实例的可用版本清单（官方网页/社区桌面走 GitHub API，官方桌面版标记官网下载）。 */
  listCatalogVersions(kind: InstanceKind): Promise<CatalogResult>
  /** 选择文件夹（新建实例路径用），取消返回 null。 */
  chooseFolder(): Promise<string | null>
  /** 取消后等待该创建任务完成所有已确认归属的清理。 */
  cancelCreateInstance(taskId: string): Promise<{ ok: boolean; error?: string; cleanupPending?: boolean }>
  listCreateTasks(): Promise<Array<{ taskId: string; path: string; cleanupPending?: boolean; error?: string }>>
  /** 新建实例流水线：核验→下载部署→自检→收录，失败仅清理任务拥有的文件。 */
  createInstance(input: CreateInstanceRequest): Promise<CreateInstanceResult>
  discoverUnfinishedCreates(): Promise<UnfinishedCreateTask[]>
  cleanupUnfinishedCreate(input: { lockPath: string; confirmed: boolean }): Promise<{ ok: boolean; error?: string }>
  /** 订阅新建实例进度（弹窗实时阶段显示）。返回退订函数。 */
  onCreateInstanceProgress(listener: (progress: CreateInstanceProgress) => void): () => void

  openExternal(url: string): Promise<void>
  openPath(path: string): Promise<void>
  minimizeWindow(): Promise<void>
  toggleMaximizeWindow(): Promise<boolean>
  closeWindow(): Promise<void>
  /** 隐藏主窗口到托盘（不退出，供「启动实例后自动关闭」）。 */
  hideWindow(): Promise<void>
  /** 关闭托盘弹出面板（供「启动实例后自动关闭」）。 */
  closeTray(): Promise<void>
  /** 显示主窗口（从托盘面板唤起）。 */
  showMainWindow(): Promise<void>
  /** 显示主窗口并打开设置（从托盘面板）。 */
  showSettings(): Promise<void>
  /** 退出程序（从托盘面板）。 */
  quitApp(): Promise<void>
  /** 订阅「打开设置」事件（托盘面板发起）。返回退订函数。 */
  onOpenSettings(listener: () => void): () => void
}

declare global {
  interface Window {
    launcher?: LauncherApi
  }
}
