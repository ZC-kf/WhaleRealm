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

import { lstat, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { stringify } from 'yaml'
import type { RuntimeAdapter, InstanceLayout, RuntimeAsset } from '../runtime-adapter'
import type { DesktopInstanceRecord } from '../instance-types'
import { buildWebEnvironment } from '../instance-env'
import { resolveManagedLayout } from '../instance-paths'
import { runOwnedCommand } from '../process'
import { ProcessCleanupError } from '../process-supervisor'
import { verifyRuntimeIntegrity } from '../runtime-assets'
import { WEB_NODE_DIST_URL, VERIFIED_WEB_VERSION, buildWebPackageJson, buildNpmInstallCommand, webNodeExeIn, dshBinIn, spawnWebRunner, createWebOutputRedactor, webSafeError } from '../web-runtime'
import { extractVerifiedNode } from '../verified-node-archive'
import { launchWebHost } from '../web-host-parent'
import { resolveNpmSystemProxy } from '../npm-network'

export { VERIFIED_WEB_VERSION }
const overlayHeader='# WhaleRealm managed Web policy v1\n'
interface AdapterDeps {
  download(url:string,destination:string,signal:AbortSignal):Promise<void>
  run?:typeof runOwnedCommand
  deployNode?:(archive:Buffer,destination:string,signal:AbortSignal)=>Promise<void>
  fetch?: (url:string,signal:AbortSignal)=>Promise<{ok:boolean;status:number}>
  host?:typeof launchWebHost
  onOutput?:(text:string)=>void
  installProxy?:()=>Promise<string|undefined>
}
function assertVersion(version:string|undefined){if(version!==VERIFIED_WEB_VERSION)throw new Error('该 Web 版本尚未通过隔离契约认证；仅支持 0.2.0-rc.2')}
async function rejectLinkedPaths(layout:InstanceLayout):Promise<void>{
  const derived=['home','app-data','local-app-data','temp','npmrc','global-npmrc'].map(name=>path.join(layout.cache,name))
  for(const target of [...Object.values(layout),...derived]){
    let candidate=path.resolve(target)
    for(;;){
      try{if((await lstat(candidate)).isSymbolicLink())throw new Error('Linked Web layout path is not owned')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
      const parent=path.dirname(candidate);if(parent===candidate)break;candidate=parent
    }
  }
}
export async function prepareWebLayout(layout:InstanceLayout):Promise<string>{
  await rejectLinkedPaths(layout)
  // Windows user-profile data roots: Tauri resolves its app config/data directories through the
  // shell profile (%USERPROFILE%\AppData\{Roaming,Local}), not the APPDATA/LOCALAPPDATA env vars,
  // so the community Desktop's http plugin aborts with PluginInitialization("http","unknown path")
  // when those directories are absent. Create them up front under the owned HOME (= USERPROFILE);
  // the isolated layout otherwise never materializes them.
  for(const directory of [layout.dshHome,layout.workspace,layout.cache,layout.electronUserData,layout.logs,...['home','app-data','local-app-data','temp'].map(name=>path.join(layout.cache,name)),...['AppData/Local','AppData/Roaming'].map(name=>path.join(layout.cache,'home',...name.split('/')))])await mkdir(directory,{recursive:true})
  for(const name of ['npmrc','global-npmrc']){
    const file=path.join(layout.cache,name)
    try{await writeFile(file,'',{flag:'wx'})}catch(error){
      if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error
      if(!(await lstat(file)).isFile() || await readFile(file,'utf8')!=='')throw new Error('Managed installer config must remain an empty owned file')
    }
  }
  const overlay=path.join(layout.dshHome,'managed-web.patch.yml')
  try{if((await lstat(overlay)).isSymbolicLink())throw new Error('Linked managed Web policy is not owned')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  const content=overlayHeader+stringify([{id:'workspace-controller',config:{documentsDirectory:path.join(layout.workspace,'documents'),documentsLookupTimeoutMs:10000}}])
  try{await writeFile(overlay,content,{flag:'wx'})}catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error
    const existing=await readFile(overlay,'utf8')
    if(!existing.startsWith(overlayHeader))throw new Error('Managed Web policy file is not launcher-owned')
    // Publication moves staging paths. Only this dedicated launcher-owned policy is regenerated.
    if(existing!==content)await writeFile(overlay,content)
  }
  return overlay
}
/** Exchange the private launch token in a fresh HTTP cookie jar; only authenticated HTML is ready. */
export async function probeWebReady(url:string,signal:AbortSignal):Promise<{ok:boolean;status:number}>{
  const response=await fetch(url,{signal,redirect:'manual'})
  if(response.status!==303)return {ok:false,status:response.status}
  const location=new URL(response.headers.get('location')??'',url)
  if(location.origin!==new URL(url).origin)return {ok:false,status:403}
  const cookies=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
  if(!cookies)return {ok:false,status:401}
  const page=await fetch(location,{signal,redirect:'manual',headers:{cookie:cookies}})
  const content=await page.text()
  return {ok:page.status===200 && content.includes('__DSH_BOOT__'),status:page.status}
}
function recordLayout(record:DesktopInstanceRecord):InstanceLayout{
  assertVersion(record.version)
  if(record.layoutVersion!==2 || record.adapterId!=='official-web')throw new Error('Legacy Web isolation cannot be certified; explicit managed deployment required')
  const layout=resolveManagedLayout(record.root)
  for(const name of ['runtimeRoot','dshHome','electronUserData','workspace','logs','cache'] as const)if(record[name]!==layout[name])throw new Error('Managed Web layout does not match owned record')
  return layout
}
async function validateLayout(layout:InstanceLayout):Promise<void>{
  const root=await realpath(layout.root)
  for(const value of [layout.runtimeRoot,layout.dshHome,layout.electronUserData,layout.workspace,layout.logs,layout.cache]){
    const resolved=await realpath(value);const relative=path.relative(root,resolved)
    if(!relative || relative.startsWith('..') || path.isAbsolute(relative))throw new Error('Web layout escapes instance ownership')
  }
}
export function createOfficialWebAdapter(deps:AdapterDeps):RuntimeAdapter{
  const run=deps.run??runOwnedCommand
  const probe=deps.fetch??probeWebReady
  const start=async(layout:InstanceLayout,port:number,id:string,signal:AbortSignal)=>{
    const patch=await prepareWebLayout(layout);await validateLayout(layout);signal.throwIfAborted()
    const handle=await spawnWebRunner({id,port,dshHome:layout.dshHome,electronUserData:layout.electronUserData,workspace:layout.workspace,cache:layout.cache,lockName:`dsh-web-${id}`,node:webNodeExeIn(layout.runtimeRoot),binJs:dshBinIn(layout.runtimeRoot),patch},deps.onOutput,signal)
    return handle
  }
  return {id:'official-web',kind:'official-web',
    async deploy(asset:RuntimeAsset,layout,signal){
      assertVersion(asset.version);if(asset.kind!=='official-web' || asset.format!=='npm' || asset.adapterId!=='official-web' || asset.url!==`https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-${asset.version}.tgz`)throw new Error('Invalid Web deployment asset')
      await prepareWebLayout(layout);await mkdir(layout.runtimeRoot,{recursive:true});await validateLayout(layout)
      const archive=path.join(layout.cache,'node.zip');await deps.download(WEB_NODE_DIST_URL,archive,signal)
      await (deps.deployNode??extractVerifiedNode)(await readFile(archive),path.join(layout.runtimeRoot,'node'),signal);await rm(archive)
      const tarball=path.join(layout.cache,'dsh-runtime.tgz');await deps.download(asset.url,tarball,signal)
      verifyRuntimeIntegrity(await readFile(tarball),asset);signal.throwIfAborted()
      await writeFile(path.join(layout.runtimeRoot,'package.json'),buildWebPackageJson(),{flag:'wx'})
      const command=buildNpmInstallCommand(layout.runtimeRoot,asset.version,tarball,layout.cache)
      const env=buildWebEnvironment(layout,process.env)
      const proxy=await (deps.installProxy??resolveNpmSystemProxy)()
      if(proxy){env.npm_config_proxy=proxy;env.npm_config_https_proxy=proxy}
      const logs=createWebOutputRedactor(deps.onOutput)
      try{await run(command.executable,command.args,600_000,{cwd:command.cwd,env,signal,onOutput:text=>logs.write(text)})}catch(error){throw webSafeError(error)}finally{logs.finish()}
      const installed=JSON.parse(await readFile(path.join(layout.runtimeRoot,'node_modules','@deepseek-ai','dsh','package.json'),'utf8'))
      if(installed.name!=='@deepseek-ai/dsh' || installed.version!==asset.version || !(await stat(dshBinIn(layout.runtimeRoot))).isFile())throw new Error('Installed Web entry/version mismatch')
      // npm records a portable file:../cache spec in package.json/lock. Keep the
      // SRI-verified source tarball in that owned cache across publication.
    },
    async selfcheck(layout,port,signal){
      const handle=await start(layout,port,'selfcheck',signal)
      try{await handle.waitReady(url=>probe(url,signal),120_000)}finally{try{await handle.stop();await handle.exited}catch(error){throw new ProcessCleanupError(`Web selfcheck cleanup could not be confirmed: ${String(error)}`)}}
    },
    async launch(record,signal){
      const layout=recordLayout(record)
      await prepareWebLayout(layout);await validateLayout(layout);signal.throwIfAborted()
      return (deps.host??launchWebHost)(record,signal)
    },
  }
}
