const {chromium}=require(process.argv[2]||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base=(process.argv[3]||'http://127.0.0.1:3019/qoe').replace(/\/$/,'');
const out=process.argv[4]||'outputs/quality-improvement-two-deploy/title-inline-verified';
fs.mkdirSync(out,{recursive:true});
const url=base+'/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement';
const rect=async el=>el.evaluate(e=>{const q=e.getBoundingClientRect();return {x:q.x,y:q.y,right:q.right,bottom:q.bottom,width:q.width,height:q.height};});
function verticallyOverlaps(a,b){return a.bottom>b.y && b.bottom>a.y;}
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const p=await browser.newPage({viewport:{width:1600,height:940}});
  const errors=[],tileResponses=[];
  p.on('pageerror',e=>errors.push(e.message));
  p.on('response',r=>{try{if(new URL(r.url()).hostname==='api.vworld.kr')tileResponses.push(r.status());}catch{}});
  await p.goto(url,{waitUntil:'domcontentloaded'});
  const select=p.getByRole('combobox',{name:'조사 후보 알고리즘'});
  await select.waitFor({timeout:90000});
  assert.equal(await select.locator('option').count(),6);
  const measurements=[];
  for(const algorithm of ['dbscan','hdbscan']){
   await select.selectOption(algorithm);
   for(const width of [1600,1369,1100,800,390]){
    await p.setViewportSize({width,height:920});
    const frame=p.getByLabel(algorithm==='dbscan'?'개선 2안 조사 후보 지도':'대안 모델 조사 후보 지도');
    await frame.getByRole('button',{name:'지도 전체 화면'}).waitFor({timeout:35000});
    const heading=frame.locator('[class*="mapTitleBlock"]');
    const control=frame.getByLabel('개선 2안 분석 설정');
    assert(await control.isVisible());
    assert.equal(await frame.getByLabel('개선 2안 분석 설정').count(),1,'Duplicate map controls');
    const a=await rect(heading),b=await rect(control);
    if(width>=800)assert(verticallyOverlaps(a,b),algorithm+' normal controls not beside map title at '+width+': '+JSON.stringify({a,b}));
    assert(b.x>=a.x,'Normal controls rendered before the title');
    const frameBox=await rect(frame);
    assert(b.right<=frameBox.right+2,'Normal controls overflow frame at '+width);
    if(algorithm==='dbscan'&&width===1369)await p.screenshot({path:out+'/normal-1369.png',fullPage:false});
    await frame.getByRole('button',{name:'지도 전체 화면'}).click();
    const dialog=p.locator('section[role="dialog"][aria-label="'+(algorithm==='dbscan'?'개선 2안 조사 후보 지도':'대안 모델 조사 후보 지도')+'"]');
    await dialog.waitFor({timeout:16000});
    const rail=dialog.getByLabel(algorithm==='dbscan'?'전체화면 왼쪽 지도 해석 및 알고리즘 설명':'전체화면 왼쪽 지도 해석 및 모델 시뮬레이션');
    const fullControls=rail.getByLabel('전체화면 분석 설정');
    await fullControls.waitFor();
    const title=rail.locator('[class*="railTitleRow"] h2,[class*="railTitleRow"] h3');
    const t=await rect(title),c=await rect(fullControls);
    if(width>=1100)assert(verticallyOverlaps(t,c),algorithm+' fullscreen controls not beside title at '+width+': '+JSON.stringify({t,c}));
    assert(c.x>=t.x,algorithm+' fullscreen controls not to the right');
    assert(c.right<=(await rect(rail)).right+2,'Controls escaped fullscreen rail at '+width);
    assert.equal(await dialog.getByLabel('전체화면 분석 설정').count(),1);
    const inside=fullControls.getByRole('combobox',{name:'전체화면 조사 후보 알고리즘'});
    assert.equal(await inside.locator('option').count(),6);
    assert.equal(await inside.inputValue(),algorithm);
    assert.equal(await fullControls.getByRole('button',{name:'알고리즘 설명·시뮬레이션'}).count(),1);
    const map=dialog.getByLabel('개선 후보 지도');
    await map.locator('.leaflet-container').waitFor({timeout:20000});
    assert((await map.locator('.leaflet-container').count())===1);
    if(width===1369&&algorithm==='dbscan')await p.screenshot({path:out+'/dbscan-fullscreen-1369.png'});
    if(width===390&&algorithm==='hdbscan')await p.screenshot({path:out+'/hdbscan-fullscreen-390.png'});
    const metrics=await p.evaluate(()=>({scroll:document.documentElement.scrollWidth,view:document.documentElement.clientWidth}));
    assert(metrics.scroll<=metrics.view+4,'Horizontal overflow at '+algorithm+'/'+width);
    measurements.push({algorithm,width,normalRow:verticallyOverlaps(a,b),fullscreenRow:verticallyOverlaps(t,c)});
    await p.keyboard.press('Escape');
   }
  }
  // Fullscreen model selection remains live and does not exit the map.
  await p.setViewportSize({width:1369,height:920});
  await select.selectOption('dbscan');
  const frame=p.getByLabel('개선 2안 조사 후보 지도');
  await frame.getByRole('button',{name:'지도 전체 화면'}).click();
  let dialog=p.locator('section[role="dialog"][aria-label="개선 2안 조사 후보 지도"]');
  const mode=dialog.getByRole('group',{name:'분석 모드'});
  await mode.getByRole('button',{name:'알고리즘 성능 검증 (기간 분리)'}).click();
  await p.locator('section[role="dialog"][aria-label="개선 2안 조사 후보 지도"]').waitFor({timeout:45000});
  dialog=p.locator('section[role="dialog"][aria-label="개선 2안 조사 후보 지도"]');
  assert.equal(await dialog.getByRole('button',{name:'알고리즘 성능 검증 (기간 분리)'}).getAttribute('aria-pressed'),'true');
  await dialog.getByRole('button',{name:'전체 기간 후보 분석 (기본)'}).click();
  await p.locator('section[role="dialog"][aria-label="개선 2안 조사 후보 지도"]').waitFor();
  dialog=p.locator('section[role="dialog"][aria-label="개선 2안 조사 후보 지도"]');
  await dialog.getByRole('combobox',{name:'전체화면 조사 후보 알고리즘'}).selectOption('spatial_scan');
  dialog=p.locator('section[role="dialog"][aria-label="대안 모델 조사 후보 지도"]');
  await dialog.waitFor({timeout:45000});
  const popupShortcut=dialog.getByRole('button',{name:'알고리즘 설명·시뮬레이션'});
  await popupShortcut.click();
  const popup=p.getByRole('dialog',{name:/Spatial Scan.*후보 산정 시뮬레이터/});
  await popup.waitFor({timeout:16000});
  await popup.getByRole('button',{name:'시뮬레이터 팝업 닫기'}).click();
  assert(await dialog.isVisible(),'Closing simulator unexpectedly closed the fullscreen map');
  await p.keyboard.press('Escape');
  assert(!(await dialog.isVisible()));
  assert(tileResponses.some(x=>x===200),'No VWorld map tile success');
  assert(tileResponses.every(x=>x===200),'VWorld map request returned non-200');
  assert.deepEqual(errors,[],'Uncaught client errors');
  console.log(JSON.stringify({pass:true,measurement:measurements,algorithmCount:6,modeSwitch:true,popup:true,tileResponses:tileResponses.length,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
