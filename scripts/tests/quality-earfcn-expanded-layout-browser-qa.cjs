const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const sleep=t=>new Promise(done=>setTimeout(done,t));
const chrome='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const origin=process.env.QOE_QA_ORIGIN||'http://127.0.0.1:3021';
const url=origin+'/qoe/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&from=00%3A00&to=23%3A59&mapMode=improvement';
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'qoe-earfcn-lines-'));
const sidecar=require('../../public/quality-improvement/candidate-mdt-rsrp-v1.json');
const dbIdx=require('../../public/quality-improvement-mixed-full/index.json');
const dbEntry=dbIdx.entries.find(e=>e.scope.dateStart==='2026-10-26'&&e.scope.dateEnd==='2026-10-30');
const db=require('../../public/quality-improvement-mixed-full/'+dbEntry.path);
const mIdx=require('../../public/quality-models-mixed-full/index.json');
const mEntry=mIdx.entries.find(e=>e.scope.dateStart==='2026-10-26'&&e.scope.dateEnd==='2026-10-30');
const models=require('../../public/quality-models-mixed-full/'+mEntry.path);
let app=null,ws=null,next=0;const pending=new Map();
async function until(fn,label,timeout=38000){const t=Date.now();while(Date.now()-t<timeout){try{const v=await fn();if(v)return v;}catch{}await sleep(400);}throw Error('Timeout '+label);}
function cdp(method,params={}){const id=++next;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP '+method+' timeout'));},16000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
async function evalJs(code){const result=await cdp('Runtime.evaluate',{expression:code,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error('Chrome JS '+JSON.stringify(result.exceptionDetails));return result.result?.value;}
function expected(ids){const totals={},curves={},unique=[...new Set(ids)];let rows=0;for(const id of unique){const rec=sidecar.records[id];assert(rec,'MDT source missing '+id);rows+=rec.validRows;for(const [f,series] of Object.entries(rec.earfcnBins)){totals[f]=(totals[f]||0)+Object.values(series).reduce((a,b)=>a+b,0);curves[f]??={};for(const [bin,count] of Object.entries(series))curves[f][bin]=(curves[f][bin]||0)+count;}}return {rows,calls:unique.length,totals,curves};}
const inspect="(function(){const charts=[...document.querySelectorAll('section[aria-label=\"선택 후보 MDT RSRP 분포\"]')];const chart=charts.find(x=>{const r=x.getBoundingClientRect();return r.width>0&&r.height>0})||charts[0];const circles=[...(chart?.querySelectorAll('circle[data-earfcn]')||[])];const totals={},curve={};for(const c of circles){const f=c.dataset.earfcn,bin=c.dataset.rsrpBin,n=Number(c.dataset.count);totals[f]=(totals[f]||0)+n;curve[f]??={};curve[f][bin]=n;}const legends=[...(chart?.querySelectorAll('[data-earfcn-legend]')||[])].map(x=>x.dataset.earfcnLegend);const labels=[...document.querySelectorAll('[aria-label=\"지도 위치 범례\"] span,[aria-label=\"대안 모델 지도 범례\"] span')].map(x=>x.textContent?.trim()||'');const gps=[...document.querySelectorAll('.qoe-gps-rf-marker')];const rough=[...document.querySelectorAll('.qoe-rough-location-marker')];const frame=document.querySelector('section[aria-label=\"개선 후보 영역\"]')||document.querySelector('section[aria-label=\"대안 모델 개선 후보 영역\"]');const rail=document.querySelector('[aria-label=\"전체화면 개선 후보 탐색\"]');const detail=rail?.querySelector('[aria-label=\"전체화면 선택 후보 상세\"]');const foot=rail?.querySelector('footer');const b=detail?.getBoundingClientRect(),c=chart?.getBoundingClientRect(),f=foot?.getBoundingClientRect(),listRect=rail?.querySelector('section')?.getBoundingClientRect(),svgRect=chart?.querySelector('svg')?.getBoundingClientRect();return JSON.stringify({model:document.getElementById('quality-model-selector')?.value||'',candidates:document.querySelectorAll('[data-candidate-id]').length,gps:gps.length,rough:rough.length,nonCircleGps:gps.filter(x=>!x.querySelector('circle')||x.querySelector('polygon,rect,path')).length,nonCircleRough:rough.filter(x=>!x.querySelector('circle')||x.querySelector('polygon,rect,path')).length,legendGps:labels.includes('GPS RSRP'),legendUnknown:labels.includes('미확보'),legendRed:labels.some(x=>x.includes('−105')),chartTitle:chart?.querySelector('h4')?.textContent||'',chartTotal:chart?.querySelector('.unused-strong')?.textContent||chart?.querySelector('div strong')?.textContent||'',note:chart?.innerText||'',legend:legends,totals,curve,series:chart?.querySelectorAll('polyline').length||0,plot:!!chart?.querySelector('svg[role=\"img\"]'),error:chart?.querySelector('[role=\"alert\"]')?.textContent||'',compact:chart?.dataset.compact,chartScrollHeight:detail?.scrollHeight,chartClientHeight:detail?.clientHeight,chartBottom:c?.bottom,detailBottom:b?.bottom,footerBottom:f?.bottom,viewportHeight:innerHeight,listHeight:listRect?.height,chartHeight:c?.height,chartWidth:c?.width,svgHeight:svgRect?.height,svgWidth:svgRect?.width,full:frame?.getAttribute('role')==='dialog'});})()";
async function snapshot(){return JSON.parse(await evalJs(inspect));}
async function selectModel(name){return evalJs("(function(){const el=document.getElementById('quality-model-selector');if(!el)return 'missing';el.value="+JSON.stringify(name)+";el.dispatchEvent(new Event('change',{bubbles:true}));return el.value;})()");}
async function selectCandidate(i){return evalJs("(function(){const c=document.querySelectorAll('[data-candidate-id]')["+i+"];if(!c)return 'missing';c.click();return 'clicked';})()");}
async function toggleFullscreen(open){const label=open?'지도 전체 화면':'전체 화면 닫기';return evalJs("(function(){const f=document.querySelector('section[aria-label=\"개선 후보 영역\"]')||document.querySelector('section[aria-label=\"대안 모델 개선 후보 영역\"]');const b=f?.querySelector('button[aria-label=\""+label+"\"]');if(!b)return 'missing';b.click();return 'clicked';})()");}
function match(state,expected,label){
 assert.equal(state.chartTitle,'EARFCN별 MDT RSRP 추이',label+' line chart title');
 assert.equal(Number(state.chartTotal.replace(/\D/g,'')),expected.rows,label+' source row count');
 assert.equal(state.series,Object.keys(expected.totals).length,label+' number of lines');
 assert.deepEqual(state.legend.sort(),Object.keys(expected.totals).sort(),label+' dlearfcn legend');
 assert.deepEqual(state.totals,expected.totals,label+' per-frequency totals');
 for(const [f,bins] of Object.entries(expected.curves)){
  for(const [bin,n] of Object.entries(bins))assert.equal(state.curve[f]?.[bin],n,label+' '+f+' / '+bin);
 }
 assert(state.note.includes('대상 통화 '+expected.calls+'건'),label+' correct member calls');
 assert.equal(state.legendGps,false,'GPS RSRP heading should not appear in map legend');
 assert.equal(state.legendUnknown,false,'Unknown marker legend removed');
 assert.equal(state.legendRed,true,'retain RSRP threshold colors');
 assert.equal(state.nonCircleGps,0,'GPS icons all circles');
 assert.equal(state.nonCircleRough,0,'MDT icons all circles');
 assert(state.plot&&state.error==='','chart rendered with no errors');
 console.log(label,JSON.stringify({rows:expected.rows,legend:state.legend,gps:state.gps,rough:state.rough,full:state.full,chartH:state.chartClientHeight}));
}
function checkCompact(s,label){
 console.log('LAYOUT_'+label,JSON.stringify({list:s.listHeight,chart:s.chartHeight,chartWidth:s.chartWidth,plot:s.svgHeight,plotWidth:s.svgWidth,detail:s.chartClientHeight,detailScroll:s.chartScrollHeight,footer:s.footerBottom,viewport:s.viewportHeight}));
 assert(s.full,label+' full screen');
 assert.equal(s.compact,'true',label+' compact chart');
 assert(s.chartScrollHeight<=s.chartClientHeight+3,label+' evidence panel no vertical overflow');
 assert(s.listHeight>=(s.viewportHeight<=830?195:235),label+' candidate list must be tall enough for more visible regions');
 assert(s.svgWidth>=s.chartWidth*.94,label+' chart must use full available horizontal width');
 assert(s.svgHeight>=(s.viewportHeight<=830?90:115),label+' line chart must remain readable');
 assert(s.chartBottom<=s.detailBottom+2,label+' chart fully visible');
 assert(s.footerBottom<=s.viewportHeight+1,label+' action button in viewport');
}
(async()=>{
 assert(fs.existsSync(chrome));
 app=spawn(chrome,['--headless=new','--window-size='+(process.env.QOE_CHROME_WINDOW_SIZE||'1600,960'),'--disable-gpu','--disable-extensions','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,url],{stdio:'ignore',windowsHide:true});
 const file=path.join(profile,'DevToolsActivePort');
 const port=await until(()=>fs.existsSync(file)?Number(fs.readFileSync(file,'utf8').split(/\r?\n/)[0]):null,'Chrome debugger',17000);
 const tab=await until(async()=>{const pages=await(await fetch('http://127.0.0.1:'+port+'/json')).json();return pages.find(p=>p.type==='page'&&p.url.includes('/qoe/'))||null;},'page target');
 ws=new WebSocket(tab.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 ws.addEventListener('message',ev=>{const obj=JSON.parse(ev.data.toString()),p=pending.get(obj.id);if(!p)return;pending.delete(obj.id);clearTimeout(p.timer);if(obj.error)p.reject(Error(JSON.stringify(obj.error)));else p.resolve(obj.result);});
 await cdp('Runtime.enable');
 const first=expected(require('../../public/quality-improvement-mixed-full/'+db.candidates[0].detailPath).candidate.memberCallIds);
 const db1=await until(async()=>{const s=await snapshot();return s.model==='dbscan'&&s.candidates===10&&s.plot&&Number(s.chartTotal.replace(/\D/g,''))===first.rows?s:null;},'DBSCAN first EARFCN lines');
 match(db1,first,'DBSCAN_1');
 assert.equal(await toggleFullscreen(true),'clicked');
 const full=await until(async()=>{const s=await snapshot();return s.full&&s.compact==='true'&&s.plot?s:null;},'DBSCAN full screen');
 match(full,first,'DBSCAN_FULLSCREEN');checkCompact(full,'DBSCAN');
 for(const i of [1,5]){
  assert.equal(await selectCandidate(i),'clicked');
  const exp=expected(require('../../public/quality-improvement-mixed-full/'+db.candidates[i].detailPath).candidate.memberCallIds);
  const state=await until(async()=>{const s=await snapshot();return s.full&&Number(s.chartTotal.replace(/\D/g,''))===exp.rows?s:null;},'DBSCAN candidate '+(i+1));
  match(state,exp,'DBSCAN_'+(i+1));checkCompact(state,'DBSCAN_'+(i+1));
 }
 assert.equal(await toggleFullscreen(false),'clicked');
 await until(async()=>!(await snapshot()).full,'exit full screen');
 for(const name of ['hdbscan','st_dbscan','adaptive_kde','spatial_scan','bayesian']){
  assert.equal(await selectModel(name),name);
  const exp=expected(models.models[name].candidates[0].members.map(p=>p.callId));
  const state=await until(async()=>{const s=await snapshot();return s.model===name&&s.candidates===models.models[name].candidates.filter(c=>c.poorCalls>=6&&c.poorCustomers>=3&&c.days>=3).length&&s.plot&&Number(s.chartTotal.replace(/\D/g,''))===exp.rows?s:null;},name+' lines');
  match(state,exp,name.toUpperCase());
  if(name==='hdbscan'){
   assert.equal(await toggleFullscreen(true),'clicked');
   const visible=await until(async()=>{const s=await snapshot();return s.full&&s.compact==='true'&&s.plot?s:null;},'HDBSCAN fullscreen');
   match(visible,exp,'HDBSCAN_FULLSCREEN');checkCompact(visible,'HDBSCAN');
   assert.equal(await toggleFullscreen(false),'clicked');
  }
 }
 console.log('EARFCN_LINES_ALL_SIX_BROWSER_QA=PASS');
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;}).finally(async()=>{
 try{ws?.close();}catch{}
 if(app?.pid){try{execFileSync('taskkill.exe',['/PID',String(app.pid),'/T','/F'],{stdio:'ignore',timeout:14000});}catch{}}
 await sleep(450);try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:8,retryDelay:350});}catch{}
});
