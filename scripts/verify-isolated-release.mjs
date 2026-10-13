#!/usr/bin/env node
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

import { spawnSync } from 'node:child_process'
import { inflateRawSync } from 'node:zlib'
import { existsSync, statSync, readFileSync, readdirSync } from 'node:fs'
import { scanReleaseEntries } from './lib/release-content.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const hubDir = path.join(scriptDir, '..', 'hub')
const releaseDir = path.join(hubDir, 'release')
const { version } = JSON.parse(readFileSync(path.join(hubDir, 'package.json'), 'utf8'))

const findings = []
const notes = []
const fail = message => findings.push(`FAIL: ${message}`)
const info = message => notes.push(`INFO: ${message}`)

function findArtifact(basename, kind) {
  const target = path.join(releaseDir, basename)
  if (!existsSync(target)) { fail(`缺少产物：${basename}`); return null }
  const size = statSync(target).size
  if (size < 1024 * 1024) { fail(`产物过小（${size} 字节），疑似损坏：${basename}`); return null }
  const head = readFileSync(target).subarray(0, 2)
  const signatureOk = kind === 'zip'
    ? (head[0] === 0x50 && head[1] === 0x4b) // PK
    : (head[0] === 0x4d && head[1] === 0x5a) // MZ
  const signatureName = kind === 'zip' ? 'ZIP（PK）头' : 'MZ 头'
  if (!signatureOk) { fail(`产物不是有效的 ${kind === 'zip' ? 'zip 归档' : 'Windows 可执行文件'}（${signatureName}缺失）：${basename}`); return null }
  info(`${basename} 存在，${(size / 1024 / 1024).toFixed(1)} MB，${signatureName}正常`)
  return target
}

/**
 * 纯 Node 的最小 zip 读取器（无第三方依赖）：
 * 解析 EOCD → 中央目录 → 本地文件头 → zlib 解压。只支持 stored/deflate
 * （electron-builder 的 zip 产物即这两种），不处理 zip64（<4GB 无需）。
 */
function readZipEntries(zipPath) {
  const buffer = readFileSync(zipPath)
  // EOCD 在文件末尾：签名 0x06054b50，最长注释 65535 字节。
  const scanStart = Math.max(0, buffer.length - 66_000)
  let eocd = -1
  for (let i = buffer.length - 22; i >= scanStart; i -= 1) {
    if (buffer[i] === 0x50 && buffer[i + 1] === 0x4b && buffer[i + 2] === 0x05 && buffer[i + 3] === 0x06) { eocd = i; break }
  }
  if (eocd < 0) { fail('zip 未找到 EOCD 结束记录，文件可能损坏'); return null }
  const entryCount = buffer.readUInt16LE(eocd + 10)
  const directoryOffset = buffer.readUInt32LE(eocd + 16)
  const directorySize = buffer.readUInt32LE(eocd + 12)
  if (buffer.readUInt16LE(eocd + 4) || buffer.readUInt16LE(eocd + 6) || buffer.readUInt16LE(eocd + 8) !== entryCount || entryCount === 0xffff || directoryOffset === 0xffffffff || directoryOffset + directorySize !== eocd || eocd + 22 + buffer.readUInt16LE(eocd + 20) !== buffer.length) throw new Error('ZIP 分卷、ZIP64 或目录边界不支持，扫描未完成')
  const entries = []
  let cursor = directoryOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > eocd) throw new Error('ZIP 中央目录越界')
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) { fail('zip 中央目录结构异常'); return null }
    const flags = buffer.readUInt16LE(cursor + 8)
    if (flags & 1) throw new Error('加密 ZIP 条目不支持，扫描未完成')
    if (((buffer.readUInt32LE(cursor + 38) >>> 16) & 0xf000) === 0xa000) throw new Error('ZIP 链接不支持，扫描未完成')
    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const uncompressedSize = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    if (cursor + 46 + nameLength + extraLength + commentLength > eocd) throw new Error('ZIP 条目索引越界')
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength)
    entries.push({ name, method, flags, compressedSize, uncompressedSize, localOffset, directoryOffset, buffer })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  if (cursor !== eocd) throw new Error('ZIP 条目数与中央目录不一致')
  return entries
}

