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

import { contextBridge, ipcRenderer } from 'electron'
import { IPC, IPC_EVENTS } from '../src/constants'
import type { AppSettings, CreateInstanceProgress, LauncherApi } from '../src/types'

/**
 * 渲染层与主进程之间唯一的桥。
 * 通道名来自共享常量，与主进程的注册面是同一份定义。
 */

const api: LauncherApi = {
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke(IPC.settingsSave, settings),
  chooseLauncherBackground: () => ipcRenderer.invoke(IPC.settingsChooseBackground),
  clearLauncherBackground: () => ipcRenderer.invoke(IPC.settingsClearBackground),
  chooseTrayBackground: () => ipcRenderer.invoke(IPC.settingsChooseTrayBackground),
  clearTrayBackground: () => ipcRenderer.invoke(IPC.settingsClearTrayBackground),
  saveCroppedTrayBackground: (dataUrl: string) => ipcRenderer.invoke(IPC.settingsSaveCroppedTrayBackground, dataUrl),
  chooseCardBackground: () => ipcRenderer.invoke(IPC.settingsChooseCardBackground),
  clearCardBackground: () => ipcRenderer.invoke(IPC.settingsClearCardBackground),
  chooseSettingsBackground: () => ipcRenderer.invoke(IPC.settingsChooseSettingsBackground),
  clearSettingsBackground: () => ipcRenderer.invoke(IPC.settingsClearSettingsBackground),
  writeClipboard: (text: string) => ipcRenderer.invoke(IPC.clipboardWriteText, text),
  checkProjectRelease: () => ipcRenderer.invoke(IPC.releaseCheck),
  downloadProjectRelease: (releaseId: number) => ipcRenderer.invoke(IPC.releaseDownload, releaseId),
  installProjectRelease: (artifactId: string) => ipcRenderer.invoke(IPC.releaseInstall, artifactId),
  restartApp: () => ipcRenderer.invoke(IPC.updateRestart),

  listInstances: () => ipcRenderer.invoke(IPC.instancesList),
  discoverInstances: () => ipcRenderer.invoke(IPC.instancesDiscover),
  importInstance: path => ipcRenderer.invoke(IPC.instancesImport, path),
  selectInstance: id => ipcRenderer.invoke(IPC.instancesSelect, id),
  startInstance: id => ipcRenderer.invoke(IPC.instancesStart, id),
  openInstance: id => ipcRenderer.invoke(IPC.instancesOpen, id),
  stopInstance: id => ipcRenderer.invoke(IPC.instancesStop, id),
  restartInstance: id => ipcRenderer.invoke(IPC.instancesRestart, id),
  pauseInstance: id => ipcRenderer.invoke(IPC.instancesPause, id),
  resumeInstance: id => ipcRenderer.invoke(IPC.instancesResume, id),
  setInstancePort: (id, port) => ipcRenderer.invoke(IPC.instancesPort, { id, port }),
  renameInstance: (id, name) => ipcRenderer.invoke(IPC.instancesRename, { id, name }),
  instanceMirrorStatus: id => ipcRenderer.invoke(IPC.instancesMirrorStatus, id),
  instanceMirrorUpdate: id => ipcRenderer.invoke(IPC.instancesMirrorUpdate, id),
  instanceMirrorRestore: id => ipcRenderer.invoke(IPC.instancesMirrorRestore, id),
  instanceMirrorHistory: id => ipcRenderer.invoke(IPC.instancesMirrorHistory, id),
  instanceMirrorRestoreTo: (id, timestamp) => ipcRenderer.invoke(IPC.instancesMirrorRestoreTo, id, timestamp),
  listInstanceStates: () => ipcRenderer.invoke(IPC.instancesStates),
  instanceUsage: dshHome => ipcRenderer.invoke(IPC.instancesUsage, dshHome),
  deepseekBalance: force => ipcRenderer.invoke(IPC.deepseekBalance, force),
  listDocs: () => ipcRenderer.invoke(IPC.docsList),
  readDoc: (id, lang) => ipcRenderer.invoke(IPC.docsRead, id, lang),
  readLicense: () => ipcRenderer.invoke(IPC.licenseRead),
  readThirdPartyNotices: () => ipcRenderer.invoke(IPC.licenseReadThirdParty),
  listCatalogVersions: kind => ipcRenderer.invoke(IPC.catalogList, kind),
  chooseFolder: () => ipcRenderer.invoke(IPC.dialogChooseFolder),
  cancelCreateInstance: taskId => ipcRenderer.invoke(IPC.createCancel, taskId),
  listCreateTasks: () => ipcRenderer.invoke(IPC.createTasks),
  createInstance: input => ipcRenderer.invoke(IPC.createInstance, input),
  discoverUnfinishedCreates: () => ipcRenderer.invoke(IPC.createUnfinished),
  cleanupUnfinishedCreate: input => ipcRenderer.invoke(IPC.createCleanup, input),
  onCreateInstanceProgress: listener => {
    const wrapped = (_event: Electron.IpcRendererEvent, progress: CreateInstanceProgress) => listener(progress)
    ipcRenderer.on(IPC_EVENTS.createInstanceProgress, wrapped)
    return () => ipcRenderer.removeListener(IPC_EVENTS.createInstanceProgress, wrapped)
  },
  deleteInstance: (id, options) => ipcRenderer.invoke(IPC.instancesDelete, id, options),
  findInstanceShortcuts: id => ipcRenderer.invoke(IPC.instancesFindShortcuts, id),
  removeInstanceShortcuts: id => ipcRenderer.invoke(IPC.instancesRemoveShortcuts, id),

  openExternal: url => ipcRenderer.invoke(IPC.openExternal, url),
  openPath: path => ipcRenderer.invoke(IPC.openPath, path),
  minimizeWindow: () => ipcRenderer.invoke(IPC.windowMinimize),
  toggleMaximizeWindow: () => ipcRenderer.invoke(IPC.windowToggleMaximize),
  closeWindow: () => ipcRenderer.invoke(IPC.windowClose),
  hideWindow: () => ipcRenderer.invoke(IPC.windowHide),
  closeTray: () => ipcRenderer.invoke(IPC.windowCloseTray),
  showMainWindow: () => ipcRenderer.invoke(IPC.windowShow),
  showSettings: () => ipcRenderer.invoke(IPC.windowShowSettings),
  quitApp: () => ipcRenderer.invoke(IPC.appQuit),
  onOpenSettings: listener => {
    const wrapped = () => listener()
    ipcRenderer.on(IPC_EVENTS.openSettings, wrapped)
    return () => ipcRenderer.removeListener(IPC_EVENTS.openSettings, wrapped)
  },
}

contextBridge.exposeInMainWorld('launcher', api)
