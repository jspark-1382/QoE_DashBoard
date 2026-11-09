const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.argv[2]||'playwright');
const root=(process.argv[3]||'http://127.0.0.1:3019/qoe').replace(/\/$/,'');
const output=process.argv[4]||'outputs/quality-improvement-two-deploy/simulator-popup-qa';
fs.mkdirSync(output,{recursive:true});
const url=root+'/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement';
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:980}});
  const errors=[],tileStatuses=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',r=>{try{if(new URL(r.url()).hostname==='api.vworld.kr')tileStatuses.push(r.status());}catch{}});
  await page.goto(url,{waitUntil:'domcontentloaded'});
  const model=page.getByRole('combobox',{name:'조사 후보 알고리즘'});
  await model.waitFor({timeout:90000});
  assert.equal(await model.locator('option').count(),6);
  const frame=page.getByLabel('개선 2안 조사 후보 지도');
  await frame.getByRole('button',{name:'지도 전체 화면'}).click();
  const full=page.locator('section[role="dialog"][aria-label="개선 2안 조사 후보 지도"]');
  await full.waitFor();
  const rail=full.getByLabel('전체화면 왼쪽 지도 해석 및 알고리즘 설명');
  assert(await full.getByLabel('전체화면 조사 후보 탐색').isVisible(),'Candidate shortlist replaces old inline explanation');
  assert.equal(await rail.getByLabel('후보 산정 가상 시뮬레이터').count(),0,'Simulator must not be embedded in left rail');
  const candidateBefore=await rail.getByLabel('전체화면 선택 후보 상세').innerText();
  const map=full.getByLabel('개선 후보 지도');
  await map.locator('.leaflet-container').waitFor();
  await page.waitForTimeout(1400);
  const beforeZoom=await map.locator('.leaflet-container').evaluate(el=>(el).getAttribute('class'));
  const cta=full.getByRole('button',{name:'알고리즘 설명·시뮬레이션'});
  await cta.click();
  const popup=page.getByRole('dialog',{name:'DBSCAN · 후보 산정 시뮬레이터'});
  await popup.waitFor({timeout:16000});
  await popup.getByLabel('후보 산정 가상 시뮬레이터').waitFor();
  assert.equal(await page.locator('section[role="dialog"][aria-label="개선 2안 조사 후보 지도"]').getAttribute('aria-hidden'),'true','Underlying map must be suspended');
  assert.equal(await popup.getByRole('button',{name:'시뮬레이터 팝업 닫기'}).count(),1);
  const focused=await page.evaluate(()=>document.activeElement?.getAttribute('aria-label'));
  assert.equal(focused,'시뮬레이터 팝업 닫기','Popup should receive keyboard focus');
  assert(!(await page.locator('section[role="dialog"][aria-label="개선 2안 조사 후보 지도"]').getAttribute('aria-expanded')),'should not use inline simulator mode');
  const controls=popup.getByLabel('후보 산정 가상 시뮬레이터');
  assert((await controls.innerText()).includes('STEP 1 / 7'));
  const phases=controls.getByRole('button',{name:/7/});
  // Interact with step navigation inside the real simulator, not an inert mock.
  await controls.getByRole('button',{name:/다음/}).first().click();
  assert((await controls.innerText()).includes('STEP 2 / 7'));
  await page.screenshot({path:output+'/dbscan-popup.png',fullPage:false});
  await page.keyboard.press('Escape');
  await popup.waitFor({state:'detached'});
  const live=page.locator('section[role="dialog"][aria-label="개선 2안 조사 후보 지도"]');
  assert(await live.isVisible(),'Closing simulator must keep fullscreen map');
  assert.equal(await live.getAttribute('aria-hidden'),null,'Map must be unsuspended after popup');
  const candidateAfter=await live.getByLabel('전체화면 선택 후보 상세').innerText();
  assert.equal(candidateAfter,candidateBefore,'Selected candidate must persist after popup');
  assert(await live.getByLabel('개선 후보 지도').locator('.leaflet-container').isVisible());
  // Toolbar trigger opens exactly the same popup.
  await live.getByRole('button',{name:'알고리즘 설명·시뮬레이션'}).click();
  await page.getByRole('dialog',{name:'DBSCAN · 후보 산정 시뮬레이터'}).waitFor();
  await page.getByRole('dialog',{name:'DBSCAN · 후보 산정 시뮬레이터'}).getByRole('button',{name:'시뮬레이터 팝업 닫기'}).click();
  assert(await live.isVisible());
  // ESC now closes only the fullscreen map, after popup already closed.
  await page.keyboard.press('Escape');
  assert(!(await live.isVisible()));
  // Also works from top bar without entering map fullscreen.
  await page.getByRole('button',{name:'알고리즘 설명·시뮬레이션'}).first().click();
  await page.getByRole('dialog',{name:'DBSCAN · 후보 산정 시뮬레이터'}).waitFor();
  await page.keyboard.press('Escape');
  assert(!(await page.getByRole('dialog',{name:'DBSCAN · 후보 산정 시뮬레이터'}).isVisible()));
  // All five alternatives mount their own real simulator, not the DBSCAN component.
  for(const [id,title] of [['hdbscan','HDBSCAN'],['st_dbscan','ST-DBSCAN'],['adaptive_kde','Adaptive KDE'],['spatial_scan','Spatial Scan'],['bayesian','Bayesian']]){
   await model.selectOption(id);
   const alt=page.getByRole('region',{name:new RegExp('선택 모델 '+title+'.* 조사 후보')});
   await alt.waitFor({timeout:45000});
   await alt.getByRole('button',{name:'지도 전체 화면'}).click();
   const f=page.locator('section[role="dialog"][aria-label="대안 모델 조사 후보 지도"]');
   await f.waitFor();
   const side=f.getByLabel('전체화면 왼쪽 지도 해석 및 모델 시뮬레이션');
   assert(await f.getByLabel('전체화면 조사 후보 탐색').isVisible());
   assert.equal(await side.getByLabel(id+' 상세 가상 시뮬레이터').count(),0);
   await f.getByRole('button',{name:'알고리즘 설명·시뮬레이션'}).click();
   const modal=page.getByRole('dialog',{name:new RegExp('^'+title+'.*후보 산정 시뮬레이터$')});
   await modal.waitFor({timeout:25000});
   await modal.getByLabel(id+' 상세 가상 시뮬레이터').waitFor({timeout:25000});
   assert.equal(await f.getAttribute('aria-hidden'),'true');
   await modal.getByRole('button',{name:'시뮬레이터 팝업 닫기'}).click();
   assert(await f.isVisible(),'Alt fullscreen must survive close for '+id);
   await page.keyboard.press('Escape');
   assert(!(await f.isVisible()));
  }
  await model.selectOption('hdbscan');
  await page.setViewportSize({width:390,height:830});
  const alt=page.getByRole('region',{name:'선택 모델 HDBSCAN 조사 후보'});
  await alt.waitFor({timeout:30000});
  await alt.getByRole('button',{name:'지도 전체 화면'}).click();
  const altFrame=page.locator('section[role="dialog"][aria-label="대안 모델 조사 후보 지도"]');
  await altFrame.getByRole('button',{name:'알고리즘 설명·시뮬레이션'}).click();
  const mobilePopup=page.getByRole('dialog',{name:'HDBSCAN · 후보 산정 시뮬레이터'});
  await mobilePopup.waitFor();
  const sizes=await mobilePopup.evaluate(el=>{const r=el.getBoundingClientRect();const content=el.querySelector('[aria-label="시뮬레이터 팝업 내용"]');const c=content.getBoundingClientRect();return {height:r.height,width:r.width,viewWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,contentHeight:c.height,contentScroll:content.scrollHeight};});
  assert(sizes.width<=sizes.viewWidth+2&&sizes.scrollWidth<=sizes.viewWidth+4);
  assert(sizes.contentHeight>=250&&sizes.contentScroll>sizes.contentHeight,'Mobile popup must scroll without clipping');
  await page.screenshot({path:output+'/hdbscan-popup-390.png'});
  await page.keyboard.press('Escape');
  assert(await altFrame.isVisible(),'Esc on mobile must keep fullscreen map');
  assert.deepEqual(errors,[]);
  assert(tileStatuses.some(s=>s===200));
  console.log(JSON.stringify({pass:true,dbscanPopup:true,alternativePopups:5,fullscreenEscapeLayering:true,topShortcut:true,mobilePopup:sizes,pageErrors:errors,mapTileResponses:tileStatuses.length}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});

