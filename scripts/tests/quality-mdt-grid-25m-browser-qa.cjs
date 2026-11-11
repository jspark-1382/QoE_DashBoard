const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const chrome='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const origin=process.env.QOE_QA_ORIGIN||'http://127.0.0.1:3016';
const url=origin+'/qoe/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&from=00%3A00&to=23%3A59&mapMode=improvement';
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'qoe-mdt-grid-select-'));
let proc=null,ws=null,seq=0;
const pending=new Map();
async function until(fn,label,timeout=65000){
 const started=Date.now();
 while(Date.now()-started<timeout){try{const result=await fn();if(result)return result;}catch(e){}await sleep(380);}
 throw new Error('Timeout '+label+' after '+timeout+'ms');
}
function cdp(method,params={}){
 const id=++seq;
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method));},21000);
  pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
 });
}
async function evalJs(code){
 const result=await cdp('Runtime.evaluate',{expression:code,returnByValue:true,awaitPromise:true});
 if(result.exceptionDetails)throw new Error('Browser JS exception '+JSON.stringify(result.exceptionDetails));
 return result.result?.value;
}
function inspect(){
 const visible=e=>{const r=e?.getBoundingClientRect();return !!r&&r.width>0&&r.height>0};
 const map=document.querySelector('[aria-label="개선 후보 지도"]');
 const select=[...document.querySelectorAll('select[aria-label="25m MDT 격자 주파수 선택"]')].find(visible);
 const period=[...document.querySelectorAll('button[aria-label="전체 기간 후보 분석 (기본)"]')].find(visible);
 const note=map?.querySelector('[aria-label="25m MDT 격자 상태"]');
 const legend=map?.querySelector('[aria-label="RSRP 색상 범례"]');
 const count=Number((note?.textContent||'').match(/([0-9,]+)격자/)?.[1].replace(/,/g,'')||0);
 const missing=Number((note?.textContent||'').match(/미수집 ([0-9,]+)격자/)?.[1].replace(/,/g,'')||0);
 const pane=map?.querySelector('.leaflet-qoe-mdt-25m-pane');
 const frame=document.querySelector('section[aria-label="개선 후보 영역"]')||document.querySelector('section[aria-label="대안 모델 개선 후보 영역"]');
 return JSON.stringify({
  model:document.getElementById("quality-model-selector")?.value||document.getElementById("quality-model-selector-full")?.value||null,
  mode:select?.value||null,
  options:[...(select?.options||[])].map(o=>o.value),
  selectBeforePeriod:!!select&&!!period&&select.getBoundingClientRect().right<period.getBoundingClientRect().left,
  note:note?.textContent.trim()||null,
  gridCells:count,missing,
  hasLegend:!!legend,
  labels:[...(legend?.querySelectorAll('div')||[])].map(x=>x.querySelector('span')?.textContent||'').filter(Boolean),
  canvases:pane?.querySelectorAll('canvas').length||0,
  candidates:map?.querySelectorAll('[data-candidate-id]').length||0,
  full:frame?.getAttribute('role')==='dialog',map:!!map
 });
}
const snapJs='('+inspect.toString()+')()';
async function snapshot(){return JSON.parse(await evalJs(snapJs));}
async function choose(mode){
 return evalJs('(function(){const s=[...document.querySelectorAll(\'select[aria-label="25m MDT 격자 주파수 선택"]\')].find(x=>{const r=x.getBoundingClientRect();return r.width>0&&r.height>0});if(!s)return "missing";s.value='+JSON.stringify(mode)+';s.dispatchEvent(new Event("change",{bubbles:true}));return s.value})()');
}
async function chooseModel(name){
 return evalJs('(function(){const s=document.getElementById("quality-model-selector");if(!s)return "missing";s.value='+JSON.stringify(name)+';s.dispatchEvent(new Event("change",{bubbles:true}));return s.value})()');
}
async function fullscreen(open){
 const label=open?'지도 전체 화면':'전체 화면 닫기';
 return evalJs('(function(){const f=document.querySelector(\'section[aria-label="개선 후보 영역"]\')||document.querySelector(\'section[aria-label="대안 모델 개선 후보 영역"]\');const b=f?.querySelector(\'button[aria-label='+JSON.stringify(label)+']\');if(!b)return "missing";b.click();return "clicked"})()');
}
(async()=>{
 assert(fs.existsSync(chrome));
 proc=spawn(chrome,['--headless=new','--window-size=1600,950','--disable-gpu','--disable-extensions','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,url],{stdio:'ignore',windowsHide:true});
 const portfile=path.join(profile,'DevToolsActivePort');
 const port=await until(()=>fs.existsSync(portfile)?Number(fs.readFileSync(portfile,'utf8').split(/\r?\n/)[0]):null,'Chrome debug port',20000);
 const target=await until(async()=>{const list=await(await fetch('http://127.0.0.1:'+port+'/json')).json();return list.find(t=>t.type==='page'&&t.url.includes('/qoe/'));},'Chrome page');
 ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 ws.addEventListener('message',event=>{const msg=JSON.parse(event.data.toString()),p=pending.get(msg.id);if(!p)return;pending.delete(msg.id);clearTimeout(p.timer);if(msg.error)p.reject(new Error(JSON.stringify(msg.error)));else p.resolve(msg.result);});
 await cdp('Runtime.enable');
 const initial=await until(async()=>{const s=await snapshot();return s.model==='dbscan'&&s.mode==='top1'&&s.gridCells>0&&s.canvases===1?s:null;},'DBSCAN default Top1');
 assert.deepEqual(initial.options,['top1','900','1.8협','1.8광','2.1','hidden']);
 assert(initial.selectBeforePeriod,'dropdown must be left of full-period button');
 assert(initial.note.includes('Top1')&&initial.labels.length===8);
 assert(initial.labels.includes('수집된 값 없음')&&initial.labels.includes('> -60'));
 console.log('TOP1',JSON.stringify(initial));
 const expectedMissing={'900':3,'1.8협':45,'1.8광':0,'2.1':658};
 for(const mode of ['900','1.8협','1.8광','2.1']){
  assert.equal(await choose(mode),mode);
  const s=await until(async()=>{const s=await snapshot();return s.mode===mode&&s.gridCells===1154&&s.missing===expectedMissing[mode]&&s.note?.includes(' · '+mode+' · ')&&s.hasLegend?s:null;},mode+' frequency grid');
  assert(s.selectBeforePeriod&&s.canvases===1);
  console.log('FREQUENCY_'+mode,JSON.stringify({mode:s.mode,gridCells:s.gridCells,missing:s.missing,note:s.note,canvases:s.canvases}));
 }
 assert.equal(await choose('hidden'),'hidden');
 const hidden=await until(async()=>{const s=await snapshot();return s.mode==='hidden'&&!s.note&&!s.hasLegend?s:null;},'hide overlay and legend');
 console.log('HIDDEN',JSON.stringify(hidden));
 assert.equal(await choose('top1'),'top1');
 const restored=await until(async()=>{const s=await snapshot();return s.mode==='top1'&&s.gridCells===initial.gridCells&&s.canvases===1?s:null;},'Top1 restored without extra canvas');
 console.log('TOP1_RESTORED',JSON.stringify(restored));
 assert.equal(await chooseModel('hdbscan'),'hdbscan');
 const alt=await until(async()=>{const s=await snapshot();return s.model==='hdbscan'&&s.candidates===10&&s.gridCells>0&&s.mode==='top1'?s:null;},'HDBSCAN Top1');
 console.log('HDBSCAN_TOP1',JSON.stringify(alt));
 assert.equal(await fullscreen(true),'clicked');
 const expanded=await until(async()=>{const s=await snapshot();return s.full&&s.gridCells>0&&s.mode==='top1'?s:null;},'fullscreen Top1');
 assert(expanded.selectBeforePeriod&&expanded.hasLegend);
 assert.equal(await choose('2.1'),'2.1');
 await until(async()=>{const s=await snapshot();return s.full&&s.mode==='2.1'&&s.gridCells>0?s:null;},'fullscreen 2.1');
 assert.equal(await choose('hidden'),'hidden');
 await until(async()=>{const s=await snapshot();return s.full&&s.mode==='hidden'&&!s.note&&!s.hasLegend?s:null;},'fullscreen hidden');
 assert.equal(await choose('top1'),'top1');
 await until(async()=>{const s=await snapshot();return s.full&&s.gridCells>0&&s.mode==='top1'?s:null;},'fullscreen Top1 restored');
 assert.equal(await fullscreen(false),'clicked');
 await until(async()=>{const s=await snapshot();return !s.full&&s.gridCells>0&&s.mode==='top1'?s:null;},'normal map restored');
 console.log('MDT_25M_FREQUENCY_SELECTOR_BROWSER_QA=PASS');
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;}).finally(async()=>{
 try{ws?.close();}catch(e){}
 if(proc?.pid){try{execFileSync('taskkill.exe',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore',timeout:14000});}catch(e){}}
 await sleep(450);try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:8,retryDelay:350});}catch(e){}
});