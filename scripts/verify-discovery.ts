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
/**
 * 发现子系统自检：在本机真实跑一次 scanMachine 与 importByPath，打印发现结果。
 * 只读，不写状态、不启动实例。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanMachine, importByPath } from '../hub/electron/instance-discovery'

const HUB = process.env.DSH_HUB_ROOT ?? fileURLToPath(new URL('..', import.meta.url))
const CATALOG = path.join(HUB, 'manifests', 'runtime-catalog.json')

function main(): void {
  const found = scanMachine({ catalogPath: CATALOG, hubRuntimesRoot: path.join(HUB, 'runtimes') })
  process.stdout.write(`scanMachine found ${found.length} install(s):\n`)
  for (const item of found) {
    process.stdout.write(
      `  [${item.tier}] ${item.path}\n` +
      `      exe=${item.exeName} version=${item.version ?? '?'} source=${item.source} running=${item.running}${item.pid ? ' pid=' + item.pid : ''}\n` +
      `      reason=${item.tierReason}\n`
    )
  }

  const expectations: Array<{ label: string; ok: boolean }> = []
  const live = found.find(f => f.path.toLowerCase() === 'd:\\dsh-desktop')
  expectations.push({ label: 'found D:\\DSH-Desktop', ok: Boolean(live) })
  expectations.push({ label: 'live running=true', ok: Boolean(live && live.running) })
  expectations.push({ label: 'live tier=C', ok: Boolean(live && live.tier === 'C') })
  const hubRuntime = found.find(f => f.path.toLowerCase().startsWith(path.join(HUB, 'runtimes').toLowerCase()))
  expectations.push({ label: 'hub runtime tier=A', ok: Boolean(hubRuntime && hubRuntime.tier === 'A') })
  const sourceOnly = found.find(f => f.path.toLowerCase() === 'd:\\deepseek-harness')
  expectations.push({ label: 'source-only dir NOT reported as desktop install', ok: !sourceOnly })

  try {
    const manual = importByPath('D:\\DSH-Desktop', { catalogPath: CATALOG })
    expectations.push({ label: 'importByPath(D:\\DSH-Desktop) tier=C', ok: manual.tier === 'C' })
  } catch (error) {
    expectations.push({ label: 'importByPath(D:\\DSH-Desktop) tier=C', ok: false })
  }
  let threw = false
  try { importByPath('D:\\definitely-not-a-dsh-install', { catalogPath: CATALOG }) } catch { threw = true }
  expectations.push({ label: 'importByPath(bad path) throws', ok: threw })

  process.stdout.write('\nexpectations:\n')
  let failed = 0
  for (const expectation of expectations) {
    process.stdout.write(`  ${expectation.ok ? 'PASS' : 'FAIL'}  ${expectation.label}\n`)
    if (!expectation.ok) failed++
  }
  process.exitCode = failed === 0 ? 0 : 2
}

main()
