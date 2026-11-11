const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const pause=ms=>new Promise(done=>setTimeout(done,ms));
const binary='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const origin=process.env.QOE_QA_ORIGIN||'http://127.0.0.1:3021';
const url=origin+'/qoe/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&from=00%3A00&to=23%3A59&mapMode=improvement';
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'qoe-candidate-terms-'));
let proc=null,ws=null,seq=0;const pending=new Map();
async function until(fn,name,timeout=36000){
 const start=Date.now();
 while(Date.now()-start<timeout){try{const v=await fn();if(v)return v;}catch(err){}await pause(400);}
 throw Error('Timeout '+name);
}
function cdp(method,params={}){
 const id=++seq;
 return new Promise((ok,fail)=>{
  const alarm=setTimeout(()=>{pending.delete(id);fail(Error('CDP timeout '+method));},16000);
  pending.set(id,{ok,fail,alarm});ws.send(JSON.stringify({id,method,params}));
 });
}
async function js(expr){
 const r=await cdp('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
 if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));
 return r.result?.value;
}
const script="(function(){const db=document.getElementById('quality-two-primary');const alt=[...document.querySelectorAll('section[aria-label^=\"선택 모델 \"]')].find(x=>x.getAttribute('aria-label')?.includes('개선 후보'));const panel=db||alt;const titles=[...(panel?.querySelectorAll('h2,h3')||[])].map(x=>x.textContent.trim());const header=[...document.querySelectorAll('strong')].map(x=>x.textContent.trim()).find(x=>x.includes('저품질 경험'))||'';const stats=[...(db?.querySelectorAll('[aria-label=\"개선 후보 핵심 현황\"]>div')||[])].map(x=>x.textContent.trim());const frame=document.querySelector('section[aria-label=\"개선 후보 영역\"]')||document.querySelector('section[aria-label=\"대안 모델 개선 후보 영역\"]');return JSON.stringify({model:document.getElementById('quality-model-selector')?.value??'',header,stats,titles,frame:frame?.getAttribute('aria-label')||'',fullscreen:frame?.getAttribute('role')==='dialog',rail:!!frame?.querySelector('[aria-label=\"전체화면 개선 후보 탐색\"]'),candidates:document.querySelectorAll('[data-candidate-id]').length,leaflet:document.querySelectorAll('.leaflet-container').length,modelTitle:alt?.getAttribute('aria-label')||'',list:!!document.querySelector('[aria-label=\"개선 후보 지역 목록\"]')||!!document.querySelector('[aria-label=\"선택 모델 개선 후보 목록\"]')});})()";
async function snapshot(){return JSON.parse(await js(script));}
async function choose(value){return js("(function(){const s=document.getElementById('quality-model-selector');if(!s)return 'missing';s.value="+JSON.stringify(value)+";s.dispatchEvent(new Event('change',{bubbles:true}));return s.value;})()");}
async function toggle(open){return js("(function(){const f=document.querySelector('section[aria-label=\"개선 후보 영역\"]')||document.querySelector('section[aria-label=\"대안 모델 개선 후보 영역\"]');const b=f?.querySelector('button[aria-label=\""+(open?'지도 전체 화면':'전체 화면 닫기')+"\"]');if(!b)return 'missing';b.click();return 'clicked';})()");}
(async()=>{
 assert(fs.existsSync(binary),'Chrome missing');
 proc=spawn(binary,['--headless=new','--disable-gpu','--disable-extensions','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,url],{windowsHide:true,stdio:'ignore'});
 const file=path.join(profile,'DevToolsActivePort');
 const port=await until(()=>fs.existsSync(file)?Number(fs.readFileSync(file,'utf8').split(/\r?\n/)[0]):null,'debug port',17000);
 const target=await until(async()=>{const pages=await(await fetch('http://127.0.0.1:'+port+'/json')).json();return pages.find(x=>x.type==='page'&&x.url.includes('/qoe/'))||null;},'Chrome page',15000);
 ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((ok,fail)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',fail,{once:true});});
 ws.addEventListener('message',ev=>{const o=JSON.parse(ev.data.toString()),p=pending.get(o.id);if(!p)return;pending.delete(o.id);clearTimeout(p.alarm);if(o.error)p.fail(Error(JSON.stringify(o.error)));else p.ok(o.result);});
 await cdp('Runtime.enable');
 const db=await until(async()=>{const s=await snapshot();return s.model==='dbscan'&&s.candidates===10&&s.stats.length===3&&s.leaflet>0?s:null;},'DBSCAN new titles');
 console.log('DBSCAN',JSON.stringify(db));
 assert(db.stats[0].startsWith('저품질 경험 고객'));
 assert(db.stats[1].startsWith('개선 후보 지역'));
 assert(db.titles.includes('개선 후보'));
 assert(db.list);
 assert(!db.titles.some(s=>s.includes('조사 후보 지도')));
 assert.equal(await toggle(true),'clicked');
 const dbFull=await until(async()=>{const s=await snapshot();return s.fullscreen&&s.rail?s:null;},'DBSCAN fullscreen');
 console.log('DBSCAN_FULLSCREEN',JSON.stringify({frame:dbFull.frame,rail:dbFull.rail,leaflet:dbFull.leaflet}));
 assert.equal(await toggle(false),'clicked');
 await until(async()=>!(await snapshot()).fullscreen,'leave full screen');
 assert.equal(await choose('hdbscan'),'hdbscan');
 const alt=await until(async()=>{const s=await snapshot();return s.model==='hdbscan'&&s.candidates===10&&s.frame==='대안 모델 개선 후보 영역'&&s.leaflet>0?s:null;},'HDBSCAN new titles');
 console.log('HDBSCAN',JSON.stringify(alt));
 assert(alt.titles.includes('개선 후보'));
 assert(alt.list&&alt.modelTitle.includes('개선 후보'));
 assert.equal(await toggle(true),'clicked');
 const altFull=await until(async()=>{const s=await snapshot();return s.fullscreen&&s.rail?s:null;},'HDBSCAN fullscreen');
 console.log('HDBSCAN_FULLSCREEN',JSON.stringify({frame:altFull.frame,rail:altFull.rail,leaflet:altFull.leaflet}));
 console.log('CANDIDATE_TERMS_BROWSER=PASS');
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;}).finally(async()=>{
 try{ws?.close();}catch(e){}
 if(proc?.pid){try{execFileSync('taskkill.exe',['/PID',String(proc.pid),'/T','/F'],{timeout:14000,stdio:'ignore'});}catch(e){}}
 await pause(450);
 try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:8,retryDelay:350});}catch(e){}
});
