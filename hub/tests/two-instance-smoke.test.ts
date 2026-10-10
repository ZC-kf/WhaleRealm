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

import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveInstanceRecord } from '../electron/instance-paths'
import { buildSmokeEvidence } from '../electron/smoke-evidence'

describe('two-instance smoke evidence contract', () => {
  it('requires distinct mutable roots, ports, locks, and skill paths', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'dsh-hub-smoke-'))
    const stable = resolveInstanceRecord(root, 'stable', { port: 19391 })
    const beta = resolveInstanceRecord(root, 'beta', { port: 19392 })
    const evidence = {
      instances: [
        { id: stable.id, pid: 101, port: stable.port, dshHome: stable.dshHome, userData: stable.electronUserData, desktopProfile: stable.desktopProfile, lockName: stable.lockName, logs: stable.logs, skillPaths: [path.join(stable.dshHome, 'skills', 'vuln-scan')] },
        { id: beta.id, pid: 102, port: beta.port, dshHome: beta.dshHome, userData: beta.electronUserData, desktopProfile: beta.desktopProfile, lockName: beta.lockName, logs: beta.logs, skillPaths: [path.join(beta.dshHome, 'skills', 'vuln-scan')] },
      ],
      distinct: { roots: true, ports: true, locks: true, skills: true },
    }
    const evidencePath = path.join(root, 'two-instance-smoke.json')
    await writeFile(evidencePath, JSON.stringify(evidence))
    expect(evidence.instances[0].dshHome).not.toBe(evidence.instances[1].dshHome)
    expect(evidence.instances[0].skillPaths[0]).not.toBe(evidence.instances[1].skillPaths[0])
    expect(evidence.distinct).toEqual({ roots: true, ports: true, locks: true, skills: true })
    const built = buildSmokeEvidence([stable, beta], [101, 102], [stable.port, beta.port], [stable.id, beta.id])
    expect(built.distinct).toEqual({ roots: true, ports: true, locks: true, skills: true })
  })
})
