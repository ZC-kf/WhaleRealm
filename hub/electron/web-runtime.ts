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

import { spawnOwnedProcess, bounded, ProcessCleanupError, type OwnedProcess } from './process-supervisor'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { InstanceEnvironmentContext } from './instance-types'
import { buildWebEnvironment } from './instance-env'


/**
 * 官方网页版（@deepseek-ai/dsh 的 web profile）运行支持：
 * 自包含 Node 运行时 + npm 安装的 dsh 包 + `dsh web` 本地服务 + 浏览器打开。
 * 端口/DSH_HOME 均按实例隔离；就绪信号为 stdout 的 `dsh web: http://127.0.0.1:<port>` 行。
 */

/** Official Node win-x64 archive; version changes require updating its trusted SHA256. */
export const WEB_NODE_VERSION = 'v22.22.0'
export const WEB_NODE_DIST_URL = `https://nodejs.org/dist/${WEB_NODE_VERSION}/node-${WEB_NODE_VERSION}-win-x64.zip`
export const WEB_NODE_SHA256 = 'c97fa376d2becdc8863fcd3ca2dd9a83a9f3468ee7ccf7a6d076ec66a645c77a'
export const VERIFIED_WEB_VERSION = '0.2.0-rc.2'
/** Trusted npm registry; dependencies retain npm's SRI verification. */
export const WEB_NPM_REGISTRY = 'https://registry.npmjs.org'
/** 官方网页版运行时 npm 包。 */
export const WEB_DSH_PACKAGE = '@deepseek-ai/dsh'

/** 某版本的 npm tarball 直链（可用于 HEAD 核验）。 */
export function dshTarballUrl(version: string): string {
  return `https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-${version}.tgz`
}

/** 实例目录内的 node.exe。 */
export function webNodeExeIn(dir: string): string {
  return path.join(dir, 'node', 'node.exe')
}

/** 实例目录内的 dsh CLI 入口。 */
export function dshBinIn(dir: string): string {
  return path.join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
}

/** 实例目录内最小 package.json（npm install 的落点，private 防误发布）。 */
export function buildWebPackageJson(): string {
  return `${JSON.stringify({ name: 'dsh-web-instance', private: true, version: '1.0.0' }, null, 2)}\n`
}

/** npm install 命令（用实例自带的 node + npm-cli，缓存落在实例目录内，不碰用户全局缓存）。 */
export function buildNpmInstallCommand(instanceDir: string, version: string, localPackageSpec?: string, cache = path.join(instanceDir, '.npm-cache')): { executable: string; args: string[]; cwd: string } {
  return {
    executable: webNodeExeIn(instanceDir),
    args: [
      path.join(instanceDir, 'node', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      'install',
      '--no-audit',
      '--no-fund',
      '--ignore-scripts',
      '--registry',
      WEB_NPM_REGISTRY,
      '--cache',
      cache,
      localPackageSpec ?? `${WEB_DSH_PACKAGE}@${version}`,
    ],
    cwd: instanceDir,
  }
}

export interface WebPackageRunner { (executable: string, args: string[], cwd: string): Promise<void> }

/**
 * 在实例目录内安装 dsh 运行包。
 * cwd 强制为实例目录——漏传会让 npm 落到进程当前目录（如 hub 根），既装错位置又污染目录。
 */
export async function installWebPackage(instanceDir: string, version: string, run: WebPackageRunner): Promise<void> {
  const cmd = buildNpmInstallCommand(instanceDir, version)
  await run(cmd.executable, cmd.args, cmd.cwd)
}

/** 从 dsh web 的 stdout 中解析就绪地址行 `dsh web: http://127.0.0.1:3080/?token=...`（含会话 token，浏览器必须带 token 访问）。 */
export function parseWebReadyUrl(output: string): string | null {
  const match = output.match(/dsh web:\s+(https?:\/\/127\.0\.0\.1:\d+\/?[^\s)]*)/)
  return match ? match[1] : null
}