/** 读取单个 zip 条目内容（stored 直接切片，deflate 用 zlib 原始解压）。 */
function zipEntryData(entry) {
  const { buffer, localOffset } = entry
  if (localOffset + 30 > entry.directoryOffset) throw new Error(`本地文件头越界：${entry.name}`)
  if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`本地文件头异常：${entry.name}`)
  const nameLength = buffer.readUInt16LE(localOffset + 26)
  const extraLength = buffer.readUInt16LE(localOffset + 28)
  const dataStart = localOffset + 30 + nameLength + extraLength
  if (dataStart + entry.compressedSize > entry.directoryOffset || buffer.toString('utf8', localOffset + 30, localOffset + 30 + nameLength) !== entry.name || buffer.readUInt16LE(localOffset + 8) !== entry.method || buffer.readUInt16LE(localOffset + 6) !== entry.flags) throw new Error(`本地文件头与索引不一致：${entry.name}`)
  const raw = buffer.subarray(dataStart, dataStart + entry.compressedSize)
  if (entry.method === 0) return raw
  if (entry.method === 8) return inflateRawSync(raw, { maxOutputLength: 256 * 1024 * 1024 })
  throw new Error(`不支持的压缩方式（${entry.method}）：${entry.name}`)
}

// Probe PATH and electron-builder's already installed cache; never download tools.
function findSevenZip() {
  const candidates = ['7z.exe', '7za.exe']
  const cache = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache', '7zip@1.0.0')
  if (cache && existsSync(cache)) for (const item of readdirSync(cache)) candidates.push(path.join(cache, item, 'bin', '7za.exe'))
  return candidates.find(candidate => spawnSync(candidate, ['i'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).status === 0)
}

function scanInstaller(setup) {
  const executable = findSevenZip()
  if (!executable) throw new Error('NSIS 内容扫描未完成：找不到 7-Zip，禁止发布')
  const list = spawnSync(executable, ['l', '-slt', '--', setup], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 })
  if (list.error || list.status !== 0) throw new Error('NSIS 内容扫描未完成：7-Zip 列举失败')
  const listing = list.stdout.split(/----------\r?\n/)[1]
  if (!listing) throw new Error('NSIS 内容扫描未完成：缺少真实文件清单')
  const entries = listing.split(/\r?\n\r?\n/).filter(block => block.startsWith('Path = ')).map(block => {
    const fields = Object.fromEntries(block.split(/\r?\n/).filter(line => line.includes(' = ')).map(line => { const i = line.indexOf(' = '); return [line.slice(0, i), line.slice(i + 3)] }))
    const directory = fields.Folder === '+' || /^D/.test(fields.Attributes ?? '')
    const name = fields.Path.replaceAll('\\', '/') + (directory ? '/' : '')
    if (fields['Symbolic Link'] || fields['Hard Link']) throw new Error(`NSIS 链接不支持：${name}`)
    const size = Number(fields.Size)
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`NSIS 文件大小异常：${name}`)
    return { name, size, read: () => {
      // -so extracts only to stdout; -spd disables wildcards in archive member names.
      const result = spawnSync(executable, ['x', '-so', '-spd', '--', setup, fields.Path], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 + 1, timeout: 120000 })
      if (result.error || result.status !== 0) throw new Error(`NSIS 文件读取失败：${name}`)
      return result.stdout
    } }
  })
  if (!entries.length) throw new Error('NSIS 内容扫描未完成：空文件清单')
  for (const finding of scanReleaseEntries(entries)) fail(`NSIS ${finding}`)
  info(`NSIS 实际载荷扫描了 ${entries.length} 个条目（${executable}）`)
}

console.log(`WhaleRealm 发行包验证（版本 ${version}）`)
console.log(`产物目录：${releaseDir}`)

const zip = findArtifact(`WhaleRealm-${version}-x64.zip`, 'zip')
const setup = findArtifact(`WhaleRealm-${version}-setup.exe`, 'exe')

if (zip) {
  try {
    const entries = readZipEntries(zip)
    if (entries) {
      info(`zip 共 ${entries.length} 个条目`)
      for (const finding of scanReleaseEntries(entries.map(entry => ({ name: entry.name, size: entry.uncompressedSize, read: () => zipEntryData(entry) })))) fail(`ZIP ${finding}`)
    }
  } catch (error) { fail(`ZIP 扫描未完成：${error.message}`) }
}
if (setup) {
  try { scanInstaller(setup) } catch (error) { fail(error.message) }
}

console.log('')
for (const line of notes) console.log(line)
const failures = findings.filter(finding => finding.startsWith('FAIL'))
for (const line of findings) console.log(line)
if (failures.length) {
  console.log(`\n验证未通过（${failures.length} 项失败）。`)
  process.exit(1)
}
console.log('验证通过：产物存在、结构完整、未发现开发机路径/用户数据/密钥形态内容。')
