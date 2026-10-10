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

// DSH 本地会话用量聚合（今日 Token 与缓存命中率）。
// 数据全部来自 {dshHome} 下 DSH 自己落盘的文件，全程零网络请求：
//   - storages/session_projcache.json：每会话 token 投影（历史总和的快速路径）；
//   - sessions/<project>/<session>/session.jsonl(.zstd)：跨天活跃会话的逐 step 明细。
// 聚合口径：总 Token = 未缓存输入 + 输出 + 缓存读；命中率 = 缓存读 /（缓存读 + 未缓存输入），
// 输入侧为零时为 null。今日口径按本地午夜划分：今日新建会话整投影计入今日，
// 早于今日创建但今天仍在活跃的会话只取今日时间窗内的 step 明细；今日命中率
// 无数据时回退用历史总命中率。

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import * as zlib from 'node:zlib'
import type { DshUsage, DshUsageResult } from '../src/types'

const zstdDecompressSync = (zlib as { zstdDecompressSync?: (input: Buffer) => Buffer }).zstdDecompressSync

// ---------------------------------------------------------------------------
// 基础数值与聚合
// ---------------------------------------------------------------------------

/** 三类 token 的一个样本。 */
export interface TokenSample {
  uncachedInput: number
  output: number
  cacheRead: number
}

const EMPTY_SAMPLE: TokenSample = { uncachedInput: 0, output: 0, cacheRead: 0 }

/** 只承认有限的正数；负数、NaN、Infinity、非数值一律按 0 处理。 */
function positiveCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function addSamples(a: TokenSample, b: TokenSample): TokenSample {
  return {
    uncachedInput: a.uncachedInput + b.uncachedInput,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
  }
}

/** 样本的 token 合计。 */
export function sampleTotal(sample: TokenSample): number {
  return sample.uncachedInput + sample.output + sample.cacheRead
}

/** 命中率 = 缓存读 /（缓存读 + 未缓存输入）；分母为零返回 null。 */
export function sampleHitRate(sample: TokenSample): number | null {
  const inputSide = sample.cacheRead + sample.uncachedInput
  return inputSide > 0 ? sample.cacheRead / inputSide : null
}

/** 某时刻所在本地日的零点（含 DST：由本地时区规则回推）。 */
export function startOfLocalDay(nowMs: number): number {
  const midnight = new Date(nowMs)
  midnight.setHours(0, 0, 0, 0)
  return midnight.getTime()
}

// ---------------------------------------------------------------------------
// 会话日志解析：明文行 → 去重后的 usage 样本
// ---------------------------------------------------------------------------

/** 日志中一条有效的 usage 样本（已按 turn+step 折叠）。 */
export interface UsageRow {
  at: number
  turn: number
  step: number
  uncachedInput: number
  output: number
  cacheRead: number
}

/**
 * 解析会话日志明文。合法行是 assistant/message（data.usage 为最终样本）或
 * assistant/chunk（data.chunk.type === 'usage'，早期样本），且 time/turn/step
 * 均为数值。同 (turn, step) 的多次采样折叠为一条：保留时间戳最新者，
 * 时间戳相同取文件中靠后的一条（最终样本通常晚于早期样本写入）。
 * 撕裂行、非法 JSON、非 usage 行、缺字段行一律跳过。
 */
export function collectUsageRows(text: string): UsageRow[] {
  const folded = new Map<string, UsageRow>()
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    const row = readUsageEntry(parsed)
    if (!row) continue
    const key = `${row.turn}:${row.step}`
    const winner = folded.get(key)
    if (winner === undefined || row.at >= winner.at) folded.set(key, row)
  }
  return [...folded.values()]
}

/** 从一条日志记录里提取 usage 样本；不符合 schema 返回 null。 */
function readUsageEntry(parsed: unknown): UsageRow | null {
  const entry = parsed as {
    type?: unknown
    time?: unknown
    data?: {
      turn?: unknown
      step?: unknown
      usage?: unknown
      chunk?: { type?: unknown; usage?: unknown }
    }
  }
  if (typeof entry.time !== 'number' || !Number.isFinite(entry.time)) return null
  if (typeof entry.data?.turn !== 'number' || typeof entry.data?.step !== 'number') return null
  let usage: Record<string, unknown> | undefined
  if (entry.type === 'assistant/message') {
    if (entry.data.usage && typeof entry.data.usage === 'object') usage = entry.data.usage as Record<string, unknown>
  } else if (entry.type === 'assistant/chunk') {
    const chunk = entry.data.chunk
    if (chunk?.type === 'usage' && chunk.usage && typeof chunk.usage === 'object') usage = chunk.usage as Record<string, unknown>
  }
  if (!usage) return null
  return {
    at: entry.time,
    turn: entry.data.turn,
    step: entry.data.step,
    uncachedInput: positiveCount(usage.inputTokens),
    output: positiveCount(usage.outputTokens),
    cacheRead: positiveCount(usage.cacheReadTokens),
  }
}

// ---------------------------------------------------------------------------
// zstd 解码：帧结构步进器（独立实现）
// ---------------------------------------------------------------------------

