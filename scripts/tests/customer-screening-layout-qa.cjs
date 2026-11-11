/* 고객 선별 화면: 1600x900 한 화면 배치, 표 10건 가독성, 하단 패널 노출 검증. */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const chrome='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const origin=process.env.QOE_QA_ORIGIN||'http://127.0.0.1:3024';
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'qoe-layout-screening-'));
let proc,ws,n=0;const pending=new Map();
async function until(check,label,ms=40000){
 const begin=Date.now();let last;
 while(Date.now()-begin<ms){try{const result=await check();if(result)return result;last=result;}catch(error){last=String(error);}await delay(400)}
 throw Error('Timeout '+label+' last='+JSON.stringify(last));
}
function cdp(method,params={}) {
 const id=++n;return new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},18000);
  pending.set(id,{resolve,reject,timeout});ws.send(JSON.stringify({id,method,params}));
 });
}
async function js(code) {
 const r=await cdp('Runtime.evaluate',{expression:code,returnByValue:true,awaitPromise:true});
 if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));
 return r.result.value;
}
function layout(){
 const box=(el)=>{
  if(!el)return null;
  const r=el.getBoundingClientRect();
  return {left:Math.round(r.left),right:Math.round(r.right),top:Math.round(r.top),bottom:Math.round(r.bottom),
    width:Math.round(r.width),height:Math.round(r.height),scrollHeight:el.scrollHeight,clientHeight:el.clientHeight};
 };
 const main=document.querySelector('main');
 const mainChildren=[...(main?.children||[])];
 const blocks=mainChildren.map(el=>({title:el.textContent.trim().slice(0,28),...box(el)}));
 const table=document.querySelector('table');
 const tableScroll=table?.parentElement;
 const tableRect=tableScroll?.getBoundingClientRect();
 const rows=[...(table?.querySelectorAll('tbody tr')||[])];
 const visibleRows=rows.filter(tr=>tr.getBoundingClientRect().top>=tableRect.top&&tr.getBoundingClientRect().bottom<=tableRect.bottom+1).length;
 const top=mainChildren[2],investigation=mainChildren[3],note=mainChildren[4];
 const mapPanel=investigation?.children[0],stack=investigation?.children[1];
 const comparePanel=stack?.children[0],detailPanel=stack?.children[1];
 const sections=[...(top?.children||[]),mapPanel,comparePanel,detailPanel].filter(Boolean).map(el=>({
   title:el.textContent.trim().slice(0,20),...box(el)
 }));
 const texts=document.body?.textContent||'';
 return {
  width:innerWidth,height:innerHeight,
  documentHeight:document.documentElement.scrollHeight,bodyHeight:document.body.scrollHeight,
  blocks,sections,
  table:{rows:rows.length,visibleRows,...box(tableScroll)},
  noteVisible:note?note.getBoundingClientRect().bottom<=innerHeight:undefined,
  kpiCards:mainChildren[1]?.children.length,
  kpiTexts:[...(mainChildren[1]?.children||[])].map(el=>el.textContent.trim().slice(0,60)),
  hasScatter:!![...document.querySelectorAll('h2')].find(h=>h.textContent.includes('고객별 저품질 분포')),
  totalCallColumn:[...table?.querySelectorAll('thead th')||[]].some(th=>th.textContent.includes('총 통화 건수')),
  mapLeftOfComparison:mapPanel?.getBoundingClientRect().right<=comparePanel?.getBoundingClientRect().left,
  compareAboveDetail:comparePanel?.getBoundingClientRect().bottom<=detailPanel?.getBoundingClientRect().top,
  map:box(document.querySelector('[aria-label="고객 선별 행정동 경계 및 무선 위치근거 지도"]')),
  compactMix:!!document.querySelector('[class*="customerProgress"]')&&!!document.querySelector('[class*="customerSegmentCards"]'),
  segmentCards:document.querySelector('[class*="customerSegmentCards"]')?.children.length??0,
  oldDonut:!!document.querySelector('[class*="donutCenter"]'),
  groupHeight:box(top?.children[0])?.height,
  mixSummary:top?.children[0]?.textContent?.trim().slice(0,180),
  mapPolygonCount:document.querySelectorAll('.leaflet-overlay-pane path.leaflet-interactive').length,
  mapColors:new Set([...document.querySelectorAll('.leaflet-overlay-pane path.leaflet-interactive')].map(x=>x.getAttribute('fill'))).size,
  loaded:texts.includes('46,640')&&texts.includes('TOP 10'),
  hasScrollbar:document.documentElement.scrollHeight>innerHeight+2,
 };
}
(async()=>{
 assert(fs.existsSync(chrome));
 proc=spawn(chrome,['--headless=new','--window-size=1600,900','--disable-gpu','--disable-extensions','--no-first-run','--no-default-browser-check',
  '--remote-debugging-port=0','--user-data-dir='+profile,origin+'/qoe/customer-screening'],{stdio:'ignore',windowsHide:true});
 const port=await until(()=>{const file=path.join(profile,'DevToolsActivePort');return fs.existsSync(file)?Number(fs.readFileSync(file,'utf8').split(/\r?\n/)[0]):null},'debug port');
 const target=await until(async()=>{
  const list=await(await fetch('http://127.0.0.1:'+port+'/json')).json();
  return list.find(item=>item.type==='page'&&item.url.includes('customer-screening'));
 },'target');
 ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 ws.addEventListener('message',event=>{const data=JSON.parse(event.data.toString()),p=pending.get(data.id);
  if(p){pending.delete(data.id);clearTimeout(p.timeout);data.error?p.reject(Error(JSON.stringify(data.error))):p.resolve(data.result)}
 });
 await cdp('Runtime.enable');await cdp('Page.enable');
 const result=await until(async()=>{const x=await js('('+layout.toString()+')()');return x.loaded&&x.table.rows===10&&x.map?.height>0&&x.mapPolygonCount>=39&&x.mapColors>=3?x:null;},'loaded layout',45000);
 console.log('LAYOUT',JSON.stringify(result));
 const geoDebug=await js('(function(){const ps=[...document.querySelectorAll(".leaflet-overlay-pane path.leaflet-interactive")];return JSON.stringify({count:ps.length,visible:ps.filter(x=>{const r=x.getBoundingClientRect();return r.width>12&&r.height>12}).length,first:ps.slice(0,10).map(x=>({fill:x.getAttribute("fill"),fillOpacity:x.getAttribute("fill-opacity"),stroke:x.getAttribute("stroke"),box:{w:Math.round(x.getBoundingClientRect().width),h:Math.round(x.getBoundingClientRect().height)}})),counts:[...new Set(ps.map(x=>x.getAttribute("fill")))],mapZoom:document.querySelector(".leaflet-container")?.getAttribute("class")})})()');
 console.log('GEO_DIAG',geoDebug);
 await delay(2600); // allow VWorld background tiles to settle before visual evidence
 const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 const file='outputs/customer-screening-layout-1600x900.png';
 fs.mkdirSync('outputs',{recursive:true});fs.writeFileSync(file,Buffer.from(shot.data,'base64'));console.log('SCREENSHOT',file);
 assert(!result.hasScrollbar,'Document page must fit in 1 viewport');
 assert(result.sections.length===6,'Upper three + map + comparison + detail panels must remain visible');
 assert.equal(result.kpiCards,4,'Top summary must have four cards');
 assert(result.totalCallColumn,'TOP10 needs total customer calls column');
 assert(!result.hasScatter,'Old scatter chart must be removed');
 assert(result.compactMix,'Compact affected customers proportion and segment cards must be rendered');
 assert.equal(result.segmentCards,4,'Four data-backed customer group cards must be visible');
 assert(!result.oldDonut,'Old donut chart must be removed');
 assert(result.mapLeftOfComparison,'Map must be left of customer comparison');
 assert(result.compareAboveDetail,'Comparison must be above detail');
 assert(result.sections.every(s=>s.top>=0&&s.bottom<=result.height+1&&s.height>60),'Every panel must be inside viewport');
 assert.equal(result.table.visibleRows,10,'TOP10 rows must all be visible');
 assert(result.blocks[3].bottom<=result.height-10,'Map and customer panels must not be cut off');
 assert(result.map.height>=300,'Reclaimed overview height should give at least 300px to the map even at Chrome inner-height 802px');
 assert(result.mapPolygonCount>=39,'Original administrative boundaries must be drawn as polygons');
 console.log('CUSTOMER_SCREENING_LAYOUT_1600x900=PASS');
})().catch(e=>{console.error(e.stack||e);process.exitCode=1}).finally(async()=>{
 try{ws?.close()}catch{}
 if(proc?.pid)try{execFileSync('taskkill.exe',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore',timeout:14000})}catch{}
 await delay(300);try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:6,retryDelay:300})}catch{}
});
