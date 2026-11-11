/* Chrome real-browser KPI display check.
 * Optional QOE_QA_ORIGIN=http://127.0.0.1:3021
 */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawn,execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const bin='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const origin=process.env.QOE_QA_ORIGIN||'http://127.0.0.1:3021';
const route='/qoe/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&from=00%3A00&to=23%3A59&mapMode=current';
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'qoe-kpi-rate-'));
let chrome,ws,id=0;
const pending=new Map();
async function until(fn,label,ms=33000){
 const start=Date.now();
 while(Date.now()-start<ms){try{const v=await fn();if(v)return v;}catch(err){}await sleep(450);}
 throw Error('Timed out '+label);
}
function cdp(method,params={}){
 const seq=++id;
 return new Promise((resolve,reject)=>{
  const alarm=setTimeout(()=>{pending.delete(seq);reject(Error('CDP timeout '+method));},15500);
  pending.set(seq,{resolve,reject,alarm});
  ws.send(JSON.stringify({id:seq,method,params}));
 });
}
async function evaluate(source){
 const result=await cdp('Runtime.evaluate',{expression:source,returnByValue:true,awaitPromise:true});
 if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
 return result.result.value;
}
const script="(function(){const host=document.querySelector('[aria-label=\"주요 QoE 품질 지표\"]');if(!host)return null;const cards=[...host.children];const card=cards[4];if(!card)return null;const content=card.querySelector('[class*=\"kpiContent\"]');const line=card.querySelector('[class*=\"kpiValueLine\"]');const badge=card.querySelector('[class*=\"locationCoverageRate\"]');const num=line?.querySelector('strong');const r=x=>{const b=x?.getBoundingClientRect();return b?{x:Math.round(b.x),y:Math.round(b.y),right:Math.round(b.right),bottom:Math.round(b.bottom),width:Math.round(b.width)}:null};return JSON.stringify({cards:cards.length,title:content?.firstElementChild?.innerText??'',value:num?.innerText??'',badge:badge?.innerText??'',description:[...card.querySelectorAll('small')].map(n=>n.innerText),svgCount:card.querySelectorAll('svg').length,otherGraphs:cards.slice(0,4).map(c=>c.querySelectorAll('svg').length),alignment:cards.map(c=>{const frame=c.getBoundingClientRect();const area=c.children[1];const heading=area.children[0].getBoundingClientRect();const value=area.children[1].querySelector('strong').getBoundingClientRect();return {titleY:Math.round(heading.y-frame.y),numberY:Math.round(value.y-frame.y),contentX:Math.round(area.getBoundingClientRect().x-frame.x),scroll:c.scrollWidth,client:c.clientWidth};}),cardRect:r(card),contentRect:r(content),lineRect:r(line),numberRect:r(num),badgeRect:r(badge),iconColor:getComputedStyle(card.firstElementChild).color,titleColor:getComputedStyle(content.firstElementChild).color,numberColor:getComputedStyle(num).color,badgeColor:getComputedStyle(badge).color,cardBackground:getComputedStyle(card).backgroundColor,scroll:Math.round(card.scrollWidth),client:Math.round(card.clientWidth)});})()";
async function snapshot(){const str=await evaluate(script);return str&&JSON.parse(str);}
(async()=>{
 assert(fs.existsSync(bin),'Chrome missing');
 chrome=spawn(bin,['--headless=new','--disable-gpu','--disable-extensions','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--window-size=1920,1080','--user-data-dir='+profile,origin+route],{windowsHide:true,stdio:'ignore'});
 const port=await until(()=>{const p=path.join(profile,'DevToolsActivePort');return fs.existsSync(p)?Number(fs.readFileSync(p,'utf8').split(/\r?\n/)[0]):null;},'debug port',17000);
 const page=await until(async()=>{const list=await (await fetch('http://127.0.0.1:'+port+'/json')).json();return list.find(p=>p.type==='page'&&p.url.includes('/qoe/'))||null;},'page target',16000);
 ws=new WebSocket(page.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 ws.addEventListener('message',ev=>{const msg=JSON.parse(ev.data.toString());if(!msg.id||!pending.has(msg.id))return;const req=pending.get(msg.id);pending.delete(msg.id);clearTimeout(req.alarm);if(msg.error)req.reject(Error(JSON.stringify(msg.error)));else req.resolve(msg.result);});
 await cdp('Runtime.enable');
 const full=await until(async()=>{const s=await snapshot();return s?.badge?.includes('15.0%')&&s.value==='237건'?s:null;},'5-day KPI rendering');
 console.log('DESKTOP',JSON.stringify(full));
 assert.equal(full.cards,5);
 assert.equal(full.title,'저품질통화 (위치활용)');
 assert.equal(full.iconColor,'rgb(50, 142, 227)','location icon retains original blue');
 assert.equal(full.titleColor,'rgb(38, 58, 84)','title retains normal dark color');
 assert.equal(full.numberColor,'rgb(203, 53, 70)','237 count must be red');
 assert.equal(full.badgeColor,'rgb(37, 99, 165)','location ratio retains original blue');
 assert.equal(full.cardBackground,'rgb(255, 255, 255)','KPI card background stays white');
 assert.equal(full.badge,'저품질 통화 대비 15.0%');
 assert.deepEqual(full.description,['GPS 131건 · 삼각 측량 근사 106건']);
 assert.equal(full.svgCount,1,'location card has icon only, no right-hand chart');
 assert(full.otherGraphs.every(n=>n===1),'other four summary cards have only their icon, no microcharts');
 assert(full.alignment.every(a=>a.titleY===full.alignment[0].titleY),'all five KPI headings share the same top alignment');
 assert(full.alignment.every(a=>a.numberY===full.alignment[0].numberY),'all five KPI numbers share the same top alignment');
 assert(full.alignment.every(a=>a.contentX===full.alignment[0].contentX),'all five KPI content blocks share the same left inset');
 assert(full.alignment.every(a=>a.scroll<=a.client+1),'no individual KPI card overflows horizontally');
 assert(full.badgeRect&&full.numberRect&&full.contentRect);
 assert(full.badgeRect.right <= full.cardRect.right+1,'badge must stay inside card');
 assert.equal(full.contentRect.x,full.numberRect.x,'value left-aligned with title/description');
 assert(full.scroll <= full.client+1,'no card horizontal overflow');
 await cdp('Emulation.setDeviceMetricsOverride',{width:1480,height:940,deviceScaleFactor:1,mobile:false});
 await sleep(800);
 const compact=await snapshot();
 console.log('COMPACT',JSON.stringify(compact));
 assert.equal(compact.badge,'저품질 통화 대비 15.0%');
 assert(compact.badgeRect.right<=compact.cardRect.right+1);
 assert(compact.scroll<=compact.client+1);
 console.log('KPI_DESKTOP_AND_COMPACT=PASS');
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;}).finally(async()=>{
 try{ws?.close();}catch(e){}
 if(chrome?.pid){try{execFileSync('taskkill.exe',['/PID',String(chrome.pid),'/T','/F'],{timeout:13000,stdio:'ignore'});}catch(e){}}
 await sleep(700);
 try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:7,retryDelay:400});}catch(e){console.warn('temporary profile retained '+profile)}
});
