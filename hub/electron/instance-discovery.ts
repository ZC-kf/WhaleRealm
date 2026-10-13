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
 * 全机 DSH 桌面发现与收录（核心使命：自动收集并管理本地所有 DSH 桌面）。
 *
 * 收录方式（多入口）：
 *  1) 全电脑扫描：所有逻辑盘顶层目录 + Program Files(x86) + %LOCALAPPDATA%\Programs + %LOCALAPPDATA% 一层
 *  2) 注册表卸载项：HKCU/HKLM Uninstall 下的 InstallLocation/DisplayIcon
 *  3) 运行中进程：映像路径反推安装目录
 *  4) 手动导入：importByPath() 校验后登记
 *
 * 收录判定是二元的（isolatable）：
 *  可托管 = 认 DSH_DESKTOP_USER_DATA / DSH_DESKTOP_PORT / DSH_HOME，可被 Hub 隔离启动；
 *  不可托管 = 不认隔离接口，只收录不托管（禁止注册为可启动实例，避免争端口/串数据）。
 * 判定依据 manifests/runtime-catalog.json 的声明；未声明的一律按不可托管处理并写明原因（fail-closed）。
 *
 * 本模块为纯函数 + 只读系统查询，不写任何文件、不启动任何进程（除只读 wmic/reg 查询）。
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve as resolvePath, sep } from 'node:path'
import type { InstanceKind } from '../src/types'

export type DiscoverSource = 'drive-top' | 'programs' | 'localappdata' | 'registry' | 'running-process' | 'manual'

/** 发行体类别：desktop = Electron 桌面；web = 原生态 web 版。 */
export type DshFlavor = 'desktop' | 'web' | 'unknown'

export interface DiscoveredInstall {
  path: string
  executable: string
  exeName: string
  version: string | null
  source: DiscoverSource
  running: boolean
  pid: number | null
  isolatable: boolean
  reason: string
  /** 发行体类别：desktop = Electron 桌面；web = 原生态 web 版（打标记，仍可隔离启动）。 */
  flavor: DshFlavor
  /** 是否通过「真实实例 + 可运行」校验（存在 resources 打包结构）。 */
  verified: boolean
  /** 实例类别（官方网页/官方桌面/社区桌面）；无法判定为 null。 */
  instanceKind: InstanceKind | null
}

/** 外部声明（manifests/runtime-catalog.json）中的分级字段；内部映射为二元 isolatable。 */
export interface RuntimeCatalogEntry {
  matchPathPrefix?: string
  matchVersion?: string
  matchExeName?: string
  /** A/B = 可隔离托管；C = 只收录不托管。 */
  tier: 'A' | 'B' | 'C'
  reason: string
}

const EXE_NAMES = ['DeepSeek Harness.exe', 'dsh-desktop.exe']

function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', windowsHide: true, timeout: 20000 })
  } catch {
    return ''
  }
}

export function listDrives(): string[] {
  // wmic 在较新 Windows 11 上已被移除，改用 A-Z 存在性探测（无外部依赖）。
  const drives: string[] = []
  for (let code = 65; code <= 90; code++) {
    const letter = String.fromCharCode(code)
    const root = `${letter}:\\`
    try {
      if (existsSync(root)) drives.push(root)
    } catch { /* ignore */ }
  }
  return drives
}

export function runningDshProcesses(): Array<{ exe: string; pid: number }> {
  // wmic 已移除；改用 Get-CimInstance（只读查询）。
  const cmd = 'powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -match \'DeepSeek|dsh-desktop\' } | ForEach-Object { $_.ExecutablePath + \'|\' + $_.ProcessId }"'
  const out = run(cmd)
  const result: Array<{ exe: string; pid: number }> = []
  for (const line of out.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const idx = trimmed.lastIndexOf('|')
    if (idx <= 0) continue
    const exe = trimmed.slice(0, idx).trim()
    const pid = Number(trimmed.slice(idx + 1).trim())
    if (exe && Number.isFinite(pid) && pid > 0 && /DeepSeek Harness\.exe|dsh-desktop\.exe$/i.test(exe)) result.push({ exe, pid })
  }
  return result
}

