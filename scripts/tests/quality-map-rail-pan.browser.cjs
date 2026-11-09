const {chromium}=require(process.argv[2]||'playwright');
const assert=require('node:assert/strict');
const origin=(process.argv[3]||'http://127.0.0.1:3016/qoe').replace(/\/$/,'');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement',{waitUntil:'domcontentloaded'});
  const selector=page.getByRole('combobox',{name:'조사 후보 알고리즘'});
  await selector.waitFor({timeout:90000});
  for(const type of ['dbscan','hdbscan']){
   await selector.selectOption(type);
   const frame=page.getByLabel(type==='dbscan'?'개선 2안 조사 후보 지도':'대안 모델 조사 후보 지도');
   await frame.getByRole('button',{name:'지도 전체 화면'}).click();
   const dialog=page.getByRole('dialog',{name:type==='dbscan'?'개선 2안 조사 후보 지도':'대안 모델 조사 후보 지도'});
   const map=dialog.getByLabel('개선 후보 지도').locator('.leaflet-container');
   await map.waitFor();
   const before=await map.locator('.leaflet-map-pane').evaluate(el=>el.style.transform);
   const box=await map.boundingBox();
   const x=box.x+box.width*.68,y=box.y+box.height*.56;
   await page.mouse.move(x,y);await page.mouse.down();
   await page.mouse.move(x-115,y+85,{steps:10});await page.mouse.up();
   await page.waitForTimeout(800);
   const after=await map.locator('.leaflet-map-pane').evaluate(el=>el.style.transform);
   assert.notEqual(after,before,type+' map pan did not move');
   assert((await map.locator('img.leaflet-tile').count())>0);
   console.log(type+' pan passed: '+before+' -> '+after);
   await page.keyboard.press('Escape');
  }
  await page.setViewportSize({width:390,height:850});
  await selector.selectOption('dbscan');
  const frame=page.getByLabel('개선 2안 조사 후보 지도');
  await frame.getByRole('button',{name:'지도 전체 화면'}).click();
  const dialog=page.getByRole('dialog',{name:'개선 2안 조사 후보 지도'});
  const left=dialog.getByLabel('전체화면 왼쪽 지도 해석 및 알고리즘 설명');
  const pos=await dialog.evaluate(d=>{
    const r=e=>{const b=e.getBoundingClientRect();return {top:b.top,bottom:b.bottom,height:b.height}};
    return {left:r(d.querySelector('[aria-label="전체화면 왼쪽 지도 해석 및 알고리즘 설명"]')),map:r(d.querySelector('[aria-label="개선 후보 지도"]')),content:r(d.querySelector('[class*="railContent"]'))};
  });
  assert(pos.left.bottom<=pos.map.top+5 && pos.map.height>160&&pos.content.height>70,JSON.stringify(pos));
  assert((await left.getByLabel('전체화면 선택 후보 요약').innerText()).includes('저MOS 고객'));
  await left.getByRole('button',{name:'시뮬레이터 열기'}).click();
  const popup=page.getByRole('dialog',{name:'DBSCAN · 후보 산정 시뮬레이터'});
  await popup.getByLabel('후보 산정 가상 시뮬레이터').waitFor();
  await popup.getByRole('button',{name:'시뮬레이터 팝업 닫기'}).click();
  await page.keyboard.press('Escape');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({pass:true,mobileDBSCANMapHeight:pos.map.height,mobileContentHeight:pos.content.height,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
