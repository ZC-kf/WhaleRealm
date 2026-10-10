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

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
      },
      preload: {
        input: 'electron/preload.ts',
      },
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: false,
  },
  build: {
    // 生产包不发 sourcemap：map 会把构建机绝对路径打进 dist/**，
    // 而 files 配置会把 dist 整个收进发行包（verify-isolated-release 拦截）。
    sourcemap: false,
  },
  test: {
    // 多个测试文件做真实文件系统操作（创建事务/镜像/注册表），并行满载时
    // 单机 IO 抖动大；超时放宽到 30s 只影响等待上限，不放宽任何断言。
    testTimeout: 30_000,
  },
})
