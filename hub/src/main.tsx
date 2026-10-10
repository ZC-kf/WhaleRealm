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

import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

/**
 * 渲染层入口：校验挂载点后装配 React 根。
 * #root 容器缺失说明 index.html 与入口构建不匹配，直接失败比渲染一张空页更好排查。
 */
function mountLauncher(): void {
  const container = document.getElementById('root')
  if (!container) {
    throw new Error('渲染挂载点 #root 不存在：index.html 与入口产物不匹配。')
  }
  createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

mountLauncher()
