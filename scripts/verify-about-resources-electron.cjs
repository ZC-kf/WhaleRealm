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
// Verify the about-module runtime dependencies WITHOUT launching the full WhaleRealm app:
//   1) the 4 builtin launcher-asset resources are served via fetch (correct status/type/size),
//   2) main-process clipboard.writeText/readText round-trips.
// Registers launcher-asset with the SAME privileges + builtin whitelist as main.ts.
const { app, protocol, clipboard, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

protocol.registerSchemesAsPrivileged([
  { scheme: 'launcher-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])

const BUILTIN = {
  'launcher-background.png': 'image/png',
  'tray-background-default.png': 'image/png',
  'qq-group-qr.jpg': 'image/jpeg',
  'telegram-qr.jpg': 'image/jpeg',
}
const resourceDir = path.join(__dirname, '..', 'hub', 'public')
const pagePath = path.join(__dirname, 'verify-crop-source.html')

app.whenReady().then(async () => {
  protocol.handle('launcher-asset', async request => {
    const name = decodeURIComponent(new URL(request.url).hostname)
    const type = BUILTIN[name]
    if (type) {
      try {
        const body = fs.readFileSync(path.join(resourceDir, name))
        return new Response(new Uint8Array(body), { headers: { 'content-type': type, 'cache-control': 'no-store' } })
      } catch {
        return new Response('Not Found', { status: 404 })
      }
    }
    return new Response('Not Found', { status: 404 })
  })

  const win = new BrowserWindow({ show: false })
  await win.loadFile(pagePath)

  const fetchResults = await win.webContents.executeJavaScript(`(async () => {
    const names = ['launcher-background.png', 'tray-background-default.png', 'qq-group-qr.jpg', 'telegram-qr.jpg']
    const out = {}
    for (const n of names) {
      try {
        const res = await fetch('launcher-asset://' + n)
        const blob = await res.blob()
        out[n] = { status: res.status, type: blob.type, size: blob.size }
      } catch (e) {
        out[n] = { error: String(e && e.message ? e.message : e) }
      }
    }
    return out
  })()`, true)

  // Clipboard round-trip in the main process.
  clipboard.writeText('https://t.me/LF_WhaleRealm')
  const linkRead = clipboard.readText()
  clipboard.writeText('1125566250')
  const idRead = clipboard.readText()

  const report = { fetchResults, clipboard: { linkRead, idRead } }
  const allOk = Object.values(fetchResults).every(r => r.status === 200 && r.size > 0 && r.type)
  report.PASS = allOk && linkRead === 'https://t.me/LF_WhaleRealm' && idRead === '1125566250'
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  app.exit(report.PASS ? 0 : 2)
})