export function approvedWebUrl(url: string, port: number): boolean {
  try { const parsed = new URL(url); return parsed.origin === `http://127.0.0.1:${port}` && !parsed.username && !parsed.password } catch { return false }
}
export function redactWebOutput(output: string): string {
  return output.replace(/([?&]token=)[^\s&#)]*/gi, '$1[REDACTED]')
}
export function webSafeError(error: unknown): Error {
  const message=redactWebOutput(error instanceof Error?error.message:String(error))
  return error instanceof Error && 'cleanupUnsafe' in error ? new ProcessCleanupError(message) : new Error(message)
}
/** Buffer fragmented pipes until a full line is available; token fragments never reach logs. */
export function createWebOutputRedactor(emit?: (text:string)=>void): {write(text:string):void;finish():void} {
  let pending=''
  return {write(text){pending+=text;let end:number;while((end=pending.indexOf('\n'))>=0){emit?.(redactWebOutput(pending.slice(0,end+1)));pending=pending.slice(end+1)}if(pending.length>64000)pending='[oversized Web output suppressed]'},finish(){if(pending)emit?.(redactWebOutput(pending));pending=''}}
}

export interface WebRunnerInput extends InstanceEnvironmentContext { node: string; binJs: string; patch?: string; cache?: string }
export interface WebRunnerHandle extends OwnedProcess {
  pid: number
  stop(): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  /** 等待就绪并返回带会话 token 的访问地址（dsh web 在 loader 落定后打印地址行；探活只需有 HTTP 响应）。 */
  waitReady(fetchImpl: (input: string) => Promise<{ ok: boolean; status: number }>, timeoutMs: number): Promise<string>
}

/** 启动一个 `dsh web` 本地服务（`--no-open` 不开浏览器；开网页由调用方负责）。 */
export async function spawnWebRunner(input: WebRunnerInput, onOutput?: (text: string) => void, signal?: AbortSignal): Promise<WebRunnerHandle> {
  await mkdir(input.workspace, { recursive: true })
  let output = '', exited = false
  const logs=createWebOutputRedactor(onOutput)
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535 || input.port === 3080) throw new Error('Unapproved Web port')
  const cache = input.cache ?? path.join(input.dshHome, '.managed-cache')
  const handle = await spawnOwnedProcess(input.node, [input.binJs, '--profile', 'web', ...(input.patch ? ['--patch', input.patch] : []), '--host', '127.0.0.1', '--port', String(input.port), '--no-open'], {
    cwd: input.workspace, env: buildWebEnvironment({dshHome:input.dshHome,cache,workspace:input.workspace}, process.env), signal,
    onOutput: text => { output = (output + text).slice(-32000); logs.write(text) },
  }).catch(error=>{logs.finish();throw webSafeError(error)})
  const safeControl=async(operation:()=>Promise<void>)=>{try{await operation()}catch(error){throw webSafeError(error)}}
  const safeExited=handle.exited.catch(error=>{throw webSafeError(error)})
  void safeExited.then(() => { exited = true;logs.finish() }, () => { exited = true;logs.finish() })
  return { ...handle,exited:safeExited,stop:()=>safeControl(()=>handle.stop()),pause:()=>safeControl(()=>handle.pause()),resume:()=>safeControl(()=>handle.resume()), waitReady: async (fetchImpl, timeoutMs) => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      signal?.throwIfAborted()
      if (exited) throw new Error('dsh web exited before ready')
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error(`Local service readiness timed out: ${redactWebOutput(output.slice(-500))}`)
      const url = parseWebReadyUrl(output)
      if (url && approvedWebUrl(url, input.port)) {
        try { const result=await bounded(fetchImpl(url), Math.min(1000, remaining), 'Readiness probe'); signal?.throwIfAborted(); if (!exited && result.ok && result.status===200) return url } catch { signal?.throwIfAborted() }
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(100, remaining)))
    }
  } }
}
export interface WebSelfcheckInput {
  node: string
  binJs: string
  port: number
  /** 自检用的临时 DSH_HOME（放目标目录内，失败随目录清理）。 */
  dshHome: string
  workspace: string
  /** Caller must prepare the launcher-owned workspace policy before official code runs. */
  patch: string
  cache: string
  fetchImpl: (input: string) => Promise<{ ok: boolean; status: number }>
  timeoutMs: number
  signal?: AbortSignal
}

/**
 * 创建流水线自检：真实启动 `dsh web`，等待就绪地址并探活（带会话 token），随后关闭。
 * 任何失败抛错（由流水线清目录回退）。
 */
export async function runWebSelfcheck(input: WebSelfcheckInput): Promise<void> {
  let output = ''
  const handle = await spawnWebRunner({
    node: input.node,
    binJs: input.binJs,
    port: input.port,
    dshHome: input.dshHome,
    workspace: input.workspace,
    patch: input.patch,
    cache: input.cache,
    id: 'selfcheck',
    lockName: 'dsh-web-selfcheck',
    electronUserData: path.join(input.dshHome, 'electron-user-data'),
  }, text => { output += text }, input.signal)
  try {
    await handle.waitReady(input.fetchImpl, input.timeoutMs)
  } catch (error) {
    await handle.stop()
    const tail = output.slice(-800)
    throw new Error(`自检启动失败：${error instanceof Error ? error.message : String(error)}${tail ? `（输出末尾：${tail.trim()}）` : ''}`)
  }
  await handle.stop()
}
