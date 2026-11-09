const {chromium}=require(process.argv[2]||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const base=(process.argv[3]||'http://127.0.0.1:3019/qoe').replace(/\/$/,'');
const out=process.argv[4]||'outputs/quality-improvement-two-deploy/candidate-rail-qa';
fs.mkdirSync(out,{recursive:true});
const url=base+'/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement';
const rect=el=>{const b=el.getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height}};
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const p=await browser.newPage({viewport:{width:1600,height:960}});
  const errors=[],tiles=[];
  p.on('pageerror',e=>errors.push(e.message));
  p.on('response',r=>{try{if(new URL(r.url()).hostname==='api.vworld.kr')tiles.push(r.status())}catch{}});
  await p.goto(url,{waitUntil:'domcontentloaded'});
  const model=p.getByRole('combobox',{name:'조사 후보 알고리즘'});
  await model.waitFor({timeout:90000});
  assert.equal(await model.locator('option').count(),6);
  const reports=[];
  for(const id of ['dbscan','hdbscan','st_dbscan','adaptive_kde','spatial_scan','bayesian']){
   await model.selectOption(id);
   const isDb=id==='dbscan';
   const mapFrame=p.getByLabel(isDb?'개선 2안 조사 후보 지도':'대안 모델 조사 후보 지도');
   await mapFrame.getByRole('button',{name:'지도 전체 화면'}).waitFor({timeout:45000});
   await mapFrame.getByRole('button',{name:'지도 전체 화면'}).click();
   const dialog=p.locator('section[role="dialog"][aria-label="'+(isDb?'개선 2안 조사 후보 지도':'대안 모델 조사 후보 지도')+'"]');
   await dialog.waitFor({timeout:18000});
   const rail=dialog.getByLabel('전체화면 조사 후보 탐색');
   await rail.waitFor({timeout:18000});
   assert.equal(await dialog.getByRole('tab',{name:'알고리즘 설명'}).count(),0,'Old algorithm panel must be gone');
   const rows=rail.locator('button[data-candidate-id]');
   const n=await rows.count();
   assert(n>0,id+' should produce source-backed candidate rows');
   const countLabel=await rail.getByLabel('전체화면 조사 후보 지역 목록').locator('h3').innerText();
   assert(countLabel.includes(String(n)),id+' candidate count mismatch: '+countLabel+' vs '+n);
   const details=rail.getByLabel('전체화면 선택 후보 상세');
   await details.waitFor();
   const firstId=await rows.first().getAttribute('data-candidate-id');
   const lastId=await rows.last().getAttribute('data-candidate-id');
   assert.equal(await rows.first().getAttribute('aria-pressed'),'true');
   const map=dialog.getByLabel('개선 후보 지도');
   await map.locator('.leaflet-container').waitFor();
   await map.locator('path[data-candidate-id]').first().waitFor({timeout:18000});
   assert((await map.locator('path[data-candidate-id]').count())>=n,'Candidate map marker count does not match shortlist');
   const nSelect=Math.min(n-1,3);
   const nth=rows.nth(nSelect);
   const chosenId=await nth.getAttribute('data-candidate-id');
   const before=await map.locator('.leaflet-map-pane').evaluate(x=>x.style.transform);
   await nth.click();
   assert.equal(await rail.locator('button[data-candidate-id="'+chosenId+'"]').getAttribute('aria-pressed'),'true','List click failed to select');
   await p.waitForTimeout(500);
   assert((await details.innerText()).includes('후보 지역 '+(nSelect+1)),'Detail not synchronized after list selection');
   const mapMarker=map.locator('path[data-candidate-id="'+firstId+'"]');
   assert.equal(await mapMarker.count(),1);
   await mapMarker.dispatchEvent('click');
   await p.waitForTimeout(450);
   assert.equal(await rail.locator('button[data-candidate-id="'+firstId+'"]').getAttribute('aria-pressed'),'true','Map click did not select list row');
   assert((await details.innerText()).includes('후보 지역 1'));
   // Force selection of the last real map marker, including cases where it
   // initially lies outside the current viewport.
   await map.locator('path[data-candidate-id="'+lastId+'"]').dispatchEvent('click');
   await p.waitForTimeout(500);
   const activeRow=rail.locator('button[data-candidate-id="'+lastId+'"]');
   assert.equal(await activeRow.getAttribute('aria-pressed'),'true','Map last-marker selection lost');
   const inView=await rail.evaluate(el=>{
    const list=el.querySelector('[aria-label="후보 선택 목록"]');
    const row=list?.querySelector('button[aria-pressed="true"]');
    if(!list||!row)return null;
    const a=list.getBoundingClientRect(),b=row.getBoundingClientRect();
    return {visible:b.top>=a.top-4&&b.bottom<=a.bottom+4,scrollTop:list.scrollTop,scrollHeight:list.scrollHeight,listHeight:list.clientHeight};
   });
   assert(inView?.visible,'Selected map candidate not visible in the left list '+JSON.stringify(inView));
   const reviewButton=rail.getByRole('button',{name:/범위 검토 \d+/});
   const reviewCount=parseInt((await reviewButton.innerText()).match(/\d+/)?.[0]??'0',10);
   await reviewButton.click();
   const shown=await rows.count();
   assert.equal(shown,reviewCount,'Range-review filter count differs from real records');
   if(reviewCount>0){
    await rows.first().click();
    assert((await details.innerText()).includes('범위 검토 필요'),'Review reason must be visible');
    assert((await details.innerText()).includes('최대 거리'),'Actual max pair distance missing');
   }
   await rail.getByRole('button',{name:/전체 \d+/}).click();
   assert.equal(await rows.count(),n);
   await rail.getByRole('button',{name:'선택 후보 고객·통화 보기'}).click();
   assert(!(await dialog.isVisible()),'Call evidence CTA should close fullscreen map');
   const selectedTab=p.getByRole('tab',{name:'고객·통화'});
   // In the normal view the complete original call table remains available.
   await selectedTab.waitFor({timeout:15000});
   assert.equal(await selectedTab.getAttribute('aria-selected'),'true');
   reports.push({model:id,candidates:n,reviewCount,selectedRowVisible:inView.visible,mapMoved:before!==(await map.locator('.leaflet-map-pane').evaluate(x=>x.style.transform).catch(()=>''))});
   if(id==='dbscan'){
    await mapFrame.getByRole('button',{name:'지도 전체 화면'}).click();
    const db=p.locator('section[role="dialog"][aria-label="개선 2안 조사 후보 지도"]');
    const shortcut=db.getByRole('button',{name:'알고리즘 설명·시뮬레이션'});
    await shortcut.click();
    const popup=p.getByRole('dialog',{name:'DBSCAN · 후보 산정 시뮬레이터'});
    await popup.waitFor();
    await popup.getByRole('button',{name:'알고리즘 설명'}).click();
    await popup.getByLabel('조사 후보 지도 알고리즘 설명').waitFor();
    await popup.getByRole('button',{name:'선정 기준'}).click();
    await popup.getByLabel('조사 후보 지도 알고리즘 설명').waitFor();
    await popup.getByRole('button',{name:'시뮬레이터',exact:true}).click();
    await popup.getByLabel('후보 산정 가상 시뮬레이터').waitFor();
    await p.screenshot({path:out+'/dbscan-rail-popup-1600.png',fullPage:false});
    await p.keyboard.press('Escape');
    assert(await db.isVisible());
    await p.screenshot({path:out+'/dbscan-list-1600.png',fullPage:false});
    await p.keyboard.press('Escape');
   }
  }
  await model.selectOption('hdbscan');
  const entry=p.getByLabel('대안 모델 조사 후보 지도');
  await entry.getByRole('button',{name:'지도 전체 화면'}).click();
  const alt=p.locator('section[role="dialog"][aria-label="대안 모델 조사 후보 지도"]');
  await alt.getByRole('button',{name:'알고리즘 설명·시뮬레이션'}).click();
  const popup=p.getByRole('dialog',{name:/HDBSCAN.*후보 산정 시뮬레이터/});
  await popup.getByRole('button',{name:'알고리즘 설명'}).click();
  assert((await popup.innerText()).includes('HDBSCAN'));
  await popup.getByRole('button',{name:'선정 기준'}).click();
  assert((await popup.innerText()).includes('하이퍼파라미터'));
  await p.keyboard.press('Escape');
  assert(await alt.isVisible());
  for(const width of [1440,1024,800,680,390]){
   await p.setViewportSize({width,height:850});await p.waitForTimeout(350);
   const geom=await alt.evaluate(el=>{
    const rail=el.querySelector('[aria-label="전체화면 조사 후보 탐색"]');
    const left=el.querySelector('[aria-label="전체화면 왼쪽 지도 해석 및 모델 시뮬레이션"]');
    const map=el.querySelector('[aria-label="개선 후보 지도"]');
    if(!rail||!left||!map)return null;
    const r=e=>{const q=e.getBoundingClientRect();return {x:q.x,y:q.y,right:q.right,bottom:q.bottom,width:q.width,height:q.height};};
    const a=r(left),b=r(map),c=r(rail);
    return {left:a,map:b,rail:c,scroll:document.documentElement.scrollWidth,view:document.documentElement.clientWidth};
   });
   assert(geom,'Layout missing at '+width);
   assert(geom.scroll<=geom.view+4,'Horizontal scroll at '+width);
   assert(geom.rail.height>=125,'Rail clipped at '+width);
   assert(geom.map.height>=150,'Map clipped at '+width);
   assert(geom.left.right<=geom.map.x+5||geom.left.bottom<=geom.map.y+5,'Map/rail overlap at '+width);
   if(width===390)await p.screenshot({path:out+'/hdbscan-list-390.png',fullPage:false});
  }
  await p.keyboard.press('Escape');
  assert.deepEqual(errors,[]);
  assert(tiles.some(x=>x===200),'VWorld tiles missing');
  console.log(JSON.stringify({pass:true,models:reports,errors,tileCount:tiles.length}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
