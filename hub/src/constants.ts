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

// 主进程与渲染进程共享的常量。

/** 渲染层保留的最大日志条数。 */
export const MAX_LOG_LINES = 500

/**
 * 项目仓库身份（唯一事实来源）。
 * 主进程 project-release、渲染层 update.ts/SettingsDialog 与 README 全部从这里
 * 派生或对齐，不再存在任何 WhaleRealm/WhaleRealm 类占位地址。
 */
export const PROJECT_OWNER = 'ZC-kf'
export const PROJECT_REPO = 'WhaleRealm'

/**
 * 项目主页（由仓库身份派生）。
 * 关于页与更新提示共用；发行/更新通道由主进程 project-release.ts 统一实现。
 */
export const PROJECT_URL = `https://github.com/${PROJECT_OWNER}/${PROJECT_REPO}`

/**
 * IPC 通道名。主进程注册与 preload 调用共用这一份定义。
 */
export const IPC = {
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  settingsChooseBackground: 'settings:choose-background',
  settingsClearBackground: 'settings:clear-background',
  settingsChooseTrayBackground: 'settings:choose-tray-background',
  settingsClearTrayBackground: 'settings:clear-tray-background',
  settingsSaveCroppedTrayBackground: 'settings:save-cropped-tray-background',
  settingsChooseCardBackground: 'settings:choose-card-background',
  settingsClearCardBackground: 'settings:clear-card-background',
  settingsChooseSettingsBackground: 'settings:choose-settings-background',
  settingsClearSettingsBackground: 'settings:clear-settings-background',
  clipboardWriteText: 'clipboard:write-text',
  releaseCheck: 'release:check',
  releaseDownload: 'release:download',
  releaseInstall: 'release:install',
  updateRestart: 'update:restart',
  instancesList: 'instances:list',
  instancesSelect: 'instances:select',
  instancesStart: 'instances:start',
  instancesOpen: 'instances:open',
  instancesStop: 'instances:stop',
  instancesRestart: 'instances:restart',
  instancesStates: 'instances:states',
  instancesDiscover: 'instances:discover',
  instancesImport: 'instances:import',
  instancesDelete: 'instances:delete',
  instancesFindShortcuts: 'instances:find-shortcuts',
  instancesRemoveShortcuts: 'instances:remove-shortcuts',
  instancesUsage: 'instances:usage',
  instancesPause: 'instances:pause',
  instancesResume: 'instances:resume',
  instancesPort: 'instances:port',
  instancesRename: 'instances:rename',
  instancesMirrorStatus: 'instances:mirror-status',
  instancesMirrorUpdate: 'instances:mirror-update',
  instancesMirrorRestore: 'instances:mirror-restore',
  instancesMirrorHistory: 'instances:mirror-history',
  instancesMirrorRestoreTo: 'instances:mirror-restore-to',
  deepseekBalance: 'deepseek:balance',
  docsList: 'docs:list',
  docsRead: 'docs:read',
  licenseRead: 'license:read',
  licenseReadThirdParty: 'license:read-third-party',
  catalogList: 'catalog:list',
  dialogChooseFolder: 'dialog:choose-folder',
  createInstance: 'create:instance',
  createCancel: 'create:cancel',
  createTasks: 'create:tasks',
  createUnfinished: 'create:unfinished',
  createCleanup: 'create:cleanup',
  openExternal: 'shell:open-external',
  openPath: 'shell:open-path',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowHide: 'window:hide',
  windowCloseTray: 'window:close-tray',
  windowShow: 'window:show',
  windowShowSettings: 'window:show-settings',
  appQuit: 'app:quit',
} as const

/** 主进程主动推送给渲染层的事件通道。 */
export const IPC_EVENTS = {
  instanceStateChanged: 'instances:state-changed',
  openSettings: 'dsh:open-settings',
  createInstanceProgress: 'create:instance-progress',
} as const
