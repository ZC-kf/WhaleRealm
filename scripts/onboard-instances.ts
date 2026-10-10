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
 * Onboard real working instances into the Hub and give each its own independent
 * copy of the full Skill library. Skills are physically copied (never linked),
 * so one instance can never read or mutate another instance's Skill files.
 */
import { existsSync } from 'node:fs'
import { mkdir, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInstanceRegistry } from '../hub/electron/instance-registry'
import { seedInstanceSkills } from '../hub/electron/skill-registry'

const HUB = process.env.DSH_HUB_ROOT ?? fileURLToPath(new URL('..', import.meta.url))
const RUNTIME_ROOT = path.join(HUB, 'runtimes', '0.1.7-alpha.1')
const RUNNER = path.join(RUNTIME_ROOT, 'DeepSeek Harness.exe')
const SHARED_SKILLS = path.join(HUB, 'shared', 'skills')

const TARGETS = [
  { id: 'daily', name: 'Daily', port: 19411 },
  { id: 'sandbox', name: 'Sandbox', port: 19412 },
]

function log(message: string): void {
  process.stdout.write(`[onboard] ${new Date().toISOString()} ${message}\n`)
}

async function countTree(root: string): Promise<{ dirs: number; files: number; links: number }> {
  let dirs = 0
  let files = 0
  let links = 0
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isSymbolicLink()) { links += 1; continue }
      if (entry.isDirectory()) { dirs += 1; await walk(full) } else if (entry.isFile()) { files += 1 }
    }
  }
  if (existsSync(root)) await walk(root)
  return { dirs, files, links }
}

async function main(): Promise<void> {
  if (!existsSync(RUNNER)) throw new Error(`isolatable runner missing: ${RUNNER}`)
  const registry = createInstanceRegistry(HUB)

  // The shared library can contain directories that are not valid Skills (for example a
  // plugin data folder without SKILL.md). seedInstanceSkills correctly refuses those, so
  // filter them here and report them instead of aborting the whole onboarding run.
  const allDirs = (await readdir(SHARED_SKILLS, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
  const sharedNames = allDirs.filter(name => existsSync(path.join(SHARED_SKILLS, name, 'SKILL.md')))
  const skipped = allDirs.filter(name => !sharedNames.includes(name))
  log(`shared skill library: ${sharedNames.length} valid skills`)
  if (skipped.length > 0) log(`skipped ${skipped.length} entr(y/ies) without SKILL.md: ${skipped.join(', ')}`)

  const summary: Array<Record<string, unknown>> = []
  for (const target of TARGETS) {
    let record
    try {
      record = await registry.get(target.id)
      log(`${target.id}: already registered (port ${record.port})`)
    } catch {
      record = await registry.create({
        id: target.id,
        name: target.name,
        version: '0.1.7-alpha.1',
        port: target.port,
        runtimeRoot: RUNTIME_ROOT,
      })
      log(`${target.id}: registered (port ${record.port}, lock ${record.lockName})`)
    }
    for (const dir of [record.dshHome, record.electronUserData, record.workspace, record.logs, record.desktopProfile]) {
      await mkdir(dir, { recursive: true })
    }

    const skillsRoot = path.join(record.dshHome, 'skills')
    const already = existsSync(skillsRoot)
      ? (await readdir(skillsRoot, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name)
      : []
    const pending = sharedNames.filter(name => !already.includes(name))
    log(`${target.id}: ${already.length} skills present, seeding ${pending.length} more`)

    let done = 0
    const batch = 50
    for (let index = 0; index < pending.length; index += batch) {
      const slice = pending.slice(index, index + batch)
      await seedInstanceSkills(record, slice)
      done += slice.length
      if (done % 200 === 0 || done === pending.length) log(`${target.id}: seeded ${done}/${pending.length}`)
    }

    const actual = await countTree(skillsRoot)
    const skillDirs = (await readdir(skillsRoot, { withFileTypes: true })).filter(e => e.isDirectory()).length
    summary.push({
      id: target.id,
      port: record.port,
      lockName: record.lockName,
      dshHome: record.dshHome,
      electronUserData: record.electronUserData,
      desktopProfile: record.desktopProfile,
      workspace: record.workspace,
      logs: record.logs,
      runtimeRoot: RUNTIME_ROOT,
      skillDirs,
      skillFiles: actual.files,
      symlinks: actual.links,
    })
    log(`${target.id}: ${skillDirs} skill dirs, ${actual.files} files, ${actual.links} links`)
  }

  const distinct = new Set(summary.map(item => String(item.dshHome))).size === summary.length
    && new Set(summary.map(item => String(item.electronUserData))).size === summary.length
    && new Set(summary.map(item => String(item.port))).size === summary.length
    && new Set(summary.map(item => String(item.lockName))).size === summary.length
  const noLinks = summary.every(item => Number(item.symlinks) === 0)
  const fullLibrary = summary.every(item => Number(item.skillDirs) === sharedNames.length)

  process.stdout.write(`${JSON.stringify({ sharedSkillCount: sharedNames.length, instances: summary, distinct, noLinks, fullLibrary }, null, 2)}\n`)
  log(`distinct=${distinct} noLinks=${noLinks} fullLibrary=${fullLibrary}`)
  if (!distinct || !noLinks || !fullLibrary) throw new Error('onboarding invariants failed')
}

main().then(() => { process.exitCode = 0 }).catch((error: unknown) => {
  process.stderr.write(`ONBOARD_ERROR: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