export function registryInstallLocations(): string[] {
  const roots = ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall']
  const found: string[] = []
  for (const root of roots) {
    const out = run(`reg query "${root}" /s /v InstallLocation`)
    for (const line of out.split(/\r?\n/)) {
      const m = /InstallLocation\s+REG_SZ\s+(.+)$/.exec(line.trim())
      if (m) {
        const p = m[1].trim().replace(/"$/g, '')
        if (p && /DeepSeek|dsh/i.test(p)) found.push(p)
      }
    }
  }
  return found
}

export function candidateDirs(): Array<{ dir: string; source: DiscoverSource }> {
  const out: Array<{ dir: string; source: DiscoverSource }> = []
  const push = (dir: string, source: DiscoverSource) => { if (dir && !out.some(x => x.dir === dir)) out.push({ dir, source }) }
  for (const drive of listDrives()) {
    try {
      for (const entry of readdirSync(drive)) {
        const full = join(drive, entry)
        try { if (statSync(full).isDirectory()) push(full, 'drive-top') } catch { /* ignore */ }
      }
    } catch { /* drive not readable */ }
  }
  const fixed = [
    join(process.env.ProgramFiles || 'C:\\Program Files', ''),
    join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', ''),
    join(process.env.LOCALAPPDATA || '', 'Programs'),
    process.env.LOCALAPPDATA || '',
  ]
  for (const base of fixed) {
    if (!base) continue
    try {
      for (const entry of readdirSync(base)) {
        const full = join(base, entry)
        try { if (statSync(full).isDirectory()) push(full, base.endsWith('Programs') ? 'programs' : 'localappdata') } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }
  for (const p of registryInstallLocations()) push(p.replace(/\\+$/g, ''), 'registry')
  return out
}

export function findExecutable(dir: string): { exe: string; name: string } | null {
  for (const name of EXE_NAMES) {
    const direct = join(dir, name)
    if (existsSync(direct)) return { exe: direct, name }
  }
  return null
}

export function readVersion(dir: string): string | null {
  const candidates = [join(dir, 'resources', 'app', 'package.json'), join(dir, 'resources', 'app.asar.unpacked', 'package.json'), join(dir, 'package.json')]
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { version?: string }
      if (parsed && typeof parsed.version === 'string') return parsed.version
    } catch { /* ignore */ }
  }
  return null
}

/** 读发行体 package.json 的 name（尽量从解包目录读，app.asar 内的 package.json 读不到时回落）。 */
function readPackageName(dir: string): string {
  const candidates = [join(dir, 'resources', 'app', 'package.json'), join(dir, 'resources', 'app.asar.unpacked', 'package.json'), join(dir, 'package.json')]
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { name?: unknown; productName?: unknown }
      const parts = [parsed?.name, parsed?.productName].filter((value): value is string => typeof value === 'string' && value.length > 0)
      if (parts.length > 0) return parts.join(' ').toLowerCase()
    } catch { /* ignore */ }
  }
  return ''
}

/** 类别判定：desktop = Electron 桌面 shell；web = 原生态 web 版；unknown = 无法判定。 */
export function flavorFor(dir: string, exeName: string): DshFlavor {
  const name = readPackageName(dir)
  if (name) {
    if (name.includes('desktop') || name.includes('electron')) return 'desktop'
    if (name.includes('web')) return 'web'
    if (/deepseek[- ]harness/.test(name)) return 'web'
  }
  return exeName.toLowerCase() === 'dsh-desktop.exe' ? 'desktop' : 'desktop'
}

/** 「真实实例 + 可运行」校验：存在 resources 打包结构（app 目录或 app.asar）。 */
export function verifyInstall(dir: string): boolean {
  return existsSync(join(dir, 'resources', 'app')) || existsSync(join(dir, 'resources', 'app.asar'))
}

