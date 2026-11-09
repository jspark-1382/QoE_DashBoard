const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.argv[2]||'playwright');
const root=(process.argv[3]||'http://127.0.0.1:3019/qoe').replace(/\/$/,'');
const output=process.argv[4]||'outputs/quality-improvement-two-deploy/map-rail-qa';
fs.mkdirSync(output,{recursive:true});
const url=root+'/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement';
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const p=await browser.newPage({viewport:{width:1440,height:970}});
  const errors=[],tileStatuses=[];
  p.on('pageerror',e=>errors.push(e.message));
  p.on('response',r=>{try{if(new URL(r.url()).hostname==='api.vworld.kr')tileStatuses.push(r.status());}catch{}});
  await p.goto(url,{waitUntil:'domcontentloaded'});
  const model=p.getByRole('combobox',{name:'조사 후보 알고리즘'});
  await model.waitFor({timeout:90000});
  const standard=p.getByLabel('개선 2안 조사 후보 지도');
  await standard.getByRole('button',{name:'지도 전체 화면'}).waitFor();
  const normalLegend=standard.getByLabel('지도 위치 범례');
  assert(await normalLegend.isVisible(),'Normal mode should retain map legend');
  assert(!(await standard.getByLabel('전체화면 선택 후보 요약').isVisible()),'Fullscreen summary must be hidden in normal view');
  await standard.getByRole('button',{name:'지도 전체 화면'}).click();
  const dialog=p.getByRole('dialog',{name:'개선 2안 조사 후보 지도'});
  await dialog.waitFor();
  const left=dialog.getByLabel('전체화면 왼쪽 지도 해석 및 알고리즘 설명');
  await left.waitFor();
  const selected=left.getByLabel('전체화면 선택 후보 요약');
  assert((await selected.innerText()).includes('후보 지역 1'));
  for(const t of ['저MOS 고객','저MOS 통화','관측 날짜','표시 반경'])assert((await selected.innerText()).includes(t),t);
  assert(await left.getByLabel('지도 위치 범례').isVisible(),'Legend must move to left rail');
  assert.equal(await dialog.getByLabel('지도 위치 범례').count(),1,'Legend must not be duplicated on the map');
  const tabs=left.getByRole('tablist',{name:'전체화면 알고리즘 정보'});
  assert.equal(await tabs.getByRole('tab').count(),2);
  assert.equal(await tabs.getByRole('tab',{name:'알고리즘 설명'}).getAttribute('aria-selected'),'true');
  let dimensions=await dialog.evaluate(d=>{
    const rail=d.querySelector('[aria-label="전체화면 왼쪽 지도 해석 및 알고리즘 설명"]');
    const map=d.querySelector('[aria-label="개선 후보 지도"]');
    const content=rail?.querySelector('[class*="railContent"]');
    const head=d.querySelector('[class*="mapHeading"]');
    if(!rail||!map||!content||!head)return null;
    const r=e=>{let b=e.getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height}};
    return {rail:r(rail),map:r(map),content:r(content),heading:r(head)};
  });
  assert(dimensions, 'Must retain visible full rail and map');
  assert(dimensions.rail.right+5<dimensions.map.x && dimensions.map.width>400,'Desktop map must be right side of rail '+JSON.stringify(dimensions));
  assert(dimensions.content.height>180,'Rail explanatory content clipped '+JSON.stringify(dimensions));
  const actualMap=dialog.getByLabel('개선 후보 지도');
  await actualMap.locator('.leaflet-container').waitFor();
  await p.waitForTimeout(2200);
  const loaded=await actualMap.locator('img.leaflet-tile').evaluateAll(a=>a.filter(x=>x.complete&&x.naturalWidth>0).length);
  assert(loaded>0,'VWorld tile background missing');
  await p.screenshot({path:output+'/dbscan-fullscreen-1440.png'});
  // Select a different real candidate using the map, not a fake simulator point.
  const marker=actualMap.locator('path.leaflet-interactive[fill="#8fa4b3"]');
  if(await marker.count()){
   await marker.first().click({timeout:5000});
   await p.waitForTimeout(400);
   assert((await selected.innerText()).includes('후보 지역 2') || (await selected.innerText()).includes('후보 지역 3'),'Selection summary should follow map marker');
  }
  await left.getByRole('button',{name:'시뮬레이터 열기'}).click();
  const dbPopup=p.getByRole('dialog',{name:'DBSCAN · 후보 산정 시뮬레이터'});
  await dbPopup.getByLabel('후보 산정 가상 시뮬레이터').waitFor({timeout:15000});
  await dbPopup.getByRole('button',{name:'시뮬레이터 팝업 닫기'}).click();
  await tabs.getByRole('tab',{name:'선정 기준'}).click();
  const criteria=left.getByText('계산 규칙 · 단계별 상세 설명 펼치기');
  await criteria.click();
  assert((await left.innerText()).includes('Haversine'));
  await tabs.getByRole('tab',{name:'알고리즘 설명'}).click();
  assert((await left.getByLabel('DBSCAN 기반 후보 선정 로직').innerText()).includes('100m'));
  // The map must stay mounted through all rail tabs.
  assert(await actualMap.locator('.leaflet-container').isVisible());
  await tabs.getByRole('tab',{name:'알고리즘 설명'}).click();
  // Zoom controls remain functional.
  const before=await actualMap.locator('img.leaflet-tile').first().getAttribute('src');
  await actualMap.locator('.leaflet-control-zoom-in').click();
  await p.waitForTimeout(1200);
  const after=await actualMap.locator('img.leaflet-tile').first().getAttribute('src');
  assert(before!==after,'Zoom-in should change VWorld tile request');
  await p.keyboard.press('Escape');
  assert(!(await dialog.isVisible()));
  // Select another algorithm: same fullscreen rail and simulation controls.
  await model.selectOption('hdbscan');
  const alt=p.getByRole('region',{name:'선택 모델 HDBSCAN 조사 후보'});
  await alt.waitFor({timeout:25000});
  await alt.getByRole('button',{name:'지도 전체 화면'}).click();
  const modal=p.getByRole('dialog',{name:'대안 모델 조사 후보 지도'});
  await modal.waitFor();
  const altRail=modal.getByLabel('전체화면 왼쪽 지도 해석 및 모델 시뮬레이션');
  await altRail.waitFor();
  assert((await altRail.getByLabel('전체화면 선택 후보 요약').innerText()).includes('후보 지역 1'));
  assert((await altRail.getByLabel('대안 모델 지도 범례').innerText()).includes('GNSS 관측'));
  const altTabs=altRail.getByRole('tablist',{name:'전체화면 알고리즘 정보'});
  await altRail.getByRole('button',{name:'시뮬레이터 열기'}).click();
  const hdPopup=p.getByRole('dialog',{name:'HDBSCAN · 후보 산정 시뮬레이터'});
  await hdPopup.getByLabel('hdbscan 상세 가상 시뮬레이터').waitFor({timeout:18000});
  await hdPopup.getByRole('button',{name:'시뮬레이터 팝업 닫기'}).click();
  await altTabs.getByRole('tab',{name:'선정 기준'}).click();
  assert((await altRail.innerText()).includes('minClusterSize')||(await altRail.innerText()).includes('min_cluster_size'));
  await altTabs.getByRole('tab',{name:'알고리즘 설명'}).click();
  assert((await altRail.getByLabel('선택 알고리즘의 핵심 선정 로직').innerText()).includes('HDBSCAN'));
  await altTabs.getByRole('tab',{name:'알고리즘 설명'}).click();
  await p.screenshot({path:output+'/hdbscan-fullscreen-1440.png'});
  const widths=[];
  for(const width of [1024,800,680,390]){
   await p.setViewportSize({width,height:850});await p.waitForTimeout(400);
   const dims=await modal.evaluate(d=>{
    const rail=d.querySelector('[aria-label="전체화면 왼쪽 지도 해석 및 모델 시뮬레이션"]');
    const map=d.querySelector('[aria-label="개선 후보 지도"]');
    const content=rail?.querySelector('[class*="railContent"]');
    if(!rail||!map||!content)return null;
    const rect=e=>{let a=e.getBoundingClientRect();return {x:a.x,y:a.y,right:a.right,bottom:a.bottom,width:a.width,height:a.height}};
    return {rail:rect(rail),map:rect(map),content:rect(content),scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth};
   });
   assert(dims,'Fullscreen missing sections at '+width);
   assert(dims.scroll<=dims.client+4,'Page overflow '+width);
   assert(dims.content.height>70 && dims.map.height>=160,'Clipped mobile panel/map '+width+': '+JSON.stringify(dims));
   assert(dims.rail.right+4<=dims.map.x||dims.rail.bottom+4<=dims.map.y,'Overlap rail and map '+width+': '+JSON.stringify(dims));
   widths.push({width,contentHeight:Math.round(dims.content.height),mapHeight:Math.round(dims.map.height)});
   if(width===390)await p.screenshot({path:output+'/hdbscan-fullscreen-390.png'});
  }
  await p.keyboard.press('Escape'); assert(!(await modal.isVisible()));
  assert.deepEqual(errors,[]);
  assert(tileStatuses.some(v=>v===200),'No successful VWorld tiles');
  console.log(JSON.stringify({pass:true,dbscanLeftSummary:true,altLeftSummary:true,mapTilesLoaded:loaded,zoomTest:true,tabCount:4,widths,pageErrors:errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
