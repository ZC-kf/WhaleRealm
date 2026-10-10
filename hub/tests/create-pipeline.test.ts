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

import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beginCreateTransaction } from '../electron/create-transaction'
import { runCreatePipeline, type CreateDeps } from '../electron/instance-create'
import { createInstanceRegistry } from '../electron/instance-registry'
import { buildNpmInstallCommand, webNodeExeIn, dshBinIn } from '../electron/web-runtime'

const fixtures: string[] = []
afterEach(async () => { for (const root of fixtures.splice(0)) await rm(root, { recursive: true, force: true }) })
async function setup(overrides: Partial<CreateDeps> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-pipeline-test-')); fixtures.push(root)
  const target = path.join(root, '中文 实例'); const registrations = new Map<string, string>()
  const deps: CreateDeps = {
    fetchHead: async () => ({ ok: true, status: 200 }),
    beginTransaction: dir => beginCreateTransaction(dir, 'test', []),
    download: async (_url, dir) => { await writeFile(path.join(dir, 'node.exe'), 'node bytes') },
    verifyPackage: async dir => { expect(await readFile(path.join(dir, 'node.exe'), 'utf8')).toBe('node bytes') },
    register: async input => { registrations.set('id', input.path); return { ok: true, instanceId: 'id' } },
    unregister: async id => { registrations.delete(id) },
    ...overrides,
  }
  const request = { name: 'one', kind: 'official-web' as const, version: '1.0.0', path: target, downloadUrl: 'https://example/runtime' }
  return { root, target, deps, request, registrations }
}
it('registers only published paths and keeps runtime bytes at their final location', async () => {
  const x = await setup(); const result = await runCreatePipeline(x.request, x.deps, () => undefined)
  expect(result.ok).toBe(true); expect(x.registrations.get('id')).toBe(path.join(x.target, 'runtime'))
  expect(await readFile(path.join(x.target, 'runtime', 'node.exe'), 'utf8')).toBe('node bytes')
  expect((await readdir(x.root)).filter(name => name.startsWith('.dsh-create'))).toEqual([])
})
it('rolls back partial registration before deleting published task bytes', async () => {
  const x = await setup()
  x.deps.register = async input => { x.registrations.set('id', input.path); return { ok: false, instanceId: 'id', error: 'registration failed' } }
  x.deps.unregister = async id => { expect(await readFile(path.join(x.target, 'runtime', 'node.exe'), 'utf8')).toBe('node bytes'); x.registrations.delete(id) }
  const result = await runCreatePipeline(x.request, x.deps, () => undefined)
  expect(result.ok).toBe(false); expect(x.registrations.size).toBe(0); expect(await readdir(x.root)).toEqual([])
})
it('cancels after deployment and removes staging without registering', async () => {
  const controller = new AbortController(); const x = await setup()
  x.deps.download = async (_url, dir) => { await writeFile(path.join(dir, 'partial'), 'task'); controller.abort() }
  const result = await runCreatePipeline(x.request, x.deps, () => undefined, controller.signal)
  expect(result.ok).toBe(false); expect(result.error).toMatch(/cancel|取消/); expect(x.registrations.size).toBe(0)
  expect(await readdir(x.root)).toEqual([])
})
it('reports cleanup failure and preserves user bytes instead of claiming rollback succeeded', async () => {
  const x = await setup()
  x.deps.register = async () => { await writeFile(path.join(x.target, 'runtime', 'user'), 'keep me'); return { ok: false, error: 'register failed' } }
  const result = await runCreatePipeline(x.request, x.deps, () => undefined)
  expect(result.ok).toBe(false); expect(result.error).toMatch(/cleanup|清理/)
  expect(await readFile(path.join(x.target, 'runtime', 'user'), 'utf8')).toBe('keep me')
})
it('persists v2 paths under the published root with no staging references in Node/npm/DSH endpoints', async () => {
  const x = await setup(); const hub = path.join(x.root, 'hub'); const registry = createInstanceRegistry(hub)
  x.deps.register = async input => {
    await registry.create({ id: 'new', ...input.layout, layoutVersion: 2, adapterId: 'official-web', port: 19401 })
    return { ok: true, instanceId: 'new' }
  }
  const result = await runCreatePipeline(x.request, x.deps, () => undefined); expect(result.ok).toBe(true)
  const record = await createInstanceRegistry(hub).get('new')
  expect(record.root).toBe(x.target); expect(record.dshHome).toBe(path.join(x.target, 'data', 'dsh-home'))
  expect(record.runtimeRoot).toBe(path.join(x.target, 'runtime'))
  const npm = buildNpmInstallCommand(record.runtimeRoot!, '1.0.0')
  for (const endpoint of [webNodeExeIn(record.runtimeRoot!), dshBinIn(record.runtimeRoot!), npm.executable, npm.args[0]!, npm.cwd]) {
    expect(endpoint.startsWith(x.target + path.sep)).toBe(true); expect(endpoint).not.toContain('.dsh-create-')
  }
})
it('keeps registered files when deregistration fails rather than dangling a live record', async () => {
  const x = await setup()
  x.deps.register = async input => { x.registrations.set('id', input.path); return { ok: false, instanceId: 'id', error: 'failure after registration' } }
  x.deps.unregister = async () => { throw new Error('registry unavailable') }
  const result = await runCreatePipeline(x.request, x.deps, () => undefined)
  expect(result.ok).toBe(false); expect(result.error).toContain('撤销收录失败')
  expect(await readFile(path.join(x.target, 'runtime', 'node.exe'), 'utf8')).toBe('node bytes')
  expect(x.registrations.get('id')).toBe(path.join(x.target, 'runtime'))
})
it('preserves published files if registration cannot establish whether its record was saved', async () => {
  const x = await setup()
  x.deps.register = async () => ({ ok: false, error: 'registry status unavailable', ownershipUncertain: true })
  const result = await runCreatePipeline(x.request, x.deps, () => undefined)
  expect(result.ok).toBe(false); expect(result.error).toContain('registry status unavailable')
  expect(await readFile(path.join(x.target, 'runtime', 'node.exe'), 'utf8')).toBe('node bytes')
})
