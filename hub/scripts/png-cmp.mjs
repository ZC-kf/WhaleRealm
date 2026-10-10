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

import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

function decodePng(file) {
  const buf = readFileSync(file)
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9] }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  const bpp = channels
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * bpp
  const prev = Buffer.alloc(stride)
  const out = Buffer.alloc(stride)
  let rp = 0
  const pixels = []
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++]
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0
      const b = prev[x]
      const c = x >= bpp ? prev[x - bpp] : 0
      let v = raw[rp++]
      if (filter === 1) v = (v + a) & 0xff
      else if (filter === 2) v = (v + b) & 0xff
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff
      else if (filter === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); v = (v + pr) & 0xff }
      out[x] = v
    }
    prev.set(out)
    for (let x = 0; x < width; x += 4) {
      const off = x * bpp
      pixels.push([out[off], out[off + 1], out[off + 2]])
    }
  }
  return { width, height, pixels }
}

function stats(pixels, x0, x1) {
  let sum = 0, n = 0, bright = 0, min = 999, max = 0
  const W = Math.round(1672)
  // x0/x1 are fractions of width
  for (let i = 0; i < pixels.length; i++) {
    // pixel index: rows are contiguous; compute x from index
    // we stored row-major with width sampled every 4 -> approx
  }
  return null
}

// simpler: decode returns full row-major list per row; redo inline below
for (const f of process.argv.slice(2)) {
  const buf = readFileSync(f)
  let pos = 8, W = 0, H = 0, colorType = 0
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos); const type = buf.toString('ascii', pos + 4, pos + 8); const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') { W = data.readUInt32BE(0); H = data.readUInt32BE(4); colorType = data[9] }
    else if (type === 'IDAT') idat.push(data); else if (type === 'IEND') break
    pos += 12 + len
  }
  const bpp = colorType === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(idat))
  const stride = W * bpp
  const prev = Buffer.alloc(stride), out = Buffer.alloc(stride)
  let rp = 0
  let sum = 0, n = 0, bright = 0, min = 999, max = 0
  let centerSum = 0, centerN = 0, centerBright = 0
  for (let y = 0; y < H; y++) {
    const filter = raw[rp++]
    for (let x = 0; x < stride; x++) { const a = x >= bpp ? out[x - bpp] : 0; const b = prev[x]; const c = x >= bpp ? prev[x - bpp] : 0; let v = raw[rp++]; if (filter === 1) v = (v + a) & 0xff; else if (filter === 2) v = (v + b) & 0xff; else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff; else if (filter === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); v = (v + pr) & 0xff } out[x] = v }
    prev.set(out)
    if (y % 4 !== 0) continue
    for (let x = 0; x < W; x += 4) {
      const off = x * bpp; const r = out[off], g = out[off + 1], b = out[off + 2]
      const l = 0.299 * r + 0.587 * g + 0.114 * b
      sum += l; n++; if (l > 128) bright++; if (l < min) min = l; if (l > max) max = l
      // center 80% horizontally
      if (x >= W * 0.1 && x <= W * 0.9) { centerSum += l; centerN++; if (l > 128) centerBright++ }
    }
  }
  console.log(JSON.stringify({ file: f.split('\\').pop(), size: `${W}x${H}`, avg: Math.round(sum / n), min: Math.round(min), max: Math.round(max), brightRatio: (bright / n).toFixed(2), centerAvg: Math.round(centerSum / centerN), centerBrightRatio: (centerBright / centerN).toFixed(2) }))
}
