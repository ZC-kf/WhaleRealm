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
// Seed the probe Skill into the two Hub-registered instances so a single GUI-launched
// pair carries PID, port, state-root, lock AND Skill-path isolation evidence.
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInstanceRegistry } from '../hub/electron/instance-registry'
import { seedInstanceSkills } from '../hub/electron/skill-registry'

const HUB = process.env.DSH_HUB_ROOT ?? fileURLToPath(new URL('..', import.meta.url))
const SKILL = 'smoke-probe'
const IDS = ['gui-a', 'gui-b']

async function main(): Promise<void> {
  const shared = path.join(HUB, 'shared', 'skills', SKILL)
  await mkdir(shared, { recursive: true })
  if (!existsSync(path.join(shared, 'SKILL.md'))) {
    await writeFile(path.join(shared, 'SKILL.md'), `# ${SKILL}\n\nInstance isolation probe skill.\n`)
  }
  const registry = createInstanceRegistry(HUB)
  for (const id of IDS) {
    const record = await registry.get(id)
    for (const dir of [record.dshHome, record.electronUserData, record.workspace, record.logs, record.desktopProfile]) {
      await mkdir(dir, { recursive: true })
    }
    const target = path.join(record.dshHome, 'skills', SKILL)
    if (existsSync(target)) {
      process.stdout.write(`${id}: skill already present at ${target}\n`)
      continue
    }
    const result = await seedInstanceSkills(record, [SKILL])
    const entry = result.seeded[0]
    if (!entry) throw new Error(`no seed record for ${id}`)
    process.stdout.write(`${id}: seeded ${entry.target} sha256=${entry.targetHash}\n`)
  }
}

main().then(() => { process.exitCode = 0 }).catch((error: unknown) => {
  process.stderr.write(`SEED_ERROR: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
