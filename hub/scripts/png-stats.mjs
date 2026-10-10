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

const file = process.argv[2]
const buf = readFileSync(file)
let pos = 8 // skip PNG signature
let width = 0, height = 0, bitDepth = 0, colorType = 0
const idat = []
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos)
  const type = buf.toString('ascii', pos + 4, pos + 8)
  const data = buf.subarray(pos + 8, pos + 8 + len)
  if (type === 'IHDR') {
    width = data.readUInt32BE(0)
    height = data.readUInt32BE(4)
    bitDepth = data[8]
    colorType = data[9]
  } else if (type === 'IDAT') {
    idat.push(data)
  } else if (type === 'IEND') {
    break
  }
  pos += 12 + len
}
const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
const bytesPerPixel = channels
const raw = inflateSync(Buffer.concat(idat))
const stride = width * bytesPerPixel
// sample every Nth pixel, applying filter None (assume filter 0; most tools write filter 0 or we approximate)
// We'll assume filter type 0 (None) for simplicity; most screenshots/tools use it, but PNGs can vary.
// Instead, do a full decode of filter types.
let sum = 0, count = 0, minL = 999, maxL = 0, bright = 0
const prev = Buffer.alloc(stride)
const out = Buffer.alloc(stride)
let rp = 0
for (let y = 0; y < height; y++) {
  const filter = raw[rp++]
  for (let x = 0; x < stride; x++) {
    const a = x >= bytesPerPixel ? out[x - bytesPerPixel] : 0
    const b = prev[x]
    const c = x >= bytesPerPixel ? prev[x - bytesPerPixel] : 0
    let v = raw[rp++]
    if (filter === 1) v = (v + a) & 0xff
    else if (filter === 2) v = (v + b) & 0xff
    else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff
    else if (filter === 4) {
      const p = a + b - c
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
      const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)
      v = (v + pr) & 0xff
    }
    out[x] = v
  }
  prev.set(out)
  // sample every 8th pixel row, every 8th column
  if (y % 8 === 0) {
    for (let x = 0; x < width; x += 8) {
      const off = x * bytesPerPixel
      const r = out[off], g = out[off + 1], b = out[off + 2]
      const l = 0.299 * r + 0.587 * g + 0.114 * b
      sum += l; count++
      if (l < minL) minL = l
      if (l > maxL) maxL = l
      if (l > 128) bright++
    }
  }
}
console.log(JSON.stringify({
  file, width, height, bitDepth, colorType, channels,
  avgLuminance: Math.round(sum / count),
  minLuminance: Math.round(minL),
  maxLuminance: Math.round(maxL),
  brightPixelRatio: (bright / count).toFixed(3),
}, null, 2))