/** zstd 普通帧魔数（字节序：28 B5 2F FD）。 */
const ZSTD_FRAME_MAGIC = 0xfd2fb528
/** 可跳过帧魔数区间（字节序：50..5F 2A 4D 18）。 */
const ZSTD_SKIPPABLE_BASE = 0x184d2a50
const ZSTD_SKIPPABLE_MASK = 0xfffffff0

/**
 * 按 zstd 帧结构（RFC 8878）步进整个缓冲区，切出每个完整帧的字节区间。
 * 与"扫描魔数出现位置"的做法不同：逐帧解析帧头描述符与块头长度，天然
 * 排除压缩数据内部偶然出现的伪魔数；结尾撕裂帧（写入中截断）因字节不足
 * 被丢弃，不影响此前完整的帧。
 */
export function zstdFrameSlices(buffer: Buffer): Array<{ start: number; end: number }> {
  const frames: Array<{ start: number; end: number }> = []
  let cursor = 0
  while (cursor + 4 <= buffer.length) {
    const magic = buffer.readUInt32LE(cursor)
    if (magic === ZSTD_FRAME_MAGIC) {
      const frameEnd = zstdFrameEnd(buffer, cursor)
      if (frameEnd === null) break // 尾部撕裂帧：字节不足，整段丢弃。
      frames.push({ start: cursor, end: frameEnd })
      cursor = frameEnd
    } else if ((magic & ZSTD_SKIPPABLE_MASK) === ZSTD_SKIPPABLE_BASE && magic <= ZSTD_SKIPPABLE_BASE + 0x0f) {
      if (cursor + 8 > buffer.length) break
      const frameSize = buffer.readUInt32LE(cursor + 4)
      const frameEnd = cursor + 8 + frameSize
      if (frameEnd > buffer.length) break
      cursor = frameEnd
    } else {
      break // 帧之间的杂散字节：不猜、不扫，就此停住。
    }
  }
  return frames
}

/** 计算从 start 开始的普通帧在 buffer 里的结束位置（不含）；字节不足返回 null。 */
function zstdFrameEnd(buffer: Buffer, start: number): number | null {
  const descriptor = buffer[start + 4]
  if (descriptor === undefined) return null
  const fcsFlag = descriptor >>> 6
  const singleSegment = (descriptor >>> 5) & 1
  const hasChecksum = (descriptor >>> 2) & 1
  const dictFlag = descriptor & 3
  const fcsSize = fcsFlag === 0 ? (singleSegment === 1 ? 1 : 0) : fcsFlag === 1 ? 2 : fcsFlag === 2 ? 4 : 8
  const dictSize = dictFlag === 0 ? 0 : dictFlag === 1 ? 1 : dictFlag === 2 ? 2 : 4
  let cursor = start + 4 + 1 + fcsSize + dictSize
  // 逐块步进：3 字节块头 = last_block(bit0) + block_type(bit1-2) + block_size(bit3-23)。
  for (;;) {
    if (cursor + 3 > buffer.length) return null
    const header = buffer.readUIntLE(cursor, 3)
    const isLast = header & 1
    const blockType = (header >>> 1) & 3
    const blockSize = header >>> 3
    // Raw/Compressed 块占 blockSize 字节；RLE 块内容固定 1 字节（blockSize 是再生长度）。
    const blockBody = blockType === 1 ? 1 : blockSize
    cursor += 3 + blockBody
    if (cursor > buffer.length) return null
    if (isLast === 1) break
  }
  if (hasChecksum === 1) cursor += 4
  if (cursor > buffer.length) return null
  return cursor
}

/**
 * 解码 zstd 日志为明文；Node 无 zstd 能力时返回 null（调用方应回退明文日志）。
 * 每个完整帧独立解码拼接；单帧解码失败（内部损坏）跳过该帧。
 */
export function decodeZstdLog(buffer: Buffer): string | null {
  if (typeof zstdDecompressSync !== 'function') return null
  let text = ''
  for (const frame of zstdFrameSlices(buffer)) {
    try {
      text += zstdDecompressSync(buffer.subarray(frame.start, frame.end)).toString('utf8')
    } catch {
      // 帧内部损坏：丢弃该帧，其余帧继续。
    }
  }
  return text
}

// ---------------------------------------------------------------------------
// 投影解析（storages/session_projcache.json）
// ---------------------------------------------------------------------------

/** 从投影表读出的单会话汇总。 */
export interface ProjectionSession {
  createdAt: number
  lastPromptAt: number | null
  sample: TokenSample
}

/**
 * 解析 DSH 落盘的会话投影。字段路径：tables.sessions[id].identity.createdAt、
 * rows.tokenUsage.val.totals{uncachedInputTokens,outputTokens,cacheReadTokens}、
 * rows.sessionListMetadata.val.lastPromptAt。缺 identity 或 totals 的条目跳过，
 * 数值字段一律按"有限正数"口径清洗。
 */
