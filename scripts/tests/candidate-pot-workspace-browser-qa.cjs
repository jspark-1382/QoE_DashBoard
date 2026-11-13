/* eslint-disable @typescript-eslint/no-require-imports -- Real Chrome CDP browser integration QA. */
/*
 * Run after building/restarting the app:
 *   node scripts/tests/candidate-pot-workspace-browser-qa.cjs
 * Optional QOE_QA_ORIGIN (default http://127.0.0.1:3001).
 * Uses an isolated temporary Chrome profile; only that process and its own unfinished jobs are cleaned up.
 */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const origin=process.env.QOE_QA_ORIGIN||'http://127.0.0.1:3001';
const chromeBin='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const candidateId='spatial-74cf136978399144',potId='38507_77757';
const url=origin+'/qoe/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&from=00%3A00&to=23%3A59&distributionMode=mos&evidence=all&mapMode=improvement';
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'qoe-pot-workspace-qa-'));
const outputDir=path.resolve('outputs');
const results={origin,candidateId,potId,checks:[],layouts:[],screenshots:[],runtimeErrors:[],consoleErrors:[],network:[]};
const pending=new Map(),ownedJobs=new Set(),jobRequests=new Set(),responseTasks=new Set();
let chrome=null,ws=null,nextId=0,jobPosts=0,lastObserved=null;
fs.mkdirSync(outputDir,{recursive:true});

