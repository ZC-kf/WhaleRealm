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
import { existsSync, statSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const hubDir = path.join(scriptDir, '..', 'hub')
const releaseDir = path.join(hubDir, 'release')
const { version } = JSON.parse(readFileSync(path.join(hubDir, 'package.json'), 'utf8'))

const findings = []
const notes = []
let failed = false
const fail = message => { findings.push(`FAIL: ${message}`); failed = true }
const warn = message => findings.push(`WARN: ${message}`)
const info = message => notes.push(`INFO: ${message}`)

/** 开发机路径 / 用户数据 / 密钥形态的硬性黑名单（条目名与内容都查）。 */
const FORBIDDEN_STRINGS = [
  'd:\\dsh-hub-hidm',
  'd:/dsh-hub-hidm',
  '/d/dsh-hub-hidm',
  'c:\\users\\lenovo',
  'dsh-hub-hidm',
]
const FORBIDDEN_ENTRIES = [
  /^instances\//,
  /^hub-data\//,
  /^\.dsh/,
  /(^|\/)hub-root\.txt$/,
  /(^|\/)settings\.json$/,
  /(^|\/)\.git\//,
  /(^|\/)release\//,
  /^tests\//,
  /^scripts\//,
  /(^|\/)node_modules\/\.pnpm\//,
]
const API_KEY_PATTERN = /sk-[A-Za-z0-9]{20,}/

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
  const entries = []
  let cursor = directoryOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) { fail('zip 中央目录结构异常'); return null }
    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const uncompressedSize = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength)
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset, buffer })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/** 读取单个 zip 条目内容（stored 直接切片，deflate 用 zlib 原始解压）。 */
function zipEntryData(entry) {
  const { buffer, localOffset } = entry
  if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`本地文件头异常：${entry.name}`)
  const nameLength = buffer.readUInt16LE(localOffset + 26)
  const extraLength = buffer.readUInt16LE(localOffset + 28)
  const dataStart = localOffset + 30 + nameLength + extraLength
  const raw = buffer.subarray(dataStart, dataStart + entry.compressedSize)
  if (entry.method === 0) return raw
  if (entry.method === 8) return inflateRawSync(raw)
  throw new Error(`不支持的压缩方式（${entry.method}）：${entry.name}`)
}

/** 内容扫描只对文本类条目做密钥形态检查（二进制 pak/dll 会随机命中 sk-… 正则）。 */
const TEXT_EXTENSIONS = /\.(js|mjs|cjs|json|html?|txt|md|css|ya?ml|map|ts)$/i

function scanZipContents(entries) {
  let scanned = 0
  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue // 目录条目
    if (entry.uncompressedSize > 256 * 1024 * 1024) { warn(`跳过超大条目（>256MB）的内容扫描：${entry.name}`); continue }
    let data
    try { data = zipEntryData(entry) } catch (error) { fail(`条目解压失败：${entry.name}（${error.message}）`); continue }
    scanned += 1
    // 路径字样是字面量，扫全部条目（包括二进制）不会误报。
    const latin = data.toString('latin1').toLowerCase()
    for (const forbidden of FORBIDDEN_STRINGS) {
      if (latin.includes(forbidden)) { fail(`zip 条目 ${entry.name} 含开发机路径字样：${forbidden}`) }
    }
    if (TEXT_EXTENSIONS.test(entry.name) && API_KEY_PATTERN.test(data.toString('utf8'))) {
      fail(`zip 条目 ${entry.name} 含疑似 API Key（sk-…）`)
    }
  }
  info(`内容扫描了 ${scanned} 个 zip 条目`)
}

/**
 * docs/、licenses/、dist-electron 都被 electron-builder 收进 app.asar
 * （files: dist/dist-electron/docs/licenses）。asar 头部是 JSON 文件清单，
 * 用字面字符串确认它们确实在包里。
 */
function expectedEntriesPresent(entries) {
  const names = new Set(entries.map(entry => entry.name.toLowerCase()))
  const required = ['resources/app.asar', 'license.electron.txt', 'licenses.chromium.html']
  for (const item of required) {
    if (!names.has(item)) fail(`zip 缺少必备文件：${item}`)
  }
  const asar = entries.find(entry => entry.name.toLowerCase() === 'resources/app.asar')
  if (!asar) return
  let asarBytes
  try { asarBytes = zipEntryData(asar) } catch (error) { fail(`app.asar 读取失败：${error.message}`); return }
  const asarText = asarBytes.toString('latin1')
  // asar 头是 JSON 目录树：目录是嵌套键（"docs":），文件是叶键（"main.js"）。
  for (const marker of ['"dist":', '"dist-electron":', '"main.js"', '"preload.mjs"', '"docs":', '"licenses":', '"GPL-3.0.txt"', '"THIRD_PARTY_NOTICES.md"']) {
    if (!asarText.includes(marker)) fail(`app.asar 内缺少预期内容：${marker}`)
  }
  if (asarText.toLowerCase().includes('dsh-hub-hidm')) fail('app.asar 含开发机路径字样：dsh-hub-hidm')
}

console.log(`WhaleRealm 发行包验证（版本 ${version}）`)
console.log(`产物目录：${releaseDir}`)

const zip = findArtifact(`WhaleRealm-${version}-x64.zip`, 'zip')
const setup = findArtifact(`WhaleRealm-${version}-setup.exe`, 'exe')

if (zip) {
  const entries = readZipEntries(zip)
  if (entries) {
    info(`zip 共 ${entries.length} 个条目`)
    for (const entry of entries) {
      for (const pattern of FORBIDDEN_ENTRIES) {
        if (pattern.test(entry.name.toLowerCase())) { fail(`zip 含禁止条目：${entry.name}`); break }
      }
    }
    expectedEntriesPresent(entries)
    scanZipContents(entries)
  }
}

if (setup) {
  // NSIS 安装包内部内容扫描需要 7z；没有就如实说明，不冒充通过。
  const probe = spawnSync('7z.exe', [], { encoding: 'utf8' })
  if (probe.error) {
    warn('NSIS 产物只做了存在性/PE 头校验；内容扫描需要 7z（未安装，未执行）')
  } else {
    const list = spawnSync('7z.exe', ['l', setup], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    if (list.status === 0) {
      const lower = list.stdout.toLowerCase()
      for (const forbidden of FORBIDDEN_STRINGS) {
        if (lower.includes(forbidden)) fail(`NSIS 产物条目含开发机路径字样：${forbidden}`)
      }
      if (API_KEY_PATTERN.test(list.stdout)) fail('NSIS 产物条目含疑似 API Key（sk-…）')
    } else {
      warn('7z 列举 NSIS 内容失败，内容扫描未完成')
    }
  }
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
