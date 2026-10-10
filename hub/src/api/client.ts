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

import { createContext, useContext } from 'react'
import { demoApi } from '../demo-api'
import type { LauncherApi } from '../types'

/**
 * 渲染层触达主进程的唯一 API 边界，分三个层次：
 *
 * 1. resolveLauncherApi —— 启动时选实现：preload 注入的 window.launcher 优先
 *    （真实 Electron 环境），否则退回 demoApi（浏览器里的开发预览数据）。
 * 2. LauncherApiProvider —— context 注入点。用 context 而不是模块级单例，
 *    组件测试就能给子树注入替身，不需要篡改全局。
 * 3. useLauncherApi —— 消费点。在 Provider 之外使用立即抛错（fail-closed），
 *    不悄悄落到 demoApi 上让缺陷静默通过。
 */

export function resolveLauncherApi(): LauncherApi {
  const injected = window.launcher
  return injected ?? demoApi
}

const LauncherApiContext = createContext<LauncherApi | undefined>(undefined)

export const LauncherApiProvider = LauncherApiContext.Provider

export function useLauncherApi(): LauncherApi {
  const api = useContext(LauncherApiContext)
  if (api === undefined) {
    throw new Error('useLauncherApi 必须在 <LauncherApiProvider> 内部使用。')
  }
  return api
}