async function until(fn,label,maxMs=40000){
 const start=Date.now();let lastError;
 while(Date.now()-start<maxMs){
  try{const result=await fn();if(result)return result;}catch(error){lastError=error.message;}
  await sleep(250);
 }
 throw Error('Timeout: '+label+(lastError?' ('+lastError+')':'')+'; last DOM='+JSON.stringify(lastObserved));
}
function cdp(method,params={}){
 const id=++nextId;
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},20000);
  pending.set(id,{resolve,reject,timer});
  ws.send(JSON.stringify({id,method,params}));
 });
}
async function evaluate(code){
 const response=await cdp('Runtime.evaluate',{expression:code,returnByValue:true,awaitPromise:true});
 if(response.exceptionDetails)throw Error('Browser exception: '+JSON.stringify(response.exceptionDetails));
 return response.result?.value;
}
async function run(fn,...args){return evaluate('('+fn.toString()+')('+args.map(value=>JSON.stringify(value)).join(',')+')');}
function observedDom(){
 const dialog=document.querySelector('dialog[open]'),workspace=dialog?.querySelector('[aria-label="POT별 5가지 원인 조사"]');
 const analysis=workspace?.querySelector('[aria-label="선택 POT 분석"]'),select=workspace?.querySelector('select[aria-label="조사 POT 선택"]');
 const categories=[...workspace?.querySelectorAll('[data-cause-category]')??[]];
 return {
  dialog:!!dialog,title:dialog?.querySelector('h2')?.textContent?.trim(),workspace:!!workspace,
  candidate:workspace?.querySelector('[data-candidate-pot-map]')?.getAttribute('data-candidate-pot-map'),
  fingerprint:workspace?.getAttribute('data-context-fingerprint'),potCount:select?.options.length??0,selected:select?.value,
  analysisPot:analysis?.getAttribute('data-selected-pot'),band:analysis?.getAttribute('data-selected-band'),
  stages:[...analysis?.querySelectorAll('[data-pot-stage]')??[]].map(e=>e.getAttribute('data-pot-stage')),
  stageText:[...analysis?.querySelectorAll('[data-pot-stage]')??[]].map(e=>e.textContent.trim()),
  categories:categories.map(e=>({id:e.getAttribute('data-cause-category'),label:e.textContent.trim(),pressed:e.getAttribute('aria-pressed')})),
  status:analysis?.querySelector('[data-status]')?.getAttribute('data-status'),
  potPaths:workspace?.querySelectorAll('[data-pot-id]').length??0,
  suspects:[...workspace?.querySelectorAll('[data-pot-id][aria-label^="확인할 POT"]')??[]].map(e=>e.getAttribute('data-pot-id')),
  selectedMarkers:[...workspace?.querySelectorAll('[data-pot-selected="true"]')??[]].map(e=>e.getAttribute('data-pot-id')),
  stations:workspace?.querySelectorAll('[data-station-id]').length??0,
  stationText:analysis?.querySelector('[data-pot-stage="3"] aside')?.textContent?.trim()??'',
  inspector:!!dialog?.querySelector('aside[aria-label="AI 입력·응답 확인"]'),
  tabs:[...dialog?.querySelectorAll('[aria-label="AI 실행 기록 구분"] [role="tab"]')??[]].map(e=>({label:e.textContent.trim(),selected:e.getAttribute('aria-selected')})),
  alerts:[...dialog?.querySelectorAll('[role="alert"]')??[]].map(e=>e.textContent.trim().slice(0,300))
 };
}
async function snapshot(){lastObserved=await run(observedDom);return lastObserved;}
async function choose(label,value){
 const chosen=await run((label,value)=>{
  const element=document.querySelector('dialog[open] select[aria-label="'+label+'"]');
  if(!element||![...element.options].some(option=>option.value===value))return null;
  element.value=value;element.dispatchEvent(new Event('change',{bubbles:true}));return element.value;
 },label,value);
 assert.equal(chosen,value,'select '+label+' must include '+value);
 await run(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function category(id){
 assert.equal(await run(id=>{
  const button=document.querySelector('dialog[open] [data-cause-category="'+id+'"]');
  if(!button)return false;button.click();return true;
 },id),true);
 return until(async()=>{const s=await snapshot();return s.categories.find(c=>c.id===id)?.pressed==='true'?s:null;},'category '+id);
}
async function pointerClick(selector){
 const point=await run(selector=>{
  const node=document.querySelector(selector);if(!node)return null;
  const r=node.getBoundingClientRect();
  return {x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height};
 },selector);
 assert(point&&point.width>0&&point.height>0,'visible click target '+selector);
 await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y});
 await cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
 await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
}
async function openCandidate(){
 const observed=await until(()=>run(id=>{
  const mapMarker=document.querySelector('[data-candidate-id="'+id+'"]');
  const ai=[...document.querySelectorAll('button[aria-label="후보 지역 23 AI 분석"]')].find(b=>b.getBoundingClientRect().width>0);
  if(!mapMarker||!ai)return null;
  const row=ai.parentElement;
  return {mapCandidate:mapMarker.getAttribute('data-candidate-id'),ariaLabel:ai.getAttribute('aria-label'),buttonText:ai.textContent.trim(),rowText:row.textContent.trim()};
 },candidateId),'candidate 23 row and actual map marker',60000);
 results.checks.push({check:'observed-candidate-row',...observed});
 assert.equal(await run(()=>{
  const ai=[...document.querySelectorAll('button[aria-label="후보 지역 23 AI 분석"]')].find(b=>b.getBoundingClientRect().width>0);
  if(!ai)return false;ai.scrollIntoView({block:'center'});ai.click();return true;
 }),true);
 const state=await until(async()=>{const s=await snapshot();return s.workspace&&s.candidate===candidateId&&s.potCount===84&&s.potPaths===84?s:null;},'candidate 23 full 84 POT workspace',45000);
 assert.deepEqual(state.stages,['1','2','3']);assert.equal(state.categories.length,5);
 results.checks.push({check:'all-range-pots',count:state.potCount,fingerprint:state.fingerprint,stations:state.stations});
}
async function capture(width,height,suffix){
 await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
 await run(()=>{
  const d=document.querySelector('dialog[open]');if(d?.children[1])d.children[1].scrollTop=0;
  const a=d?.querySelector('[aria-label="선택 POT 분석"]');if(a)a.scrollTop=0;
 });
 await sleep(500);
 const layout=await run(()=>{
  const rectangle=node=>{
   if(!node)return null;const r=node.getBoundingClientRect();
   return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right,clientWidth:node.clientWidth,scrollWidth:node.scrollWidth,clientHeight:node.clientHeight,scrollHeight:node.scrollHeight};
  };
  const dialog=document.querySelector('dialog[open]'),workspace=dialog?.querySelector('[aria-label="POT별 5가지 원인 조사"]');
  return {viewport:{width:innerWidth,height:innerHeight},dialog:rectangle(dialog),workspace:rectangle(workspace),
   map:rectangle(workspace?.querySelector('[aria-label="조사 후보 지도 패널"]')),analysis:rectangle(workspace?.querySelector('[aria-label="선택 POT 분석"]')),
   stages:[...workspace?.querySelectorAll('[data-pot-stage]')??[]].map(e=>({stage:e.getAttribute('data-pot-stage'),...rectangle(e)})),
   categories:[...workspace?.querySelectorAll('[data-cause-category]')??[]].map(e=>({id:e.getAttribute('data-cause-category'),...rectangle(e)})),
   rootHorizontalOverflow:document.documentElement.scrollWidth>innerWidth+1};
  });
 results.layouts.push(layout);
 assert.equal(layout.viewport.width,width);assert.equal(layout.viewport.height,height);
 assert(layout.dialog&&layout.map&&layout.analysis,'layout panels exist');
 assert(layout.dialog.x>=0&&layout.dialog.right<=width+1&&layout.dialog.bottom<=height+1,'dialog fits viewport');
 assert(layout.map.right<=layout.analysis.x+1,'map remains left of selected-POT analysis');
 assert(layout.map.height>250&&layout.analysis.height>250,'both panels have usable height');
 assert(layout.map.scrollWidth<=layout.map.clientWidth+1&&layout.analysis.scrollWidth<=layout.analysis.clientWidth+1,'panels do not overflow horizontally');
 if(width===1366&&height===768){
  const stage3=layout.stages.find(stage=>stage.stage==='3');
  assert(stage3&&stage3.bottom<=layout.analysis.bottom+1,'1366x768 stage 3 must fit in the visible analysis panel');
 }
 const screenshot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
 const filename=path.join(outputDir,'candidate-pot-workspace-'+suffix+'.png');
 fs.writeFileSync(filename,Buffer.from(screenshot.data,'base64'));results.screenshots.push(filename);
 console.log('LAYOUT_'+suffix,JSON.stringify(layout));
}
async function trackJobResponse(requestId){
 try{
  const body=await cdp('Network.getResponseBody',{requestId}),job=JSON.parse(body.base64Encoded?Buffer.from(body.body,'base64').toString('utf8'):body.body);
  if(typeof job.id==='string'&&job.target?.candidateId===candidateId)ownedJobs.add(job.id);
 }catch{/* A cancelled request has no response body and never supplies a job to clean up. */}
}
(async()=>{
 assert(fs.existsSync(chromeBin),'Chrome executable is unavailable');
 chrome=spawn(chromeBin,['--headless=new','--window-size=1920,1080','--disable-gpu','--disable-extensions','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
 const portFile=path.join(profile,'DevToolsActivePort');
 const port=await until(()=>fs.existsSync(portFile)?Number(fs.readFileSync(portFile,'utf8').split(/\r?\n/)[0]):null,'isolated Chrome debugging port',20000);
 const target=await until(async()=>{const pages=await(await fetch('http://127.0.0.1:'+port+'/json')).json();return pages.find(p=>p.type==='page');},'isolated Chrome page');
 ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 ws.addEventListener('message',event=>{
  const packet=JSON.parse(event.data.toString());
  if(packet.id&&pending.has(packet.id)){
   const request=pending.get(packet.id);pending.delete(packet.id);clearTimeout(request.timer);
   if(packet.error)request.reject(Error(JSON.stringify(packet.error)));else request.resolve(packet.result);
  }else if(packet.method==='Runtime.exceptionThrown'){
   const error=packet.params.exceptionDetails;results.runtimeErrors.push({text:error.text,description:error.exception?.description?.slice(0,800)});
  }else if(packet.method==='Runtime.consoleAPICalled'&&packet.params.type==='error'){
   results.consoleErrors.push(packet.params.args.map(a=>a.value??a.description??'').join(' ').slice(0,500));
  }else if(packet.method==='Network.requestWillBeSent'){
   const {requestId,request}=packet.params;
   if(request.method==='POST'&&request.url===origin+'/qoe/api/analysis/jobs'){jobRequests.add(requestId);jobPosts++;}
  }else if(packet.method==='Network.responseReceived'){
   const r=packet.params.response;if(r.url.includes('/qoe/api/analysis/'))results.network.push({path:new URL(r.url).pathname,status:r.status});
  }else if(packet.method==='Network.loadingFinished'&&jobRequests.has(packet.params.requestId)){
   const task=trackJobResponse(packet.params.requestId);responseTasks.add(task);void task.finally(()=>responseTasks.delete(task));
  }
 });
 await cdp('Runtime.enable');await cdp('Network.enable');await cdp('Page.enable');
 await cdp('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
 await cdp('Page.navigate',{url});
 await openCandidate();
 await choose('조사 POT 선택',potId);
 await category('coverage');
 const coverage=await until(async()=>{const s=await snapshot();return s.analysisPot===potId&&s.band==='900'&&s.stageText[0]?.includes('11.16%')&&s.stageText[0]?.includes('22.73%')?s:null;},'38507_77757 900 MHz 11.16% to 22.73%');
 assert.deepEqual(coverage.stages,['1','2','3']);assert.deepEqual(coverage.selectedMarkers,[potId]);
 results.checks.push({check:'pot-three-steps-900',pot:coverage.analysisPot,band:coverage.band,stageText:coverage.stageText});
 await capture(1920,1080,'1920x1080');
 await choose('조사 지도 MDT 대역','1.8광');
 const wide=await until(async()=>{const s=await snapshot();return s.band==='1.8광'&&s.stageText[0]?.includes('4.92%')?s:null;},'1.8 wide 4.92%');
 results.checks.push({check:'band-change',band:wide.band,stageText:wide.stageText[0]});
 await choose('조사 지도 MDT 대역','900');
 for(const id of ['capacity','interference','coverage','mobility','equipment']){
  let state=await category(id);
  if(['capacity','mobility','equipment'].includes(id)){
   state=await until(async()=>{const s=await snapshot();return s.status==='unavailable'&&s.suspects.length===0?s:null;},'no unsupported suspect POT for '+id);
   assert.equal(state.suspects.length,0);
  }
  assert.equal(state.categories.filter(c=>c.pressed==='true').length,1);
  results.checks.push({check:'cause-category',id,status:state.status,suspects:state.suspects,stages:state.stages});
 }
 await category('coverage');
 const other=await run(selected=>{
  const map=document.querySelector('dialog[open] [aria-label="조사 후보 POT·기지국 지도"]'),bounds=map?.getBoundingClientRect();
  if(!bounds)return null;
  for(const p of map.querySelectorAll('[data-pot-id]')){
   if(p.getAttribute('data-pot-id')===selected)continue;
   const r=p.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
   if(x<bounds.left+15||x>bounds.right-15||y<bounds.top+15||y>bounds.bottom-15)continue;
   if(document.elementFromPoint(x,y)?.closest('[data-pot-id]')===p)return p.getAttribute('data-pot-id');
  }
  return null;
 },potId);
 assert(other,'at least one unobstructed POT marker is clickable');
 await pointerClick('dialog[open] [data-pot-id="'+other+'"]');
 const clicked=await until(async()=>{const s=await snapshot();return s.selected===other&&s.analysisPot===other&&s.selectedMarkers.includes(other)?s:null;},'map POT click updates selection and analysis');
 results.checks.push({check:'map-selection-sync',selected:clicked.selected});
 await choose('조사 POT 선택',potId);
 await pointerClick('dialog[open] [data-station-relation="candidate-bye"]');
 const station=await until(async()=>{const s=await snapshot();return s.stationText.includes('3500320')&&s.stationText.includes('책임 기지국')?s:null;},'station click shows actual BYE registry information');
 results.checks.push({check:'station-click',text:station.stationText});
 const postsBeforeInspector=jobPosts;
 assert.equal(await run(()=>{
  const b=[...document.querySelectorAll('dialog[open] header button')].find(e=>e.textContent.trim()==='AI 입력·응답 확인');
  if(!b)return false;b.click();return true;
 }),true);
 await until(async()=>{const s=await snapshot();return s.inspector&&s.tabs.length===4?s:null;},'existing inspector four tabs',45000);
 const labels=['System','User','전송 데이터','응답·검증'];
 const inspectorChecks=[];
 for(const label of labels){
  assert.equal(await run(label=>{
   const tab=[...document.querySelectorAll('dialog[open] [role="tab"]')].find(e=>e.textContent.trim()===label);
   if(!tab)return false;tab.click();return true;
  },label),true);
  const pane=await until(()=>run(label=>{
   const tab=[...document.querySelectorAll('dialog[open] [aria-label="AI 실행 기록 구분"] [role="tab"]')].find(e=>e.textContent.trim()===label);
   const panel=document.querySelector('dialog[open] [role="tabpanel"]');
   return tab?.getAttribute('aria-selected')==='true'&&panel?.textContent.trim()?{label,textLength:panel.textContent.trim().length,notSent:panel.textContent.includes('아직 모델에 전송되지')}:null;
  },label),'inspector tab '+label);
  inspectorChecks.push(pane);
 }
 assert.equal(jobPosts,postsBeforeInspector,'opening and switching inspector tabs must not send new analysis jobs');
 results.checks.push({check:'inspector-four-tabs',tabs:inspectorChecks,readOnly:true});
 await run(()=>[...document.querySelectorAll('dialog[open] header button')].find(e=>e.textContent.trim()==='AI 입력·응답 확인')?.click());
 await until(async()=>{const s=await snapshot();return !s.inspector&&s.workspace?s:null;},'inspector closed and workspace restored');
 await run(()=>document.querySelector('dialog[open] button[aria-label="후보 분석 팝업 닫기"]')?.click());
 await until(async()=>!(await snapshot()).dialog,'dialog close');
 assert.equal(await run(()=>{
  const summary=[...document.querySelectorAll('[aria-label="선택 후보 AI 요약"] button')].find(e=>e.textContent.includes('문제·원인·개선 보기'));
  const button=summary??[...document.querySelectorAll('button[aria-label="후보 지역 23 AI 분석"]')].find(e=>e.getBoundingClientRect().width>0);
  if(!button)return false;button.click();return true;
 }),true);
 await until(async()=>{const s=await snapshot();return s.workspace&&s.candidate===candidateId&&s.potCount===84&&s.potPaths===84?s:null;},'dialog reopen without duplicate map layers');
 await choose('조사 POT 선택',potId);await category('coverage');await choose('조사 지도 MDT 대역','900');
 results.checks.push({check:'dialog-reopen',potCount:(await snapshot()).potCount});
 await capture(1366,768,'1366x768');
 assert.equal(results.runtimeErrors.length,0,'no browser runtime exception');
 results.jobPosts=jobPosts;results.ownedJobCount=ownedJobs.size;results.status='PASS';
 console.log('CANDIDATE_POT_WORKSPACE_BROWSER_QA',JSON.stringify(results));
})().catch(async error=>{
 results.status='FAIL';results.error=error.stack||String(error);results.lastObserved=lastObserved;process.exitCode=1;
 console.error(results.error);
 if(ws?.readyState===WebSocket.OPEN){
  try{const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});const file=path.join(outputDir,'candidate-pot-workspace-failure.png');fs.writeFileSync(file,Buffer.from(shot.data,'base64'));results.screenshots.push(file);}catch{}
 }
}).finally(async()=>{
 await Promise.allSettled(responseTasks);
 for(const id of ownedJobs){
  try{
   const response=await fetch(origin+'/qoe/api/analysis/jobs/'+encodeURIComponent(id)),job=await response.json();
   if(['queued','collecting','analyzing'].includes(job.status))await fetch(origin+'/qoe/api/analysis/jobs/'+encodeURIComponent(id),{method:'DELETE'});
  }catch{}
 }
 fs.writeFileSync(path.join(outputDir,'candidate-pot-workspace-qa.json'),JSON.stringify(results,null,2));
 try{ws?.close();}catch{}
 for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error('QA Chrome closed'));}pending.clear();
 if(chrome?.pid){try{execFileSync('taskkill.exe',['/PID',String(chrome.pid),'/T','/F'],{stdio:'ignore',timeout:10000});}catch{}}
 await sleep(500);
 try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:6,retryDelay:300});}catch{console.warn('Temporary QA Chrome profile retained: '+profile);}
});
