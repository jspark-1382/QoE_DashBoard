const {chromium}=require(process.argv[2]||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const out='outputs/quality-improvement-two-deploy/candidate-rail-responsive';
fs.mkdirSync(out,{recursive:true});
(async()=>{
const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1440,height:900}});
 p.setDefaultTimeout(16000);
 const errors=[],tileResponses=[];
 p.on('pageerror',e=>errors.push(e.message));
 p.on('response',r=>{try{if(new URL(r.url()).hostname==='api.vworld.kr')tileResponses.push(r.status());}catch{}});
 await p.goto((process.argv[3]||'http://127.0.0.1:3019/qoe')+'/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement',{waitUntil:'domcontentloaded'});
 const model=p.getByRole('combobox',{name:'조사 후보 알고리즘'});await model.waitFor({timeout:75000});
 const sizes=[];
 for(const id of ['dbscan','hdbscan']){
  await model.selectOption(id);
  const frame=p.getByLabel(id==='dbscan'?'개선 2안 조사 후보 지도':'대안 모델 조사 후보 지도');
  await frame.getByRole('button',{name:'지도 전체 화면'}).waitFor({timeout:35000});
  await frame.getByRole('button',{name:'지도 전체 화면'}).click();
  const dialog=p.locator('section[role="dialog"][aria-label="'+(id==='dbscan'?'개선 2안 조사 후보 지도':'대안 모델 조사 후보 지도')+'"]');
  const rail=dialog.getByLabel('전체화면 조사 후보 탐색');
  await rail.waitFor();
  const rows=rail.locator('button[data-candidate-id]');
  const last=await rows.last().getAttribute('data-candidate-id');
  await dialog.getByLabel('개선 후보 지도').locator('path[data-candidate-id="'+last+'"]').dispatchEvent('click');
  await p.waitForTimeout(200);
  const sc=await rail.evaluate(el=>{
   const list=el.querySelector('[aria-label="후보 선택 목록"]'),row=list.querySelector('button[aria-pressed="true"]');
   const a=list.getBoundingClientRect(),b=row.getBoundingClientRect();
   return {top:list.scrollTop,content:list.scrollHeight,available:list.clientHeight,visible:b.top>=a.top-4&&b.bottom<=a.bottom+4};
  });
  assert(sc.visible,'Selected candidate row did not auto-scroll: '+JSON.stringify({id,sc}));
  // List can select a new candidate after marker click.
  await rows.nth(2).click();
  const map=dialog.getByLabel('개선 후보 지도');
  await map.locator('.leaflet-container').waitFor();
  for(const width of [1440,1024,800,680,390]){
   await p.setViewportSize({width,height:850});
   await p.waitForTimeout(250);
   const geometry=await dialog.evaluate(el=>{
    const rail=el.querySelector('[aria-label="전체화면 조사 후보 탐색"]');
    const sidebar=rail.parentElement;
    const map=el.querySelector('[aria-label="개선 후보 지도"]');
    const content=rail.querySelector('[aria-label="후보 선택 목록"]');
    const detail=rail.querySelector('[aria-label="전체화면 선택 후보 상세"]');
    const r=e=>{let b=e.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height}};
    return {sidebar:r(sidebar),map:r(map),rail:r(rail),list:r(content),detail:r(detail),scroll:document.documentElement.scrollWidth,view:document.documentElement.clientWidth};
   });
   assert(geometry.scroll<=geometry.view+4,'Horizontal overflow '+id+'/'+width);
   assert(geometry.map.height>=150&&geometry.rail.height>155,'Map or list clipped '+id+'/'+width);
   assert(geometry.sidebar.right<=geometry.map.left+5||geometry.sidebar.bottom<=geometry.map.top+5,'Rail overlaps map '+id+'/'+width);
   assert(geometry.list.height>=32&&geometry.detail.height>=45,'Candidate evidence clipped '+id+'/'+width);
   if(width===1440||width===390)await p.screenshot({path:out+'/'+id+'-'+width+'.png'});
   sizes.push({id,width,listHeight:Math.round(geometry.list.height),detailHeight:Math.round(geometry.detail.height),mapHeight:Math.round(geometry.map.height)});
  }
  await p.keyboard.press('Escape');
 }
 assert(tileResponses.some(x=>x===200),'No successful map tiles');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({pass:true,sizes,tiles:tileResponses.length,errors}));
}finally{await browser.close()}})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});

