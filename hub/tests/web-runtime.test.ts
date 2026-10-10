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

import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  WEB_NPM_REGISTRY,
  WEB_DSH_PACKAGE,
  buildNpmInstallCommand,
  buildWebPackageJson,
  dshBinIn,
  dshTarballUrl,
  installWebPackage,
  parseWebReadyUrl,
  webNodeExeIn,
} from '../electron/web-runtime'

describe('官方网页版运行支持（web-runtime.ts）', () => {
  it('dshTarballUrl 生成 npm 镜像 tarball 直链', () => {
    expect(dshTarballUrl('0.2.0-rc.2')).toBe('https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.0-rc.2.tgz')
    expect(dshTarballUrl('0.1.7-alpha.1')).toBe('https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.1.7-alpha.1.tgz')
  })

  it('webNodeExeIn / dshBinIn 指向实例目录内自含产物', () => {
    expect(webNodeExeIn('C:/inst/web')).toBe(path.join('C:/inst/web', 'node', 'node.exe'))
    expect(dshBinIn('C:/inst/web')).toBe(path.join('C:/inst/web', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
  })

  it('buildNpmInstallCommand：实例自带 node/npm、镜像源、实例内缓存、锁定版本', () => {
    const cmd = buildNpmInstallCommand('C:/inst/web', '0.2.0-rc.2')
    expect(cmd.cwd).toBe('C:/inst/web')
    expect(cmd.executable).toBe(path.join('C:/inst/web', 'node', 'node.exe'))
    expect(cmd.args[0]).toBe(path.join('C:/inst/web', 'node', 'node_modules', 'npm', 'bin', 'npm-cli.js'))
    expect(cmd.args).toContain('--no-audit')
    expect(cmd.args).toContain(WEB_NPM_REGISTRY)
    expect(cmd.args).toContain(path.join('C:/inst/web', '.npm-cache'))
    expect(cmd.args).toContain(`${WEB_DSH_PACKAGE}@0.2.0-rc.2`)
  })

  it('installWebPackage：以实例目录为 cwd 执行（防装错位置/污染当前目录）', async () => {
    const calls: Array<{ executable: string; args: string[]; cwd: string }> = []
    await installWebPackage('C:/inst/web', '0.2.0-rc.2', async (executable, args, cwd) => { calls.push({ executable, args, cwd }) })
    expect(calls).toHaveLength(1)
    expect(calls[0].cwd).toBe('C:/inst/web')
    expect(calls[0].executable).toBe(path.join('C:/inst/web', 'node', 'node.exe'))
    expect(calls[0].args).toContain(`${WEB_DSH_PACKAGE}@0.2.0-rc.2`)
  })

  it('buildWebPackageJson：private 最小 package.json（npm install 落点）', () => {
    const parsed = JSON.parse(buildWebPackageJson())
    expect(parsed).toEqual({ name: 'dsh-web-instance', private: true, version: '1.0.0' })
  })

  it('parseWebReadyUrl：解析就绪行（含会话 token），容忍 LAN 后缀，垃圾输入返回 null', () => {
    expect(parseWebReadyUrl('dsh web: http://127.0.0.1:3080')).toBe('http://127.0.0.1:3080')
    expect(parseWebReadyUrl('dsh web: http://127.0.0.1:19430/?token=AbC123_xyz')).toBe('http://127.0.0.1:19430/?token=AbC123_xyz')
    expect(parseWebReadyUrl('x\ndsh web: http://127.0.0.1:19430/?token=T1 (LAN: http://192.168.1.5:19430)\n')).toBe('http://127.0.0.1:19430/?token=T1')
    expect(parseWebReadyUrl('no url here')).toBe(null)
  })
})

it('uses the real owned Web process and cancels readiness without leaking it',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');const net=await import('node:net')
 const {spawnWebRunner}=await import('../electron/web-runtime')
 const root=await mkdtemp(path.join(tmpdir(),'whale-web-owned-'));let handle:Awaited<ReturnType<typeof spawnWebRunner>>|undefined
 const listener=net.createServer();await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=(listener.address() as import('node:net').AddressInfo).port;await new Promise<void>(resolve=>listener.close(()=>resolve()))
 try {
  const bin=path.join(root,'fixture.cjs');await writeFile(bin,'setInterval(()=>{},1000)')
  const abort=new AbortController()
  handle=await spawnWebRunner({node:process.execPath,binJs:bin,id:'fixture',port,dshHome:path.join(root,'home'),workspace:path.join(root,'work'),electronUserData:path.join(root,'electron'),lockName:'fixture'},undefined,abort.signal)
  const readiness=handle.waitReady(async()=>({ok:true,status:200}),2000)
  abort.abort();await expect(readiness).rejects.toThrow();await handle.exited
  expect(()=>process.kill(handle!.pid,0)).toThrow()
 }finally{await handle?.stop();await rm(root,{recursive:true,force:true})}
},15000)
