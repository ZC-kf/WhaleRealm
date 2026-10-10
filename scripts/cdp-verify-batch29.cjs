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
// Verify batch-29: item 7 full i18n coverage — language switch flips window chrome, guide callout, and settings.
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
  const wait=ms=>ev(`new Promise(r=>setTimeout(r,${ms}))`)

  await ev('(async()=>{const d=Date.now()+60000;while(Date.now()<d){if(document.querySelector("[aria-label=\\"启动器设置\\"]"))return true;await new Promise(r=>setTimeout(r,300))}return false})()')

  const closeGuide = `(()=>{const g=document.querySelector("[data-testid=\\"guide-callout\\"]");if(!g)return false;const b=Array.from(g.querySelectorAll("button")).find(x=>(x.textContent||"").trim()==="✕");if(b)b.click();return true})()`
  await ev(closeGuide)

  // zh baseline
  const zhGear = await ev(`!!document.querySelector('[aria-label="启动器设置"]')`)
  // open guide, read zh title
  await ev(`window.dispatchEvent(new Event("dsh-first-run-guide:open"));true`)
  await wait(400)
  const zhTitle = await ev(`(()=>{const h=document.querySelector('[data-testid="guide-callout"] h2');return h?h.textContent.trim():''})()`)
  await ev(closeGuide)

  // open settings, go to language, pick English
  await ev(`document.querySelector('[aria-label="启动器设置"]').click();true`)
  await ev('(async()=>{const d=Date.now()+8000;while(Date.now()<d){if(document.querySelector(".settings-dialog"))break;await new Promise(r=>setTimeout(r,150))}return true})()')
  const zhCategory = await ev(`(()=>{const s=document.querySelector(".settings-category span");return s?s.textContent.trim():''})()`)
  const langCat = await ev(`(()=>{const b=Array.from(document.querySelectorAll(".settings-category")).find(x=>(x.textContent||"").includes("语言"));if(b){b.click();return true}return false})()`)
  await ev('(async()=>{const d=Date.now()+5000;while(Date.now()<d){if(document.querySelector(".theme-option[title=\\"English\\"]"))break;await new Promise(r=>setTimeout(r,150))}return true})()')
  const enClicked = await ev(`(()=>{const b=document.querySelector('.theme-option[title="English"]');if(b){b.click();return true}return false})()`)

  // wait for re-render into English
  const enGear = await ev('(async()=>{const d=Date.now()+8000;while(Date.now()<d){if(document.querySelector("[aria-label=\\"Launcher settings\\"]"))return true;await new Promise(r=>setTimeout(r,200))}return false})()')
  const enSettingsTitle = await ev(`(()=>{const h=document.querySelector("#settings-title");return h?h.textContent.trim():''})()`)
  const enCategory = await ev(`(()=>{const s=document.querySelector(".settings-category span");return s?s.textContent.trim():''})()`)
  // close settings
  await ev(`(()=>{const b=document.querySelector(".settings-close-button");if(b)b.click();return true})()`)
  await wait(300)

  // open guide, read English title
  await ev(`window.dispatchEvent(new Event("dsh-first-run-guide:open"));true`)
  await wait(400)
  const enTitle = await ev(`(()=>{const h=document.querySelector('[data-testid="guide-callout"] h2');return h?h.textContent.trim():''})()`)
  await ev(closeGuide)

  // restore zh-CN
  await ev(`document.querySelector('[aria-label="Launcher settings"]').click();true`)
  await ev('(async()=>{const d=Date.now()+8000;while(Date.now()<d){if(document.querySelector(".settings-dialog"))break;await new Promise(r=>setTimeout(r,150))}return true})()')
  await ev(`(()=>{const b=Array.from(document.querySelectorAll(".settings-category")).find(x=>(x.textContent||"").includes("Language"));if(b){b.click();return true}return false})()`)
  await ev('(async()=>{const d=Date.now()+5000;while(Date.now()<d){if(document.querySelector(".theme-option[title=\\"Simplified Chinese\\"]"))break;await new Promise(r=>setTimeout(r,150))}return true})()')
  await ev(`(()=>{const b=document.querySelector('.theme-option[title="Simplified Chinese"]');if(b){b.click();return true}return false})()`)
  await ev('(async()=>{const d=Date.now()+8000;while(Date.now()<d){if(document.querySelector("[aria-label=\\"启动器设置\\"]"))break;await new Promise(r=>setTimeout(r,200))}return true})()')
  await ev(`(()=>{const b=document.querySelector(".settings-close-button");if(b)b.click();return true})()`)

  c.close()
  const verdict={
    zhGear,
    langCat,
    enClicked,
    enGear,
    guideSwitched: zhTitle!=='' && enTitle!=='' && zhTitle!==enTitle,
    settingsCatSwitched: zhCategory!=='' && enCategory!=='' && zhCategory!==enCategory,
  }
  verdict.PASS = Object.values(verdict).every(v=>v===true)
  console.log(JSON.stringify({zhTitle, enTitle, enSettingsTitle, zhCategory, enCategory, verdict},null,2))
  if(!verdict.PASS) process.exitCode=2
})().catch(e=>{console.error('ERROR',e.stack||e);process.exitCode=1})
