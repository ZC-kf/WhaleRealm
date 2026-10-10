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

import { afterAll, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as zlib from 'node:zlib'
import {
  collectUsageRows,
  decodeZstdLog,
  isSafeSessionId,
  readDshUsage,
  readProjectionSessions,
  sampleHitRate,
  sampleTotal,
  startOfLocalDay,
  zstdFrameSlices,
} from '../electron/dsh-usage'

const zstdCompressSync = (zlib as { zstdCompressSync?: (input: Buffer) => Buffer }).zstdCompressSync

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

const tempHomes: string[] = []
async function newHome(): Promise<string> {
  const home = await mkdtemp(path.join(os.tmpdir(), 'whalerealm-usage-'))
  tempHomes.push(home)
  return home
}

afterAll(async () => {
  await Promise.all(tempHomes.splice(0).map(home => rm(home, { recursive: true, force: true }).catch(() => undefined)))
})

/** 一条会话日志行：chunk 携带早期 usage 样本，message 携带最终样本。 */
function usageRow(kind: 'message' | 'chunk', turn: number, step: number, time: number, usage: Record<string, unknown>): string {
  const type = kind === 'chunk' ? 'assistant/chunk' : 'assistant/message'
  const data = kind === 'chunk'
    ? { turn, step, chunk: { type: 'usage', usage } }
    : { turn, step, message: { role: 'assistant' }, usage }
  return JSON.stringify({ type, seq: step, time, data })
}

/** 投影 JSON 字符串：{ 会话ID: { createdAt, totals, lastPromptAt } }。 */
function projectionOf(entries: Record<string, { createdAt: number; totals: Record<string, unknown>; lastPromptAt?: number | null }>): string {
  const sessions: Record<string, unknown> = {}
  for (const [id, spec] of Object.entries(entries)) {
    sessions[id] = {
      identity: { createdAt: spec.createdAt },
      rows: {
        tokenUsage: { val: { totals: spec.totals } },
        sessionListMetadata: { val: { lastPromptAt: spec.lastPromptAt ?? null } },
      },
    }
  }
  return JSON.stringify({ tables: { sessions } })
}

async function writeProjection(home: string, json: string): Promise<void> {
  await mkdir(path.join(home, 'storages'), { recursive: true })
  await writeFile(path.join(home, 'storages', 'session_projcache.json'), json, 'utf8')
}

async function writeSessionLog(home: string, project: string, sessionId: string, lines: string[], compressed = false): Promise<void> {
  const dir = path.join(home, 'sessions', project, sessionId)
  await mkdir(dir, { recursive: true })
  const payload = Buffer.from(lines.join('\n'), 'utf8')
  const body = compressed && zstdCompressSync ? zstdCompressSync(payload) : payload
  await writeFile(path.join(dir, compressed ? 'session.jsonl.zstd' : 'session.jsonl'), body)
}

// ---------------------------------------------------------------------------
// 数值语义
// ---------------------------------------------------------------------------

describe('样本合计与命中率', () => {
  it('总 Token = 未缓存输入 + 输出 + 缓存读', () => {
    expect(sampleTotal({ uncachedInput: 100, output: 50, cacheRead: 350 })).toBe(500)
    expect(sampleTotal({ uncachedInput: 0, output: 0, cacheRead: 0 })).toBe(0)
  })

  it('命中率 = 缓存读 /(缓存读+未缓存输入)；输入侧为零为 null', () => {
    expect(sampleHitRate({ uncachedInput: 100, output: 0, cacheRead: 300 })).toBeCloseTo(0.75, 10)
    expect(sampleHitRate({ uncachedInput: 0, output: 5, cacheRead: 0 })).toBeNull()
  })

  it('本地日零点：不晚于当前时刻；同一本地日内恒定；跨午夜推进', () => {
    const now = Date.now()
    const midnight = startOfLocalDay(now)
    expect(midnight).toBeLessThanOrEqual(now)
    expect(startOfLocalDay(midnight)).toBe(midnight)
    expect(startOfLocalDay(midnight + 3_600_000)).toBe(midnight) // 同日白天
    // 本地日界的推进量是一天（86400s，DST 日为 82800/90000s，用范围断言兼容）。
    const nextMidnight = startOfLocalDay(midnight + 90_000_000)
    expect(nextMidnight - midnight).toBeGreaterThanOrEqual(82_800_000)
    expect(nextMidnight - midnight).toBeLessThanOrEqual(90_000_000)
  })
})

// ---------------------------------------------------------------------------
// 会话日志解析
// ---------------------------------------------------------------------------

describe('collectUsageRows', () => {
  it('同 (turn,step) 折叠为一条：时间戳最新者胜，不重复计数', () => {
    const rows = collectUsageRows([
      usageRow('chunk', 1, 1, 100, { inputTokens: 100, outputTokens: 10, cacheReadTokens: 50 }),
      usageRow('message', 1, 1, 200, { inputTokens: 120, outputTokens: 12, cacheReadTokens: 60 }),
      usageRow('chunk', 1, 1, 150, { inputTokens: 999, outputTokens: 9, cacheReadTokens: 9 }),
      usageRow('message', 1, 2, 300, { inputTokens: 200, outputTokens: 20, cacheReadTokens: 80 }),
    ].join('\n'))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ turn: 1, step: 1, at: 200, uncachedInput: 120, output: 12, cacheRead: 60 })
  })

  it('同时刻冲突：文件中靠后的一行胜出', () => {
    const rows = collectUsageRows([
      usageRow('message', 1, 1, 500, { inputTokens: 10, outputTokens: 1, cacheReadTokens: 1 }),
      usageRow('message', 1, 1, 500, { inputTokens: 20, outputTokens: 2, cacheReadTokens: 2 }),
    ].join('\n'))
    expect(rows).toHaveLength(1)
    expect(rows[0].uncachedInput).toBe(20)
  })

  it('跳过撕裂行、非 usage 记录、缺字段行与非法数值', () => {
    const rows = collectUsageRows([
      '{"torn line without closing',
      JSON.stringify({ type: 'user/message', time: 1, data: { turn: 1, step: 1 } }),
      JSON.stringify({ type: 'assistant/message', data: { turn: 1, step: 1, usage: { inputTokens: 1 } } }), // 缺 time
      JSON.stringify({ type: 'assistant/message', time: 'x', data: { turn: 1, step: 1, usage: {} } }), // time 非数值
      JSON.stringify({ type: 'assistant/chunk', time: 5, data: { turn: 1, step: 1, chunk: { type: 'text', usage: {} } } }), // 非 usage chunk
      usageRow('message', 2, 1, 50, { inputTokens: -5, outputTokens: Number.NaN, cacheReadTokens: 7 }),
    ].join('\n'))
    expect(rows).toHaveLength(1)
    // 负数与 NaN 清洗为 0，合法的正数保留。
    expect(rows[0]).toMatchObject({ uncachedInput: 0, output: 0, cacheRead: 7 })
  })
})

