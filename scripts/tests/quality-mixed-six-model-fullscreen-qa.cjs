const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
const sleep=t=>new Promise(ok=>setTimeout(ok,t));
const chrome='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const origin=process.env.QOE_QA_ORIGIN||'http://127.0.0.1:3021';
const url=origin+'/qoe/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&from=00%3A00&to=23%3A59&mapMode=improvement';
const prof=fs.mkdtempSync(path.join(os.tmpdir(),'qoe-all-six-test-'));
const idx=require('../../public/quality-models-mixed-full/index.json');
const ent=idx.entries.find(e=>e.scope.dateStart==='2026-10-26'&&e.scope.dateEnd==='2026-10-30');
const report=require('../../public/quality-models-mixed-full/'+ent.path);
let p=null,ws=null,counter=0;const pending=new Map();
async function wait(fn,name,limit=35000){const since=Date.now();while(Date.now()-since<limit){try{const value=await fn();if(value)return value;}catch{}await sleep(400);}throw Error('Timeout '+name);}
async function send(method,params={}){const id=++counter;return new Promise((ok,fail)=>{const timer=setTimeout(()=>{pending.delete(id);fail(Error('CDP timeout '+method));},16000);pending.set(id,{ok,fail,timer});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const x=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(x.exceptionDetails)throw Error('Browser JS error '+JSON.stringify(x.exceptionDetails));return x.result?.value;}
const snapshotJS="(function(){const el=document.getElementById('quality-model-selector');const gps=[...document.querySelectorAll('.qoe-gps-rf-marker')];const colors=gps.map(x=>x.querySelector('svg g')?.getAttribute('fill')??null);const labels=[...document.querySelectorAll('[aria-label=\"대안 모델 지도 범례\"] span')].map(x=>x.textContent?.trim()??'');return JSON.stringify({model:el?.value??null,candidates:document.querySelectorAll('[data-candidate-id]').length,gps:gps.length,rough:document.querySelectorAll('.qoe-rough-location-marker').length,towers:document.querySelectorAll('.qoe-station-tower-marker').length,colors:colors.reduce((a,x)=>(a[x]=(a[x]||0)+1,a),{}),legendBands:labels.includes('GPS 주파수'),legendRsrp:labels.includes('GPS RSRP'),legendMdt:labels.some(x=>x.includes('MDT 근사')),stale:document.body.innerText.includes('후보 산정 제외')||document.body.innerText.includes('입력 모집단이 다릅니다'),errors:[...document.querySelectorAll('[role=\"alert\"]')].map(x=>x.innerText.slice(0,100))});})()";
async function snapshot(){return JSON.parse(await evaluate(snapshotJS));}
async function selectModel(model){return evaluate("(function(){const s=document.getElementById('quality-model-selector');if(!s)return 'missing';s.value="+JSON.stringify(model)+";s.dispatchEvent(new Event('change',{bubbles:true}));return s.value;})()");}
async function clickSecond(){return evaluate("(function(){const a=document.querySelectorAll('[data-candidate-id]');if(a.length<2)return 'missing';a[1].dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));return 'clicked';})()");}
async function checkFullscreen(panelLabel,model){
 const selector='section[aria-label="'+panelLabel+'"]';
 const clicked=await evaluate("(function(){const panel=document.querySelector("+JSON.stringify(selector)+");const b=panel?.querySelector('button[aria-label=\"지도 전체 화면\"]');if(!b)return 'missing';b.click();return 'open';})()");
 assert.equal(clicked,'open');
 const state=await wait(async()=>{
  const data=JSON.parse(await evaluate("(function(){const panel=document.querySelector("+JSON.stringify(selector)+");const rail=panel?.querySelector('[aria-label=\"전체화면 선택 후보 상세\"]');const leg=panel?.querySelector('[aria-label=\"대안 모델 지도 범례\"]');return JSON.stringify({expanded:panel?.getAttribute('role')==='dialog',rail:rail?.innerText??'',legend:leg?.innerText??'',gps:panel?.querySelectorAll('.qoe-gps-rf-marker').length,rough:panel?.querySelectorAll('.qoe-rough-location-marker').length});})()"));
  return data.expanded&&data.rail.includes('MDT RSRP 근사 (미검증)')&&!data.rail.includes('검토 통과 삼각 측량')?data:null;
 },model+' full-screen GPS MDT rail');
 console.log('FULLSCREEN_'+model.toUpperCase(),JSON.stringify(state));
 assert(state.rail.includes('GPS '),model+' must retain GPS proof');
 if(model!=='dbscan')assert(state.legend.includes('GPS 주파수')&&state.legend.includes('GPS RSRP'),'Full screen RF legend');
 const closed=await evaluate("(function(){const panel=document.querySelector("+JSON.stringify(selector)+");const b=panel?.querySelector('button[aria-label=\"전체 화면 닫기\"]');if(!b)return 'missing';b.click();return 'closed';})()");
 assert.equal(closed,'closed');
 await wait(async()=>{const x=await evaluate("(function(){const p=document.querySelector("+JSON.stringify(selector)+");return p?.getAttribute('role')??'normal';})()");return x==='normal';},model+' map restored');
}
(async()=>{
 assert(fs.existsSync(chrome),'Chrome not installed');
 p=spawn(chrome,['--headless=new','--disable-gpu','--disable-extensions','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+prof,url],{stdio:'ignore',windowsHide:true});
 const portFile=path.join(prof,'DevToolsActivePort');
 const port=await wait(()=>fs.existsSync(portFile)?Number(fs.readFileSync(portFile,'utf8').split(/\r?\n/)[0]):null,'CDP port',16000);
 const tab=await wait(async()=>{const list=await(await fetch('http://127.0.0.1:'+port+'/json')).json();return list.find(x=>x.type==='page'&&x.url.includes('/qoe/'))||null;},'CDP page',16000);
 ws=new WebSocket(tab.webSocketDebuggerUrl);
 await new Promise((ok,fail)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',fail,{once:true});});
 ws.addEventListener('message',ev=>{const obj=JSON.parse(ev.data.toString()),r=pending.get(obj.id);if(!r)return;pending.delete(obj.id);clearTimeout(r.timer);if(obj.error)r.fail(Error(JSON.stringify(obj.error)));else r.ok(obj.result);});
 await send('Runtime.enable');
 const baseline=await wait(async()=>{const s=await snapshot();return s.model==='dbscan'&&s.candidates===10&&s.gps===8&&s.rough===10?s:null;},'DBSCAN GPS 8 MDT 10');
 console.log('DBSCAN',JSON.stringify(baseline));
 assert.equal(baseline.stale,false);
 await checkFullscreen('개선 2안 조사 후보 지도','dbscan');
 for(const name of ['hdbscan','st_dbscan','adaptive_kde','spatial_scan','bayesian']){
  assert.equal(await selectModel(name),name);
  const first=report.models[name].candidates[0];
  const info=await wait(async()=>{const s=await snapshot();return s.model===name&&s.candidates===report.models[name].candidates.filter(c=>c.poorCalls>=6&&c.poorCustomers>=3&&c.days>=3).length&&s.gps===first.gnssCalls&&s.rough===first.roughCalls&&s.legendBands&&s.legendRsrp&&s.legendMdt?s:null;},name+' first candidate GPS+MDT and RF legend');
  assert.equal(info.stale,false,name+' stale exclusion wording');
  console.log(name.toUpperCase(),JSON.stringify(info));
  if(report.models[name].candidates.length>1){
   assert.equal(await clickSecond(),'clicked');
   const second=report.models[name].candidates[1];
   const info2=await wait(async()=>{const s=await snapshot();return s.gps===second.gnssCalls&&s.rough===second.roughCalls?s:null;},name+' second candidate');
   console.log(name.toUpperCase()+'_SECOND',JSON.stringify({gps:info2.gps,rough:info2.rough,colors:info2.colors}));
  }
 }
 await checkFullscreen('대안 모델 조사 후보 지도','bayesian');
 console.log('ALL_SIX_MODELS_BROWSER_QA=PASS');
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;}).finally(async()=>{try{ws?.close();}catch{}if(p?.pid){try{execFileSync('taskkill.exe',['/PID',String(p.pid),'/T','/F'],{stdio:'ignore',timeout:12000});}catch{}}await sleep(500);try{fs.rmSync(prof,{recursive:true,force:true,maxRetries:8,retryDelay:350});}catch{}});
