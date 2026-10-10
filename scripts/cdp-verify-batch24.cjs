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
// Verify batch-24: background actually loads + new header titles (kicker/title).
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
  await ev('(async()=>{const d=Date.now()+60000;while(Date.now()<d){if(document.querySelector(".launcher-home"))return true;await new Promise(r=>setTimeout(r,300))}return false})()')
  await ev('(()=>{const g=document.querySelector("[aria-label=\\"首次使用引导\\"]");if(g){const x=g.querySelector("[aria-label=\\"关闭引导\\"]");if(x)x.click()}return true})()')
  const report={}
  report.kicker=await ev('document.querySelector(".launcher-kicker")?.textContent')
  report.title=await ev('document.querySelector(".instance-switcher__header h2")?.textContent')
  report.titleGradient=await ev('getComputedStyle(document.querySelector(".instance-switcher__header h2")).webkitTextFillColor')
  report.bgVar=await ev('getComputedStyle(document.documentElement).getPropertyValue("--launcher-background-image").trim()')
  report.bgLoad=await ev('(async()=>{return await new Promise(res=>{const i=new Image();i.onload=()=>res({ok:true,w:i.naturalWidth,h:i.naturalHeight});i.onerror=()=>res({ok:false});i.src="launcher-asset://launcher-background.png";setTimeout(()=>res({ok:false,timeout:true}),6000)})})()')
  c.close()
  const verdict={
    kickerCorrect: report.kicker==='DeepSeek Harness 实例',
    titleCorrect: (report.title||'').includes('鲸域'),
    titleArtText: report.titleGradient!=='rgb(0, 0, 0)' && report.titleGradient!=='',
    bgViaProtocol: (report.bgVar||'').includes('launcher-asset://launcher-background.png'),
    bgLoaded: report.bgLoad && report.bgLoad.ok===true,
  }
  verdict.PASS=Object.values(verdict).every(v=>v===true)
  console.log(JSON.stringify({...report,verdict},null,2))
  if(!verdict.PASS) process.exitCode=2
})().catch(e=>{console.error('ERROR',e.stack||e);process.exitCode=1})