export function loadCatalog(catalogPath: string): RuntimeCatalogEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(catalogPath, 'utf8')) as { entries?: RuntimeCatalogEntry[] }
    const entries = Array.isArray(parsed.entries) ? parsed.entries : []
    // 机器无关占位符：公开仓库不得含构建机绝对路径，故目录表用 `<hubRuntimes>` 表示
    // 「本机 Hub 自带运行体根」。catalogPath = <hubRoot>/manifests/runtime-catalog.json，
    // 因此 hub 运行时根 = <hubRoot>/runtimes；加载时按本机实际位置展开，语义等价于原绝对前缀匹配。
    const hubRuntimes = resolvePath(dirname(catalogPath), '..', 'runtimes')
    for (const entry of entries) {
      if (entry && typeof entry.matchPathPrefix === 'string' && entry.matchPathPrefix.includes('<hubRuntimes>')) {
        entry.matchPathPrefix = entry.matchPathPrefix.split('<hubRuntimes>').join(hubRuntimes)
      }
    }
    return entries
  } catch {
    return []
  }
}

/** 二元判定：目录是否可被 Hub 隔离托管。 */
export function isolatableFor(install: { path: string; exeName: string; version: string | null }, catalog: RuntimeCatalogEntry[]): { isolatable: boolean; reason: string } {
  for (const entry of catalog) {
    const okPath = !entry.matchPathPrefix || install.path.toLowerCase().startsWith(entry.matchPathPrefix.toLowerCase())
    const okVersion = !entry.matchVersion || install.version === entry.matchVersion
    const okExe = !entry.matchExeName || install.exeName === entry.matchExeName
    if (okPath && okVersion && okExe) return { isolatable: entry.tier !== 'C', reason: entry.reason }
  }
  return { isolatable: false, reason: '未在 manifests/runtime-catalog.json 声明隔离能力，只收录不托管（fail-closed）' }
}

export interface ScanOptions {
  catalogPath: string
  /** Hub 自身运行体目录（其子目录为各版本运行体，深度超过盘顶层扫描范围）。 */
  hubRuntimesRoot?: string
  /** 需要跳过的运行体目录（移除注册后可选跳过扫描）；手动导入不受影响。 */
  skipPaths?: string[]
}

