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

import { EventEmitter } from 'node:events'
import type { BrowserWindow, Rectangle } from 'electron'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachWindowShadow, showWindowShadow, syncWindowShadow } from '../electron/window-shadow'

const electronMocks = vi.hoisted(() => ({ createWindow: vi.fn() }))
vi.mock('electron', () => ({ BrowserWindow: electronMocks.createWindow }))

/** 模拟一个带几何与形态状态的 BrowserWindow。 */
class FakeWindow extends EventEmitter {
  bounds: Rectangle
  visible = false
  minimized = false
  maximized = false
  focused = false
  destroyed = false
  webContents = Object.assign(new EventEmitter(), { invalidate: vi.fn() })
  isDestroyed = () => this.destroyed
  isVisible = () => this.visible
  isMinimized = () => this.minimized
  isMaximized = () => this.maximized
  isFullScreen = () => false
  isFocused = () => this.focused
  getContentBounds = (): Rectangle => ({ ...this.bounds })
  getBounds = (): Rectangle => ({ ...this.bounds, width: this.bounds.width + 8, height: this.bounds.height + 8 })
  setContentBounds = vi.fn((next: Rectangle) => { this.bounds = { ...next } })
  setMenuBarVisibility = vi.fn()
  setIgnoreMouseEvents = vi.fn()
  loadURL = vi.fn(async () => undefined)
  hide = vi.fn(() => { this.visible = false })
  showInactive = vi.fn(() => { this.visible = true })
  moveTop = vi.fn()
  destroy = vi.fn(() => { this.destroyed = true })
  constructor(bounds: Rectangle) {
    super()
    this.bounds = { ...bounds }
  }
}

const toBrowserWindow = (fake: FakeWindow) => fake as unknown as BrowserWindow
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

let owner: FakeWindow
let shadow: FakeWindow

beforeAll(() => { Object.defineProperty(process, 'platform', { value: 'win32' }) })
afterAll(() => { Object.defineProperty(process, 'platform', originalPlatform) })

beforeEach(() => {
  vi.useFakeTimers()
  owner = new FakeWindow({ x: 100, y: 100, width: 900, height: 560 })
  owner.visible = true
  owner.focused = true
  electronMocks.createWindow.mockImplementation(function (options: Rectangle) {
    shadow = new FakeWindow({ x: options.x, y: options.y, width: options.width, height: options.height })
    return shadow
  })
  attachWindowShadow(toBrowserWindow(owner))
})

afterEach(() => {
  owner.emit('closed')
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('投影层装配与显示', () => {
  it('投影窗初始几何为主窗内容边界外扩 30px', () => {
    expect(shadow.bounds).toEqual({ x: 70, y: 70, width: 960, height: 620 })
    expect(shadow.setIgnoreMouseEvents).toHaveBeenCalledWith(true)
  })

  it('页面就绪前 reveal 空转；就绪后显示且投影先于主窗提升', () => {
    showWindowShadow(toBrowserWindow(owner))
    expect(shadow.showInactive).not.toHaveBeenCalled()
    shadow.webContents.emit('did-finish-load')
    expect(shadow.visible).toBe(true)
    // 成对提升：投影在前、主窗在后（不改变键盘焦点）。
    expect(shadow.moveTop.mock.invocationCallOrder[0]).toBeLessThan(owner.moveTop.mock.invocationCallOrder[0])
  })

  it('对未挂载的窗口调用 sync/show 不抛错', () => {
    const stranger = new FakeWindow({ x: 0, y: 0, width: 100, height: 100 })
    expect(() => { syncWindowShadow(toBrowserWindow(stranger)); showWindowShadow(toBrowserWindow(stranger)) }).not.toThrow()
  })
})

describe('移动与缩放的静止判定', () => {
  it('动效期间隐藏，静止满 80ms 才恢复到最终几何', () => {
    shadow.webContents.emit('did-finish-load')
    expect(shadow.visible).toBe(true)

    owner.emit('will-resize')
    expect(shadow.visible).toBe(false)

    owner.bounds = { x: 50, y: 60, width: 1100, height: 720 }
    owner.emit('resize')
    vi.advanceTimersByTime(50)
    owner.bounds = { x: 40, y: 50, width: 1200, height: 780 }
    syncWindowShadow(toBrowserWindow(owner))
    vi.advanceTimersByTime(50)
    // 计时被最后一次位移重置：50ms 不足以恢复。
    expect(shadow.visible).toBe(false)
    vi.runAllTimers()
    expect(shadow.visible).toBe(true)
    expect(shadow.bounds).toEqual({ x: 10, y: 20, width: 1260, height: 840 })
    // 只有两次真实位移触发重绘（初始对齐与静止后的复查都不写几何）。
    expect(shadow.webContents.invalidate).toHaveBeenCalledTimes(2)
  })

  it('负坐标显示器上的移动同样收敛', () => {
    shadow.webContents.emit('did-finish-load')
    owner.emit('will-move')
    owner.bounds = { ...owner.bounds, x: -1500, y: 200 }
    owner.emit('move')
    owner.emit('moved')
    expect(shadow.visible).toBe(false)
    vi.runAllTimers()
    expect(shadow.visible).toBe(true)
    expect(shadow.bounds).toEqual({ x: -1530, y: 170, width: 960, height: 620 })
  })
})

describe('焦点与窗口形态', () => {
  it('静止判定到点时主窗已失焦则不显示；重新聚焦立即恢复', () => {
    shadow.webContents.emit('did-finish-load')
    owner.emit('will-move')
    owner.focused = false
    vi.runAllTimers()
    expect(shadow.visible).toBe(false)
    owner.focused = true
    owner.emit('focus')
    expect(shadow.visible).toBe(true)
  })

  it('最小化/最大化期间保持隐藏，恢复普通形态后回来', () => {
    shadow.webContents.emit('did-finish-load')
    owner.minimized = true
    owner.emit('minimize')
    vi.runAllTimers()
    expect(shadow.visible).toBe(false)
    owner.minimized = false
    owner.emit('restore')
    expect(shadow.visible).toBe(true)
    owner.maximized = true
    owner.emit('maximize')
    owner.emit('focus') // 最大化形态下 focus 也不得显示。
    expect(shadow.visible).toBe(false)
    owner.maximized = false
    owner.emit('unmaximize')
    expect(shadow.visible).toBe(true)
  })

  it('主窗隐藏时投影随退', () => {
    shadow.webContents.emit('did-finish-load')
    expect(shadow.visible).toBe(true)
    owner.emit('hide')
    expect(shadow.visible).toBe(false)
  })
})

describe('生命周期清理', () => {
  it('主窗关闭取消在途定时器并销毁投影', () => {
    owner.emit('will-resize')
    expect(vi.getTimerCount()).toBe(1)
    owner.destroyed = true
    owner.emit('closed')
    expect(vi.getTimerCount()).toBe(0)
    expect(shadow.destroy).toHaveBeenCalledTimes(1)
    expect(() => vi.runAllTimers()).not.toThrow()
  })
})
