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
// Minimal Electron harness to verify the CropDialog crop-source pipeline in real Chromium,
// WITHOUT launching the full WhaleRealm app (which would run instance management + mirror
// initialization). Registers launcher-asset with the SAME privileges/handler as main.ts,
// loads a file:// page (matching the app's renderer origin), then tests:
//   1) fetch() on launcher-asset:// returns image bytes,
//   2) blob -> ImageBitmap -> canvas -> toDataURL is NOT tainted (produces a valid PNG),
//   3) diagnostic: whether a direct launcher-asset:// <img> taints the canvas.
const { app, protocol, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

protocol.registerSchemesAsPrivileged([
  { scheme: 'launcher-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])

const imagePath = path.join(__dirname, '..', 'hub', 'public', 'launcher-background.png')
const pagePath = path.join(__dirname, 'verify-crop-source.html')

app.whenReady().then(async () => {
  protocol.handle('launcher-asset', async request => {
    const name = decodeURIComponent(new URL(request.url).hostname)
    if (name === 'launcher-background.png') {
      const body = fs.readFileSync(imagePath)
      return new Response(new Uint8Array(body), { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } })
    }
    return new Response('Not Found', { status: 404 })
  })

  const win = new BrowserWindow({ show: false })
  await win.loadFile(pagePath)
  const result = await win.webContents.executeJavaScript(`(async () => {
    const out = {}
    try {
      const res = await fetch('launcher-asset://launcher-background.png')
      out.fetchStatus = res.status
      const blob = await res.blob()
      out.fetchBlobSize = blob.size
      out.fetchType = blob.type
      const bmp = await createImageBitmap(blob)
      out.bitmapSize = bmp.width + 'x' + bmp.height
      const c = document.createElement('canvas'); c.width = 64; c.height = 64
      const cx = c.getContext('2d'); cx.drawImage(bmp, 0, 0, 64, 64)
      const du = c.toDataURL('image/png')
      out.blobPngPrefix = du.slice(0, 22)
      out.blobPngLength = du.length
      out.blobCanvasOk = true
    } catch (e) { out.blobError = String(e && e.message ? e.message : e) }
    try {
      const img = new Image()
      img.src = 'launcher-asset://launcher-background.png'
      await img.decode()
      out.directNatural = img.naturalWidth + 'x' + img.naturalHeight
      const c = document.createElement('canvas'); c.width = 10; c.height = 10
      const cx = c.getContext('2d'); cx.drawImage(img, 0, 0, 10, 10)
      try { c.toDataURL('image/png'); out.directTainted = false } catch (e) { out.directTainted = true }
    } catch (e) { out.directError = String(e && e.message ? e.message : e) }
    return out
  })()`, true)

  result.PASS = result.fetchStatus === 200 && result.fetchBlobSize > 0 && result.blobCanvasOk === true && result.blobPngLength > 0
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  app.exit(result.PASS ? 0 : 2)
})