export function scanMachine(opts: ScanOptions): DiscoveredInstall[] {
  const catalog = loadCatalog(opts.catalogPath)
  const running = runningDshProcesses()
  const seen = new Map<string, DiscoveredInstall>()

  const consider = (dir: string, source: DiscoverSource) => {
    const normalized = resolvePath(dir).toLowerCase()
    const skipped = (opts.skipPaths ?? []).some(p => {
      const prefix = resolvePath(p).toLowerCase()
      return normalized === prefix || normalized.startsWith(prefix + sep)
    })
    if (skipped) return
    const foundExe = findExecutable(dir)
    if (!foundExe) return
    const key = foundExe.exe.toLowerCase()
    if (seen.has(key)) {
      const existing = seen.get(key) as DiscoveredInstall
      if (!existing.running) {
        const run = running.find(r => r.exe.toLowerCase() === key)
        if (run) { existing.running = true; existing.pid = run.pid }
      }
      return
    }
    const version = readVersion(dir)
    const graded = isolatableFor({ path: dir, exeName: foundExe.name, version }, catalog)
    const run = running.find(r => r.exe.toLowerCase() === key)
    const flavor = flavorFor(dir, foundExe.name)
    seen.set(key, {
      path: dir,
      executable: foundExe.exe,
      exeName: foundExe.name,
      version,
      source,
      running: Boolean(run),
      pid: run ? run.pid : null,
      isolatable: graded.isolatable,
      reason: graded.reason,
      flavor,
      verified: verifyInstall(dir),
      instanceKind: detectInstanceKind({ exeName: foundExe.name, packageName: readPackageName(dir), flavor }),
    })
  }

  for (const candidate of candidateDirs()) consider(candidate.dir, candidate.source)
  if (opts.hubRuntimesRoot) {
    try {
      for (const entry of readdirSync(opts.hubRuntimesRoot)) {
        const full = join(opts.hubRuntimesRoot, entry)
        try { if (statSync(full).isDirectory()) consider(full, 'drive-top') } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }
  for (const run of running) {
    const dir = resolvePath(run.exe, '..')
    consider(dir, 'running-process')
    const existing = seen.get(run.exe.toLowerCase())
    if (existing) { existing.running = true; existing.pid = run.pid }
  }
  return Array.from(seen.values()).sort((a, b) => a.path.localeCompare(b.path))
}

/** 手动导入：校验路径下确有 DSH 桌面可执行文件，返回发现结果（不写任何状态）。 */
export function importByPath(rawPath: string, opts: ScanOptions): DiscoveredInstall {
  const dir = resolvePath(rawPath)
  const foundExe = findExecutable(dir)
  if (!foundExe) {
    throw new Error(`该目录下没有 DSH 桌面可执行文件（期望 ${EXE_NAMES.join(' 或 ')}）：${dir}`)
  }
  const catalog = loadCatalog(opts.catalogPath)
  const version = readVersion(dir)
  const graded = isolatableFor({ path: dir, exeName: foundExe.name, version }, catalog)
  const run = runningDshProcesses().find(r => r.exe.toLowerCase() === foundExe.exe.toLowerCase())
  const flavor = flavorFor(dir, foundExe.name)
  return {
    path: dir,
    executable: foundExe.exe,
    exeName: foundExe.name,
    version,
    source: 'manual',
    running: Boolean(run),
    pid: run ? run.pid : null,
    isolatable: graded.isolatable,
    reason: graded.reason,
    flavor,
    verified: verifyInstall(dir),
    instanceKind: detectInstanceKind({ exeName: foundExe.name, packageName: readPackageName(dir), flavor }),
  }
}

/**
 * 实例类别判定（纯函数）：依据可执行文件名 + 包名 + 形态组合。
 * 规则：
 *  - 包名含 deepseek 且含 harness（官方命名）：
 *      含 desktop/electron → official-desktop；否则 → official-web（官方核心/网页形态）。
 *  - 包名含 web → official-web。
 *  - 其他桌面外壳（dsh-desktop.exe 或含 desktop 的包名）→ community-desktop。
 *  - 仅可执行文件且无法判读包名时：
 *      DeepSeek Harness.exe → 按 flavor（web→官方网页，否则官方桌面）；
 *      dsh-desktop.exe → community-desktop。
 * 局限：官方桌面版与社区桌面包装器在包名上可能同名，此规则按「官方 exe 名」区分；
 * 新建实例流程由下载来源精确写入类别，不走本地猜测。
 */
export function detectInstanceKind(input: { exeName: string; packageName: string; flavor: DshFlavor }): InstanceKind | null {
  const name = input.packageName.toLowerCase()
  const exe = input.exeName.toLowerCase()
  if (name) {
    const official = name.includes('@deepseek-ai') || (name.includes('deepseek') && name.includes('harness'))
    if (name.includes('desktop') || name.includes('electron')) return official ? 'official-desktop' : 'community-desktop'
    if (name.includes('web')) return 'official-web'
    if (official) return 'official-web'
    return 'community-desktop'
  }
  if (exe === 'dsh-desktop.exe') return 'community-desktop'
  if (exe === 'deepseek harness.exe') return input.flavor === 'web' ? 'official-web' : 'official-desktop'
  return null
}

/** 从目录现场判定实例类别（读包名 + 可执行文件名），供老实例补种。 */
export function detectKindFromDir(dir: string): InstanceKind | null {
  if (!dir) return null
  const foundExe = findExecutable(dir)
  const packageName = readPackageName(dir)
  if (!foundExe && !packageName) return null
  const flavor = flavorFor(dir, foundExe?.name ?? '')
  return detectInstanceKind({ exeName: foundExe?.name ?? '', packageName, flavor })
}
