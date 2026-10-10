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

// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LauncherApiProvider, resolveLauncherApi, useLauncherApi } from '../src/api/client'
import { demoApi } from '../src/demo-api'
import { BUSY, useAsyncAction } from '../src/hooks/use-async-action'
import { TOAST_DURATION, TOAST_FADE_MS, useToast, type ToastState } from '../src/hooks/use-toast'
import { Toast } from '../src/components/Toast'
import type { LauncherApi } from '../src/types'

/** 挂载一个把 hook 结果暴露到 harness.current 的探针组件。 */
function mountProbe<H>(useHook: () => H, extraProps: Record<string, unknown> = {}): { current: H; unmount(): Promise<void> } {
  let latest: H | null = null
  function Probe(props: Record<string, unknown>) {
    latest = useHook()
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root: Root = createRoot(host)
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  act(() => { root.render(<Probe {...extraProps} />) })
  return {
    get current() { return latest as H },
    async unmount() { await act(async () => { root.unmount() }); host.remove() },
  }
}

const mounted: Array<() => Promise<void>> = []
afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()!()
  delete (window as { launcher?: LauncherApi }).launcher
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('resolveLauncherApi', () => {
  it('preload 注入的 window.launcher 优先', () => {
    const injected = { listInstances: vi.fn() } as unknown as LauncherApi
    ;(window as { launcher?: LauncherApi }).launcher = injected
    expect(resolveLauncherApi()).toBe(injected)
  })

  it('浏览器环境退回演示数据', () => {
    expect(resolveLauncherApi()).toBe(demoApi)
  })
})

describe('useLauncherApi', () => {
  it('Provider 内返回注入实现', async () => {
    const injected = { listInstances: vi.fn() } as unknown as LauncherApi
    let seen: LauncherApi | null = null
    function Consumer() {
      seen = useLauncherApi()
      return null
    }
    let root: Root | null = null
    await act(async () => {
      const host = document.createElement('div')
      document.body.append(host)
      root = createRoot(host)
      root.render(
        <LauncherApiProvider value={injected}>
          <Consumer />
        </LauncherApiProvider>,
      )
    })
    expect(seen).toBe(injected)
    await act(async () => { root!.unmount() })
  })

  it('脱离 Provider 使用立即抛错', async () => {
    let caught: unknown = null
    let root: Root | null = null
    await act(async () => {
      const host = document.createElement('div')
      document.body.append(host)
      root = createRoot(host)
      root.render(<div>{(() => { try { useLauncherApi() } catch (error) { caught = error } return null })()}</div>)
    })
    expect(caught).toBeInstanceOf(Error)
    await act(async () => { root!.unmount() })
  })
})

describe('useAsyncAction', () => {
  it('成功路径：占忙 → 结果返回 → 成功提示 → 解忙', async () => {
    const showToast = vi.fn()
    const harness = mountProbe(() => useAsyncAction(showToast))
    mounted.push(harness.unmount)
    let done = false
    const run = harness.current.run
    let result: number | undefined
    await act(async () => {
      result = await run(BUSY.settings, async () => 7, { success: '已保存' })
      done = true
    })
    expect(done).toBe(true)
    expect(result).toBe(7)
    expect(showToast).toHaveBeenCalledWith({ kind: 'success', message: '已保存' })
    expect(harness.current.busy).toBeNull()
  })

  it('成功文案可按结果动态生成', async () => {
    const showToast = vi.fn()
    const harness = mountProbe(() => useAsyncAction(showToast))
    mounted.push(harness.unmount)
    await act(async () => {
      await harness.current.run('runtime', async () => 19430, { success: port => `端口 ${port}` })
    })
    expect(showToast).toHaveBeenCalledWith({ kind: 'success', message: '端口 19430' })
  })

  it('失败默认弹错误提示并返回 undefined；自定义 onError 接管时不弹默认提示', async () => {
    const showToast = vi.fn()
    const onError = vi.fn()
    const harness = mountProbe(() => useAsyncAction(showToast))
    mounted.push(harness.unmount)
    let outcome: string | undefined = 'unset'
    await act(async () => {
      outcome = await harness.current.run('credential', async () => { throw new Error('密钥无效') })
    })
    expect(outcome).toBeUndefined()
    expect(showToast).toHaveBeenCalledWith({ kind: 'error', message: '密钥无效' })
    await act(async () => {
      await harness.current.run('credential', async () => { throw new Error('x') }, { onError })
    })
    expect(onError).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledTimes(1)
    expect(harness.current.busy).toBeNull()
  })

  it('并发修复：先完成的动作不误清后来者的忙碌槽', async () => {
    const showToast = vi.fn()
    const harness = mountProbe(() => useAsyncAction(showToast))
    mounted.push(harness.unmount)
    let releaseA!: (value: number) => void
    let releaseB!: (value: number) => void
    const first = new Promise<number>(resolve => { releaseA = resolve })
    const second = new Promise<number>(resolve => { releaseB = resolve })
    let runA: Promise<unknown> | null = null
    let runB: Promise<unknown> | null = null
    await act(async () => {
      runA = harness.current.run('action-a', () => first)
      runB = harness.current.run('action-b', () => second)
    })
    // 后启动者占用忙碌槽。
    expect(harness.current.busy).toBe('action-b')
    await act(async () => {
      releaseA(1)
      await runA
    })
    // A 先完成，忙碌槽仍归 B。
    expect(harness.current.busy).toBe('action-b')
    await act(async () => {
      releaseB(2)
      await runB
    })
    expect(harness.current.busy).toBeNull()
  })
})

describe('useToast', () => {
  const notice: ToastState = { kind: 'success', message: '同一个对象' }

  it('新提示替换旧提示并把计时拨回起点', async () => {
    vi.useFakeTimers()
    const harness = mountProbe(() => useToast())
    mounted.push(harness.unmount)
    act(() => { harness.current.showToast({ kind: 'error', message: '第一条' }) })
    expect(harness.current.toast?.message).toBe('第一条')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(harness.current.toast?.message).toBe('第一条')
    act(() => { harness.current.showToast({ kind: 'success', message: '第二条' }) })
    act(() => { vi.advanceTimersByTime(1000) })
    // 若计时未被重置，第一条的 1700ms 早已到点清空。
    expect(harness.current.toast?.message).toBe('第二条')
    act(() => { vi.advanceTimersByTime(TOAST_DURATION + TOAST_FADE_MS) })
    expect(harness.current.toast).toBeNull()
  })

  it('代数对账：同一对象重复展示不被陈旧计时器清掉', async () => {
    vi.useFakeTimers()
    const harness = mountProbe(() => useToast())
    mounted.push(harness.unmount)
    act(() => { harness.current.showToast(notice) })
    act(() => { vi.advanceTimersByTime(1200) })
    act(() => { harness.current.showToast(notice) })
    // 只推进到第一代计时器的原到点时刻（1200 + 500 = 1700ms）——
    // 它已被第二次展示作废，不许清掉当前提示。
    act(() => { vi.advanceTimersByTime(500) })
    expect(harness.current.toast).toBe(notice)
    // 第二代的完整 1700ms 走完才消失。
    act(() => { vi.advanceTimersByTime(1200) })
    expect(harness.current.toast).toBeNull()
  })

  it('手动关闭立即清空并作废计时器', async () => {
    vi.useFakeTimers()
    const harness = mountProbe(() => useToast())
    mounted.push(harness.unmount)
    act(() => { harness.current.showToast({ kind: 'error', message: '稍后消失' }) })
    act(() => { harness.current.dismissToast() })
    expect(harness.current.toast).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    act(() => { vi.advanceTimersByTime(5000) })
    expect(harness.current.toast).toBeNull()
  })

  it('卸载清理在途计时器', async () => {
    vi.useFakeTimers()
    const harness = mountProbe(() => useToast())
    act(() => { harness.current.showToast({ kind: 'success', message: '马上卸载' }) })
    expect(vi.getTimerCount()).toBe(1)
    await harness.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('Toast 组件', () => {
  function mountToast(toast: ToastState, onClose: () => void): { host: HTMLElement; unmount(): Promise<void> } {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    act(() => { root.render(<Toast toast={toast} onClose={onClose} />) })
    return { host, unmount: async () => { await act(async () => { root.unmount() }); host.remove() } }
  }

  it('渲染种类类名、消息文本与生命周期 CSS 变量', async () => {
    const view = mountToast({ kind: 'error', message: '启动失败' }, () => {})
    mounted.push(view.unmount)
    const box = view.host.querySelector<HTMLElement>('.toast')!
    expect(box.className).toContain('error')
    expect(box.getAttribute('role')).toBe('status')
    expect(box.style.getPropertyValue('--toast-lifetime')).toBe(`${TOAST_DURATION + TOAST_FADE_MS}ms`)
    expect(box.textContent).toContain('启动失败')
  })

  it('操作按钮触发动作并立即关闭', async () => {
    const onAction = vi.fn()
    const onClose = vi.fn()
    const view = mountToast(
      { kind: 'success', message: '已删除', action: { label: '移入回收站', onClick: onAction } },
      onClose,
    )
    mounted.push(view.unmount)
    const button = view.host.querySelector<HTMLButtonElement>('.toast-action')!
    act(() => { button.click() })
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('无操作按钮时不渲染按钮', async () => {
    const view = mountToast({ kind: 'success', message: '纯文本' }, () => {})
    mounted.push(view.unmount)
    expect(view.host.querySelector('.toast-action')).toBeNull()
  })
})
