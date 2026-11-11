const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const sleep=t=>new Promise(r=>setTimeout(r,t));
const bin='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const origin=process.env.QOE_QA_ORIGIN||'http://127.0.0.1:3021';
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'qoe-terms-'));
const url=origin+'/qoe/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&from=00%3A00&to=23%3A59&mapMode=current';
let chrome,ws,id=0;const pending=new Map();
async function until(fn,label,limit=34000){const start=Date.now();while(Date.now()-start<limit){try{const v=await fn();if(v)return v;}catch{}await sleep(400);}throw Error('Timeout '+label);}
function cdp(method,params={}){const seq=++id;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(seq);reject(Error('CDP timeout '+method));},16000);pending.set(seq,{resolve,reject,timer});ws.send(JSON.stringify({id:seq,method,params}));});}
async function evaluate(source){const r=await cdp('Runtime.evaluate',{expression:source,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;}
const snapshotScript="(function(){const tab=[...document.querySelectorAll('fieldset[aria-label=\"지도 모드\"] button')];const card=document.querySelector('[aria-label=\"주요 QoE 품질 지표\"]');const text=document.body.innerText;return JSON.stringify({names:tab.map(x=>x.textContent.trim()),pressed:tab.map(x=>x.getAttribute('aria-pressed')),cardLabels:card?[...card.children].map(x=>x.innerText):[],qoe:text.includes('QoE 분포'),map:text.includes('저품질 통화 위치'),rank:text.includes('저품질 순위'),station:!!document.querySelector('button[aria-label=\"기지국 표시 전환\"]'),distribution:!!document.querySelector('select[aria-label=\"QoE 분포 기준\"]'),old: text.includes('기존 현황'),candidates:document.querySelectorAll('[data-candidate-id]').length});})()";
async function snapshot(){return JSON.parse(await evaluate(snapshotScript));}
async function click(label){return evaluate("(function(){const b=[...document.querySelectorAll('fieldset[aria-label=\"지도 모드\"] button')].find(x=>x.textContent.trim()==="+JSON.stringify(label)+");if(!b)return 'missing';b.click();return 'clicked';})()");}
(async()=>{
 assert(fs.existsSync(bin));
 chrome=spawn(bin,['--headless=new','--disable-gpu','--disable-extensions','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,url],{windowsHide:true,stdio:'ignore'});
 const portfile=path.join(profile,'DevToolsActivePort');
 const port=await until(()=>fs.existsSync(portfile)?Number(fs.readFileSync(portfile,'utf8').split(/\r?\n/)[0]):null,'Chrome debugging port',17000);
 const tab=await until(async()=>{const arr=await(await fetch('http://127.0.0.1:'+port+'/json')).json();return arr.find(x=>x.type==='page'&&x.url.includes('/qoe/'))||null;},'Chrome page',16000);
 ws=new WebSocket(tab.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 ws.addEventListener('message',event=>{const x=JSON.parse(event.data.toString()),r=pending.get(x.id);if(!r)return;pending.delete(x.id);clearTimeout(r.timer);if(x.error)r.reject(Error(JSON.stringify(x.error)));else r.resolve(x.result);});
 await cdp('Runtime.enable');
 const current=await until(async()=>{const s=await snapshot();return s.qoe&&s.map&&s.rank&&s.cardLabels.length===5?s:null;},'quality dashboard');
 console.log('CURRENT',JSON.stringify(current));
 assert.deepEqual(current.names,['품질현황','개선후보']);
 assert.deepEqual(current.pressed,['true','false']);
 assert(current.station&&current.distribution&&!current.old);
 assert(current.cardLabels[2].includes('평균 QoE')&&current.cardLabels[2].includes('MOS(v5) 기반'));
 assert(!current.cardLabels[2].includes('Drop 보정')&&!current.cardLabels[2].includes('절단'));
 assert.equal(await click('개선후보'),'clicked');
 const candidate=await until(async()=>{const s=await snapshot();return s.pressed[1]==='true'&&s.candidates===10?s:null;},'candidate tab 22 items');
 console.log('CANDIDATE',JSON.stringify({names:candidate.names,pressed:candidate.pressed,candidates:candidate.candidates}));
 assert.equal(await click('품질현황'),'clicked');
 const back=await until(async()=>{const s=await snapshot();return s.pressed[0]==='true'&&s.qoe&&s.map&&s.rank?s:null;},'switch back');
 console.log('RESTORED',JSON.stringify({names:back.names,qoe:back.qoe,map:back.map,rank:back.rank}));
 console.log('TERMINOLOGY_BROWSER=PASS');
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;}).finally(async()=>{try{ws?.close();}catch{}if(chrome?.pid){try{execFileSync('taskkill.exe',['/PID',String(chrome.pid),'/T','/F'],{stdio:'ignore',timeout:13000});}catch{}}await sleep(400);try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:8,retryDelay:350});}catch{}});