// ---------------------------------------------------------------------------
// zstd 帧结构步进器与解码
// ---------------------------------------------------------------------------

describe('zstdFrameSlices / decodeZstdLog', () => {
  it.skipIf(!zstdCompressSync)('逐帧切出多帧拼接容器，尾部撕裂帧丢弃', () => {
    const frameA = zstdCompressSync!(Buffer.from('alpha\n'))
    const frameB = zstdCompressSync!(Buffer.from('beta\n'))
    const container = Buffer.concat([frameA, frameB, frameB.subarray(0, 9)]) // 第三帧撕裂
    const slices = zstdFrameSlices(container)
    expect(slices).toHaveLength(2)
    expect(slices[0]).toEqual({ start: 0, end: frameA.length })
    expect(slices[1]).toEqual({ start: frameA.length, end: frameA.length + frameB.length })
    const text = decodeZstdLog(container)
    expect(text).toContain('alpha')
    expect(text).toContain('beta')
  })

  it.skipIf(!zstdCompressSync)('压缩数据内部偶然出现的伪魔数不会截出新帧', () => {
    // 找一段"内容里含 zstd 魔数"的明文；帧步进器只认帧头位置，不会在数据中间切帧。
    const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
    let plaintext = ''
    for (let i = 0; i < 200; i++) plaintext += `payload-${i}-${magic.toString('hex')}\n`
    const frame = zstdCompressSync!(Buffer.from(plaintext))
    const slices = zstdFrameSlices(frame)
    expect(slices).toHaveLength(1)
    expect(slices[0]).toEqual({ start: 0, end: frame.length })
    expect(decodeZstdLog(frame)).toBe(plaintext)
  })

  it.skipIf(!zstdCompressSync)('帧内部损坏跳过该帧，其余帧照常解码', () => {
    const frameGood = zstdCompressSync!(Buffer.from('intact\n'))
    const frameCorrupt = zstdCompressSync!(Buffer.from('corrupt\n'))
    // 完整帧 + 一个帧头合法但块内容被翻转的帧。
    const corrupted = Buffer.from(frameCorrupt)
    corrupted[corrupted.length - 5] ^= 0xff
    const container = Buffer.concat([frameGood, corrupted])
    const text = decodeZstdLog(container)
    expect(text).toContain('intact')
  })

  it('非 zstd 容器无帧可解，解码结果为空文本', () => {
    // 帧步进器不认普通文本：0 帧切出，解码得到空串（调用方据此回退明文日志）。
    // decodeZstdLog 仅在 Node 无 zstd 能力时返回 null，本机有能力，不可直接断言 null。
    expect(zstdFrameSlices(Buffer.from('plain text, not zstd'))).toEqual([])
    expect(decodeZstdLog(Buffer.from('plain text, not zstd'))).toBe('')
  })

  it('可跳过帧（skippable frame）被整体跨过', () => {
    // 50 2A 4D 18 + 4 字节长度 + 载荷；后接普通帧。
    const skippable = Buffer.concat([Buffer.from([0x50, 0x2a, 0x4d, 0x18]), Buffer.from([3, 0, 0, 0]), Buffer.from([1, 2, 3])])
    const slices = zstdFrameSlices(skippable)
    expect(slices).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 投影解析
// ---------------------------------------------------------------------------

describe('readProjectionSessions', () => {
  it('解析 identity/totals/lastPromptAt 并清洗数值', () => {
    const map = readProjectionSessions(JSON.parse(projectionOf({
      good: { createdAt: 1700, totals: { uncachedInputTokens: 10, outputTokens: 20, cacheReadTokens: 30 }, lastPromptAt: 1800 },
      strNumbers: { createdAt: 1701, totals: { uncachedInputTokens: '15', outputTokens: -3, cacheReadTokens: Number.POSITIVE_INFINITY } },
    })))
    expect(map.size).toBe(2)
    expect(map.get('good')).toEqual({ createdAt: 1700, lastPromptAt: 1800, sample: { uncachedInput: 10, output: 20, cacheRead: 30 } })
    // 字符串/负数/Infinity 一律清洗为 0；lastPromptAt 缺失为 null。
    expect(map.get('strNumbers')).toEqual({ createdAt: 1701, lastPromptAt: null, sample: { uncachedInput: 0, output: 0, cacheRead: 0 } })
  })

  it('容忍缺 identity / 缺 totals / 空 sessions 表', () => {
    const map = readProjectionSessions({ tables: { sessions: {
      noIdentity: { rows: { tokenUsage: { val: { totals: { uncachedInputTokens: 1 } } } } },
      noTotals: { identity: { createdAt: 1 } },
      nullish: null,
    } } })
    expect(map.size).toBe(0)
    expect(readProjectionSessions({}).size).toBe(0)
    expect(readProjectionSessions('not an object').size).toBe(0)
  })
})

describe('isSafeSessionId', () => {
  it('接受常规会话 ID 形状', () => {
    expect(isSafeSessionId('sess-abc123')).toBe(true)
    expect(isSafeSessionId('a')).toBe(true)
    expect(isSafeSessionId('A_b-C9')).toBe(true)
  })

  it('拒绝路径成分与超长 ID', () => {
    expect(isSafeSessionId('../escape')).toBe(false)
    expect(isSafeSessionId('..')).toBe(false)
    expect(isSafeSessionId('a/b')).toBe(false)
    expect(isSafeSessionId('a\\b')).toBe(false)
    expect(isSafeSessionId('.hidden')).toBe(false)
    expect(isSafeSessionId('x'.repeat(81))).toBe(false)
    expect(isSafeSessionId('')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 端到端聚合
// ---------------------------------------------------------------------------

describe('readDshUsage', () => {
  const now = Date.now()
  const todayStart = startOfLocalDay(now)

  it('无投影文件返回 no-data；坏 JSON 返回 error', async () => {
    const home = await newHome()
    expect((await readDshUsage(home)).status).toBe('no-data')
    await writeProjection(home, 'not json at all')
    expect((await readDshUsage(home)).status).toBe('error')
  })

  it('今日新建会话计整份投影；跨天活跃会话只取今日窗口明细', async () => {
    const home = await newHome()
    await writeProjection(home, projectionOf({
      'session-new': { createdAt: todayStart + 1000, totals: { uncachedInputTokens: 1000, outputTokens: 200, cacheReadTokens: 8000 } },
      'session-old': { createdAt: todayStart - 86_400_000, totals: { uncachedInputTokens: 9999, outputTokens: 9999, cacheReadTokens: 9999 }, lastPromptAt: todayStart + 5000 },
    }))
    await writeSessionLog(home, 'proj-a', 'session-old', [
      usageRow('message', 1, 1, todayStart - 10, { inputTokens: 500, outputTokens: 50, cacheReadTokens: 400 }), // 昨日 step：不计入今日
      usageRow('message', 1, 2, todayStart + 10, { inputTokens: 300, outputTokens: 40, cacheReadTokens: 60 }),   // 今日 step
    ])
    const result = await readDshUsage(home, now)
    if (result.status !== 'ok') throw new Error(`expected ok, got ${result.status}`)
    // 今日 = 新会话投影(1000+200+8000) + 旧会话今日窗口(300+40+60)。
    expect(result.usage.tokensToday).toBe(9200 + 400)
    // 总和 = 两份投影合计。
    expect(result.usage.tokensTotal).toBe(9200 + 29997)
    // 今日命中率 = (8000+60) / (8000+60+1000+300)。
    expect(result.usage.cacheHitRate).toBeCloseTo(8060 / 9360, 6)
  })

  it('今日命中率无输入侧数据时回退历史总命中率', async () => {
    const home = await newHome()
    await writeProjection(home, projectionOf({
      oldOnly: { createdAt: todayStart - 86_400_000, totals: { uncachedInputTokens: 700, outputTokens: 0, cacheReadTokens: 300 } },
    }))
    const result = await readDshUsage(home, now)
    if (result.status !== 'ok') throw new Error(`expected ok, got ${result.status}`)
    expect(result.usage.tokensToday).toBe(0)
    expect(result.usage.cacheHitRate).toBeCloseTo(300 / 1000, 6)
  })

  it.skipIf(!zstdCompressSync)('zstd 日志优先读取', async () => {
    const home = await newHome()
    await writeProjection(home, projectionOf({
      s: { createdAt: todayStart - 86_400_000, totals: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }, lastPromptAt: todayStart + 60_000 },
    }))
    // 两个日志都在：zstd 是新数据，明文是过期数据；必须读到 zstd 的内容。
    await writeSessionLog(home, 'proj', 's', [usageRow('message', 1, 1, todayStart + 1000, { inputTokens: 900, outputTokens: 90, cacheReadTokens: 10 })], true)
    await writeSessionLog(home, 'proj', 's', [usageRow('message', 1, 1, todayStart + 1000, { inputTokens: 1, outputTokens: 1, cacheReadTokens: 1 })], false)
    const result = await readDshUsage(home, now)
    if (result.status !== 'ok') throw new Error(`expected ok, got ${result.status}`)
    expect(result.usage.tokensToday).toBe(1000)
  })

  it.skipIf(!zstdCompressSync)('zstd 损坏时回退同目录明文日志', async () => {
    const home = await newHome()
    await writeProjection(home, projectionOf({
      s: { createdAt: todayStart - 86_400_000, totals: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }, lastPromptAt: todayStart + 60_000 },
    }))
    // 伪装的 zstd 文件（帧头字节翻转，不可解码）+ 完好的明文日志。
    const dir = path.join(home, 'sessions', 'proj', 's')
    await mkdir(dir, { recursive: true })
    const fakeZstd = zstdCompressSync!(Buffer.from('garbage'))
    fakeZstd[6] ^= 0xff
    await writeFile(path.join(dir, 'session.jsonl.zstd'), fakeZstd)
    await writeSessionLog(home, 'proj', 's', [usageRow('message', 1, 1, todayStart + 1000, { inputTokens: 400, outputTokens: 40, cacheReadTokens: 60 })])
    const result = await readDshUsage(home, now)
    if (result.status !== 'ok') throw new Error(`expected ok, got ${result.status}`)
    expect(result.usage.tokensToday).toBe(500)
  })

  it('在多个 project 目录中搜索同一会话', async () => {
    const home = await newHome()
    await writeProjection(home, projectionOf({
      s: { createdAt: todayStart - 86_400_000, totals: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }, lastPromptAt: todayStart + 60_000 },
    }))
    // proj-a 下没有该会话；日志在 proj-b。
    await mkdir(path.join(home, 'sessions', 'proj-a', 'unrelated-session'), { recursive: true })
    await writeSessionLog(home, 'proj-b', 's', [usageRow('message', 1, 1, todayStart + 2000, { inputTokens: 250, outputTokens: 25, cacheReadTokens: 25 })])
    const result = await readDshUsage(home, now)
    if (result.status !== 'ok') throw new Error(`expected ok, got ${result.status}`)
    expect(result.usage.tokensToday).toBe(300)
  })

  it('恶意投影 session id（含路径成分）不触发目录穿越，聚合照常完成', async () => {
    const home = await newHome()
    // 投影里出现 ..\..\settings 这样的"会话 ID"：isSafeSessionId 拒绝它进入文件路径，
    // 该会话只贡献投影 totals，不会去读 home 之外的任何文件。
    const maliciousId = '..\\..\\settings'
    await writeProjection(home, projectionOf({
      [maliciousId]: { createdAt: todayStart - 86_400_000, totals: { uncachedInputTokens: 5, outputTokens: 5, cacheReadTokens: 5 }, lastPromptAt: todayStart + 5000 },
      benign: { createdAt: todayStart + 1, totals: { uncachedInputTokens: 100, outputTokens: 100, cacheReadTokens: 100 } },
    }))
    await writeFile(path.join(home, 'sentinel.json'), 'must not be read as a session log')
    const result = await readDshUsage(home, now)
    if (result.status !== 'ok') throw new Error(`expected ok, got ${result.status}`)
    // 恶意 ID 的投影 totals 仍计入总和（是 DSH 自己的投影数据），但没有文件被穿越读取。
    expect(result.usage.tokensTotal).toBe(315)
    expect(result.usage.tokensToday).toBe(300) // 只有今日新建的 benign
  })
})
