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

import { BrowserWindow, screen } from 'electron'
import { attachWindowShadow, showWindowShadow } from './window-shadow'

/** 主窗口的创建与渲染层消息出口。 */

// 视觉规格：首次打开即此尺寸，右上角按钮在「基础尺寸 ↔ 全屏」间切换。
const BASE_SIZE = { width: 1400, height: 900 }
const MIN_SIZE = { width: 900, height: 620 }
/** 窗口与工作区边缘保留的留白（任务栏/屏幕边缘不贴死）。 */
const WORK_AREA_GAP = 24
/** 透明窗口：渲染层的圆角外壳就是窗口真实外缘。 */
const WINDOW_CHROME = {
  backgroundColor: '#00000000',
  transparent: true,
  frame: false,
  thickFrame: false,
} as const

/** 把期望尺寸压进主显示器工作区（四周留白后仍装得下的部分）。 */
export function normalWindowSize(
  width: number = BASE_SIZE.width,
  height: number = BASE_SIZE.height,
): { width: number; height: number } {
  const area = screen.getPrimaryDisplay().workArea
  const maxWidth = Math.max(1, area.width - WORK_AREA_GAP * 2)
  const maxHeight = Math.max(1, area.height - WORK_AREA_GAP * 2)
  return { width: Math.min(width, maxWidth), height: Math.min(height, maxHeight) }
}

export interface CreateWindowOptions {
  preloadPath: string
  iconPath: string
  /** 开发模式下加载的 Vite dev server 地址；缺省加载打包产物。 */
  devServerUrl?: string
  indexPath: string
  /** 初始窗口尺寸（来自用户设置；缺省用基础尺寸）。 */
  initialSize?: { width: number; height: number }
  onClosed: () => void
}

export function createMainWindow(options: CreateWindowOptions): BrowserWindow {
  const size = options.initialSize ?? normalWindowSize()
  const window = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: Math.min(MIN_SIZE.width, size.width),
    minHeight: Math.min(MIN_SIZE.height, size.height),
    ...WINDOW_CHROME,
    // 边缘自由缩放保留（右上角按钮仍是预设尺寸间切换）。
    resizable: true,
    maximizable: false,
    roundedCorners: true,
    // Windows 上原生阴影会盖穿透明窗口的圆角，改由投影层（window-shadow）合成。
    hasShadow: process.platform !== 'win32',
    icon: options.iconPath,
    title: '鲸域 · WhaleRealm',
    show: false,
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.setMenuBarVisibility(false)
  window.setHasShadow(process.platform !== 'win32')
  window.once('closed', options.onClosed)
  attachWindowShadow(window)
  window.once('ready-to-show', () => {
    // 居中：窗口中心对准主显示器工作区中心，取整避免半像素抖动。
    const area = screen.getPrimaryDisplay().workArea
    const bounds = window.getBounds()
    window.setPosition(
      Math.round(area.x + (area.width - bounds.width) / 2),
      Math.round(area.y + (area.height - bounds.height) / 2),
      false,
    )
    window.show()
    showWindowShadow(window)
  })

  if (options.devServerUrl) {
    void window.loadURL(options.devServerUrl)
  } else {
    void window.loadFile(options.indexPath)
  }
  return window
}

/**
 * 渲染层消息的统一出口：窗口已销毁（含 webContents 已销毁）时静默丢弃，
 * 让推送方不必各自判断存活。
 */
export interface RendererChannel {
  send(channel: string, payload: unknown): void
}

export function createRendererChannel(getWindow: () => BrowserWindow | null): RendererChannel {
  return {
    send(channel, payload) {
      const window = getWindow()
      if (window === null || window.isDestroyed() || window.webContents.isDestroyed()) return
      window.webContents.send(channel, payload)
    },
  }
}
