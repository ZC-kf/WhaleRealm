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

/** Use Electron's resolved system network route only for this isolated installer. */
export async function resolveNpmSystemProxy(): Promise<string | undefined> {
  const {session}=await import('electron')
  const route=await session.defaultSession.resolveProxy('https://registry.npmjs.org')
  const first=route.split(';')[0].trim()
  if(first==='DIRECT')return undefined
  const match=/^(PROXY|HTTPS) ([^\s]+)$/.exec(first)
  if(!match)throw new Error('npm installer cannot use this system proxy route')
  const url=new URL(`${match[1]==='HTTPS'?'https':'http'}://${match[2]}`)
  if(url.username || url.password || url.pathname!=='/' || url.search || url.hash || !url.port)throw new Error('npm system proxy route is unsupported')
  return url.origin
}
