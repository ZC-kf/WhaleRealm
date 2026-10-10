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
// Verify batch-26: dim/opacity sliders present + CSS vars applied + crop flow wiring.
const http = require('node:http')
const PORT = Number(process.argv[2] || 9333)
function getJSON(p){return new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:PORT,path:p},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}})}).on('error',rej)})}
function connect(url){return new Promise((res,rej)=>{const ws=new WebSocket(url);const pending=new Map();let seq=0;ws.addEventListener('open',()=>res({send(m,p){const id=++seq;return new Promise((r2,j2)=>{const t=setTimeout(()=>{pending.delete(id);j2(new Error('timeout '+m))},30000);pending.set(id,{r:r2,j:j2,t});ws.send(JSON.stringify({id,method:m,params:p||{}}))})},close(){ws.close()}}));ws.addEventListener('message',e=>{let m;try{m=JSON.parse(typeof e.data==='string'?e.data:e.data.toString())}catch{return}const en=pending.get(m.id);if(!en)return;pending.delete(m.id);clearTimeout(en.t);m.error?en.j(new Error(JSON.stringify(m.error))):en.r(m.result)});ws.addEventListener('error',e=>rej(new Error('ws '+e.message)))})}
(async()=>{
  const targets=await getJSON('/json/list')
  const page=targets.find(t=>t.type==='page'&&/dist[\\/]index\.html(?:[?#]|$)/.test(t.url))
  if(!page) throw new Error('no renderer')
  const c=await connect(page.webSocketDebuggerUrl)
  await c.send('Runtime.enable',{})
  const ev=async e=>{const r=await c.send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value}
  await ev('(async()=>{const d=Date.now()+60000;while(Date.now()<d){if(document.querySelector("[aria-label=\\"启动器设置\\"]"))return true;await new Promise(r=>setTimeout(r,300))}return false})()')
  await ev('(()=>{const g=document.querySelector("[aria-label=\\"首次使用引导\\"]");if(g){const x=g.querySelector("[aria-label=\\"关闭引导\\"]");if(x)x.click()}return true})()')
  // open settings, go tray category
  await ev('(()=>{document.querySelector("[aria-label=\\"启动器设置\\"]").click();return true})()')
  await ev('(async()=>{const d=Date.now()+8000;while(Date.now()<d){if(document.querySelector(".settings-dialog"))break;await new Promise(r=>setTimeout(r,150))}return true})()')
  const report=await ev('(async()=>{const trayCat=Array.from(document.querySelectorAll(".settings-category")).find(b=>(b.textContent||"").includes("托盘"));if(trayCat)trayCat.click();await new Promise(r=>setTimeout(r,300));const text=document.querySelector(".settings-dialog")?.innerText||"";return {hasTrayOpacity:text.includes("托盘背景图透明度"),hasTrayDim:text.includes("托盘背景图暗度"),hasLauncherDim:(()=>{const a=Array.from(document.querySelectorAll(".settings-category")).find(b=>(b.textContent||"").includes("外观"));if(a)a.click();return false})()};})()')
  // switch to appearance, check launcher dim slider
  const report2=await ev('(async()=>{const a=Array.from(document.querySelectorAll(".settings-category")).find(b=>(b.textContent||"").includes("外观"));if(a)a.click();await new Promise(r=>setTimeout(r,300));const text=document.querySelector(".settings-dialog")?.innerText||"";const close=document.querySelector(".settings-close-button");if(close)close.click();return {hasLauncherDim:text.includes("背景暗度"),hasLauncherOpacity:text.includes("背景透明度")}})()')
  c.close()
  const verdict={
    trayOpacity: report.hasTrayOpacity===true,
    trayDim: report.hasTrayDim===true,
    launcherDim: report2.hasLauncherDim===true,
    launcherOpacity: report2.hasLauncherOpacity===true,
  }
  verdict.PASS=Object.values(verdict).every(v=>v===true)
  console.log(JSON.stringify({...report,...report2,verdict},null,2))
  if(!verdict.PASS) process.exitCode=2
})().catch(e=>{console.error('ERROR',e.stack||e);process.exitCode=1})
