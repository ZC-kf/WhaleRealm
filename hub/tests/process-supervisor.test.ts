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
import { expect, it, vi } from 'vitest'
import * as ownership from '../electron/process-supervisor'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { spawn } from 'node:child_process'
import path from 'node:path'
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
it('owns A including detached child; stopping A leaves B alive and root identity is recorded', async () => {
 expect(ownership.spawnOwnedProcess).toBeTypeOf('function')
 const root = await mkdtemp(path.join(os.tmpdir(), 'whale job 中文-'))
 const handles: ownership.OwnedProcess[] = []
 try {
  const script = 'const {spawn}=require("node:child_process"); const c=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{detached:true,stdio:"ignore"}); console.log("DESC:"+c.pid); setInterval(()=>{},1000)'
  let descendant = 0
  const a = await ownership.spawnOwnedProcess(process.execPath, ['-e', script], { cwd: root, onOutput: text => { const m=text.match(/DESC:(\d+)/); if(m) descendant=Number(m[1]) } }); handles.push(a)
  const b = await ownership.spawnOwnedProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: root }); handles.push(b)
  expect(a.identity.createdAt).toMatch(/^\d+$/); expect(a.identity.image.toLowerCase()).toContain('node.exe')
  await vi.waitFor(()=>expect(descendant).toBeGreaterThan(0),{timeout:5000})
  expect(alive(descendant)).toBe(true)
  await a.pause(); await a.resume()
  await a.stop(); await a.exited
  expect(alive(a.pid)).toBe(false); expect(alive(descendant)).toBe(false); expect(alive(b.pid)).toBe(true)
 } finally { await Promise.all(handles.map(h=>h.stop())); await rm(root,{recursive:true,force:true}) }
}, 30000)

// Runs the production broker in a sacrificial Hub host. No PID search or third-party runtime.
it('Hub EOF closes its owned tree while an independently owned B survives', async () => {
 const root=await mkdtemp(path.join(os.tmpdir(),'whale-eof-'))
 let host: ReturnType<typeof spawn> | undefined; let b: ownership.OwnedProcess | undefined
 try {
  const source=await readFile(new URL('../electron/process-supervisor.ts',import.meta.url),'utf8')
  await writeFile(path.join(root,'process-supervisor.ts'), source.replace("'./windows-job-source'", "'./windows-job-source.ts'"))
  await writeFile(path.join(root,'windows-job-source.ts'),await readFile(new URL('../electron/windows-job-source.ts',import.meta.url)))
  const script='const {spawn}=require("node:child_process");const c=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{detached:true,stdio:"ignore"});console.log("DESC:"+c.pid);setInterval(()=>{},1000)'
  await writeFile(path.join(root,'host.mjs'), `import {spawnOwnedProcess} from './process-supervisor.ts'; const h=await spawnOwnedProcess(process.execPath,['-e',${JSON.stringify(script)}],{cwd:${JSON.stringify(root)},onOutput:t=>process.stdout.write(t)});console.log('ROOT:'+h.pid);`)
  b=await ownership.spawnOwnedProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:root})
  host=spawn(process.execPath,[path.join(root,'host.mjs')],{windowsHide:true,stdio:['ignore','pipe','pipe']})
  let output='';host.stdout!.on('data',chunk=>{output+=chunk.toString()});host.stderr!.on('data',chunk=>{output+=chunk.toString()})
  await vi.waitFor(()=>{expect(output).toMatch(/ROOT:\d+/);expect(output).toMatch(/DESC:\d+/)},{timeout:10000})
  const parent=Number(output.match(/ROOT:(\d+)/)![1]), child=Number(output.match(/DESC:(\d+)/)![1])
  const hostExit=new Promise(resolve=>host!.once('exit',resolve));host.kill();await hostExit
  await vi.waitFor(()=>{expect(alive(parent)).toBe(false);expect(alive(child)).toBe(false)},{timeout:10000})
  expect(alive(b.pid)).toBe(true)
 } finally {host?.kill();await b?.stop();await rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:100})}
},30000)

it('a crashed root cleans its orphaned descendant and stale handle cannot stop B',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'whale-orphan-'));const handles:ownership.OwnedProcess[]=[]
 try {
  let child=0
  const a=await ownership.spawnOwnedProcess(process.execPath,['-e','const {spawn}=require("node:child_process");const c=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{detached:true,stdio:"ignore"});console.log("DESC:"+c.pid);setTimeout(()=>process.exit(7),700)'],{cwd:root,onOutput:text=>{const m=text.match(/DESC:(\d+)/);if(m)child=Number(m[1])}});handles.push(a)
  expect((await a.exited).code).toBe(7);expect(child).toBeGreaterThan(0);expect(alive(child)).toBe(false)
  const b=await ownership.spawnOwnedProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:root});handles.push(b)
  // Exposed identity is informational, never authority. A stale/mutated PID must not target B.
  a.identity.pid=b.pid;a.pid=b.pid;await a.stop();expect(alive(b.pid)).toBe(true)
 }finally{await Promise.all(handles.map(h=>h.stop()));await rm(root,{recursive:true,force:true})}
},20000)
