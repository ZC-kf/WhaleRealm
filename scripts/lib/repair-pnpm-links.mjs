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
 * Dependency link integrity repair for pnpm `node-linker=isolated` layouts.
 *
 * In the build sandbox pnpm 11.7 completes installs ("Done in Ns", exit 0, "Already
 * up to date" on re-runs) while creating zero dependency links: package content
 * directories and `.bin` shims are materialized under `node_modules/.pnpm`, but
 * neither the per-package dependency junctions, the importer (workspace root)
 * direct-dependency links, nor the hoist layer are created. Node resolution then
 * fails with ERR_MODULE_NOT_FOUND deep inside tooling (e.g. tsx -> esbuild).
 *
 * This module re-derives the complete link graph from the pinned pnpm-lock.yaml
 * (which is never modified) and restores every missing link as a directory
 * junction. Junctions require no symlink privilege and are resolved transparently
 * by Node, matching the isolated linker layout pnpm itself would have produced.
 *
 * The lock snapshot key -> `.pnpm` directory name mapping is ported verbatim from
 * pnpm 11.7's `depPathToFilename` (dist/pnpm.mjs), including the sha256 short-hash
 * truncation used when a name exceeds `virtualStoreDirMaxLength` (60 on Windows)
 * or contains uppercase characters. It was validated byte-for-byte against real
 * directory names such as `@agentclientprotocol+sdk@1.4.0_zod@4.4.3`,
 * `@algolia+autocomplete-core@_a74662b9236ea701bf6f59f305f13c8a` and the
 * patch_hash-suffixed `@earendil-works+pi-ai@0.85._a68c33b4430d43f3230a6ca4636f469a`.
 */
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

/** Verbatim port of pnpm 11.7 depPathToFilenameUnescaped. */
function depPathToFilenameUnescaped(depPath) {
  if (!depPath.startsWith('file:')) {
    if (depPath[0] === '/') depPath = depPath.substring(1)
    const index = depPath.indexOf('@', 1)
    if (index === -1) return depPath
    return `${depPath.substring(0, index)}@${depPath.slice(index + 1)}`
  }
  return depPath.replace(':', '+')
}

/** Verbatim port of pnpm 11.7 depPathToFilename (sha256 short hash, 32 hex chars). */
export function depPathToFilename(depPath, maxLengthWithoutHash) {
  let filename = depPathToFilenameUnescaped(depPath).replace(/[\\/:*?"<>|#]/g, '+')
  if (filename.includes('(')) filename = filename.replace(/\)$/, '').replace(/\)\(|\(|\)/g, '_')
  if (filename.length > maxLengthWithoutHash || (filename !== filename.toLowerCase() && !filename.startsWith('file+')))
    return `${filename.substring(0, maxLengthWithoutHash - 33)}_${createHash('sha256').update(filename).digest('hex').substring(0, 32)}`
  return filename
}

const unquote = value => (value.length >= 2 && (value.startsWith('\'') && value.endsWith('\'') || value.startsWith('"') && value.endsWith('"')) ? value.slice(1, -1) : value)
const importerDepSections = new Set(['dependencies', 'devDependencies', 'optionalDependencies'])
const snapshotDepSections = { dependencies: 'dependencies', optionalDependencies: 'optionalDependencies' }
/**
 * Lockfile dependency values are either a plain version (`0.28.1`,
 * `4.1.8(@peer@1.2.3)`) or an alias carrying the real package id
 * (`string-width@4.2.3`). Aliases never start with a digit and carry no
 * unparenthesized `@`-free prefix; this test separates the two forms.
 */
const isAliasValue = value => /^(?:@[^/(]+\/)?[^@/(]+@/.test(value)
/** Real package name of an alias value (`@scope/name@1.0.0` -> `@scope/name`). */
const aliasName = value => {
  const at = value.startsWith('@') ? value.indexOf('@', 1) : value.indexOf('@')
  return at === -1 ? value : value.slice(0, at)
}

/**
 * Minimal structured reader for pnpm lockfile v9 covering exactly the sections the
 * repair needs: importers (direct deps incl. workspace `link:` refs) and snapshots
 * (per-package resolved dependencies). Values are plain scalars on fixed indentation
 * levels, so a line scanner is sufficient and dependency-free.
 */
export function parseLockfile(lockText) {
  const importers = []
  const snapshots = []
  const packages = []
  let section = ''
  let importer = null
  let importerSection = ''
  let pendingDep = null
  let snapshot = null
  let snapshotSection = ''
  for (const rawLine of lockText.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue
    const indent = rawLine.length - rawLine.trimStart().length
    const line = rawLine.trim()
    const separator = line.indexOf(': ')
    const hasInlineValue = separator !== -1 && !line.startsWith('- ')
    const key = hasInlineValue ? line.slice(0, separator) : line.endsWith(':') ? line.slice(0, -1) : line
    const value = hasInlineValue ? line.slice(separator + 2) : ''
    if (indent === 0) {
      section = key
      importer = null
      snapshot = null
      importerSection = ''
      snapshotSection = ''
      continue
    }
    if (section === 'importers') {
      if (indent === 2) {
        importer = { dir: unquote(key), dependencies: [] }
        importers.push(importer)
        importerSection = ''
        pendingDep = null
      } else if (indent === 4 && importer) {
        importerSection = importerDepSections.has(key) ? key : ''
        pendingDep = null
      } else if (indent === 6 && importer) {
        if (!importerSection) continue
        if (value) importer.dependencies.push({ name: unquote(key), version: unquote(value), optional: importerSection === 'optionalDependencies' })
        else pendingDep = unquote(key)
      } else if (indent === 8 && importer && pendingDep) {
        if (key === 'version' && value) {
          importer.dependencies.push({ name: pendingDep, version: unquote(value), optional: importerSection === 'optionalDependencies' })
          pendingDep = null
        }
      }
    } else if (section === 'snapshots') {
      if (indent === 2) {
        snapshot = { key: unquote(key), dependencies: [], optionalDependencies: [] }
        snapshots.push(snapshot)
        snapshotSection = ''
      } else if (indent === 4 && snapshot) {
        snapshotSection = snapshotDepSections[key] ?? ''
      } else if (indent === 6 && snapshot && snapshotSection && value) {
        snapshot[snapshotSection].push({ name: unquote(key), version: unquote(value) })
      }
    } else if (section === 'packages' && indent === 2) {
      packages.push(unquote(key))
    }
  }
  return { importers, snapshots, packages }
}

/**
 * Verify and restore the dependency link graph of an installed pnpm workspace.
 *
 * @param {string} projectRoot workspace root containing pnpm-lock.yaml and node_modules
 * @param {{dryRun?: boolean, onEvent?: (event: string, detail: string) => void}} options
 * @returns {Promise<{present: number, repaired: number, optionalMissing: number,
 *   skippedSnapshots: number, unexplainedDirs: number, warnings: string[],
 *   requiredMissing: string[]}>} repair report; throws when required links cannot be restored
 */
export async function repairDependencyLinks(projectRoot, { dryRun = false, onEvent = () => {} } = {}) {
  const report = { present: 0, repaired: 0, optionalMissing: 0, skippedSnapshots: 0, unexplainedDirs: 0, warnings: [], requiredMissing: [] }
  const lockText = await fs.readFile(path.join(projectRoot, 'pnpm-lock.yaml'), 'utf8')
  const { importers, snapshots, packages } = parseLockfile(lockText)
  const modulesYaml = await fs.readFile(path.join(projectRoot, 'node_modules/.modules.yaml'), 'utf8').catch(() => '')
  const maxLength = Number(/virtualStoreDirMaxLength"?\s*[:=]\s*"?(\d+)/.exec(modulesYaml)?.[1] ?? 60)
  const pnpmDir = path.join(projectRoot, 'node_modules/.pnpm')

  /** Absolute target directory of a dependency: alias values carry the real package id. */
  const registryTarget = (name, version) => {
    const depPath = isAliasValue(version) ? version : `${name}@${version}`
    const realName = isAliasValue(version) ? aliasName(version) : name
    return path.join(pnpmDir, depPathToFilename(depPath, maxLength), 'node_modules', realName)
  }

  /**
   * Ensure `linkPath` is a junction to `target`. Existing correct links are kept;
   * real directories are only replaced when empty (broken-install leftovers);
   * missing optional targets are skipped (platform-filtered packages).
   * @returns {'present'|'repaired'|'optionalMissing'|'requiredMissing'}
   */
  async function ensureLink(linkPath, target, optional) {
    const stats = await fs.lstat(linkPath).catch(error => { if (error.code === 'ENOENT') return null; throw error })
    if (stats) {
      if (stats.isSymbolicLink()) {
        const existing = await fs.readlink(linkPath)
        if (path.resolve(path.dirname(linkPath), existing).toLowerCase() === target.toLowerCase()) return 'present'
        report.warnings.push(`existing link points elsewhere: ${linkPath} -> ${existing}`)
        return 'present'
      }
      if (stats.isDirectory() && (await fs.readdir(linkPath)).length === 0) {
        if (!dryRun) { await fs.rmdir(linkPath); await fs.symlink(target, linkPath, 'junction') }
        return 'repaired'
      }
      report.warnings.push(`non-link content occupies link location: ${linkPath}`)
      return 'present'
    }
    if (!(await fs.stat(target).then(stats => stats.isDirectory(), () => false))) {
      if (optional) return 'optionalMissing'
      report.requiredMissing.push(`${linkPath} -> ${target}`)
      return 'requiredMissing'
    }
    if (!dryRun) {
      await fs.mkdir(path.dirname(linkPath), { recursive: true })
      await fs.symlink(target, linkPath, 'junction')
    }
    return 'repaired'
  }

  const count = outcome => { if (outcome !== 'requiredMissing') report[outcome] += 1; return outcome }

  for (const importer of importers) {
    const importerDir = importer.dir === '.' ? projectRoot : path.join(projectRoot, importer.dir)
    if (!(await fs.stat(importerDir).then(stats => stats.isDirectory(), () => false))) {
      report.warnings.push(`importer directory missing: ${importer.dir}`)
      continue
    }
    for (const dep of importer.dependencies) {
      const linkPath = path.join(importerDir, 'node_modules', dep.name)
      const target = dep.version.startsWith('link:') ? path.resolve(importerDir, dep.version.slice('link:'.length)) : registryTarget(dep.name, dep.version)
      if (count(await ensureLink(linkPath, target, dep.optional)) === 'repaired') onEvent('repair', `${importer.dir} :: ${dep.name} -> ${target}`)
    }
  }

  for (const snapshot of snapshots) {
    const ownDir = path.join(pnpmDir, depPathToFilename(snapshot.key, maxLength))
    if (!(await fs.stat(ownDir).then(stats => stats.isDirectory(), () => false))) {
      report.skippedSnapshots += 1
      continue
    }
    for (const dep of snapshot.dependencies) {
      if (dep.version.startsWith('link:')) { report.warnings.push(`workspace link inside snapshot ${snapshot.key}`); continue }
      const target = registryTarget(dep.name, dep.version)
      if (count(await ensureLink(path.join(ownDir, 'node_modules', dep.name), target, false)) === 'repaired') onEvent('repair', `${snapshot.key} :: ${dep.name} -> ${target}`)
    }
    for (const dep of snapshot.optionalDependencies) {
      if (dep.version.startsWith('link:')) continue
      const target = registryTarget(dep.name, dep.version)
      if (count(await ensureLink(path.join(ownDir, 'node_modules', dep.name), target, true)) === 'repaired') onEvent('repair', `${snapshot.key} :: ${dep.name} (optional) -> ${target}`)
    }
  }

  // Self-validation: every on-disk .pnpm directory must be explainable by some lock key.
  // Unexplained names mean the encoder diverged from pnpm and links may target wrong dirs.
  const explained = new Set([...snapshots, ...packages.map(key => ({ key }))].map(entry => depPathToFilename(entry.key, maxLength)))
  for (const entry of await fs.readdir(pnpmDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules' || explained.has(entry.name)) continue
    report.unexplainedDirs += 1
    if (report.warnings.length < 50) report.warnings.push(`unexplained .pnpm entry: ${entry.name}`)
  }

  if (report.requiredMissing.length > 0) {
    const sample = report.requiredMissing.slice(0, 10).join('; ')
    throw new Error(`Link repair found ${report.requiredMissing.length} required dependency targets missing from node_modules (install incomplete): ${sample}`)
  }
  return report
}
