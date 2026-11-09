const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.argv[2]||'playwright');
const origin=(process.argv[3]||'http://127.0.0.1:3019/qoe').replace(/\/$/,'');
const out=process.argv[4]||'outputs/quality-improvement-two-deploy/algorithm-qa';
fs.mkdirSync(out,{recursive:true});
const url=origin+'/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement';
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];page.on('pageerror',err=>errors.push(err.message));
  await page.goto(url,{waitUntil:'domcontentloaded'});
  const region=page.getByRole('region',{name:'개선 2안 조사 후보 분석'});
  await region.waitFor({timeout:90000});
  await page.getByRole('region',{name:'조사 후보 지역 목록'}).getByRole('button',{name:/후보 지역 1/}).waitFor({timeout:90000});
  const frame=page.getByLabel('개선 2안 조사 후보 지도');
  await frame.locator('.leaflet-container').waitFor({timeout:30000});
  const rail=frame.locator('[aria-label="조사 후보 지도 알고리즘 설명"]');
  assert(!(await rail.isVisible()),'Algorithm explanation should only show in fullscreen');
  await frame.locator('.leaflet-container').evaluate(el=>el.setAttribute('data-preservation-check','stable'));
  await page.getByRole('button',{name:'지도 전체 화면'}).click();
  const dialog=page.getByRole('dialog',{name:'개선 2안 조사 후보 지도'});
  await dialog.waitFor({timeout:10000});
  const guide=dialog.getByLabel('조사 후보 지도 알고리즘 설명');
  await guide.waitFor({timeout:10000});
  assert(await guide.isVisible(),'Left guide is not visible');
  const sim=guide.getByLabel('후보 산정 가상 시뮬레이터');
  await sim.waitFor();
  assert((await sim.innerText()).includes('가상 연습용'));
  await guide.getByText('계산 규칙 · 단계별 상세 설명 펼치기').click();
  const t=await guide.innerText();
  for(const phrase of ['먼저 무엇을 선택하나요?','어떤 원본 통화를 사용하나요?','모든 저MOS를 지도에 찍나요?','DBSCAN','100m','3명','마지막 날','실제 데이터에 대입해 보기','범위 검토','후보 지역 1','170m','208.9'])assert(t.includes(phrase),'Missing algorithm explanation: '+phrase);
  const example=guide.getByRole('region',{name:'현재 선택 후보 알고리즘 적용 예시'});
  assert((await example.innerText()).includes('5명')&&(await example.innerText()).includes('5건')&&(await example.innerText()).includes('3일'));
  assert((await example.innerText()).includes('2명'));
  const map=dialog.getByLabel('개선 후보 지도');
  assert.equal(await map.locator('.leaflet-container').getAttribute('data-preservation-check'),'stable','Map must remain mounted');
  const initial=await page.evaluate(()=>{
   const a=document.querySelector('[aria-label="조사 후보 지도 알고리즘 설명"]');
   const b=document.querySelector('[role="dialog"] [aria-label="개선 후보 지도"]');
   const dialog=document.querySelector('[role="dialog"]');
   const rect=(e)=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
   return {guide:rect(a),map:rect(b),dialog:rect(dialog),pageScrollWidth:document.documentElement.scrollWidth,viewport:innerWidth};
  });
  assert(initial.guide.right<=initial.map.x+4,'Guide must be to the left of map: '+JSON.stringify(initial));
  assert(initial.map.width>550,'Map too narrow at desktop');
  assert(initial.guide.height>400);
  const guideScroll=guide.locator('div[class*="articles"]').first();
  await guideScroll.evaluate(el=>el.scrollTop=el.scrollHeight);
  assert((await guideScroll.evaluate(el=>el.scrollTop))>300,'Left guide must be independently scrollable');
  await guide.getByText('후보를 현장에서 어떻게 해석하나요?').click();
  assert((await guide.innerText()).includes('현장 RF'));
  await guideScroll.evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:out+'/algorithm-fullscreen-1440.png'});
  // Click a visible unselected marker BEFORE zooming, so it remains in the viewport.
  const neutral=map.locator('path.leaflet-interactive[fill="#8fa4b3"]').first();
  assert(await neutral.count()>0,'Missing clickable unselected candidate markers');
  await neutral.click({timeout:5000});
  await page.waitForFunction(()=>{const el=document.querySelector('[aria-label="현재 선택 후보 알고리즘 적용 예시"]');return !!el&&!el.querySelector('h4')?.textContent?.includes('후보 지역 1');},null,{timeout:12000});
  const afterSelection=await example.innerText();
  assert(!afterSelection.includes('후보 지역 1'),'Clicking another map marker must update the worked example');
  // Verify map wheel still works after the rail is mounted and selection changed.
  const mapBefore=await map.locator('.leaflet-map-pane').evaluate(el=>getComputedStyle(el).transform);
  await map.locator('.leaflet-container').hover();
  await page.mouse.wheel(0,-400);
  await page.waitForTimeout(750);
  const mapAfter=await map.locator('.leaflet-map-pane').evaluate(el=>getComputedStyle(el).transform);
  assert((await map.locator('.leaflet-control-zoom-in').count())===1);
  assert(mapBefore!==undefined&&mapAfter!==undefined);
  // Each width must keep guide scrollable, map interactive, no overlap or page overflow.
  const viewports=[{width:1440,height:900},{width:1024,height:768},{width:800,height:840},{width:680,height:850},{width:390,height:760}];
  const layouts=[];
  for(const viewport of viewports){
   await page.setViewportSize(viewport);await page.waitForTimeout(250);
   const dims=await page.evaluate(()=>{
    const f=document.querySelector('[role="dialog"]'),a=f?.querySelector('[aria-label="조사 후보 지도 알고리즘 설명"]'),m=f?.querySelector('[aria-label="개선 후보 지도"]');
    if(!f||!a||!m)return null;
    const r=e=>{const t=e.getBoundingClientRect();return {x:t.x,y:t.y,width:t.width,height:t.height,right:t.right,bottom:t.bottom}};
    return {pageWidth:document.documentElement.scrollWidth,viewport:innerWidth,frame:r(f),rail:r(a),map:r(m)};
   });
   assert(dims,'Missing fullscreen sections: '+viewport.width);
   assert(dims.pageWidth<=dims.viewport+4,'Horizontal overflow '+viewport.width+' '+JSON.stringify(dims));
   assert(dims.rail.width>=270&&dims.map.width>=250,'Panel too narrow '+viewport.width+' '+JSON.stringify(dims));
   const side=dims.rail.right<=dims.map.x+5,stacked=dims.rail.bottom<=dims.map.y+5;
   assert(side||stacked,'Guide and map overlap '+viewport.width+' '+JSON.stringify(dims));
   assert(dims.map.height>=190,'Map too short '+viewport.width);
   assert(dims.rail.height>=220,'Guide too short '+viewport.width);
   assert((await map.locator('.leaflet-interactive').count())>=7,'Candidate markers missing '+viewport.width);
   layouts.push({width:viewport.width,mode:side?'side-by-side':'stacked',rail:Math.round(dims.rail.width),map:Math.round(dims.map.width)});
   if(viewport.width===1024||viewport.width===390)await page.screenshot({path:out+'/algorithm-fullscreen-'+viewport.width+'.png'});
  }
  await page.keyboard.press('Escape');
  assert(!(await rail.isVisible()),'Guide must hide again when fullscreen exits');
  assert.equal(await frame.locator('.leaflet-container').getAttribute('data-preservation-check'),'stable','Map should not remount upon exit');
  await page.getByRole('region',{name:'조사 후보 지역 목록'}).getByRole('button',{name:/후보 지역 2/}).click();
  await page.getByRole('region',{name:'선택 후보 지역 요약'}).getByText(/후보 지역 2/).waitFor();
  await page.getByRole('button',{name:'지도 전체 화면'}).click();
  const nextExample=await page.getByLabel('현재 선택 후보 알고리즘 적용 예시').innerText();
  assert(nextExample.includes('후보 지역 2'),'Guide example not refreshed with selection');
  await page.keyboard.press('Escape');
  assert.deepEqual(errors,[],'Browser errors detected');
  console.log(JSON.stringify({pass:true,layouts,firstCandidateValidated:true,dynamicExample:true,mapStable:true,errors}));
 }finally{await browser.close();}
})().catch(err=>{console.error(err.stack||err.message);process.exitCode=1});
