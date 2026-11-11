/* Real Chrome/Leaflet smoke test; only test profile is temporary.
 * Run: node scripts/tests/quality-candidate-selection-only-browser-qa.cjs
 * Optional environment: QOE_QA_ORIGIN=http://127.0.0.1:3021
 */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawn,execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const chromeBin='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const base=process.env.QOE_QA_ORIGIN||'http://127.0.0.1:3021';
const url=base+'/qoe/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&from=00%3A00&to=23%3A59&mapMode=improvement';
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'qoe-selected-markers-'));
let chrome=null,ws=null;
let nextId=1;
const requests=new Map();
async function waitUntil(fn,label,maxMs=33000){
 const start=Date.now();
 while(Date.now()-start<maxMs){
   try{const v=await fn();if(v)return v;}catch(err){}
   await sleep(450);
 }
 throw Error('Timed out waiting for '+label);
}
function cdp(method,params={}){
 const id=nextId++;
 return new Promise((resolve,reject)=>{
   const deadline=setTimeout(()=>{requests.delete(id);reject(Error('CDP timeout '+method));},16000);
   requests.set(id,{resolve,reject,deadline});
   ws.send(JSON.stringify({id,method,params}));
 });
}
async function evaluate(js){
 const answer=await cdp('Runtime.evaluate',{expression:js,returnByValue:true,awaitPromise:true});
 if(answer.exceptionDetails)throw Error('Chrome JS error '+JSON.stringify(answer.exceptionDetails));
 return answer.result?.value;
}
async function snapshot(){
 const json=await evaluate("JSON.stringify({rough:document.querySelectorAll('.qoe-rough-location-marker').length,gps:document.querySelectorAll('.qoe-gps-rf-marker').length,towers:document.querySelectorAll('.qoe-station-tower-marker').length,linked:document.querySelectorAll('.qoe-station-linked').length,selectedRough:document.querySelectorAll('.qoe-rough-selected').length,choices:document.querySelectorAll('[data-candidate-id]').length})");
 return JSON.parse(json);
}
async function click(i){
 const js="(function(){const nodes=document.querySelectorAll('[data-candidate-id]');if(!nodes["+i+"])return 'missing';nodes["+i+"].dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));return 'clicked-"+i+"';})()";
 return evaluate(js);
}
(async()=>{
 assert(fs.existsSync(chromeBin),'Chrome missing');
 chrome=spawn(chromeBin,['--headless=new','--disable-gpu','--disable-extensions','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,url],{stdio:'ignore',windowsHide:true});
 const portFile=path.join(profile,'DevToolsActivePort');
 const port=await waitUntil(()=>fs.existsSync(portFile)?Number(fs.readFileSync(portFile,'utf8').split(/\r?\n/)[0]):null,'DevToolsActivePort',17000);
 const target=await waitUntil(async()=>{
  const list=await (await fetch('http://127.0.0.1:'+port+'/json')).json();
  return list.find(p=>p.type==='page'&&p.url.includes('/qoe/'))||null;
 },'Chrome page target',15000);
 ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{
  ws.addEventListener('open',resolve,{once:true});
  ws.addEventListener('error',reject,{once:true});
 });
 ws.addEventListener('message',event=>{
  const packet=JSON.parse(event.data.toString());
  if(!packet.id||!requests.has(packet.id))return;
  const request=requests.get(packet.id);requests.delete(packet.id);clearTimeout(request.deadline);
  if(packet.error)request.reject(Error(JSON.stringify(packet.error)));else request.resolve(packet.result);
 });
 await cdp('Runtime.enable');
 const first=await waitUntil(async()=>{const s=await snapshot();return s.rough===10&&s.gps===8&&s.choices===22&&s.towers>=6?s:null;},'GPS+MDT candidate 1 selected');
 console.log('INITIAL',JSON.stringify(first));
 assert.equal(first.selectedRough,10);
 assert.equal(await click(1),'clicked-1');
 const second=await waitUntil(async()=>{const s=await snapshot();return s.rough===10&&s.gps===3&&s.towers>0?s:null;},'candidate 2 only');
 console.log('SECOND',JSON.stringify(second));
 assert.equal(second.selectedRough,10);
 assert.equal(await click(4),'clicked-4');
 const fifth=await waitUntil(async()=>{const s=await snapshot();return s.rough===1&&s.gps===9&&s.selectedRough===1?s:null;},'candidate 5 GPS+MDT');
 console.log('FIFTH',JSON.stringify(fifth));
 assert.equal(await click(5),'clicked-5');
 const sixth=await waitUntil(async()=>{const s=await snapshot();return s.rough===0&&s.gps===9&&s.selectedRough===0?s:null;},'candidate 6 GPS only');
 console.log('SIXTH',JSON.stringify(sixth));
 assert.equal(sixth.choices,22);
 console.log('LIVE_SELECTION_SWITCH=PASS');
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;}).finally(async()=>{
 try{ws?.close();}catch(error){}
 if(chrome?.pid){try{execFileSync('taskkill.exe',['/PID',String(chrome.pid),'/T','/F'],{stdio:'ignore',timeout:12000});}catch(error){}}
 await sleep(700);
 try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:8,retryDelay:350});}catch(error){console.warn('temporary Chrome QA profile retained: '+profile);}
});
