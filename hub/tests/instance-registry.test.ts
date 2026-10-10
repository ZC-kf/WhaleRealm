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

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createInstanceRegistry } from '../electron/instance-registry'

const persistenceFailure = vi.hoisted(() => ({ target: '' }))
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>()
  return { ...actual, rename: async (from: string, to: string) => {
    if (to === persistenceFailure.target) { persistenceFailure.target = ''; throw new Error('fixture atomic replacement failed') }
    return actual.rename(from, to)
  } }
})

const fixtures: string[] = []
afterEach(async () => { for (const root of fixtures.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() { const root = await mkdtemp(path.join(tmpdir(), 'dsh-task3-registry-')); fixtures.push(root); return root }
async function freePort() { const s = net.createServer(); await new Promise<void>(resolve => s.listen(0, '127.0.0.1', resolve)); const port = (s.address() as net.AddressInfo).port; await new Promise<void>(resolve => s.close(() => resolve())); return port }

describe('instance registry', () => {
  it('preserves explicit adapter identity and cache path on a legacy layout during create and rename', async () => {
    const root = await fixture(); const registry = createInstanceRegistry(root)
    const old = await registry.create({ id: 'adapter-legacy', adapterId: 'certified-legacy', cache: 'legacy-cache', port: await freePort() })
    expect(old.adapterId).toBe('certified-legacy')
    const renamed = await registry.update(old.id, { name: 'renamed' })
    expect(renamed.adapterId).toBe('certified-legacy')
    expect(renamed.cache).toBe('legacy-cache')
    expect(renamed.layoutVersion).toBeUndefined()
    expect(renamed.dshHome).toBe(path.join(root, 'instances', 'adapter-legacy', 'dsh-home'))
  })
  it('keeps both concurrent creates durable and returns independent record copies', async () => {
    const root = await fixture(); const registry = createInstanceRegistry(root)
    await Promise.all([registry.create({ id: 'a', port: await freePort() }), registry.create({ id: 'b', port: await freePort() })])
    expect((await createInstanceRegistry(root).list()).map(r => r.id).sort()).toEqual(['a', 'b'])
    const copy = await registry.get('a'); copy.root = 'changed by caller'
    expect((await registry.get('a')).root).toBe(path.join(root, 'instances', 'a'))
  })

  it.each(['{bad json', '{"id":"not-an-array"}', '[{"id":"incomplete"}]'])('recovers damaged main structure from a valid backup and quarantines original bytes: %s', async bad => {
    const root = await fixture(); const registry = createInstanceRegistry(root)
    await registry.create({ id: 'old', port: await freePort() })
    const file = path.join(root, 'hub-data', 'instances.json'); const good = await readFile(file, 'utf8')
    await writeFile(`${file}.bak`, good); await writeFile(file, bad)
    expect((await createInstanceRegistry(root).list()).map(r => r.id)).toEqual(['old'])
    const names = await readdir(path.dirname(file)); const quarantines = names.filter(n => n.startsWith('instances.json.corrupt-'))
    expect(quarantines).toHaveLength(1)
    expect(await readFile(path.join(path.dirname(file), quarantines[0]), 'utf8')).toBe(bad)
    expect(await readFile(`${file}.bak`, 'utf8')).toBe(good)
    expect(JSON.parse(await readFile(file, 'utf8'))[0].id).toBe('old')
  })

  it('quarantines malformed binary primary bytes exactly before backup recovery', async () => {
    const root = await fixture(); const registry = createInstanceRegistry(root)
    const old = await registry.create({ id: 'old', port: await freePort() })
    const file = path.join(root, 'hub-data', 'instances.json'); const good = await readFile(file)
    const damaged = Buffer.from([0x7b, 0xff, 0x7d])
    await writeFile(`${file}.bak`, good); await writeFile(file, damaged)
    expect(await registry.list()).toEqual([old])
    const names = (await readdir(path.dirname(file))).filter(name => name.startsWith('instances.json.corrupt-'))
    expect(names).toHaveLength(1)
    expect(await readFile(path.join(path.dirname(file), names[0]))).toEqual(damaged)
    expect(await readFile(file)).toEqual(good)
    expect(await readFile(`${file}.bak`)).toEqual(good)
  })

  it('recovers instead of silently accepting invalid UTF-8 within an otherwise valid recorded path', async () => {
    const root = await fixture(); const registry = createInstanceRegistry(root)
    const old = await registry.create({ id: 'old', dshHome: 'original-home', port: await freePort() })
    const file = path.join(root, 'hub-data', 'instances.json'); const good = await readFile(file)
    const text = good.toString('utf8'); const offset = text.indexOf('original-home')
    const damaged = Buffer.concat([Buffer.from(text.slice(0, offset)), Buffer.from([0xff]), Buffer.from(text.slice(offset + 1))])
    await writeFile(`${file}.bak`, good); await writeFile(file, damaged)
    expect(await registry.list()).toEqual([old])
    const names = (await readdir(path.dirname(file))).filter(name => name.startsWith('instances.json.corrupt-'))
    expect(names).toHaveLength(1)
    expect(await readFile(path.join(path.dirname(file), names[0]))).toEqual(damaged)
    expect(await readFile(file)).toEqual(good)
  })

  it('accepts valid multibyte UTF-8 paths including a deliberately encoded replacement character', async () => {
    const root = await fixture(); const registry = createInstanceRegistry(root)
    await registry.create({ id: 'unicode', dshHome: '用户资料/valid-\uFFFD-home', port: await freePort() })
    expect((await registry.get('unicode')).dshHome).toBe('用户资料/valid-\uFFFD-home')
    expect((await readdir(path.join(root, 'hub-data'))).sort()).toEqual(['instances.json', 'instances.json.bak'])
  })

  it('refuses an invalid-encoding backup without modifying either original file', async () => {
    const root = await fixture(); const registry = createInstanceRegistry(root)
    await registry.create({ id: 'old', dshHome: 'original-home', port: await freePort() })
    const file = path.join(root, 'hub-data', 'instances.json'); const text = (await readFile(file)).toString('utf8')
    const offset = text.indexOf('original-home')
    const badBackup = Buffer.concat([Buffer.from(text.slice(0, offset)), Buffer.from([0xff]), Buffer.from(text.slice(offset + 1))])
    const damaged = Buffer.from([0x7b, 0xff, 0x7d])
    await writeFile(`${file}.bak`, badBackup); await writeFile(file, damaged)
    await expect(registry.list()).rejects.toThrow(/backup invalid/)
    expect(await readFile(file)).toEqual(damaged)
    expect(await readFile(`${file}.bak`)).toEqual(badBackup)
    expect((await readdir(path.dirname(file))).sort()).toEqual(['instances.json', 'instances.json.bak'])
  })

  it('rejects a malformed kind even when its string conversion resembles a supported kind', async () => {
    const root = await fixture(); const registry = createInstanceRegistry(root)
    await registry.create({ id: 'old', port: await freePort() })
    const file = path.join(root, 'hub-data', 'instances.json'); const good = await readFile(file, 'utf8')
    const records = JSON.parse(good); records[0].instanceKind = ['official-web']
    await writeFile(`${file}.bak`, good); await writeFile(file, JSON.stringify(records))
    const restored = await registry.list()
    expect(restored[0].instanceKind).toBeUndefined()
    expect((await readdir(path.dirname(file))).filter(name => name.startsWith('instances.json.corrupt-'))).toHaveLength(1)
  })

  it('restores a missing main file from backup without losing an independently recorded legacy root', async () => {
    const root = await fixture(); const registry = createInstanceRegistry(root)
    const old = await registry.create({ id: 'old', root: 'independent-legacy-root', port: await freePort() })
    const file = path.join(root, 'hub-data', 'instances.json'); const good = await readFile(file, 'utf8')
    await writeFile(`${file}.bak`, good); await rm(file)
    expect(await registry.list()).toEqual([old])
    expect(await readFile(file, 'utf8')).toBe(good)
  })

  it('shares mutations and pending reservations across registry clients of the same root', async () => {
    const root = await fixture(); const a = createInstanceRegistry(root); const b = createInstanceRegistry(root)
    await Promise.all([a.create({ id: 'a', port: await freePort() }), b.create({ id: 'b', port: await freePort() })])
    await Promise.all([a.update('a', { name: 'A' }), b.update('b', { name: 'B' })])
    expect((await a.list()).map(r => r.name).sort()).toEqual(['A', 'B'])
    const [one, two] = await Promise.all([a.beginCreation('pending'), b.beginCreation('pending')])
    const preferred = await freePort()
    const ports = await Promise.all([a.reservePort(one, preferred), b.reservePort(two, preferred)])
    expect(new Set(ports).size).toBe(2)
    await Promise.all([a.releaseCreation(one), b.releaseCreation(two)])
    await Promise.all([a.remove('a'), b.update('b', { name: 'B updated' })])
    expect((await b.list()).map(r => ({ id: r.id, name: r.name }))).toEqual([{ id: 'b', name: 'B updated' }])
  })

  it('keeps the complete primary and backup when atomic replacement fails and continues later mutations', async () => {
    const root = await fixture(); const registry = createInstanceRegistry(root)
    await registry.create({ id: 'old', port: await freePort() })
    const file = path.join(root, 'hub-data', 'instances.json'); const good = await readFile(file, 'utf8')
    persistenceFailure.target = file
    await expect(registry.update('old', { name: 'failed rename' })).rejects.toThrow('fixture atomic replacement failed')
    expect(await readFile(file, 'utf8')).toBe(good)
    expect(await readFile(`${file}.bak`, 'utf8')).toBe(good)
    expect((await readdir(path.dirname(file))).filter(name => name.includes('.tmp-'))).toEqual([])
    expect((await registry.update('old', { name: 'later rename' })).name).toBe('later rename')
  })

  it('refuses uncertain corrupt state without creating an empty registry or removing files', async () => {
    const root = await fixture(); const directory = path.join(root, 'hub-data'); await mkdir(directory)
    const file = path.join(directory, 'instances.json'); await writeFile(file, 'broken'); await writeFile(`${file}.bak`, '[null]')
    const registry = createInstanceRegistry(root)
    await expect(registry.create({ id: 'new', port: await freePort() })).rejects.toThrow(/registry|backup/i)
    expect(await readFile(file, 'utf8')).toBe('broken'); expect(await readFile(`${file}.bak`, 'utf8')).toBe('[null]')
  })

  it('preserves the previous complete generation as backup and all explicit legacy paths on updates', async () => {
    const root = await fixture(); const registry = createInstanceRegistry(root)
    const legacy = await registry.create({ id: 'old', port: await freePort(), root: 'old-root', runtimeRoot: 'old-runtime', dshHome: 'old-home', electronUserData: 'old-profile', desktopProfile: 'old-desktop', workspace: 'old-work', logs: 'old-log' })
    const updated = await registry.update('old', { name: 'renamed' })
    expect(updated).toEqual({ ...legacy, name: 'renamed' })
    expect(JSON.parse(await readFile(path.join(root, 'hub-data', 'instances.json.bak'), 'utf8'))).toEqual([legacy])
    const created = await registry.create({ id: 'new', layoutVersion: 2, adapterId: 'web', root: path.join(root, 'chosen'), port: await freePort() })
    const v2 = await registry.update('new', { name: 'new name', layoutVersion: 2, adapterId: 'web-next', cache: 'explicit-cache' } as any)
    expect(v2).toEqual({ ...created, name: 'new name', adapterId: 'web-next', cache: 'explicit-cache' })
  })

  it('leases distinct ports to pending creates without early registration and releases a failed lease', async () => {
    const registry = createInstanceRegistry(await fixture()) as any
    const [a, b] = await Promise.all([registry.beginCreation('same'), registry.beginCreation('same')])
    expect(a).not.toBe(b)
    const preferred = await freePort()
    const [pa, pb] = await Promise.all([registry.reservePort(a, preferred), registry.reservePort(b, preferred)])
    expect(pa).not.toBe(pb); expect(await registry.list()).toEqual([])
    await registry.releaseCreation(a)
    const c = await registry.beginCreation('c'); expect(await registry.reservePort(c, pa)).toBe(pa)
    await registry.create({ id: b, port: pb }); await registry.releaseCreation(b)
    expect((await registry.get(b)).port).toBe(pb)
    await registry.releaseCreation(c)
  })

  it('serializes start reservations with pending creation and leaves an external listener alive', async () => {
    const registry = createInstanceRegistry(await fixture()) as any
    const server = net.createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const occupied = (server.address() as net.AddressInfo).port
    try {
      await registry.create({ id: 'existing', port: occupied + (occupied < 65535 ? 1 : -1) })
      const pending = await registry.beginCreation('pending')
      const ports = await Promise.all([registry.reservePort('existing', occupied), registry.reservePort(pending, occupied)])
      expect(new Set(ports).size).toBe(2); expect(ports).not.toContain(occupied)
      expect(server.listening).toBe(true)
      await registry.releaseCreation(pending)
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  })
  it('persists two records with distinct state roots', async () => {
    const root = await fixture()
    const registry = createInstanceRegistry(root)
    const stable = await registry.create({ id: 'stable', name: 'Stable', version: '0.1.7-alpha.1', port: await freePort() })
    const beta = await registry.create({ id: 'beta', name: 'Beta', version: '0.1.7-alpha.1', port: await freePort() })
    expect(stable.dshHome).not.toBe(beta.dshHome)
    expect((await registry.list())).toHaveLength(2)
  })

  it('rejects removal of a running instance', async () => {
    const root = await fixture()
    const registry = createInstanceRegistry(root)
    await registry.create({ id: 'stable', port: await freePort() })
    await registry.markRunning('stable')
    await expect(registry.remove('stable')).rejects.toThrow(/running/)
  })
})
