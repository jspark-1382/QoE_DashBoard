/* 신규 고객 선별 화면 전용 Chrome CDP 스모크/상호작용 검사. */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const chrome='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const origin=process.env.QOE_QA_ORIGIN||'http://127.0.0.1:3024';
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'qoe-screening-'));
let proc,ws,seq=0;const pending=new Map();
async function until(fn,label,timeout=85000){
 const start=Date.now();let last;
 while(Date.now()-start<timeout){
  try{const x=await fn();if(x)return x;last=x;}catch(e){last=e?.message;}
  await sleep(500);
 }
 throw Error('Timeout '+label+' '+JSON.stringify(last));
}
function cdp(method,params={}){
 const id=++seq;
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},15000);
  pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
 });
}
async function evalJs(js){
 const data=await cdp('Runtime.evaluate',{expression:js,returnByValue:true,awaitPromise:true});
 if(data.exceptionDetails)throw Error(JSON.stringify(data.exceptionDetails));
 return data.result?.value;
}
function inspect(){
 const body=document.body?.innerText||'';
 const ranks=[...document.querySelectorAll('table tbody tr')];
 const nav=document.querySelector('nav[aria-label="품질 분석 탭"]');
 const navLabels=[...(nav?.querySelectorAll('a')||[])].map(a=>a.textContent.trim());
 const map=document.querySelector('[aria-label="고객 선별 행정동 경계 및 무선 위치근거 지도"]');
 return {
  customerTab:navLabels.at(-1),
  originalTabs:navLabels.slice(0,7),
  status:body.includes('저품질 통화 집중 고객 TOP 10')&&body.includes('고객군 분포'),
  all:body.includes('46,640'),poor:body.includes('1,359'),low:body.includes('1,580'),
  rows:ranks.length,
  topCustomer:ranks[0]?.querySelector('td:nth-child(2)')?.textContent.trim()||'',
  mapMarkers:map?.querySelectorAll('.leaflet-interactive').length||0,
  navCount:navLabels.length, selected:!!document.querySelector('table tr[aria-selected="true"]'),
  link:[...document.querySelectorAll('a')].find(a=>a.textContent.includes('기존 고객·통화 상세'))?.getAttribute('href')||'',
  error:body.includes('고객 선별 데이터가 없습니다')||body.includes('데이터 형식이 올바르지 않습니다'),
 };
}
const inspectJs='('+inspect.toString()+')()';
(async()=>{
 assert(fs.existsSync(chrome));
 proc=spawn(chrome,['--headless=new','--window-size=1680,1000','--disable-gpu','--disable-extensions','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,origin+'/qoe/customer-screening'],{stdio:'ignore',windowsHide:true});
 const port=await until(()=>{const file=path.join(profile,'DevToolsActivePort');return fs.existsSync(file)?Number(fs.readFileSync(file,'utf8').split(/\r?\n/)[0]):null;},'Chrome debug',22000);
 const target=await until(async()=>{const list=await(await fetch('http://127.0.0.1:'+port+'/json')).json();return list.find(t=>t.type==='page'&&t.url.includes('customer-screening'));},'Chrome page');
 ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 ws.addEventListener('message',ev=>{const o=JSON.parse(ev.data.toString()),p=pending.get(o.id);if(p){pending.delete(o.id);clearTimeout(p.timer);o.error?p.reject(Error(JSON.stringify(o.error))):p.resolve(o.result);}});
 await cdp('Runtime.enable');
 let checked=0; const initial=await until(async()=>{const x=await evalJs(inspectJs);checked++;if(checked===1||checked%12===0)console.log('SCREENING_DIAG',JSON.stringify(x));return x.all&&x.poor&&x.status&&x.mapMarkers>0?x:null;},'customer screening loaded',20000);
 assert.equal(initial.customerTab,'고객 선별');assert.equal(initial.navCount,8);
 assert(initial.rows===10&&initial.low&&initial.selected);
 assert(initial.link.includes('/qoe/?source=MDT&view=contract'));
 console.log('SCREENING_INITIAL',JSON.stringify(initial));
 await cdp('Page.enable');
 const screenshot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 fs.mkdirSync('outputs',{recursive:true});
 const screenshotPath='outputs/customer-screening-ui-'+(new URL(origin).port||'3024')+'.png';
 fs.writeFileSync(screenshotPath,Buffer.from(screenshot.data,'base64'));
 console.log('SCREENSHOT '+screenshotPath);
 // Screen mode and spatial evidence regression: a polygon is not a fake customer GPS point.
 const fills=await evalJs('(function(){return [...new Set([...document.querySelectorAll(".leaflet-overlay-pane path.leaflet-interactive")].map(p=>p.getAttribute("fill")))].filter(Boolean)})()');
 assert(fills.length>=3,'Choropleth map must show real non-uniform administrative polygon fills');
 const chooseMode=async(label)=>evalJs('(function(){const b=[...document.querySelectorAll("button")].find(x=>x.textContent.trim()==='+JSON.stringify(label)+');if(!b)return false;b.click();return true})()');
 const clickArea=await evalJs('(function(){const ps=[...document.querySelectorAll(".leaflet-overlay-pane path.leaflet-interactive")];const x=ps.find(p=>["#b72f50","#e66b64","#eda36f"].includes((p.getAttribute("fill")||"").toLowerCase()));if(!x)return false;x.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true}));return true})()');
 assert(clickArea,'Click a colored real administrative district');
 const district=await until(async()=>{const x=await evalJs('document.body.innerText');return x.includes("선택 고객 비교 ·")?x:null;},'district selection scopes comparison',17000);
 assert(district.includes('선택 해제'));
 const mapMetric=await evalJs('(function(){const s=document.querySelector("select[aria-label=\\"고객 지도 집계 지표\\"]");s.value="drops";s.dispatchEvent(new Event("change",{bubbles:true}));return s.value})()');
 assert.equal(mapMetric,'drops');
 await until(async()=>await evalJs('document.querySelector("[aria-label=\\"고객 지도 집계 범례\\"]")?.textContent.includes("SIP Drop 통화")'), 'SIP Drop metric map',17000);
 assert(await chooseMode('기지국·셀별'));
 const cell=await until(async()=>await evalJs('document.body.innerText.includes("관측 셀")&&document.querySelectorAll(".leaflet-overlay-pane path.leaflet-interactive").length>39'), 'BYE Cell view',17000);
 assert(cell);
 assert(await chooseMode('GNSS 실측'));
 const gnss=await until(async()=>await evalJs('document.body.innerText.includes("GNSS 격자")&&document.querySelectorAll(".leaflet-overlay-pane path.leaflet-interactive").length>39'), 'GNSS-only view',17000);
 assert(gnss);
 assert(await chooseMode('행정동별 고객'));
 await until(async()=>await evalJs('document.querySelectorAll(".leaflet-overlay-pane path.leaflet-interactive").length>=39'), 'restore administrative polygon map',17000);
 console.log('SCREENING_MAP_VIEW_QA=PASS');
 const changed=await evalJs('(function(){const b=[...document.querySelectorAll("button")].find(x=>x.textContent.trim()==="Drop 기준");if(!b)return false;b.click();return true})()');
 assert(changed);
 await until(async()=>{const x=await evalJs(inspectJs);return x.topCustomer!==initial.topCustomer?x:null;},'Drop ranking sort');
 const filter=await evalJs('(function(){const s=document.querySelector("select[aria-label=\\"고객 선별 조건\\"]");s.value="repeat";s.dispatchEvent(new Event("change",{bubbles:true}));return s.value})()');
 assert.equal(filter,'repeat');
 await until(async()=>{const x=await evalJs(inspectJs);return x.rows>0&&x.rows<=10&&x.status?x:null;},'filter');

 // Selecting a customer from the TOP10 must switch the map to chronological
 // GNSS/BYE-site observations, not treat cell sites as handset GPS.
 const pickTop=await evalJs('(function(){const b=document.querySelector("table tbody tr td:nth-child(2) button");if(!b)return false;b.click();return true})()');
 assert(pickTop);
 const routeFirst=await until(async()=>evalJs('(function(){const l=document.querySelector("[aria-label=\\"고객 위치흐름 범례\\"]"),p=document.querySelectorAll(".leaflet-overlay-pane .customer-route-point");return l&&p.length>0?{text:l.innerText,count:p.length,links:document.querySelectorAll(".customer-route-link").length}:null})()'),'TOP10 customer route',25000);
 assert(routeFirst.text.includes('BYE 기지국 참고'));
 assert(routeFirst.text.includes('실제 이동경로 아님'));
 console.log('CUSTOMER_ROUTE_FROM_TOP10',JSON.stringify(routeFirst));
 const dateDrop=await evalJs('(function(){const s=document.querySelector("select[aria-label=\\"고객 위치흐름 날짜\\"]");return s?[...s.options].map(x=>x.value):null})()');
 assert(dateDrop?.length>=2);
 const customerList=await evalJs('(function(){const b=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="고객 목록");if(!b)return false;b.click();return true})()');
 assert(customerList);
 await until(async()=>await evalJs('!!document.querySelector("[role=\\"dialog\\"][aria-label=\\"고객 목록에서 선택\\"]")'),'customer list dialog');
 const searchInList=await evalJs('(function(){const s=document.querySelector("input[aria-label=\\"목록 내 서비스계약번호 검색\\"]");if(!s)return false;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;setter.call(s,"511186569");s.dispatchEvent(new Event("input",{bubbles:true}));return true})()');
 assert(searchInList);
 await until(async()=>await evalJs('!![...document.querySelectorAll("[role=\\"dialog\\"] table tbody button")].find(b=>b.textContent.includes("511186569"))'),'listed mixed-evidence customer');
 const fromList=await evalJs('(function(){const b=[...document.querySelectorAll("[role=\\"dialog\\"] table tbody button")].find(b=>b.textContent.includes("511186569"));if(!b)return false;b.click();return true})()');
 assert(fromList);
 const mixed=await until(async()=>evalJs('(function(){const t=document.querySelector("[aria-label=\\"고객 위치흐름 범례\\"]")?.innerText||"",p=document.querySelectorAll(".customer-route-point").length,gps=document.querySelectorAll(".customer-route-site").length;return t.includes("511186569")&&p>20?{text:t,points:p,gnssSiteMarkers:gps,links:document.querySelectorAll(".customer-route-link").length}:null})()'),'customer list mixed GNSS + BYE route',25000);
 assert(mixed.text.includes('GNSS 실측 28건'));
 assert(mixed.text.includes('BYE 기지국 참고'));
 assert(mixed.gnssSiteMarkers>0);
 assert.equal(await evalJs('document.querySelector("[role=\\"dialog\\"]")===null'),true);
 console.log('CUSTOMER_ROUTE_FROM_LIST',JSON.stringify(mixed));
 await sleep(1400);
 const routeScreen=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 const routeScreenshotPath='outputs/customer-screening-customer-route-'+(new URL(origin).port||'3024')+'.png';
 fs.writeFileSync(routeScreenshotPath,Buffer.from(routeScreen.data,'base64'));
 console.log('ROUTE_SCREENSHOT '+routeScreenshotPath);

 const second=await evalJs('(function(){const b=document.querySelectorAll("button[aria-pressed]")[1];if(!b)return false;b.click();return true})()');
 assert(second);
 await until(async()=>await evalJs('(function(){const v=document.querySelector("[aria-label=\\"고객 위치흐름 범례\\"]")?.innerText||"";return !!v&&!v.includes("511186569")})()'),'comparison card changes route',24000);
 console.log('CUSTOMER_ROUTE_COMPARE_QA=PASS');
 console.log('SCREENING_BROWSER_QA=PASS');
})().catch(e=>{console.error(e.stack||e);process.exitCode=1}).finally(async()=>{
 try{ws?.close()}catch{}
 if(proc?.pid)try{execFileSync('taskkill.exe',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore',timeout:14000})}catch{}
 await sleep(300);try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:6,retryDelay:350})}catch{}
});
