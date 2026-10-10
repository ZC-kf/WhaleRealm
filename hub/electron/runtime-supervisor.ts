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

import { bounded, type ProcessExit } from './process-supervisor'
export type InstanceRuntimeStatus = 'stopped' | 'starting' | 'ready' | 'stopping' | 'crashed' | 'paused'
export interface RuntimeContext { id: string; port: number; dshHome: string }
export interface RuntimeHandle {
 pid: number; url: string; exited: Promise<ProcessExit>; ready?: Promise<string>
 stop(): Promise<void>; pause(): Promise<void>; resume(): Promise<void>; open?(): Promise<void>
}
export interface RuntimeState { instanceId: string; status: InstanceRuntimeStatus; pid: number | null; url: string | null; cleanupPending?: boolean }
export interface RuntimeSupervisor {
 start(id: string, context: RuntimeContext): Promise<void>; cancelStart(id: string): void
 stop(id: string): Promise<void>; pause(id: string): Promise<void>; resume(id: string): Promise<void>; open(id: string): Promise<void>
 state(id: string): RuntimeState; listStates(): RuntimeState[]; stopAll(): Promise<void>
}
interface Entry { state: RuntimeState; abort: AbortController; handle?: RuntimeHandle; starting?: Promise<void>; stopping?: Promise<void> }
export function createRuntimeSupervisor(options: { spawn: (context: RuntimeContext, signal: AbortSignal) => Promise<RuntimeHandle>; stopTimeoutMs?: number; onExit?: (id:string)=>void }): RuntimeSupervisor {
 const entries=new Map<string,Entry>(); let closing=false
 const timeout=options.stopTimeoutMs??15000
 const empty=(id:string):RuntimeState=>({instanceId:id,status:'stopped',pid:null,url:null})
 const dispose=async(entry:Entry)=>{if(entry.state.cleanupPending)throw new Error('Runtime tree exit is not confirmed');if(entry.handle){const handle=entry.handle;await bounded(handle.stop(),timeout,'Runtime stop');await bounded(handle.exited,timeout,'Runtime exit');entry.handle=undefined}entry.state={...entry.state,status:'stopped',pid:null,url:null}}
 const api:RuntimeSupervisor={
  start(id,context){
   if(closing)return Promise.reject(new Error('Launcher is shutting down'))
   const previous=entries.get(id)
   if(previous?.state.status==='paused')return api.resume(id)
   if(previous?.starting)return previous.starting
   if(previous?.state.status==='ready')return Promise.resolve()
   if(previous?.handle||previous?.stopping||previous?.state.cleanupPending)return Promise.reject(new Error('Previous process has not exited'))
   const entry:Entry={state:{...empty(id),status:'starting'},abort:new AbortController()};entries.set(id,entry)
   const operation=(async()=>{
    try{
     const handle=await options.spawn(context,entry.abort.signal);entry.handle=handle;entry.state.pid=handle.pid
     void handle.exited.then(()=>{
      if(entry.handle!==handle)return
      entry.handle=undefined;entry.state.pid=null;entry.state.url=null
      if(entry.state.status!=='stopping'&&entry.state.status!=='stopped')entry.state.status='crashed'
      options.onExit?.(id)
     },()=>{entry.state.status='crashed'})
     if(entry.abort.signal.aborted)throw new Error('Runtime startup cancelled')
     const url=handle.ready?await handle.ready:handle.url
     if(entry.abort.signal.aborted||entry.handle!==handle)throw new Error('Runtime exited or startup cancelled')
     entry.state={instanceId:id,status:'ready',pid:handle.pid,url}
    }catch(error){
     if(!entry.handle && error instanceof Error && 'cleanupUnsafe' in error)entry.state.cleanupPending=true
     if(entry.handle){entry.state.status='stopping';try{await dispose(entry)}catch(stopError){throw new AggregateError([error,stopError],'Startup failed and process cleanup failed')}}
     if(entry.state.status!=='stopped')entry.state.status=entry.abort.signal.aborted&&!entry.state.cleanupPending?'stopped':'crashed'
     throw error
    }
   })()
   entry.starting=operation;void operation.then(()=>{entry.starting=undefined},()=>{entry.starting=undefined});return operation
  },
  cancelStart(id){entries.get(id)?.abort.abort()},
  async open(id){
   const entry=entries.get(id),handle=entry?.handle
   if(closing || !entry || entry.abort.signal.aborted || entry.state.status!=='ready' || !handle?.open)throw new Error('instance is not running or cannot be opened')
   await handle.open()
   if(entry.abort.signal.aborted || entry.state.status!=='ready' || entry.handle!==handle)throw new Error('instance is not running')
  },
  stop(id){
   const entry=entries.get(id);if(!entry)return Promise.resolve()
   entry.abort.abort();if(entry.stopping)return entry.stopping
   entry.state.status='stopping'
   const operation=(async()=>{if(entry.starting)await bounded(entry.starting.catch(()=>{}),timeout,'Runtime startup cancellation');await dispose(entry)})()
   entry.stopping=operation;void operation.then(()=>{entry.stopping=undefined},()=>{entry.stopping=undefined;entry.state.status='crashed'});return operation
  },
  async pause(id){const e=entries.get(id);if(!e?.handle||e.state.status!=='ready')throw new Error('instance is not running');try{await bounded(e.handle.pause(),timeout,'Runtime pause')}catch(error){e.state.status='crashed';throw error};if(e.handle&&e.state.status==='ready')e.state.status='paused';else throw new Error('Runtime exited during pause')},
  async resume(id){const e=entries.get(id);if(!e?.handle||e.state.status!=='paused')throw new Error('instance is not paused');try{await bounded(e.handle.resume(),timeout,'Runtime resume')}catch(error){e.state.status='crashed';throw error};if(e.handle&&e.state.status==='paused')e.state.status='ready';else throw new Error('Runtime exited during resume')},
  state:id=>({...entries.get(id)?.state??empty(id)}),
  listStates:()=>[...entries.values()].map(e=>({...e.state})),
  async stopAll(){closing=true;for(const e of entries.values())e.abort.abort();const results=await Promise.allSettled([...entries.keys()].map(id=>api.stop(id)));const errors=results.filter((r):r is PromiseRejectedResult=>r.status==='rejected');if(errors.length)throw new AggregateError(errors.map(e=>e.reason),'Runtime shutdown failed')},
 }
 return api
}
