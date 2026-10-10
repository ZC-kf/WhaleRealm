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

import { Tray } from 'electron'

/**
 * 系统托盘：左键/右键都切换托盘弹出面板（面板内含「退出」）。
 */

export interface TrayController {
  /** 首次隐藏到托盘时的一次性气泡提示。 */
  notifyBackground(): void
  destroy(): void
}

interface CreateTrayOptions {
  iconPath: string
  onToggle: () => void
}

export function createTray(options: CreateTrayOptions): TrayController {
  const tray = new Tray(options.iconPath)
  tray.setToolTip('鲸域 · WhaleRealm')
  tray.on('click', () => options.onToggle())
  tray.on('right-click', () => options.onToggle())

  return {
    notifyBackground() {
      if (tray.isDestroyed() || process.platform !== 'win32') return
      tray.displayBalloon({
        iconType: 'info',
        title: '鲸域 · WhaleRealm',
        content: '程序仍在后台运行，点托盘图标可快捷操作。',
      })
    },
    destroy() {
      tray.destroy()
    },
  }
}
