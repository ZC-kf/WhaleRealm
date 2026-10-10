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
import { LauncherApiProvider } from '../src/api/client'
import { I18nProvider } from '../src/i18n'
import { CreateInstanceDialog, type CreateInstanceInput } from '../src/components/dialogs/CreateInstanceDialog'
import { UnfinishedCreatesDialog } from '../src/components/dialogs/UnfinishedCreatesDialog'
import type { LauncherApi, UnfinishedCreateTask } from '../src/types'

/**
 * 创建流程 UI 的行为测试（注入 API 替身）：
 * 真实阶段显示、任务标识、取消语义、失败如实提示与重试、重复提交禁止、
 * 未完成任务的确认清理流程。
 */

type ProgressListener = (progress: { taskId?: string; stage: string; percent: number; detailKey: string }) => void

interface Harness {
  progressListeners: Set<ProgressListener>
  api: LauncherApi
  onCreate: ReturnType<typeof vi.fn<(input: CreateInstanceInput) => Promise<unknown>>>
}

function makeHarness(): Harness {
  const progressListeners = new Set<ProgressListener>()
  const onCreate = vi.fn<(input: CreateInstanceInput) => Promise<unknown>>()
  const api = {
    listCatalogVersions: vi.fn(async () => ({
      ok: true,
      versions: [{ version: '0.21.0', publishedAt: '', downloadUrl: 'https://example.com/x.zip', prerelease: false, latest: true }],
    })),
    chooseFolder: vi.fn(async () => null),
    cancelCreateInstance: vi.fn(async () => ({ ok: true })),
    onCreateInstanceProgress: (listener: ProgressListener) => {
      progressListeners.add(listener)
      return () => progressListeners.delete(listener)
    },
  } as unknown as LauncherApi
  return { progressListeners, api, onCreate }
}

const mounts: Array<() => Promise<void>> = []
afterEach(async () => {
  while (mounts.length > 0) await mounts.pop()!()
  vi.clearAllMocks()
})

function renderDialog(harness: Harness): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  const root: Root = createRoot(host)
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  act(() => {
    root.render(
      <I18nProvider language="zh-CN">
        <LauncherApiProvider value={harness.api}>
          <CreateInstanceDialog onClose={() => undefined} onCreate={harness.onCreate} />
        </LauncherApiProvider>
      </I18nProvider>,
    )
  })
  mounts.push(async () => { await act(async () => { root.unmount() }); host.remove() })
  return host
}

/**
 * jsdom + React 受控输入：直接 el.value = x 会被 React 的 value tracker 吞掉
 * （React 认为值未变化而不触发 onChange）。必须用原型上的原生 setter，
 * 与 React Testing Library 的 setNativeValue 同理。
 */
function setNativeValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const prototype = element instanceof HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
  descriptor?.set?.call(element, value)
}

