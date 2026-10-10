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
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { parseArgs } from 'node:util'
import { repairDependencyLinks } from './lib/repair-pnpm-links.mjs'

// Builds only owned source copies. No installer, application launch or certification occurs here.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({ options: { kind: { type: 'string' }, source: { type: 'string' }, output: { type: 'string' }, inputs: { type: 'string' }, phase: { type: 'string', default: 'all' } } })
const pins = {
  'official-desktop': { version: '0.1.7-alpha.1', sourceRef: 'c36a83ff6bb95e3f82cf79f9be7c724270a8aa61', lock: '623fda2414acb26aeb4d38a3a7b89f83df7aefd23884605131b0270fa961a52a', short: 'official', executable: 'WhaleRealm Official.exe' },
  'community-desktop': { version: '0.21.0', sourceRef: 'aff39a991fda3558c5459b54fb3fa1c6984d3227', lock: '4d1c9ab2287872b77db603ef9585744cd9174cd50b60bddc863358aa78c5445e', short: 'community', executable: 'deepseek-harness-desktop.exe' },
}
const pin = pins[values.kind]
if (!pin || !values.source || !values.output || !['all', 'install', 'build', 'package'].includes(values.phase)) throw new Error('Usage: --kind official-desktop|community-desktop --source <owned copy> --output <owned output> [--inputs <prepared inputs>] [--phase all|install|build|package]')
const source = path.resolve(values.source), output = path.resolve(values.output), inputs = path.resolve(values.inputs ?? path.join(repo, 'imports/isolation-build'))
const inside = (root, target) => { const rel = path.relative(root, target); return !!rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel) }
if (!inside(inputs, source) || !inside(inputs, output) || /pristine/i.test(source) || source === output || inside(source, output) || inside(output, source)) throw new Error('Source/output must be disjoint owned copies under inputs, never pristine')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
if (sha(await fs.readFile(path.join(source, 'pnpm-lock.yaml'))) !== pin.lock) throw new Error('Pinned source lock mismatch')
const patchRoot = path.join(repo, 'runtime-sources', values.kind, 'patches')
const patchBytes = await fs.readFile(path.join(patchRoot, 'files.json'))
const patches = JSON.parse(patchBytes)
for (const entry of patches) {
  const target = path.resolve(source, entry.path)
  if (!inside(source, target) || sha(Buffer.from(entry.content)) !== entry.afterSha256) throw new Error('Invalid source patch receipt')
  let current
  try { current = sha(await fs.readFile(target)) } catch (error) { if (error.code !== 'ENOENT') throw error; current = null }
  if (current !== entry.beforeSha256 && current !== entry.afterSha256) throw new Error(`Unexpected source contents: ${entry.path}`)
  if (current !== entry.afterSha256) { await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, entry.content) }
}
await fs.mkdir(output, { recursive: true })
const owner = path.join(output, 'build-owner.json')
const identity = { kind: values.kind, source, sourceRef: pin.sourceRef, patchSha256: sha(patchBytes) }
try { const old = JSON.parse(await fs.readFile(owner)); if (JSON.stringify(old) !== JSON.stringify(identity)) throw new Error('Output belongs to a different build') } catch (error) { if (error.code !== 'ENOENT') throw error; await fs.writeFile(owner, JSON.stringify(identity), { flag: 'wx' }) }
const state = path.join(output, 'state')
for (const dir of ['home', 'app-data', 'local-app-data', 'cache', 'config', 'temp', 'cargo-target']) await fs.mkdir(path.join(state, dir), { recursive: true })
const node = path.join(inputs, 'payloads/extracted/node/node-v22.22.0-win-x64/node.exe')
const pnpm = path.join(inputs, 'payloads/extracted/pnpm/package/bin/pnpm.cjs')
const store = path.join(inputs, `pnpm-preparation/${pin.short}-state/store`)
const cache = path.join(inputs, `pnpm-preparation/${pin.short}-state/cache`)
// One offline configuration for every nested pnpm boundary: this userconfig is inherited
// through NPM_CONFIG_USERCONFIG by all child pnpm processes (`run` automatic dependency
// verification, community `deploy`, installs nested by pnpm itself), and the wrapper below
// repeats it as explicit command-line flags. Environment variables stay as a second layer.
// Forward slashes keep the ini parser from interpreting backslashes; pnpm 11.7 reads these
// exact kebab-case keys (verify-deps-before-run defaults to "install" when absent).
const npmrc = `offline=true\nstore-dir=${store.replaceAll('\\', '/')}\ncache-dir=${cache.replaceAll('\\', '/')}\nverify-deps-before-run=false\n`
await fs.writeFile(path.join(state, 'npmrc'), npmrc)
// The pnpm keys above are not valid git configuration; git keeps a separate neutral file.
await fs.writeFile(path.join(state, 'gitconfig'), '')
await fs.mkdir(path.join(state, 'bin'), { recursive: true })
const offlineFlags = ['--config.offline=true', `--config.store-dir=${store}`, `--config.cache-dir=${cache}`, '--config.verify-deps-before-run=false'].map(flag => `"${flag}"`).join(' ')
await fs.writeFile(path.join(state, 'bin/pnpm.cmd'), `@echo off\r\n"${node}" "${pnpm}" ${offlineFlags} %*\r\n`)
const rust = path.join(inputs, 'toolchains/rust-1.99.0-x86_64-pc-windows-msvc')
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SystemRoot|WINDIR|ComSpec|PATHEXT|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i.test(key)))
Object.assign(env, {
  PATH: [path.dirname(node), path.join(state, 'bin'), path.join(source, 'node_modules/.bin'), path.join(rust, 'bin'), path.join(process.env.SystemRoot, 'System32'), path.join(process.env.SystemRoot, 'System32\\WindowsPowerShell\\v1.0'), process.env.SystemRoot, 'C:\\Program Files\\Git\\cmd'].join(path.delimiter),
  HOME: path.join(state, 'home'), USERPROFILE: path.join(state, 'home'), APPDATA: path.join(state, 'app-data'), LOCALAPPDATA: path.join(state, 'local-app-data'),
  TEMP: path.join(state, 'temp'), TMP: path.join(state, 'temp'), CI: 'true', GIT_CEILING_DIRECTORIES: inputs, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(state, 'gitconfig'), GIT_TERMINAL_PROMPT: '0',
  NPM_CONFIG_USERCONFIG: path.join(state, 'npmrc'), NPM_CONFIG_CACHE: path.join(state, 'cache'), NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false', NPM_CONFIG_STORE_DIR: store, XDG_CACHE_HOME: path.join(state, 'cache'), XDG_CONFIG_HOME: path.join(state, 'config'), XDG_STATE_HOME: state,
  ELECTRON_SKIP_BINARY_DOWNLOAD: '1', COREPACK_ENABLE_NETWORK: '0', COREPACK_ENABLE_AUTO_PIN: '0', WR_PNPM_STORE: store, WR_PNPM_CACHE: cache,
  pnpm_config_verify_deps_before_run: 'false', npm_config_offline: 'true',
  // Upstream client-build-environment.ts reads this before falling back to `git rev-parse HEAD`;
  // the isolated source copy is deliberately not a Git repository (GIT_CEILING_DIRECTORIES stops
  // discovery), so the pinned upstream commit must be supplied explicitly.
  DSH_CLIENT_COMMIT_HASH: pin.sourceRef,
  CARGO_HOME: path.join(inputs, 'cargo-preparation/cargo-home'), CARGO_TARGET_DIR: path.join(state, 'cargo-target'), CARGO_NET_OFFLINE: 'true', RUSTC: path.join(rust, 'bin/rustc.exe'), RUSTDOC: path.join(rust, 'bin/rustdoc.exe'),
  DSH_DESKTOP_TARGET_PLATFORM: 'win32', DSH_DESKTOP_TARGET_ARCH: 'x64', DSH_DESKTOP_BUILD_COMMIT: pin.sourceRef, DSH_DESKTOP_BUILD_DIRTY: '1',
  WR_ELECTRON_ARCHIVE: path.join(inputs, 'electron-44-payload/electron-v44.0.0-win32-x64.zip'),
})
// Official native build toolchain: koffi compiles from source via CMake+Ninja exactly like
// upstream CI (its tarball ships no prebuilt binaries). cnoke never passes -G on win32, so
// the Ninja generator is forced through CMAKE_GENERATOR and cl.exe is resolved from PATH
// with explicit LIB/INCLUDE — VS instance discovery is sandbox-blocked, the same reason
// compile-community.cmd sets both explicitly after its VsDevCmd call.
if (pin.short === 'official') {
  const nativeMsvc = 'C:\\BuildTools\\VC\\Tools\\MSVC\\14.44.35207'
  const nativeKits = 'C:\\Program Files (x86)\\Windows Kits\\10'
  const nativeSdk = '10.0.26100.0'
  const nativeCmake = 'C:\\BuildTools\\Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin'
  const nativeNinja = 'C:\\BuildTools\\Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\Ninja'
  const nativeLib = [`${nativeMsvc}\\lib\\x64`, `${nativeKits}\\Lib\\${nativeSdk}\\ucrt\\x64`, `${nativeKits}\\Lib\\${nativeSdk}\\um\\x64`].join(';')
  const nativeInclude = [`${nativeMsvc}\\include`, ...['ucrt', 'um', 'shared', 'winrt', 'cppwinrt'].map(part => `${nativeKits}\\Include\\${nativeSdk}\\${part}`)].join(';')
  for (const dir of [...nativeLib.split(';'), ...nativeInclude.split(';'), nativeCmake, nativeNinja, `${nativeMsvc}\\bin\\Hostx64\\x64`, `${nativeKits}\\bin\\${nativeSdk}\\x64`]) { try { await fs.access(dir) } catch { throw new Error(`Native toolchain path missing: ${dir}`) } }
  env.PATH = [nativeCmake, nativeNinja, `${nativeMsvc}\\bin\\Hostx64\\x64`, `${nativeKits}\\bin\\${nativeSdk}\\x64`, env.PATH].join(path.delimiter)
  Object.assign(env, { CMAKE_GENERATOR: 'Ninja', LIB: nativeLib, INCLUDE: nativeInclude })
}
const log = await fs.open(path.join(output, `build-${Date.now()}.log`), 'a')
async function run(executable, args, cwd = source) {
  console.log('Build:', args.join(' '))
  await log.appendFile(JSON.stringify({ executable, args, cwd }) + '\n')
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { process.stdout.write(bytes); void log.appendFile(bytes) })
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Build exited ${code}: ${args.join(' ')}`)))
  })
}
const pm = (...args) => run(node, [pnpm, ...args])
if (['all', 'install'].includes(values.phase)) {
  await pm('install', '--offline', '--frozen-lockfile', '--trust-lockfile', '--ignore-scripts', '--ignore-pnpmfile', '--pm-on-fail=error', '--config.runtime-on-fail=error', `--store-dir=${store}`, `--cache-dir=${path.join(inputs, `pnpm-preparation/${pin.short}-state/cache`)}`, '--reporter=append-only')
  // This sandbox silently turns directory symlink creation (fs.symlink with type 'dir',
  // which pnpm's isolated linker uses for every dependency link) into empty real
  // directories: the call reports success but no reparse point appears, so imports fail
  // with ERR_MODULE_NOT_FOUND (e.g. tsx -> esbuild). Junctions are still honored, so
  // re-derive the complete link graph from the pinned lockfile (never modified) and
  // restore every missing dependency link as an absolute junction. Throws loudly when a
  // required target is absent, i.e. when the install itself was incomplete.
  const linkReport = await repairDependencyLinks(source)
  await log.appendFile('link-repair ' + JSON.stringify(linkReport) + '\n')
  console.log('Link repair:', JSON.stringify(linkReport))
}
if (['all', 'build'].includes(values.phase)) {
  if (pin.short === 'official') { await pm('run', 'build:official'); await pm('run', 'build:desktop') }
  else {
    await pm('run', 'build')
    const command = path.join(output, 'compile-community.cmd')
    const q = value => '"' + value.replaceAll('"', '') + '"'
    // VsDevCmd locates the Windows SDK by querying the registry with reg.exe, which the
    // build sandbox blocks; when that fails it leaves LIB/INCLUDE unset and every link
    // fails with LNK1181 (kernel32.lib not found). Set both explicitly to the verified
    // on-disk toolchain paths after the VsDevCmd call (it may clear them when the SDK
    // probe fails) so link.exe still resolves kernel32.lib/ucrt.lib directly.
    const msvc = 'C:\\BuildTools\\VC\\Tools\\MSVC\\14.44.35207'
    const kits = 'C:\\Program Files (x86)\\Windows Kits\\10'
    const sdk = '10.0.26100.0'
    const libDirs = [`${msvc}\\lib\\x64`, `${kits}\\Lib\\${sdk}\\ucrt\\x64`, `${kits}\\Lib\\${sdk}\\um\\x64`].join(';')
    const includeDirs = [`${msvc}\\include`, ...['ucrt', 'um', 'shared', 'winrt', 'cppwinrt'].map(part => `${kits}\\Include\\${sdk}\\${part}`)].join(';')
    for (const dir of [...libDirs.split(';'), ...includeDirs.split(';')]) { try { await fs.access(dir) } catch { throw new Error(`MSVC/SDK path missing: ${dir}`) } }
    await fs.writeFile(command, `@echo off\r\nsetlocal\r\ncall "C:\\BuildTools\\Common7\\Tools\\VsDevCmd.bat" -arch=x64 -host_arch=x64\r\nif errorlevel 1 exit /b %errorlevel%\r\nset "LIB=${libDirs}"\r\nset "INCLUDE=${includeDirs}"\r\n${q(node)} ${q(pnpm)} exec tauri build --no-bundle --config ${q(path.join(output, 'tauri-build.json'))}\r\nexit /b %errorlevel%\r\n`)
    await fs.writeFile(path.join(output, 'tauri-build.json'), JSON.stringify({ build: { beforeBuildCommand: '' } }))
    await run(process.env.ComSpec, ['/d', '/c', command])
  }
}
// Materialize all links as files and keep all supplied licenses. Reject cycles and non-files.
async function copyTree(from, to, ancestors = new Set()) {
  const real = await fs.realpath(from)
  if (ancestors.has(real)) throw new Error(`Resource link cycle: ${from}`)
  const stat = await fs.stat(real)
  if (stat.isFile()) { await fs.mkdir(path.dirname(to), { recursive: true }); await fs.copyFile(real, to); return }
  if (!stat.isDirectory()) throw new Error(`Unsupported resource: ${from}`)
  await fs.mkdir(to, { recursive: true })
  for (const name of await fs.readdir(real)) await copyTree(path.join(real, name), path.join(to, name), new Set([...ancestors, real]))
}
// electron-builder's Node collector walks `dependencies` only and never adds
// `peerDependencies` (app-builder-lib resolves required deps, not peers). The prepared dsh
// runtime, by contrast, resolves those peers at run time: the packaged main process imports
// @deepseek-ai/dsh-api-gateway, which imports @deepseek-ai/cordis, whose own loader resolves
// cordis-plugin-loader / cordis-plugin-include. Without the peers the app aborts on
// ERR_MODULE_NOT_FOUND before it can ever write a readiness file, so materialize the missing
// closure from the prepared dsh tree — the exact version set the runtime was built against —
// keeping the packaged app self-consistent. A peer the dsh tree does not provide (e.g. ws's
// optional bufferutil / utf-8-validate native accelerators) is recorded as skipped; a
// required dependency that cannot be satisfied fails the build rather than shipping broken.
async function completeAppDependencyClosure(appModules, sourceModules) {
  const packageDir = (root, name) => path.join(root, ...name.split('/'))
  const directory = async candidate => { try { return (await fs.lstat(candidate)).isDirectory() } catch { return false } }
  const listPackages = async root => {
    const names = []
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('@')) for (const inner of await fs.readdir(path.join(root, entry.name), { withFileTypes: true })) { if (inner.isDirectory()) names.push(`${entry.name}/${inner.name}`) }
      else names.push(entry.name)
    }
    return names
  }
  const seen = new Set(), queue = await listPackages(appModules), copied = [], skipped = [], unsatisfied = []
  while (queue.length) {
    const name = queue.shift()
    if (seen.has(name)) continue
    seen.add(name)
    const installed = packageDir(appModules, name)
    const origin = (await directory(installed)) ? installed : packageDir(sourceModules, name)
    if (!(await directory(origin))) continue
    const manifest = JSON.parse(await fs.readFile(path.join(origin, 'package.json'), 'utf8'))
    const optional = manifest.peerDependenciesMeta ?? {}
    const dependencies = Object.keys(manifest.dependencies ?? {})
    const peers = Object.keys(manifest.peerDependencies ?? {})
    for (const dependency of [...dependencies, ...peers]) {
      if (seen.has(dependency)) continue
      const target = packageDir(appModules, dependency)
      if (await directory(target)) { queue.push(dependency); continue }
      const provided = packageDir(sourceModules, dependency)
      if (await directory(provided)) { await copyTree(provided, target); copied.push(dependency); queue.push(dependency); continue }
      if (peers.includes(dependency) && optional[dependency]?.optional) skipped.push(dependency)
      else unsatisfied.push(dependency)
    }
  }
  return { scanned: seen.size, copied, skipped, unsatisfied }
}
if (['all', 'package'].includes(values.phase)) {
  const portable = path.join(output, 'portable')
  if (await fs.stat(portable).then(() => true, () => false)) throw new Error('Portable destination exists; retain it and choose a fresh output for a new artifact')
  if (pin.short === 'official') {
    const downloads = path.join(source, 'apps/desktop/.desktop-build/downloads')
    await fs.mkdir(downloads, { recursive: true })
    for (const name of await fs.readdir(path.join(inputs, 'official-runtime-payloads/downloads'))) {
      const from = path.join(inputs, 'official-runtime-payloads/downloads', name)
      if ((await fs.stat(from)).isFile()) await fs.copyFile(from, path.join(downloads, sha(await fs.readFile(from))))
    }
    // Upstream package-target.ts runs release tarball packing between build and
    // prepare:runtime — prepare:packages reads packed/{dsh,vendor,landlock}, so the
    // same sequence is reproduced here before the prepare steps (pack → runtime →
    // packages → dsh → electron-builder).
    const packed = path.join(source, 'apps/desktop/.desktop-build/targets/win-x64/packed')
    const packedDsh = path.join(packed, 'dsh'), packedVendor = path.join(packed, 'vendor'), packedLandlock = path.join(packed, 'landlock')
    await pm('run', 'release:pack', '--family', 'dsh', '--out', packedDsh)
    await pm('--dir', 'apps/desktop-host', 'pack', '--pack-destination', packedDsh)
    await pm('run', 'release:pack', '--family', 'vendor', '--out', packedVendor)
    await fs.rm(packedLandlock, { recursive: true, force: true })
    await fs.mkdir(packedLandlock, { recursive: true })
    await pm('--dir', 'native/system', 'run', 'build:ts')
    await pm('--dir', 'native/system/packages/entry', 'pack', '--pack-destination', packedLandlock)
    await pm('--filter', '@deepseek-ai/dsh-desktop', 'run', 'prepare:runtime', '--defer-primary-runtime-smoke')
    await pm('--filter', '@deepseek-ai/dsh-desktop', 'run', 'prepare:packages')
    await pm('--filter', '@deepseek-ai/dsh-desktop', 'run', 'prepare:dsh', '--defer-runtime-smoke')
    const target = path.join(source, 'apps/desktop/.desktop-build/targets/win-x64')
    const config = path.join(output, 'electron-builder.cjs')
    await fs.writeFile(config, 'module.exports=' + JSON.stringify({ appId: 'com.whalerealm.official', productName: 'WhaleRealm Official', asar: false, npmRebuild: false, nodeGypRebuild: false, electronDist: path.join(target, 'electron'), directories: { app: path.join(source, 'apps/desktop'), output: path.join(output, 'electron-package') }, files: ['lib/**/*', 'renderer/**/*', 'package.json'], extraFiles: [{ from: path.join(target, 'dsh'), to: 'resources/app/dsh' }], extraResources: [{ from: path.join(target, 'runtime'), to: 'runtime' }], extraMetadata: { dshBuildCommit: pin.sourceRef, dshBuildDirty: true, whaleRealmPatchSha256: identity.patchSha256 }, win: { signAndEditExecutable: false, executableName: 'WhaleRealm Official' }, publish: null }, null, 2))
    await pm('--filter', '@deepseek-ai/dsh-desktop', 'exec', 'electron-builder', '--win', '--x64', '--dir', '--publish', 'never', '--config', config)
    // Complete the app closure with the dependency/peer set electron-builder omitted (see
    // completeAppDependencyClosure). The prepared dsh runtime tree is the copy source and is
    // copied into the portable tree below regardless, so resolving peers from it only adds the
    // missing links the app layer needs to import; the log line records exactly what was added.
    const closure = await completeAppDependencyClosure(path.join(output, 'electron-package/win-unpacked/resources/app/node_modules'), path.join(target, 'dsh/node_modules'))
    await log.appendFile('dependency-closure ' + JSON.stringify(closure) + '\n')
    console.log('Dependency closure completion:', JSON.stringify(closure))
    if (closure.unsatisfied.length) throw new Error(`Unsatisfied app dependencies: ${closure.unsatisfied.join(', ')}`)
    await copyTree(path.join(output, 'electron-package/win-unpacked'), portable)
    // electron-builder's extraFiles filter hard-excludes a root-level node_modules relative
    // to each entry's from-dir (app-builder-lib util/filter.js), so the prepared dsh runtime
    // tree can never be packaged through extraFiles. Materialize it with the same copyTree
    // used for the rest of the portable tree instead; the two files extraFiles already
    // copied are overwritten with identical bytes.
    await copyTree(path.join(target, 'dsh'), path.join(portable, 'resources/app/dsh'))
  } else {
    await fs.mkdir(portable)
    await copyTree(path.join(state, 'cargo-target/release', pin.executable), path.join(portable, pin.executable))
    await copyTree(path.join(source, 'src-tauri/resources'), path.join(portable, 'resources'))
    await copyTree(path.join(source, 'src-tauri/icons'), path.join(portable, 'icons'))
    await copyTree(path.join(inputs, 'payloads/extracted/node/node-v22.22.0-win-x64'), path.join(portable, 'resources/node'))
    await copyTree(path.join(inputs, 'payloads/extracted/pnpm/package'), path.join(portable, 'resources/pnpm'))
    await copyTree(path.join(inputs, 'payloads/extracted/core'), path.join(portable, 'resources/dsh'))
  }
  for (const name of (await fs.readdir(source)).filter(name => /^(LICENSE|NOTICE|COPYING)/i.test(name))) await copyTree(path.join(source, name), path.join(portable, 'source-notices', name))
  const files = []
  async function inventory(dir) { for (const item of await fs.readdir(dir, { withFileTypes: true })) { const f = path.join(dir, item.name); if (item.isDirectory()) await inventory(f); else if (item.isFile()) { const bytes = await fs.readFile(f); files.push({ path: path.relative(portable, f).replaceAll('\\', '/'), size: bytes.length, sha256: sha(bytes) }) } else throw new Error('Portable tree contains a link') } }
  await inventory(portable)
  const receipt = { schemaVersion: 1, kind: values.kind, version: pin.version, adapterId: `${values.kind}-v1`, sourceRef: pin.sourceRef, patchSha256: identity.patchSha256, executable: pin.executable, files }
  await fs.writeFile(path.join(portable, 'runtime-receipt.json'), JSON.stringify(receipt, null, 2))
  await fs.copyFile(path.join(patchRoot, 'managed.patch'), path.join(output, 'managed.patch'))
  // Python zipfile produces ordinary ZIP with complete file tree; neither runtime nor installer is executed.
  const archive = path.join(output, `${values.kind}-${pin.version}-win-x64.zip`)
  const python = process.env.WR_BUILD_PYTHON
  if (!python || !path.isAbsolute(python)) throw new Error('Set WR_BUILD_PYTHON to an existing Python executable for ZIP assembly')
  await run(python, ['-c', 'import pathlib,sys,zipfile; r=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],"x",zipfile.ZIP_DEFLATED,compresslevel=6); [z.write(p,p.relative_to(r).as_posix()) for p in sorted(r.rglob("*")) if p.is_file()]; z.close()', portable, archive])
  const bytes = await fs.readFile(archive)
  const pending = { ...receipt, files: undefined, assetId: `${values.kind}:${pin.version}:${identity.patchSha256.slice(0, 12)}`, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`, format: 'zip', url: new URL('file:///' + archive.replaceAll('\\', '/')).href, receiptSha256: sha(await fs.readFile(path.join(portable, 'runtime-receipt.json'))), status: 'pending-acceptance', builtAt: new Date().toISOString() }
  await fs.writeFile(path.join(output, 'pending-manifest.json'), JSON.stringify(pending, null, 2))
  console.log('Built provisional artifact; final real A/B acceptance is required:', archive)
}
await log.close()
