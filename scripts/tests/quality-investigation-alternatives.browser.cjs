const {chromium}=require(process.argv[2]||'playwright');
const assert=require('node:assert/strict');
(async()=>{
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const p=await browser.newPage({viewport:{width:1440,height:900}});
 p.setDefaultTimeout(13000);
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto((process.argv[3]||'http://127.0.0.1:3019/qoe')+'/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement',{waitUntil:'domcontentloaded'});
 const model=p.getByRole('combobox',{name:'조사 후보 알고리즘'});await model.waitFor({timeout:75000});
 const results=[];
 for(const [id,name] of [['hdbscan','HDBSCAN'],['st_dbscan','ST-DBSCAN'],['adaptive_kde','KDE'],['spatial_scan','Spatial Scan'],['bayesian','Bayesian']]){
  console.log('MODEL',id);
  await model.selectOption(id);
  const frame=p.getByLabel('대안 모델 조사 후보 지도');
  await frame.getByRole('button',{name:'지도 전체 화면'}).waitFor({timeout:35000});
  await frame.getByRole('button',{name:'지도 전체 화면'}).click();
  const d=p.locator('section[role="dialog"][aria-label="대안 모델 조사 후보 지도"]');
  const rail=d.getByLabel('전체화면 조사 후보 탐색');
  await rail.waitFor();
  const rows=rail.locator('button[data-candidate-id]');
  const count=await rows.count();
  const markers=await d.getByLabel('개선 후보 지도').locator('path[data-candidate-id]').count();
  assert.equal(count,markers,id+' markers mismatch');
  assert(count>0,id+' empty shortlist');
  const lastId=await rows.last().getAttribute('data-candidate-id');
  await d.getByLabel('개선 후보 지도').locator('path[data-candidate-id="'+lastId+'"]').dispatchEvent('click');
  assert.equal(await rows.last().getAttribute('aria-pressed'),'true',id+' selection did not follow marker');
  const selected=await rail.getByLabel('전체화면 선택 후보 상세').innerText();
  assert(selected.includes('후보 지역 '+count),id+' detail not refreshed');
  const reviews=rail.getByRole('button',{name:/범위 검토 \d+/});
  const review=parseInt((await reviews.innerText()).match(/\d+/)?.[0]??'0',10);
  await reviews.click();
  assert.equal(await rail.locator('button[data-candidate-id]').count(),review,id+' range filter differs');
  await rail.getByRole('button',{name:/전체 \d+/}).click();
  if(id==='hdbscan'){
   await d.getByRole('button',{name:'알고리즘 설명·시뮬레이션'}).click();
   const dialog=p.getByRole('dialog',{name:/HDBSCAN.*후보 산정 시뮬레이터/});
   await dialog.getByRole('button',{name:'알고리즘 설명'}).click();
   assert((await dialog.innerText()).includes('HDBSCAN'));
   await dialog.getByRole('button',{name:'선정 기준'}).click();
   assert((await dialog.innerText()).includes('하이퍼파라미터'));
   await p.keyboard.press('Escape');
   assert(await d.isVisible(),'Popup close also closed map');
  }
  await p.keyboard.press('Escape');
  results.push({model:id,candidates:count,review,markerLink:true});
 }
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({pass:true,results,errors}));
}finally{await browser.close()}
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});