async function fillForm(host: HTMLElement): Promise<void> {
  const [nameInput, pathInput] = host.querySelectorAll<HTMLInputElement>('input')
  await act(async () => {
    setNativeValue(nameInput, '测试实例')
    nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    setNativeValue(pathInput, 'D:\\instances\\test')
    pathInput.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const kindSelect = host.querySelector<HTMLSelectElement>('select')!
  await act(async () => {
    setNativeValue(kindSelect, 'community-desktop')
    kindSelect.dispatchEvent(new Event('change', { bubbles: true }))
  })
  // 等待版本列表异步拉取后渲染第二个 select。
  await act(async () => {})
  const versionSelect = host.querySelectorAll<HTMLSelectElement>('select')[1]
  await act(async () => {
    setNativeValue(versionSelect, '0.21.0')
    versionSelect.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function confirmButton(host: HTMLElement): HTMLButtonElement {
  return [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '确定')!
}

function cancelButton(host: HTMLElement): HTMLButtonElement {
  // 空闲时为「取消」，busy 中为「取消创建」，取消请求发出后为「正在取消，等待任务收尾…」。
  return [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('取消'))!
}

describe('CreateInstanceDialog 真实反馈', () => {
  it('显示主进程推送的真实阶段、百分比与任务标识', async () => {
    const harness = makeHarness()
    const host = renderDialog(harness)
    await fillForm(host)
    let release!: (value: unknown) => void
    const gate = new Promise(resolve => { release = resolve })
    harness.onCreate.mockImplementationOnce(() => gate)
    let submitted: CreateInstanceInput | undefined
    await act(async () => {
      const result = confirmButton(host).click()
      void result
      await Promise.resolve()
      submitted = harness.onCreate.mock.calls[0]?.[0]
    })
    expect(submitted).toBeDefined()
    expect(submitted!.taskId).toMatch(/^[0-9a-f-]{36}$/)
    // 推送进度事件（对齐主进程 detailKey 语义）。
    await act(async () => {
      for (const listener of harness.progressListeners) {
        listener({ taskId: submitted!.taskId, stage: 'deploy', percent: 42, detailKey: 'create.stage.download' })
      }
    })
    expect(host.textContent).toContain('正在下载部署')
    expect(host.textContent).toContain('42%')
    expect(host.textContent).toContain('任务标识')
    const bar = host.querySelector('[role="progressbar"]')!
    expect(bar.getAttribute('aria-valuenow')).toBe('42')
    await act(async () => { release(undefined) })
  })

  it('创建中禁止重复提交：表单与确认按钮全部锁定', async () => {
    const harness = makeHarness()
    const host = renderDialog(harness)
    await fillForm(host)
    let release!: (value: unknown) => void
    const gate = new Promise(resolve => { release = resolve })
    harness.onCreate.mockImplementation(() => gate)
    act(() => { confirmButton(host).click() })
    await act(async () => {})
    expect(harness.onCreate).toHaveBeenCalledTimes(1)
    expect(confirmButton(host).disabled).toBe(true)
    const [nameInput] = host.querySelectorAll<HTMLInputElement>('input')
    expect(nameInput.disabled).toBe(true)
    // 再点也不追加调用。
    act(() => { confirmButton(host).click() })
    await act(async () => {})
    expect(harness.onCreate).toHaveBeenCalledTimes(1)
    await act(async () => { release(undefined) })
  })

  it('失败如实提示且可重试：错误显示后再次确认触发第二次创建', async () => {
    const harness = makeHarness()
    const host = renderDialog(harness)
    await fillForm(host)
    harness.onCreate.mockImplementationOnce(async () => { throw new Error('下载链接不可用（HTTP 404）') })
    await act(async () => { confirmButton(host).click() })
    expect(host.textContent).toContain('下载链接不可用')
    expect(host.textContent).toContain('创建未完成')
    // busy 已解除，可重试。
    expect(confirmButton(host).disabled).toBe(false)
    harness.onCreate.mockImplementationOnce(async () => undefined)
    await act(async () => { confirmButton(host).click() })
    expect(harness.onCreate).toHaveBeenCalledTimes(2)
  })

  it('取消语义：busy 中关闭变为取消任务，只发一次请求，收尾后显示已取消', async () => {
    const harness = makeHarness()
    const host = renderDialog(harness)
    await fillForm(host)
    let release!: (value: unknown) => void
    const gate = new Promise(resolve => { release = resolve })
    harness.onCreate.mockImplementation(() => gate)
    act(() => { confirmButton(host).click() })
    await act(async () => {})
    const taskId = harness.onCreate.mock.calls[0][0].taskId
    const cancel = harness.api.cancelCreateInstance as ReturnType<typeof vi.fn>
    // busy 中按钮文案变为「取消创建」。
    expect(cancelButton(host).textContent).toContain('取消创建')
    act(() => { cancelButton(host).click() })
    await act(async () => {})
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(cancel.mock.calls[0][0]).toBe(taskId)
    // 取消请求发出后按钮进入「取消中」并禁用，不能重复发起。
    expect(cancelButton(host).textContent).toContain('正在取消')
    expect(cancelButton(host).disabled).toBe(true)
    act(() => { cancelButton(host).click() })
    await act(async () => {})
    expect(cancel).toHaveBeenCalledTimes(1)
    // 任务以失败收尾（取消导致）→ 显示中性「已取消」，不显示错误。
    await act(async () => { release(undefined) })
    // 注意：onCreate 的 gate 正常 resolve 视为成功路径；改为 reject 再验证。
  })

  it('用户取消导致 onCreate 失败时显示已取消而非错误', async () => {
    const harness = makeHarness()
    const host = renderDialog(harness)
    await fillForm(host)
    let reject!: (reason: unknown) => void
    const gate = new Promise((_resolve, rejectFn) => { reject = rejectFn })
    harness.onCreate.mockImplementation(() => gate)
    act(() => { confirmButton(host).click() })
    await act(async () => {})
    act(() => { cancelButton(host).click() })
    await act(async () => {})
    await act(async () => { reject(new Error('创建已取消')) })
    expect(host.textContent).toContain('已取消创建')
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })
})

describe('UnfinishedCreatesDialog 恢复入口', () => {
  const tasks: UnfinishedCreateTask[] = [
    { lockPath: 'C:\\lock-a', taskId: '11111111-2222-3333-4444-555555555555', target: 'D:\\inst\\a', pid: 0, active: false, phase: 'staging' },
    { lockPath: 'C:\\lock-b', taskId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', target: 'D:\\inst\\b', pid: 4321, active: true, phase: 'publishing' },
  ]

  function renderRecovery(cleanup: ReturnType<typeof vi.fn>, onDismiss: () => void): HTMLElement {
    const api = { cleanupUnfinishedCreate: cleanup } as unknown as LauncherApi
    const host = document.createElement('div')
    document.body.append(host)
    const root: Root = createRoot(host)
    ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    act(() => {
      root.render(
        <I18nProvider language="zh-CN">
          <LauncherApiProvider value={api}>
            <UnfinishedCreatesDialog tasks={tasks} onDismiss={onDismiss} />
          </LauncherApiProvider>
        </I18nProvider>,
      )
    })
    mounts.push(async () => { await act(async () => { root.unmount() }); host.remove() })
    return host
  }

  it('列出全部任务：短标识、目标路径与活跃进程提示', () => {
    const host = renderRecovery(vi.fn(), () => undefined)
    expect(host.textContent).toContain('11111111')
    expect(host.textContent).toContain('aaaaaaaa')
    expect(host.textContent).toContain('D:\\inst\\a')
    expect(host.textContent).toContain('D:\\inst\\b')
    // active 任务显示进程仍在运行的提示，非 active 不显示。
    expect(host.textContent).toContain('该任务的进程仍在运行')
    expect(host.querySelectorAll('.unfinished-task small')).toHaveLength(1)
  })

  it('确认清理：带确认标志调用 IPC，成功后条目消失，失败如实保留并显示原因', async () => {
    const cleanup = vi.fn()
    cleanup.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: '所有权校验失败' })
    const host = renderRecovery(cleanup, () => undefined)
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('.unfinished-task button')]
    await act(async () => { buttons[0].click() })
    expect(cleanup).toHaveBeenCalledWith({ lockPath: 'C:\\lock-a', confirmed: true })
    // 第一条成功后从列表消失，只剩第二条。
    expect(host.querySelectorAll('.unfinished-task')).toHaveLength(1)
    await act(async () => { host.querySelector<HTMLButtonElement>('.unfinished-task button')!.click() })
    expect(cleanup).toHaveBeenCalledTimes(2)
    expect(host.textContent).toContain('所有权校验失败')
    expect(host.querySelectorAll('.unfinished-task')).toHaveLength(1)
  })

  it('稍后处理收起弹窗且不动任何任务', () => {
    const onDismiss = vi.fn()
    const host = renderRecovery(vi.fn(), onDismiss)
    const dismiss = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('稍后处理'))!
    act(() => { dismiss.click() })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
