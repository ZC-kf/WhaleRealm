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

import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { createOfficialWebAdapter, prepareWebLayout } from '../electron/adapters/official-web'
import { resolveManagedLayout } from '../electron/instance-paths'
import { buildWebEnvironment } from '../electron/instance-env'
import { redactWebOutput, approvedWebUrl, createWebOutputRedactor } from '../electron/web-runtime'

it('uses an allowlisted environment for installs and runtime before any package runs', () => {
 const root=path.resolve('test-owned'); const layout=resolveManagedLayout(root)
 const env=buildWebEnvironment(layout,{DSH_HOME:'outside',NODE_OPTIONS:'--require evil',DSH_PKG_ALLOW_LAN:'1',DEEPSEEK_API_KEY:'secret',npm_config_userconfig:'outside',PATH:'system',SystemRoot:'C:/Windows'})
 expect(env.DSH_HOME).toBe(layout.dshHome); expect(env.npm_config_cache).toBe(layout.cache)
 expect(env.NODE_OPTIONS).toBeUndefined(); expect(env.DSH_PKG_ALLOW_LAN).toBeUndefined(); expect(env.DEEPSEEK_API_KEY).toBeUndefined()
 expect(env.npm_config_userconfig).toBe(path.join(layout.cache,'npmrc'))
 expect(env.DSH_TELEMETRY_DISABLED).toBe('1')
})
it('does not invoke npm when verified tarball bytes are corrupt', async () => {
 const root=await mkdtemp(path.join(tmpdir(),'web-deploy-')); const run=vi.fn()
 const expected=Buffer.from('expected'); const asset={assetId:'official-web:0.2.0-rc.2',kind:'official-web' as const,version:'0.2.0-rc.2',adapterId:'official-web',url:'https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.0-rc.2.tgz',integrity:`sha512-${createHash('sha512').update(expected).digest('base64')}`,format:'npm' as const,sourceRef:'test'}
 const adapter=createOfficialWebAdapter({download:async(url,dest)=>{const {writeFile}=await import('node:fs/promises');await writeFile(dest,url.endsWith('.tgz')?'corrupt':'node')},run,deployNode:async()=>{}})
 try {await expect(adapter.deploy(asset,resolveManagedLayout(root),new AbortController().signal)).rejects.toThrow('完整性'); expect(run).not.toHaveBeenCalled()}
 finally {await rm(root,{recursive:true,force:true})}
})
it('accepts only its exact loopback origin and redacts access tokens',()=>{
 expect(approvedWebUrl('http://127.0.0.1:19430/?token=secret',19430)).toBe(true)
 for(const url of ['http://127.0.0.1:19431/','http://localhost:19430/','http://user:pass@127.0.0.1:19430/','https://127.0.0.1:19430/'])expect(approvedWebUrl(url,19430)).toBe(false)
 expect(redactWebOutput('dsh web: http://127.0.0.1:19430/?token=secret')).not.toContain('secret')
})
it('redacts tokens split across stderr pipe fragments',()=>{
 const output:string[]=[];const logs=createWebOutputRedactor(text=>output.push(text))
 logs.write('dsh web: http://127.0.0.1:19430/?to');logs.write('ken=se');logs.write('cret\n');logs.finish()
 expect(output.join('')).toContain('[REDACTED]');expect(output.join('')).not.toContain('secret')
})
it('rebinds only its managed workspace overlay after publication, preserving user config',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'web-policy-'));const layout=resolveManagedLayout(root)
 try{
  const patch=await prepareWebLayout(layout)
  await writeFile(patch,(await readFile(patch,'utf8')).replace(layout.workspace,'old-staging-workspace'))
  const userPatch=path.join(layout.dshHome,'cordis.patch.yml');await writeFile(userPatch,'user-owned config\n')
  await prepareWebLayout(layout)
  expect(await readFile(patch,'utf8')).toContain(layout.workspace)
  expect(await readFile(patch,'utf8')).not.toContain('old-staging-workspace')
  expect(await readFile(userPatch,'utf8')).toBe('user-owned config\n')
  const npmrc=path.join(layout.cache,'npmrc');await writeFile(npmrc,'ignore-scripts=false\n')
  await expect(prepareWebLayout(layout)).rejects.toThrow('installer config')
  await writeFile(npmrc,'')
  await writeFile(patch,'user-owned file\n');await expect(prepareWebLayout(layout)).rejects.toThrow('not launcher-owned')
 }finally{await rm(root,{recursive:true,force:true})}
})
it('materializes the Windows user-profile data roots the community http plugin resolves',async()=>{
 // Tauri resolves app config/data dirs via the shell profile (%USERPROFILE%\AppData\{Roaming,Local}),
 // not the APPDATA/LOCALAPPDATA env vars; without them tauri-plugin-http aborts with
 // PluginInitialization("http","unknown path") before the window can boot.
 const root=await mkdtemp(path.join(tmpdir(),'web-appdata-'));const layout=resolveManagedLayout(root)
 try{
  await prepareWebLayout(layout)
  for(const name of ['Local','Roaming'])expect((await stat(path.join(layout.cache,'home','AppData',name))).isDirectory()).toBe(true)
 }finally{await rm(root,{recursive:true,force:true})}
})
