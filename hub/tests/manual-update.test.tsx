// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 凛枫
// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import App from '../src/App'
import { demoApi } from '../src/demo-api'
import { IPC } from '../src/constants'
import { registerIpcHandlers, type IpcDependencies } from '../electron/ipc'

const fixtures = vi.hoisted(() => ({
  settings: { language: 'en', autoUpdate: true },
  handle: vi.fn(),
  spawn: vi.fn(),
}))
vi.mock('electron', () => ({ app: {}, BrowserWindow: {}, clipboard: {}, dialog: {}, ipcMain: { handle: fixtures.handle }, net: {}, shell: {} }))
vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), spawn: fixtures.spawn }))
vi.mock('../src/hooks/use-launcher-store', () => ({ useLauncherStore: () => ({ settings: fixtures.settings, loading: false, instances: [], instanceStates: [] }) }))
vi.mock('../src/components/LauncherHome', () => ({ LauncherHome: () => null }))
vi.mock('../src/components/FirstRunGuide', () => ({ FirstRunGuide: () => null }))

afterEach(() => { delete window.launcher; vi.clearAllMocks(); fixtures.settings.autoUpdate = true })

it('automatic checks only show a release and the update action opens its page without installation', async () => {
  const release = { releaseId: 9001, version: '2.0.0', publishedAt: '2026-10-13', notes: '', pageUrl: 'https://github.com/ZC-kf/WhaleRealm/releases/tag/v2.0.0', assets: [] }
  const api = { ...demoApi, checkProjectRelease: vi.fn(async () => ({ release, reason: null, error: null })), downloadProjectRelease: vi.fn(), installProjectRelease: vi.fn(), stopInstance: vi.fn(), restartApp: vi.fn(), openExternal: vi.fn(async () => undefined) }
  window.launcher = api
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    await act(async () => { root.render(<App />) })
    expect(host.querySelector('[aria-labelledby="update-title"]')).not.toBeNull()
    expect(api.downloadProjectRelease).not.toHaveBeenCalled()
    const action = host.querySelector<HTMLButtonElement>('.update-dialog .primary-command')!
    expect(action).not.toBeNull()
    await act(async () => { action.click() })
    expect(api.openExternal).toHaveBeenCalledWith(release.pageUrl)
    expect(api.stopInstance).not.toHaveBeenCalled()
    expect(api.downloadProjectRelease).not.toHaveBeenCalled()
    expect(api.installProjectRelease).not.toHaveBeenCalled()
    expect(api.restartApp).not.toHaveBeenCalled()
  } finally { await act(async () => { root.unmount() }) }
})

it('the legacy installation IPC rejects requests before executing an installer', async () => {
  registerIpcHandlers({} as IpcDependencies)
  const handler = fixtures.handle.mock.calls.find(([channel]) => channel === IPC.releaseInstall)![1]
  await expect(handler({}, 'WhaleRealm-2.0.0-setup.exe')).rejects.toThrow(/manual|手动/i)
  expect(fixtures.spawn).not.toHaveBeenCalled()
})

it('disabling automatic checks makes no release request at startup', async () => {
  fixtures.settings.autoUpdate = false
  const api = { ...demoApi, checkProjectRelease: vi.fn(async () => ({ release: null, reason: 'no-release' as const, error: null })) }
  window.launcher = api
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    await act(async () => { root.render(<App />) })
    expect(api.checkProjectRelease).not.toHaveBeenCalled()
    expect(host.querySelector('[aria-labelledby="update-title"]')).toBeNull()
  } finally { await act(async () => { root.unmount() }) }
})
