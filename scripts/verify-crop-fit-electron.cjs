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
// Verify the crop window shows the FULL imported image (no clipping) for a tall image,
// using the exact .crop-container/.crop-canvas CSS shipped in styles.css. Runs a minimal
// Electron window (no full-app instance management) and measures the rendered <img> box.
const { app, BrowserWindow } = require('electron')

const CSS = `
.crop-container { width:100%; max-height:62vh; overflow:hidden; text-align:center; border-radius:10px; background:#050607; user-select:none; touch-action:none; }
.crop-canvas { position:relative; display:inline-block; max-width:100%; line-height:0; vertical-align:top; }
.crop-canvas img { display:block; max-width:100%; max-height:62vh; width:auto; height:auto; pointer-events:none; }
`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 800, height: 600 })
  await win.loadURL(`data:text/html,<html><head><meta charset="utf-8"><style>${encodeURIComponent(CSS)}</style></head><body><div class="crop-container" style="width:500px"><div class="crop-canvas"><img id="tall"></div></div></body></html>`)

  const result = await win.webContents.executeJavaScript(`(async () => {
    // Tall image 400x1400 (portrait, taller than any reasonable crop viewport).
    const c = document.createElement('canvas'); c.width = 400; c.height = 1400
    const cx = c.getContext('2d'); cx.fillStyle = '#ff0000'; cx.fillRect(0, 0, 400, 1400)
    const img = document.getElementById('tall'); img.src = c.toDataURL('image/png')
    await img.decode()
    const r = img.getBoundingClientRect()
    const box = document.querySelector('.crop-container').getBoundingClientRect()
    return {
      natural: img.naturalWidth + 'x' + img.naturalHeight,
      rendered: Math.round(r.width) + 'x' + Math.round(r.height),
      container: Math.round(box.width) + 'x' + Math.round(box.height),
      imgInsideContainer: r.top >= box.top && r.bottom <= box.bottom && r.left >= box.left && r.right <= box.right,
      aspectPreserved: Math.abs((r.width / r.height) - (400 / 1400)) < 0.01,
      notClipped: r.height <= box.height && r.width <= box.width,
    }
  })()`, true)

  result.PASS = result.imgInsideContainer && result.aspectPreserved && result.notClipped
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  app.exit(result.PASS ? 0 : 2)
})
