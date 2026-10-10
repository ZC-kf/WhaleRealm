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

import { BrowserWindow, type Rectangle } from 'electron'

/**
 * Windows 主窗口的合成投影层。
 *
 * 主窗口本身关闭了系统阴影（透明无框窗口在 Windows 上原生阴影会盖穿圆角），
 * 这里补一层透明的辅助窗：几何始终贴着主窗内容边界外扩一圈，只画阴影、
 * 不接任何输入。两个原生表面的重绘是异步的，窗口移动/缩放期间如果跟着
 * 刷新，会看到"旧边缘脱离主体"的残影——因此动效期把投影藏起来，等窗口
 * 静止一小段时间再恢复。
 */

/** 投影带宽度：内容边界向四周外扩的像素数。 */
const SHADOW_MARGIN_PX = 30
/** 移动/缩放后的静止判定窗口（毫秒）。 */
const SETTLE_WINDOW_MS = 80

/** 投影页标记：阴影环用 body 伪元素画，窗口本体不承载任何交互元素。 */
function shadowPageHtml(marginPx: number): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }
  body::before {
    content: "";
    position: absolute;
    inset: ${marginPx}px;
    border-radius: 14px;
    box-shadow:
      0 0 1px 1px rgba(22, 32, 26, 0.10),
      0 6px 24px rgba(22, 32, 26, 0.18);
  }
</style>
</head>
<body></body>
</html>`
}

/** 内容边界外扩一圈后的投影窗几何。 */
function expandedAround(content: Rectangle): Rectangle {
  return {
    x: content.x - SHADOW_MARGIN_PX,
    y: content.y - SHADOW_MARGIN_PX,
    width: content.width + SHADOW_MARGIN_PX * 2,
    height: content.height + SHADOW_MARGIN_PX * 2,
  }
}

function sameRectangle(a: Rectangle, b: Rectangle): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

interface ShadowRig {
  /** 几何事件（move/resize 族）：有位移才对齐并重启静止判定。 */
  follow(): void
  /** 立即尝试显示（focus/restore 等场合）；不满足显示条件时静默退避。 */
  reveal(): void
}

const rigs = new WeakMap<BrowserWindow, ShadowRig>()

export function attachWindowShadow(owner: BrowserWindow): void {
  // 只挂在活跃的 Windows 主窗口上；重复挂载无副作用。
  if (process.platform !== 'win32' || owner.isDestroyed() || rigs.has(owner)) return

  const initial = expandedAround(owner.getContentBounds())
  const shadow = new BrowserWindow({
    ...initial,
    useContentSize: true,
    backgroundColor: '#00000000',
    transparent: true,
    frame: false,
    thickFrame: false,
    roundedCorners: false,
    // 投影自身不能再带系统阴影，否则双层投影。
    hasShadow: false,
    focusable: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  shadow.setMenuBarVisibility(false)
  shadow.setIgnoreMouseEvents(true)

  let pageLoaded = false
  let settleTimer: ReturnType<typeof setTimeout> | null = null
  let alignedWith: Rectangle = initial

  const cancelSettle = () => {
    if (settleTimer !== null) {
      clearTimeout(settleTimer)
      settleTimer = null
    }
  }

  const retreat = () => {
    cancelSettle()
    if (!shadow.isDestroyed()) shadow.hide()
  }

  /** 把投影几何对齐到目标框（仅在位移时写回并强制重绘）。 */
  const align = (target: Rectangle) => {
    if (sameRectangle(alignedWith, target)) return
    alignedWith = target
    shadow.setContentBounds(target, false)
    shadow.webContents.invalidate()
  }

  /**
   * 显示条件：投影页就绪、双方窗口健在、主窗可见且处于普通形态
   * （非最小化/最大化/全屏）、主窗持有焦点。投影从不抢焦点。
   */
  const canReveal = () =>
    pageLoaded
    && !owner.isDestroyed()
    && !shadow.isDestroyed()
    && owner.isVisible()
    && !owner.isMinimized()
    && !owner.isMaximized()
    && !owner.isFullScreen()
    && owner.isFocused()

  const reveal = () => {
    if (!canReveal()) return
    align(expandedAround(owner.getContentBounds()))
    if (settleTimer !== null) return // 动效期未静止：交给静止判定收尾。
    shadow.showInactive()
    // 主窗与投影必须作为一对提升。只提主窗会把投影压在别的应用下面；
    // 反过来把主窗 moveTop 到投影之上会改变主窗原有 Z 序。投影既不收
    // 焦点也不收输入，先提投影、再提主窗，键盘焦点不受任何影响。
    shadow.moveTop()
    owner.moveTop()
  }

  /** 藏起投影并重启静止判定：静止满一个窗口期且主窗仍聚焦才恢复。 */
  const deferUntilSettled = () => {
    retreat()
    settleTimer = setTimeout(() => {
      settleTimer = null
      reveal()
    }, SETTLE_WINDOW_MS)
  }

  rigs.set(owner, {
    follow() {
      if (owner.isDestroyed() || shadow.isDestroyed()) return
      const target = expandedAround(owner.getContentBounds())
      if (sameRectangle(alignedWith, target)) return
      deferUntilSettled()
      align(target)
    },
    reveal() {
      if (owner.isDestroyed() || shadow.isDestroyed()) return
      if (!canReveal()) {
        retreat()
        return
      }
      reveal()
    },
  })

  const followRig = () => rigs.get(owner)?.follow()
  const revealRig = () => rigs.get(owner)?.reveal()

  // 即时反应类：动效一开始就把投影收进静止判定。
  owner.on('will-move', deferUntilSettled)
  owner.on('will-resize', deferUntilSettled)
  // 几何跟踪类：有位移才对齐，并顺带延续静止判定（拖动中每次都重置计时）。
  owner.on('move', followRig)
  owner.on('resize', followRig)
  owner.on('moved', followRig)
  owner.on('resized', followRig)
  // 显隐类：回到普通形态即显示，离开普通形态即隐藏。
  owner.on('focus', revealRig)
  owner.on('show', revealRig)
  owner.on('restore', revealRig)
  owner.on('hide', retreat)
  owner.on('minimize', retreat)
  owner.on('maximize', retreat)
  owner.on('unmaximize', revealRig)
  owner.on('enter-full-screen', retreat)
  owner.on('leave-full-screen', revealRig)

  owner.once('closed', () => {
    cancelSettle()
    rigs.delete(owner)
    if (!shadow.isDestroyed()) shadow.destroy()
  })

  // 投影页就绪前 reveal 全部空转；就绪后立即尝试显示。
  shadow.webContents.once('did-finish-load', () => {
    pageLoaded = true
    reveal()
  })
  void shadow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(shadowPageHtml(SHADOW_MARGIN_PX))}`)
}

export function syncWindowShadow(owner: BrowserWindow): void {
  rigs.get(owner)?.follow()
}

export function showWindowShadow(owner: BrowserWindow): void {
  rigs.get(owner)?.reveal()
}
