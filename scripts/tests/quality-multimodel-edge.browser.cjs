const assert=require('node:assert/strict');
const {chromium}=require(process.argv[2]||'playwright');
(async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await b.newPage({viewport:{width:390,height:820}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const url=(process.argv[3]||'http://127.0.0.1:3019/qoe')+'/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement';
  await page.goto(url,{waitUntil:'domcontentloaded'});
  const sel=page.getByRole('combobox',{name:'조사 후보 알고리즘'});
  await sel.waitFor({timeout:90000});
  await sel.selectOption('hdbscan');
  const panel=page.getByRole('region',{name:'선택 모델 HDBSCAN 조사 후보'});
  await panel.waitFor({timeout:35000});
  await panel.getByRole('button',{name:'지도 전체 화면'}).click();
  const dialog=page.getByRole('dialog',{name:'대안 모델 조사 후보 지도'});
  await dialog.waitFor();
  const guide=dialog.getByLabel('선택 모델 알고리즘 검증 기준');
  const map=dialog.getByLabel('개선 후보 지도');
  await map.locator('.leaflet-container').waitFor();
  const state=await page.evaluate(()=>{
   const d=document.querySelector('[role=dialog]'),a=d?.querySelector('[aria-label="선택 모델 알고리즘 검증 기준"]'),m=d?.querySelector('[aria-label="개선 후보 지도"]');
   if(!a||!m)return null;
   const r=e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height}};
   return {guide:r(a),map:r(m),pageWidth:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth};
  });
  assert(state);
  assert(state.guide.bottom<=state.map.y+5,'mobile modal sections overlap '+JSON.stringify(state));
  assert(state.map.height>=150&&state.guide.height>=200,'undersized fullscreen sections: '+JSON.stringify(state));
  assert(state.pageWidth<=state.viewport+4);
  await page.keyboard.press('Escape');
  assert(!await guide.isVisible());
  const row=panel.getByRole('region',{name:'선택 모델 조사 후보 목록'}).getByRole('button').first();
  await row.click();
  await panel.getByRole('button',{name:'이 후보의 통화 목록 조사'}).click();
  await page.locator('#qoe-proposal-four-calls').waitFor({timeout:20000});
  // A one-day scope cannot pass the independent >=2-day candidate gate.
  await page.goto((process.argv[3]||'http://127.0.0.1:3019/qoe')+'/?variant=improvement2&dateStart=2026-10-30&dateEnd=2026-10-30&mapMode=improvement',{waitUntil:'domcontentloaded'});
  await sel.waitFor({timeout:45000});
  await sel.selectOption('hdbscan');
  const one=page.getByRole('region',{name:'선택 모델 HDBSCAN 조사 후보'});
  await one.waitFor({timeout:45000});
  assert((await one.innerText()).includes('0곳'));
  assert((await one.innerText()).includes('모델별 결과가 0곳'));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({pass:true,mobileFullscreen:true,callInvestigation:true,oneDayCandidateCount:0,errors}));
 }finally{await b.close();}
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
