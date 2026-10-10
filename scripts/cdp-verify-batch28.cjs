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
// Verify batch-28: items 2 (bg+dim), 3 (layout), 4 (card bg), 5 (settings bg), 6 (about gradient).
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
  // item 2: bg + dim vars
  const r2=await ev('({dim:getComputedStyle(document.documentElement).getPropertyValue("--launcher-dim").trim(),bg:getComputedStyle(document.documentElement).getPropertyValue("--launcher-background-image").trim(),headerBottom:!!document.querySelector(".instance-header-bottom")})')
  // open settings, check card bg + settings bg + about gradient
  await ev('(()=>{document.querySelector("[aria-label=\\"启动器设置\\"]").click();return true})()')
  await ev('(async()=>{const d=Date.now()+8000;while(Date.now()<d){if(document.querySelector(".settings-dialog"))break;await new Promise(r=>setTimeout(r,150))}return true})()')
  const r45=await ev('(async()=>{const win=Array.from(document.querySelectorAll(".settings-category")).find(b=>(b.textContent||"").includes("窗口"));if(win)win.click();await new Promise(r=>setTimeout(r,300));let text=document.querySelector(".settings-dialog")?.innerText||"";const cardBg=text.includes("卡片背景色")&&text.includes("卡片背景图")&&text.includes("卡片背景透明度")&&text.includes("卡片字体颜色");const settingsBg=text.includes("设置界面背景图")&&text.includes("设置界面背景透明度");const about=Array.from(document.querySelectorAll(".settings-category")).find(b=>(b.textContent||"").includes("关于"));if(about)about.click();await new Promise(r=>setTimeout(r,300));const h4=document.querySelector(".about-brand h4");const gradient=h4?getComputedStyle(h4).webkitTextFillColor:"none";const close=document.querySelector(".settings-close-button");if(close)close.click();return {cardBg,settingsBg,gradient}})()')
  c.close()
  const verdict={
    dimApplied: r2.dim.includes('rgba'),
    bgApplied: r2.bg.includes('launcher-asset://launcher-background.png'),
    headerLayout: r2.headerBottom===true,
    cardBg: r45.cardBg===true,
    settingsBg: r45.settingsBg===true,
    aboutGradient: r45.gradient==='rgba(0, 0, 0, 0)' || r45.gradient==='',
  }
  verdict.PASS=Object.values(verdict).every(v=>v===true)
  console.log(JSON.stringify({...r2,...r45,verdict},null,2))
  if(!verdict.PASS) process.exitCode=2
})().catch(e=>{console.error('ERROR',e.stack||e);process.exitCode=1})
