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
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { WEB_NODE_SHA256, WEB_NODE_VERSION } from './web-runtime'

/** Pinned Node ZIP only; inspect every entry before writing and extract without a shell. */
export async function extractVerifiedNode(bytes: Buffer, destination: string, signal: AbortSignal): Promise<void> {
  if(createHash('sha256').update(bytes).digest('hex')!==WEB_NODE_SHA256)throw new Error('Node archive integrity check failed')
  let end=-1
  for(let offset=bytes.length-22;offset>=Math.max(0,bytes.length-65557);offset--)if(bytes.readUInt32LE(offset)===0x06054b50){end=offset;break}
  if(end<0 || bytes.readUInt16LE(end+4)!==0 || bytes.readUInt16LE(end+6)!==0)throw new Error('Unsupported Node ZIP')
  const count=bytes.readUInt16LE(end+10);let cursor=bytes.readUInt32LE(end+16)
  const entries:Array<{name:string;start:number;compressed:number;size:number;method:number;directory:boolean}>=[];const seen=new Set<string>();let expanded=0
  const prefix=`node-${WEB_NODE_VERSION}-win-x64/`
  for(let i=0;i<count;i++){
    if(bytes.readUInt32LE(cursor)!==0x02014b50)throw new Error('Invalid Node ZIP directory')
    const flags=bytes.readUInt16LE(cursor+8),method=bytes.readUInt16LE(cursor+10),compressed=bytes.readUInt32LE(cursor+20),size=bytes.readUInt32LE(cursor+24)
    const nameSize=bytes.readUInt16LE(cursor+28),extra=bytes.readUInt16LE(cursor+30),comment=bytes.readUInt16LE(cursor+32),local=bytes.readUInt32LE(cursor+42)
    const attributes=bytes.readUInt32LE(cursor+38)
    const archiveName=bytes.subarray(cursor+46,cursor+46+nameSize).toString('utf8');cursor+=46+nameSize+extra+comment
    if(!archiveName.startsWith(prefix) || archiveName.includes('\\') || archiveName.includes(':') || flags&1 || ![0,8].includes(method) || ((attributes>>>16)&0xf000)===0xa000)throw new Error('Unsafe Node ZIP entry')
    const name=archiveName.slice(prefix.length),directory=name.endsWith('/') || name==='';const components=name.replace(/\/$/,'').split('/')
    if(name && components.some(value=>!value || value==='.' || value==='..' || /[. ]$/.test(value) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)))throw new Error('Unsafe Node ZIP path')
    if(!name)continue
    if(seen.has(name.toLowerCase()))throw new Error('Duplicate Node ZIP path');seen.add(name.toLowerCase())
    expanded+=size;if(expanded>300*1024*1024)throw new Error('Node ZIP expansion limit exceeded')
    if(bytes.readUInt32LE(local)!==0x04034b50 || bytes.subarray(local+30,local+30+bytes.readUInt16LE(local+26)).toString('utf8')!==archiveName)throw new Error('Node ZIP local entry mismatch')
    const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28)
    if(start+compressed>bytes.length)throw new Error('Truncated Node ZIP')
    entries.push({name,start,compressed,size,method,directory})
  }
  await mkdir(destination,{recursive:false})
  for(const entry of entries){
    signal.throwIfAborted();const target=path.resolve(destination,entry.name);const relative=path.relative(destination,target)
    if(relative.startsWith('..') || path.isAbsolute(relative))throw new Error('Node ZIP escapes destination')
    if(entry.directory){await mkdir(target,{recursive:true});continue}
    const compressed=bytes.subarray(entry.start,entry.start+entry.compressed)
    const content=entry.method===8?inflateRawSync(compressed,{maxOutputLength:entry.size}):compressed
    if(content.length!==entry.size)throw new Error('Node ZIP size mismatch')
    await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content,{flag:'wx'})
  }
}
