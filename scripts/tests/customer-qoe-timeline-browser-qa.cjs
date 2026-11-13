/* eslint-disable @typescript-eslint/no-require-imports -- Node browser QA runner. */
/* Selected customer timeline: real browser, real query responses, no source-data mutation. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const origin=process.env.QOE_QA_ORIGIN||'http://127.0.0.1:3001';
const out=path.resolve('outputs/customer-qoe-timeline-qa');
fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(out,'chrome-'));
const chrome='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let proc,ws,id=0;const pending=new Map(),errors=[];
async function until(check,label,timeout=30000){
  const started=Date.now();let last;
  while(Date.now()-started<timeout){try{const value=await check();if(value)return value;last=value;}catch(error){last=String(error);}await delay(180);}
  throw Error(label+': '+JSON.stringify(last));
}
function cdp(method,params={}){return new Promise((resolve,reject)=>{
  const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error('CDP timeout '+method));},20000);
  pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));
});}
async function js(expression){const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result?.value;}
const panel='document.querySelector("section[aria-label=\\"선택 고객 통화 품질 추이\\"]")';
async function snapshot(){return js(`(()=>{const p=${panel};return p?{customer:p.dataset.timelineCustomer,text:p.innerText,points:[...p.querySelectorAll('[data-call-id]')].map(e=>({id:e.dataset.callId,qoe:e.dataset.qoe,drop:e.dataset.drop})),width:p.getBoundingClientRect().width}:null})()`);}
async function clickLabel(label){return js(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!b)return false;b.click();return true})()`);}
async function screenshot(name){const value=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(value.data,'base64'));}
(async()=>{
  proc=spawn(chrome,['--headless=new','--disable-gpu','--disable-extensions','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,origin+'/qoe/customer-screening'],{stdio:'ignore',windowsHide:true});
  const port=await until(()=>{const file=path.join(profile,'DevToolsActivePort');return fs.existsSync(file)?Number(fs.readFileSync(file,'utf8').split(/\r?\n/)[0]):null;},'Chrome ready');
  const target=await until(async()=>{const targets=await(await fetch('http://127.0.0.1:'+port+'/json')).json();return targets.find(t=>t.type==='page'&&t.url.includes('customer-screening'));},'Target ready');
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',event=>{const value=JSON.parse(event.data.toString()),request=pending.get(value.id);if(request){pending.delete(value.id);clearTimeout(request.timer);if(value.error)request.reject(Error(JSON.stringify(value.error)));else request.resolve(value.result);}else if(value.method==='Runtime.exceptionThrown')errors.push(value.params.exceptionDetails);});
  await cdp('Runtime.enable');await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
  const first=await until(async()=>{const value=await snapshot();return value?.points.length?value:null;},'Timeline replaces customer comparison',Number(process.env.QOE_QA_TIMEOUT||30000));
  const firstNumber=await js(`(${panel}).querySelector('strong').textContent`);
  assert(!await js('document.body.innerText.includes("선택 고객 비교")'));
  assert(first.text.includes('저품질 기준'));
  assert.deepEqual(await js(`[...(${panel}).querySelectorAll('[data-axis-score]')].map(e=>Number(e.dataset.axisScore))`),[5,4,3,2,1],'QoE axis is fixed from 1 to 5');
  assert(await js(`(()=>{const p=${panel};const top=Number(p.querySelector('[data-axis-score="5"]').getAttribute('y'))-4,bottom=Number(p.querySelector('[data-axis-score="1"]').getAttribute('y'))-4;return [...p.querySelectorAll('[data-call-id]:not([data-unscored="true"])')].every(e=>{const y=Number(e.querySelector('circle').getAttribute('cy'));return y>=top&&y<=bottom})})()`),'All scored observations stay within the 1-to-5 plot');
  const response=await js(`(async()=>{const p=${panel};const r=await fetch('/qoe/api/voice/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'customer-qoe-timeline',customerId:p.dataset.timelineCustomer,scope:{dateStart:'2026-10-26',dateEnd:'2026-10-30',from:'00:00',to:'23:59'}})});if(!r.ok)throw Error(await r.text());return r.json()})()`);
  assert.equal(first.points.length,response.calls.length,'Every scoped call is represented, including unscored and unlocated calls');
  for(const call of response.calls){const point=first.points.find(p=>p.id===call.id);assert(point);assert.equal(point.qoe,call.qoe===null?'':String(call.qoe));assert.equal(point.drop,String(call.drop));}
  const located=response.calls.find(call=>call.location);
  assert(located,'At least one call with original location exists');
  assert(await js(`(()=>{const p=${panel};const point=[...p.querySelectorAll('[data-call-id]')].find(e=>e.dataset.callId===${JSON.stringify(located.id)});if(!point)return false;point.dispatchEvent(new MouseEvent('click',{bubbles:true}));return true})()`));
  await until(()=>js(`!![...document.querySelectorAll('.qoe-timeline-focused-call')].find(e=>e.dataset.callId===${JSON.stringify(located.id)})`),'Selected graph call focuses its evidenced map point');
  const href=await until(()=>js(`(()=>{const p=${panel};return p.querySelector('a[href*="call="]')?.getAttribute('href')})()`),'Selected raw-call link');
  const selectedUrl=new URL(href,origin);assert.equal(selectedUrl.searchParams.get('call'),located.rawCallId);assert.equal(selectedUrl.searchParams.get('date'),located.date);assert(selectedUrl.pathname.startsWith('/qoe/'));
  await js(`(()=>{const point=[...(${panel}).querySelectorAll('[data-call-id]')].find(e=>e.dataset.callId===${JSON.stringify(located.id)});point.focus()})()`);
  await delay(100);
  await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9});
  await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9});
  assert(await js(`document.activeElement?.getAttribute('href')===${JSON.stringify(href)}`),'Tab reaches the selected call detail link');
  await screenshot('desktop-selected-call');
  const anotherDay=response.calls.find(call=>call.date!==located.date)?.date;
  if(anotherDay){
    await js(`(()=>{const s=document.querySelector('select[aria-label="고객 위치흐름 날짜"]');s.value=${JSON.stringify(anotherDay)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await until(()=>js('document.querySelectorAll(".qoe-timeline-focused-call").length===0'),'Map day clears an out-of-day selected point');
  }
  assert(await clickLabel('하루 확대'));
  const day=await until(()=>js(`(()=>{const s=document.querySelector('select[aria-label="통화 품질 추이 날짜"]');return s?.value&&s.value!=='all'?s.value:null})()`),'Day zoom');
  const dayView=await until(async()=>{const value=await snapshot();return value?.points.length===response.calls.filter(c=>c.date===day).length?value:null;},'Day zoom retains exactly its calls');
  assert(dayView.points.every(p=>response.calls.find(c=>c.id===p.id)?.date===day));
  assert.deepEqual(await js(`[...(${panel}).querySelectorAll('[data-axis-score]')].map(e=>Number(e.dataset.axisScore))`),[5,4,3,2,1],'Day zoom retains the same QoE range');
  assert(await clickLabel('기간 전체'));
  await until(async()=>{const value=await snapshot();return value?.points.length===response.calls.length;},'Restore all calls');
  const secondCustomer=await js(`(()=>{const rows=[...document.querySelectorAll('tr[aria-selected="false"]')];const row=rows.find(r=>r.querySelector('td:nth-child(2) button'));if(!row)return false;const b=row.querySelector('td:nth-child(2) button');b.click();return true})()`);
  assert(secondCustomer);
  const second=await until(async()=>{const value=await snapshot();return value?.customer&&value.customer!==first.customer&&value.points.length?value:null;},'Changing customer refreshes the timeline');
  assert(second.points.every(p=>!response.calls.some(c=>c.id===p.id)),'No old customer calls remain');
  await js(`(()=>{const input=document.querySelector('input[aria-label="서비스계약번호 검색"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(firstNumber)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await until(async()=>{const value=await snapshot();return value?.customer===first.customer&&value.points.length===first.points.length;},'A filter excluding the pinned customer accepts the server-selected replacement');
  await cdp('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const original=window.fetch;let fail=true;window.fetch=function(input,init){let request;try{request=JSON.parse(init?.body||'null')}catch{}if(fail&&request?.op==='customer-qoe-timeline'){fail=false;return Promise.reject(new TypeError('QA transient network failure'))}return original.apply(this,arguments)}})()`});
  await cdp('Page.reload',{ignoreCache:true});
  await until(()=>js(`(${panel})?.innerText.includes('다시 시도')`),'Transient timeline failure exposes retry');
  assert(await clickLabel('다시 시도'));
  await until(async()=>{const value=await snapshot();return value?.points.length;},'Retry loads real customer calls');
  await cdp('Emulation.setDeviceMetricsOverride',{width:768,height:1000,deviceScaleFactor:1,mobile:false});
  await delay(350);await js(`(${panel})?.scrollIntoView({block:'start'})`);
  assert(await js(`(()=>{const p=${panel};const r=p.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&p.scrollWidth<=p.clientWidth+1})()`),'Timeline fits narrow layout');
  await screenshot('narrow');
  assert.equal(errors.length,0,JSON.stringify(errors));
  const result={origin,calls:first.points.length,qoeAxis:[1,5],customerChanged:true,dayZoom:true,rawCallLink:true,mapFocus:true,mapDayClearsFocus:true,keyboardDetail:true,filteredFallback:true,retry:true,narrowLayout:true,consoleErrors:errors.length};
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(async error=>{if(ws?.readyState===WebSocket.OPEN){try{await screenshot('failure');fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:String(error),snapshot:await snapshot(),exceptions:errors},null,2));}catch{}}console.error(error);process.exitCode=1;}).finally(async()=>{
  if(ws?.readyState===WebSocket.OPEN){try{await cdp('Browser.close');}catch{}ws.close();}
  if(proc&&!proc.killed)proc.kill();
});
