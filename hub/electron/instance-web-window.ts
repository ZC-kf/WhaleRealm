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

import type { BrowserWindow, WebPreferences } from 'electron'
import { approvedWebUrl } from './web-runtime'

const approvals = new Map<string, { origin: string; storagePath: string }>()
const windows = new Map<string, BrowserWindow>()
export function instanceWebPartition(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) throw new Error('Invalid Web instance id')
  return `persist:whalerealm-web-${id}`
}
export function webWindowPreferences(id: string): WebPreferences {
  return { partition: instanceWebPartition(id), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }
}
export function isAllowedWebNavigation(url: string, origin: string): boolean {
  try {const parsed=new URL(url);return parsed.origin===origin && parsed.protocol==='http:' && !parsed.username && !parsed.password} catch {return false}
}
export function approveInstanceWebWindow(id: string, port: number, storagePath: string): void {
  instanceWebPartition(id)
  if (!approvedWebUrl(`http://127.0.0.1:${port}`,port) || port===3080 || !Number.isInteger(port) || port<1 || port>65535) throw new Error('Invalid approved Web origin')
  const existing=approvals.get(id)
  if(windows.has(id) && (existing?.origin!==`http://127.0.0.1:${port}` || existing.storagePath!==storagePath)) throw new Error('Cannot change live Web session identity')
  if([...approvals].some(([other,value])=>other!==id && value.storagePath.toLowerCase()===storagePath.toLowerCase())) throw new Error('Web session storage already belongs to another instance')
  approvals.set(id,{origin:`http://127.0.0.1:${port}`,storagePath})
}
export async function openInstanceWebWindow(id: string, url: string): Promise<void> {
  const approval=approvals.get(id)
  if(!approval || !isAllowedWebNavigation(url,approval.origin)) throw new Error('Web URL is outside approved instance origin')
  const previous=windows.get(id)
  if(previous && !previous.isDestroyed()){previous.show();previous.focus();return}
  const {BrowserWindow,session}=await import('electron')
  if(approvals.get(id)!==approval)throw new Error('Web instance approval is no longer live')
  const concurrent=windows.get(id)
  if(concurrent && !concurrent.isDestroyed()){concurrent.show();concurrent.focus();return}
  // fromPath is Electron's persistent isolated session with instance-owned storage.
  const isolated=session.fromPath(approval.storagePath)
  isolated.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false))
  isolated.setPermissionCheckHandler(()=>false)
  isolated.on('will-download',event=>event.preventDefault())
  isolated.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,callback)=>{
    let allowed=isAllowedWebNavigation(details.url,approval.origin)
    try {const parsed=new URL(details.url);allowed ||= parsed.protocol==='ws:' && parsed.host===new URL(approval.origin).host && !parsed.username && !parsed.password;allowed ||= parsed.protocol==='blob:' && parsed.origin===approval.origin} catch { /* deny */ }
    callback({cancel:!allowed})
  })
  const {partition:_partition,...preferences}=webWindowPreferences(id)
  const window=new BrowserWindow({width:1180,height:800,title:`DSH · ${id}`,webPreferences:{...preferences,session:isolated}})
  windows.set(id,window)
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}))
  window.webContents.on('will-navigate',event=>{if(!isAllowedWebNavigation(event.url,approval.origin))event.preventDefault()})
  window.webContents.on('will-redirect',event=>{if(!isAllowedWebNavigation(event.url,approval.origin))event.preventDefault()})
  window.webContents.on('will-frame-navigate',event=>{if(!isAllowedWebNavigation(event.url,approval.origin))event.preventDefault()})
  window.on('closed',()=>{if(windows.get(id)===window)windows.delete(id)})
  try {
    await window.loadURL(url)
    if(approvals.get(id)!==approval || window.isDestroyed())throw new Error('Web instance approval is no longer live')
  } catch {
    if(windows.get(id)===window)closeInstanceWebWindow(id)
    throw new Error(`Web page failed to load for instance ${id}`)
  }
}
export function revokeInstanceWebWindow(id: string): void {
  approvals.delete(id)
  closeInstanceWebWindow(id)
}
export function closeInstanceWebWindow(id: string): void {
  const window=windows.get(id);windows.delete(id)
  if(window && !window.isDestroyed())window.destroy()
}
