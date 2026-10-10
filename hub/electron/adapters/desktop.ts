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
import { copyFile, cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createHash, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { stringify } from 'yaml'
import type { InstanceLayout, RuntimeAdapter, RuntimeAsset, RuntimeHandle } from '../runtime-adapter'
import { resolveDesktopAsset, stableStringify, type CertifiedDesktopAsset } from '../desktop-assets'
import { prepareWebLayout } from './official-web'
import { buildWebEnvironment } from '../instance-env'
import { resolveManagedLayout } from '../instance-paths'
import { spawnOwnedProcess, bounded, ProcessCleanupError } from '../process-supervisor'
import { runOwnedCommand } from '../process'
import { verifyRuntimeIntegrity } from '../runtime-assets'

export interface DesktopAdapterDeps { download(url: string, destination: string, signal: AbortSignal): Promise<void>; onOutput?: (text: string) => void }
interface Receipt { kind: string; version: string; sourceRef: string; patchSha256: string; executable: string; files: Array<{ path: string; size: number; sha256: string }> }
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
function safePath(root: string, relative: string): string {
  if (!relative || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..' || /[<>:"|?*\x00-\x1f]|[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('Unsafe Desktop resource path')
  const target = path.resolve(root, relative)
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('Desktop resource escapes ownership')
  return target
}
async function verifyTree(layout: InstanceLayout, asset: CertifiedDesktopAsset, signal: AbortSignal): Promise<void> {
  const receiptFile = path.join(layout.runtimeRoot, 'runtime-receipt.json')
  if (!(await lstat(receiptFile)).isFile() || (await lstat(receiptFile)).isSymbolicLink()) throw new Error('Runtime receipt is not a regular owned file')
  const bytes = await readFile(receiptFile)
  if (sha(bytes) !== asset.receiptSha256) throw new Error('Desktop receipt digest mismatch')
  const receipt = JSON.parse(bytes.toString()) as Receipt
  if (receipt.kind !== asset.kind || receipt.version !== asset.version || receipt.sourceRef !== asset.sourceRef || receipt.patchSha256 !== asset.patchSha256 || receipt.executable !== asset.executable || !Array.isArray(receipt.files)) throw new Error('Desktop source/patch identity mismatch')
  const expected = new Set(['runtime-receipt.json'])
  for (const file of receipt.files) {
    signal.throwIfAborted()
    const target = safePath(layout.runtimeRoot, file.path), key = file.path.toLowerCase()
    if (expected.has(key)) throw new Error('Duplicate Desktop resource receipt')
    expected.add(key)
    const info = await lstat(target)
    if (!info.isFile() || info.isSymbolicLink() || info.size !== file.size || sha(await readFile(target)) !== file.sha256) throw new Error(`Desktop resource integrity failed: ${file.path}`)
  }
  async function walk(directory: string): Promise<void> {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, item.name)
      if (item.isSymbolicLink()) throw new Error('Linked Desktop resource denied')
      if (item.isDirectory()) await walk(target)
      else if (!item.isFile() || !expected.delete(path.relative(layout.runtimeRoot, target).replaceAll('\\', '/').toLowerCase())) throw new Error('Unreceipted Desktop resource denied')
    }
  }
  await walk(layout.runtimeRoot)
  if (expected.size) throw new Error('Missing Desktop resources')
}
// .NET supports ZIP64. Validate the entire directory first, then exclusively create regular files.
// Exported for the anti-regression test (hub/tests/desktop-extract-script.test.ts): the TS template
// literal must evaluate to a .ps1 whose .NET regex contains a *literal* `\.` (single-backslash-dot
// placed before the dot would be an invalid TS escape and be silently stripped to a bare `.`).
export const extractScript = `param([string]$Archive,[string]$Destination)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[IO.Compression.ZipFile]::OpenRead($Archive)
try {
 $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
 [long]$expanded=0
 foreach($entry in $zip.Entries) {
  $name=$entry.FullName
  if (!$name -or $name.Contains('\\') -or $name.StartsWith('/') -or (($entry.ExternalAttributes -shr 16) -band 61440) -eq 40960) {throw 'Unsafe ZIP entry'}
  foreach($part in $name.TrimEnd('/').Split('/')) {if (!$part -or $part -eq '.' -or $part -eq '..' -or $part -match '[<>:"|?*\\x00-\\x1f]|[. ]$|^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\\.|$)') {throw 'Unsafe ZIP path'}}
  if (!$seen.Add($name.TrimEnd('/'))) {throw 'Duplicate ZIP path'}
  $expanded += $entry.Length
  if ($expanded -gt 17179869184 -or $zip.Entries.Count -gt 300000) {throw 'ZIP resource limit'}
 }
 foreach($entry in $zip.Entries) {
  $target=[IO.Path]::GetFullPath([IO.Path]::Combine($Destination,$entry.FullName))
  if (!$target.StartsWith([IO.Path]::GetFullPath($Destination)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) {throw 'ZIP escapes root'}
  if ($entry.FullName.EndsWith('/')) {[IO.Directory]::CreateDirectory($target)|Out-Null;continue}
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))|Out-Null
  $inputStream=$entry.Open(); $outputStream=[IO.File]::Open($target,[IO.FileMode]::CreateNew)
  try {$inputStream.CopyTo($outputStream)} finally {$outputStream.Dispose();$inputStream.Dispose()}
 }
} finally {$zip.Dispose()}
`
// Focus an existing window owned by the managed process itself. No browser page,
// URL or external application is ever opened; failure to find a visible window is an error.
const focusScript = `param([int]$ProcessId)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WhaleRealmFocus {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@
$target=[uint32]$ProcessId
$matched=$false
$callback=[WhaleRealmFocus+EnumWindowsProc]{
  param($window,$state)
  $owner=[uint32]0
  if([WhaleRealmFocus]::GetWindowThreadProcessId($window,[ref]$owner) -and $owner -eq $target -and [WhaleRealmFocus]::IsWindowVisible($window)){
    if([WhaleRealmFocus]::IsIconic($window)){[void][WhaleRealmFocus]::ShowWindow($window,9)}
    [void][WhaleRealmFocus]::ShowWindow($window,5)
    [void][WhaleRealmFocus]::SetForegroundWindow($window)
    $script:matched=$true
  }
  return $true
}
[void][WhaleRealmFocus]::EnumWindows($callback,[IntPtr]::Zero)
if(-not $matched){throw "No visible window owned by process $ProcessId"}
`
/** Bring an already-running managed Desktop window back to the foreground (Windows only). */
async function focusOwnedWindows(layout: InstanceLayout, pid: number, signal: AbortSignal): Promise<void> {
  const script = path.join(layout.cache, 'focus-desktop-window.ps1')
  try { if ((await lstat(script)).isSymbolicLink()) throw new Error('Linked focus script denied') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  await writeFile(script, '\ufeff' + focusScript)
  await runOwnedCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-ProcessId', String(pid)], 15_000, { env: buildWebEnvironment(layout, process.env), signal })
}
async function prepare(layout: InstanceLayout): Promise<void> {
  await prepareWebLayout(layout)
  const overlay = path.join(layout.dshHome, 'managed-desktop.patch.yml')
  try { if ((await lstat(overlay)).isSymbolicLink()) throw new Error('Linked managed Desktop policy') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  await writeFile(overlay, '# WhaleRealm managed Desktop policy v1\n' + stringify([{ id: 'workspace-controller', config: { documentsDirectory: path.join(layout.workspace, 'documents'), documentsLookupTimeoutMs: 10000 } }]))
}
/**
 * Chromium accommodations for the local acceptance harness.
 *
 * The managed Desktop is a Chromium application; on some GPU-less/isolated hosts the GPU
 * child crashes (0xC0000005 / EXCEPTION_BREAKPOINT) and the app dies before it can satisfy
 * the readiness contract, so the acceptance harness may opt in to a small, strictly
 * allowlisted set of Chromium flags. Trust boundary:
 *   - honored only while the acceptance channel is active (WR_ACCEPTANCE_CANDIDATE set);
 *   - space-separated tokens, each required to be on the allowlist; anything else throws;
 *   - renderer and instance processes cannot set these env vars, and a production launch
 *     (no WR_ACCEPTANCE_CANDIDATE) always receives an empty argument list.
 */
export const ACCEPTANCE_CHROMIUM_FLAGS = ['--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', '--disable-gpu-sandbox'] as const
export function acceptanceChromiumFlags(env: NodeJS.ProcessEnv = process.env): string[] {
  if (!env.WR_ACCEPTANCE_CANDIDATE) return []
  const tokens = (env.WR_ACCEPTANCE_CHROMIUM_FLAGS ?? '').trim().split(/\s+/).filter(Boolean)
  const rejected = tokens.filter(token => !ACCEPTANCE_CHROMIUM_FLAGS.includes(token as typeof ACCEPTANCE_CHROMIUM_FLAGS[number]))
  if (rejected.length) throw new Error(`非法验收 Chromium 参数：${rejected.join('、')}；仅允许：${ACCEPTANCE_CHROMIUM_FLAGS.join(' ')}`)
  return [...new Set(tokens)]
}
export function createDesktopAdapter(kind: CertifiedDesktopAsset['kind'], deps: DesktopAdapterDeps): RuntimeAdapter {
  async function start(layout: InstanceLayout, asset: CertifiedDesktopAsset, id: string, port: number, signal: AbortSignal): Promise<RuntimeHandle> {
    await prepare(layout); await verifyTree(layout, asset, signal)
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 3080) throw new Error('Invalid reserved Desktop port')
    let instanceCore: string | undefined
    if (kind === 'community-desktop') {
      const core = path.join(layout.cache, 'app-data/core')
      try { const info = await lstat(core); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid private community core') } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        await cp(path.join(layout.runtimeRoot, 'resources/dsh'), core, { recursive: true, errorOnExist: true, force: false })
      }
      // The upstream patch resolves the bundled dsh core to this instance-private
      // writable copy so receipted read-only resources are never mutated at runtime.
      instanceCore = core
    }
    const nonce = randomBytes(32).toString('hex'), readyFile = path.join(layout.logs, `ready-${nonce}.json`)
    const env: NodeJS.ProcessEnv = { ...buildWebEnvironment(layout, process.env), WR_INSTANCE_ID: id, WR_INSTANCE_ROOT: layout.root, WR_INSTANCE_PORT: String(port), WR_LAUNCH_NONCE: nonce, DSH_DESKTOP_USER_DATA: layout.electronUserData }
    if (instanceCore) env.WR_INSTANCE_CORE = instanceCore
    const child = await spawnOwnedProcess(path.join(layout.runtimeRoot, asset.executable), acceptanceChromiumFlags(), { cwd: layout.workspace, env, signal, windowsHide: false, onOutput: deps.onOutput })
    let exited = false
    void child.exited.then(() => { exited = true }, () => { exited = true })
    const ready = bounded((async () => {
      // bounded() only rejects the outer promise; the loop needs its own deadline,
      // otherwise it keeps polling every 200ms after the caller already timed out.
      const deadline = Date.now() + 180_000
      for (;;) {
        signal.throwIfAborted(); if (exited) throw new Error('Desktop exited before readiness')
        if (Date.now() >= deadline) throw new Error('Desktop readiness timed out')
        try {
          const fact = JSON.parse(await readFile(readyFile, 'utf8')) as { id: string; nonce: string; port: number; url: string }
          if (fact.id !== id || fact.nonce !== nonce || fact.port !== port || new URL(fact.url).origin !== `http://127.0.0.1:${port}`) throw new Error('Desktop readiness identity mismatch')
          return fact.url
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
        await new Promise(resolve => setTimeout(resolve, 200))
      }
    })(), 180_000, 'Desktop readiness')
    void ready.catch(() => {})
    return {
      ...child, url: `http://127.0.0.1:${port}`, ready,
      async open() {
        // Reopen = focus a window this owned process already created; nothing else opens.
        if (exited || signal.aborted) throw new Error('Desktop is not running')
        await focusOwnedWindows(layout, child.pid, signal)
      },
    }
  }
  return { id: `${kind}-v1`, kind,
    async deploy(input: RuntimeAsset, layout, signal) {
      const asset = resolveDesktopAsset(kind, input.version)
      // Key-order-independent identity check: the asset came from the trusted
      // resolver, so the caller merely has to hand back the same asset (field order
      // in JSON is irrelevant).
      if (stableStringify(input) !== stableStringify(asset)) throw new Error('Desktop asset is not from the trusted catalog')
      await prepare(layout); await mkdir(layout.runtimeRoot, { recursive: true })
      if ((await readdir(layout.runtimeRoot)).length) throw new Error('Desktop deployment requires an empty owned runtime')
      const archive = path.join(layout.cache, 'desktop.zip'), script = path.join(layout.cache, 'extract-desktop.ps1')
      if (new URL(asset.url).protocol === 'file:') await copyFile(fileURLToPath(asset.url), archive)
      else await deps.download(asset.url, archive, signal)
      verifyRuntimeIntegrity(await readFile(archive), asset)
      await writeFile(script, '\ufeff' + extractScript, { flag: 'wx' })
      await runOwnedCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Archive', archive, '-Destination', layout.runtimeRoot], 600_000, { env: buildWebEnvironment(layout, process.env), signal })
      await verifyTree(layout, asset, signal); await rm(archive); await rm(script)
    },
    async selfcheck(layout, port, signal) {
      const receipt = JSON.parse(await readFile(path.join(layout.runtimeRoot, 'runtime-receipt.json'), 'utf8')) as Receipt
      const child = await start(layout, resolveDesktopAsset(kind, receipt.version), 'selfcheck', port, signal)
      try { await child.ready } finally { try { await child.stop(); await child.exited } catch (error) { throw new ProcessCleanupError(`Desktop selfcheck cleanup unconfirmed: ${String(error)}`) } }
    },
    async launch(record, signal) {
      if (record.layoutVersion !== 2 || record.adapterId !== `${kind}-v1` || record.instanceKind !== kind) throw new Error('Legacy Desktop cannot be certified; paths and data preserved. Create a managed deployment explicitly.')
      const layout = resolveManagedLayout(record.root)
      for (const name of ['runtimeRoot', 'dshHome', 'electronUserData', 'workspace', 'logs', 'cache'] as const) if (record[name] !== layout[name]) throw new Error('Desktop record layout mismatch')
      return start(layout, resolveDesktopAsset(kind, record.version ?? ''), record.id, record.port, signal)
    },
  }
}
