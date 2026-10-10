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
// Drive the packaged Hub's real renderer over CDP so instance lifecycle goes through
// window.launcher -> preload ipcRenderer.invoke -> main ipcMain handlers -> supervisor.
// Uses Node's built-in global WebSocket; no external dependency.
const http = require('node:http')
const path = require('node:path')

const PORT = 9333
const HUB = process.env.DSH_HUB_ROOT ? path.resolve(process.env.DSH_HUB_ROOT) : path.resolve(__dirname, '..')
const RUNTIME_ROOT = path.join(HUB, 'runtimes', '0.1.7-alpha.1')
const IDS = ['gui-a', 'gui-b']
const PORTS = [19401, 19402]

function getTargets() {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: '/json/list' }, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch (error) { reject(error) } })
    }).on('error', reject)
  })
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const pending = new Map()
    let seq = 0
    ws.addEventListener('open', () => resolve({
      send(method, params) {
        const id = ++seq
        return new Promise((res, rej) => {
          const timer = setTimeout(() => { pending.delete(id); rej(new Error(`CDP timeout: ${method}`)) }, 120000)
          pending.set(id, { res, rej, timer })
          ws.send(JSON.stringify({ id, method, params }))
        })
      },
      close() { ws.close() },
    }))
    ws.addEventListener('message', event => {
      let msg
      try { msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString()) } catch { return }
      if (msg.id === undefined) return
      const entry = pending.get(msg.id)
      if (!entry) return
      pending.delete(msg.id)
      clearTimeout(entry.timer)
      if (msg.error) entry.rej(new Error(`${JSON.stringify(msg.error)}`))
      else entry.res(msg.result)
    })
    ws.addEventListener('error', event => reject(new Error(`websocket error: ${event.message ?? 'unknown'}`)))
  })
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
    throw new Error(`renderer exception: ${detail}`)
  }
  return result.result.value
}

async function main() {
  const targets = await getTargets()
  const page = targets.find(t => t.type === 'page' && /dist[\\/]index\.html/.test(t.url))
  if (!page) throw new Error('main renderer target not found')
  const client = await connect(page.webSocketDebuggerUrl)
  await client.send('Runtime.enable', {})

  const out = {}
  out.apiType = await evaluate(client, `typeof window.launcher`)
  out.instanceMethods = await evaluate(client, `Object.keys(window.launcher).filter(k => /instance/i.test(k)).sort()`)
  out.preexisting = await evaluate(client, `(async () => (await window.launcher.listInstances()).map(i => i.id))()`)

  const specs = IDS.map((id, index) => ({ id, name: id, version: '0.1.7-alpha.1', port: PORTS[index], runtimeRoot: RUNTIME_ROOT }))
  out.created = await evaluate(client, `(async () => {
    const specs = ${JSON.stringify(specs)}
    const results = []
    for (const spec of specs) {
      try { const r = await window.launcher.createInstance(spec); results.push({ id: r.id, port: r.port, runtimeRoot: r.runtimeRoot, dshHome: r.dshHome, electronUserData: r.electronUserData, desktopProfile: r.desktopProfile, lockName: r.lockName }) }
      catch (error) { results.push({ id: spec.id, error: String((error && error.message) || error) }) }
    }
    return results
  })()`)

  out.startResults = []
  for (const id of IDS) {
    try {
      out.startResults.push({ id, state: await evaluate(client, `(async () => await window.launcher.startInstance(${JSON.stringify(id)}))()`) })
    } catch (error) {
      out.startResults.push({ id, error: String(error.message || error) })
    }
  }

  await new Promise(resolve => setTimeout(resolve, 10000))
  out.states = await evaluate(client, `(async () => await window.launcher.listInstanceStates())()`)
  out.instances = await evaluate(client, `(async () => (await window.launcher.listInstances()).filter(i => ${JSON.stringify(IDS)}.includes(i.id)).map(i => ({ id: i.id, port: i.port, dshHome: i.dshHome, electronUserData: i.electronUserData, desktopProfile: i.desktopProfile, workspace: i.workspace, logs: i.logs, lockName: i.lockName, runtimeRoot: i.runtimeRoot })))()`)

  client.close()
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
}

main().catch(error => { process.stderr.write(`DRIVER_ERROR: ${(error && error.stack) || error}\n`); process.exitCode = 1 })
