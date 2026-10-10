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

import net from 'node:net'
export async function isLoopbackPortAvailable(port:number):Promise<boolean>{ return await new Promise(resolve=>{const s=net.createServer(); s.once('error',()=>resolve(false)); s.listen({host:'127.0.0.1',port,exclusive:true},()=>s.close(()=>resolve(true)))}) }
export async function allocateLoopbackPort(preferred:number,reserved:Set<number>,probe:isNumberProbe=(p)=>isLoopbackPortAvailable(p)):Promise<number>{ if(!Number.isInteger(preferred)||preferred<1||preferred>65535) throw new Error('invalid preferred port'); for(let i=0;i<65535;i++){const p=((preferred-1+i)%65535)+1;if(!reserved.has(p)&&await probe(p))return p} throw new Error('no loopback port available') }
type isNumberProbe=(port:number)=>Promise<boolean>