export function readProjectionSessions(json: unknown): Map<string, ProjectionSession> {
  const sessions = new Map<string, ProjectionSession>()
  const tables = (json as { tables?: { sessions?: Record<string, unknown> } })?.tables?.sessions
  if (tables === null || typeof tables !== 'object') return sessions
  for (const [sessionId, entry] of Object.entries(tables)) {
    const item = entry as {
      identity?: unknown
      rows?: {
        tokenUsage?: { val?: { totals?: Record<string, unknown> } }
        sessionListMetadata?: { val?: { lastPromptAt?: unknown } }
      }
    }
    const totals = item?.rows?.tokenUsage?.val?.totals
    if (item?.identity === null || typeof item?.identity !== 'object' || totals === null || typeof totals !== 'object') continue
    const lastPromptAt = positiveCount(item.rows?.sessionListMetadata?.val?.lastPromptAt)
    sessions.set(sessionId, {
      createdAt: positiveCount((item.identity as { createdAt?: unknown }).createdAt),
      lastPromptAt: lastPromptAt > 0 ? lastPromptAt : null,
      sample: {
        uncachedInput: positiveCount(totals.uncachedInputTokens),
        output: positiveCount(totals.outputTokens),
        cacheRead: positiveCount(totals.cacheReadTokens),
      },
    })
  }
  return sessions
}

// ---------------------------------------------------------------------------
// 会话日志定位：多 project 目录搜索 + zstd 优先 / 明文回退
// ---------------------------------------------------------------------------

/** 投影里的会话 ID 直接拼进文件路径，必须先验证形状（防目录穿越）。 */
export function isSafeSessionId(sessionId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(sessionId)
}

/**
 * 在 sessions/<project>/<sessionId>/ 下定位会话日志并取今日明细。
 * 搜索顺序：逐 project 目录；每个目录里 zstd 日志优先，解码失败、无 zstd
 * 能力或解出空文本时回退同目录的明文日志（旧实现无此回退，压缩文件损坏
 * 会直接吞掉可用的明文数据）。返回 null 表示该 project 下无可读日志。
 */
async function usageRowsSince(dshHome: string, sessionId: string, sinceMs: number): Promise<UsageRow[] | null> {
  const sessionsRoot = path.join(dshHome, 'sessions')
  let projects: string[]
  try {
    projects = await readdir(sessionsRoot)
  } catch {
    return null
  }
  for (const project of projects) {
    const sessionDir = path.join(sessionsRoot, project, sessionId)
    const compressedLog = path.join(sessionDir, 'session.jsonl.zstd')
    const plainLog = path.join(sessionDir, 'session.jsonl')
    const compressed = await readLogIfPossible(compressedLog)
    if (compressed !== null) {
      const text = decodeZstdLog(compressed)
      if (text !== null && text !== '') return collectUsageRows(text).filter(row => row.at >= sinceMs)
    }
    // zstd 缺失/损坏/为空 → 同目录明文日志兜底。
    const plain = await readLogIfPossible(plainLog)
    if (plain !== null) return collectUsageRows(plain.toString('utf8')).filter(row => row.at >= sinceMs)
  }
  return null
}

async function readLogIfPossible(logPath: string): Promise<Buffer | null> {
  try {
    return await readFile(logPath)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 顶层聚合
// ---------------------------------------------------------------------------

export async function readDshUsage(dshHome: string, nowMs: number = Date.now()): Promise<DshUsageResult> {
  try {
    let projectionRaw: string
    try {
      projectionRaw = await readFile(path.join(dshHome, 'storages', 'session_projcache.json'), 'utf8')
    } catch {
      return { status: 'no-data' }
    }
    const sessions = readProjectionSessions(JSON.parse(projectionRaw))
    if (sessions.size === 0) return { status: 'no-data' }

    const todayStart = startOfLocalDay(nowMs)
    let today = EMPTY_SAMPLE
    let overall = EMPTY_SAMPLE
    for (const [sessionId, session] of sessions) {
      overall = addSamples(overall, session.sample)
      if (session.createdAt >= todayStart) {
        // 今日新建的会话：投影 totals 即最终值，整份计入今日。
        today = addSamples(today, session.sample)
        continue
      }
      if (session.lastPromptAt !== null && session.lastPromptAt >= todayStart && isSafeSessionId(sessionId)) {
        // 跨天活跃会话：投影是历史累计，只取今日时间窗内的逐 step 明细。
        const rows = await usageRowsSince(dshHome, sessionId, todayStart)
        if (rows !== null) {
          for (const row of rows) {
            today = addSamples(today, {
              uncachedInput: row.uncachedInput,
              output: row.output,
              cacheRead: row.cacheRead,
            })
          }
        }
      }
    }
    const usage: DshUsage = {
      tokensToday: sampleTotal(today),
      tokensTotal: sampleTotal(overall),
      cacheHitRate: sampleHitRate(today) ?? sampleHitRate(overall),
    }
    return { status: 'ok', usage }
  } catch (cause) {
    return { status: 'error', message: cause instanceof Error ? cause.message : '读取本地用量失败' }
  }
}
