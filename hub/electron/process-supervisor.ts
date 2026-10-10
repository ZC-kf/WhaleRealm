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
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { WINDOWS_JOB_SOURCE } from './windows-job-source'
export class ProcessCleanupError extends Error { readonly cleanupUnsafe = true }
export interface ProcessExit { code: number | null; signal: string | null }
export interface ProcessIdentity { pid: number; createdAt: string; image: string }
export interface OwnedProcess { pid: number; identity: ProcessIdentity; exited: Promise<ProcessExit>; stop(): Promise<void>; pause(): Promise<void>; resume(): Promise<void> }
export interface OwnedProcessOptions { cwd?: string; env?: NodeJS.ProcessEnv; windowsHide?: boolean; signal?: AbortSignal; onOutput?: (text: string) => void }
export function bounded<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
 return new Promise((resolve,reject) => { const timer=setTimeout(()=>reject(new Error(`${label} timed out`)),milliseconds); promise.then(value=>{clearTimeout(timer);resolve(value)},error=>{clearTimeout(timer);reject(error)}) })
}
const owned = new Set<OwnedProcess>()
const pending = new Set<Promise<OwnedProcess>>()
const uncertainStartups: unknown[] = []
let closing = false
// CommandLineToArgvW quoting; no shell interprets the target command.
function quote(value: string): string { if(value.includes('\0')) throw new Error('Invalid command argument'); return '"'+value.replace(/(\\*)"/g,'$1$1\\"').replace(/(\\+)$/,'$1$1')+'"' }
const psQuote = (value: string) => "'"+value.replace(/'/g,"''")+"'"
export function spawnOwnedProcess(executable: string, args: string[], options: OwnedProcessOptions = {}): Promise<OwnedProcess> {
 if(closing) return Promise.reject(new Error('Launcher is shutting down'))
 const operation = launch(executable,args,options)
 pending.add(operation); void operation.then(()=>pending.delete(operation),error=>{pending.delete(operation);if(error instanceof ProcessCleanupError)uncertainStartups.push(error)})
 return operation
}
async function launch(executable: string,args: string[],options: OwnedProcessOptions): Promise<OwnedProcess> {
 if(process.platform!=='win32') throw new Error('Verified process ownership requires Windows Job Objects')
 options.signal?.throwIfAborted()
 const dir=await mkdtemp(path.join(tmpdir(),'whalerealm-job-'))
 const marker='JOB-'+randomUUID()+':'
 const command=[executable,...args].map(quote).join(' ')
 const script=path.join(dir,'owner.ps1')
 await writeFile(script,`\ufeff$ErrorActionPreference = 'Stop'\nAdd-Type -TypeDefinition @'\n${WINDOWS_JOB_SOURCE}\n'@\n[OwnedJob]::Run(${psQuote(command)},${psQuote(options.cwd??process.cwd())},$${options.windowsHide!==false},${psQuote(marker)})\n`)
 const broker=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script],{cwd:dir,env:options.env,windowsHide:true,stdio:['pipe','pipe','pipe']})
 let resolveReady!: (identity: ProcessIdentity)=>void, rejectReady!: (error: Error)=>void
 const ready=new Promise<ProcessIdentity>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject})
 let resolveExit!: (exit: ProcessExit)=>void, rejectExit!: (error: Error)=>void
 const exited=new Promise<ProcessExit>((resolve,reject)=>{resolveExit=resolve;rejectExit=reject})
 void exited.catch(()=>{})
 let finished=false, confirmedExit:ProcessExit|undefined, buffer='', stderr='', nextCommand=0
 const commands=new Map<string,{resolve:()=>void;reject:(error:Error)=>void}>()
 const fail=(error:Error)=>{rejectReady(error);if(!confirmedExit)rejectExit(error);for(const wait of commands.values())wait.reject(error);commands.clear()}
 const send=(text:string)=>{if(broker.stdin.destroyed||!broker.stdin.writable)throw new Error('Process owner is unavailable');broker.stdin.write(text+'\n')}
 const cancel=()=>{try{send('stop')}catch(error){fail(error as Error)}}
 options.signal?.addEventListener('abort',cancel,{once:true})
 broker.stdin.on('error',error=>fail(error))
 broker.stdout.setEncoding('utf8')
 broker.stdout.on('data',(text:string)=>{
  buffer+=text; let newline:number
  while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline).replace(/\r$/,'');buffer=buffer.slice(newline+1)
   if(!line.startsWith(marker)){options.onOutput?.(line+'\n');continue}
   const [kind,...values]=line.slice(marker.length).split('|')
   if(kind==='ready')resolveReady({pid:Number(values[0]),createdAt:values[1],image:Buffer.from(values[2],'base64').toString('utf8')})
   else if(kind==='exit'){finished=true;confirmedExit={code:Number(values[0]),signal:null}}
   else if(kind==='fatal')fail(new Error(Buffer.from(values[0],'base64').toString('utf8')))
   else {const wait=commands.get(values[0]);commands.delete(values[0]);if(kind==='ack')wait?.resolve();else wait?.reject(new Error(Buffer.from(values[1],'base64').toString('utf8')))}
  }
 })
 broker.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-4000);options.onOutput?.(chunk.toString())})
 broker.once('error',fail)
 broker.once('close',code=>{
  options.signal?.removeEventListener('abort',cancel)
  // A protocol acknowledgement precedes the broker's finally block. Wait for
  // close so retained process handles and inherited pipes are also released.
  if(confirmedExit)resolveExit(confirmedExit)
  else fail(new Error(`Process owner exited without tree exit confirmation (${code}): ${stderr}`))
  void rm(dir,{recursive:true,force:true}).catch(()=>{})
 })
 if(options.signal?.aborted)cancel()
 let identity:ProcessIdentity
 try{identity=await bounded(ready,15000,'Process owner startup')}catch(error){broker.stdin.end();try{await bounded(exited,12000,'Failed startup cleanup')}catch(cleanupError){throw new ProcessCleanupError(`${String(error)}; ${String(cleanupError)}`)}throw error}
 const control=(verb:string)=>{
  const id=String(++nextCommand)
  const response=new Promise<void>((resolve,reject)=>{commands.set(id,{resolve,reject});try{send(verb+'|'+id)}catch(error){commands.delete(id);reject(error)}})
  return bounded(response,10000,`Process ${verb}`).finally(()=>commands.delete(id))
 }
 let stopPromise:Promise<void>|undefined
 const handle:OwnedProcess={pid:identity.pid,identity,exited,
  stop(){ if(!stopPromise)stopPromise=(async()=>{if(!finished)send('stop');await bounded(exited,12000,'Owned process exit')})().catch(error=>{throw new ProcessCleanupError(String(error))}).finally(()=>{stopPromise=undefined});return stopPromise },
  pause:()=>control('pause'),resume:()=>control('resume')}
 owned.add(handle);void exited.then(()=>owned.delete(handle),()=>{})
 if(options.signal?.aborted||closing){await handle.stop();throw new Error('Process startup cancelled')}
 return handle
}
export async function shutdownOwnedProcesses():Promise<void>{
 closing=true
 await bounded(Promise.allSettled([...pending]),20000,'Pending process startup')
 const results=await Promise.allSettled([...owned].map(handle=>handle.stop()))
 const failures=results.filter((r):r is PromiseRejectedResult=>r.status==='rejected')
 if(failures.length||uncertainStartups.length)throw new AggregateError([...failures.map(r=>r.reason),...uncertainStartups],'Owned process shutdown failed')
}
