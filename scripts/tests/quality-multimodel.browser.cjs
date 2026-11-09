const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.argv[2]||'playwright');
const root=(process.argv[3]||'http://127.0.0.1:3019/qoe').replace(/\/$/,'');
const out=process.argv[4]||'outputs/quality-improvement-two-deploy/multimodel-qa';
fs.mkdirSync(out,{recursive:true});
const url=root+'/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement';
const expected={hdbscan:16,st_dbscan:5,adaptive_kde:15,spatial_scan:17,bayesian:20};
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const p=await browser.newPage({viewport:{width:1440,height:1040}});
  const errors=[],requests=[];
  p.on('pageerror',e=>errors.push(e.message));
  p.on('response',r=>{if(r.url().includes('/quality-models/'))requests.push({status:r.status(),path:r.url().split('/').pop()})});
  await p.goto(url,{waitUntil:'domcontentloaded'});
  const selector=p.getByRole('combobox',{name:'조사 후보 알고리즘'});
  await selector.waitFor({timeout:90000});
  assert.equal(await selector.locator('option').count(),6);
  assert.equal(await selector.inputValue(),'dbscan');
  assert(await p.getByRole('region',{name:'조사 후보 지역 목록'}).count()>0);
  await p.getByRole('region',{name:'조사 후보 지역 목록'}).getByRole('button').first().waitFor({timeout:60000});
  await p.screenshot({path:out+'/baseline-dbscan.png',fullPage:false});
  const evidence=[];
  for(const [id,total] of Object.entries(expected)){
   await selector.selectOption(id);
   const name=({hdbscan:'HDBSCAN',st_dbscan:'ST-DBSCAN',adaptive_kde:'Adaptive KDE',spatial_scan:'Spatial Scan',bayesian:'Bayesian (Empirical Bayes)'})[id];
   const panel=p.getByRole('region',{name:'선택 모델 '+name+' 조사 후보'});
   await panel.waitFor({timeout:45000});
   const list=panel.getByRole('region',{name:'선택 모델 조사 후보 목록'});
   await list.getByRole('button').first().waitFor({timeout:30000});
   const rows=list.getByRole('button');
   assert.equal(await rows.count(),total,id+' candidate count');
   const count=await panel.getByLabel('선택 모델 후보 통계').innerText();
   assert(count.includes(total+'곳'),id+' summary mismatch');
   const map=panel.getByLabel('개선 후보 지도');
   await map.locator('.leaflet-container').waitFor({timeout:30000});
   assert((await map.locator('.leaflet-interactive').count())>=total,'Candidate points should be plotted '+id);
   const current=panel.getByRole('region',{name:'선택 모델 후보 상세 근거'});
   assert((await current.innerText()).includes('후보 지역 1'));
   assert((await current.getByLabel('선택 모델 후보의 실제 원본 통화').locator('tbody tr').count())>0);
   await rows.nth(1).click();
   await current.getByText('후보 지역 2',{exact:true}).waitFor({timeout:10000});
   assert.equal(await rows.nth(1).getAttribute('aria-pressed'),'true');
   // Fullscreen contains model-specific methodology, not the DBSCAN simulator.
   await panel.getByRole('button',{name:'지도 전체 화면'}).click();
   const dialog=p.getByRole('dialog',{name:'대안 모델 조사 후보 지도'});
   await dialog.waitFor({timeout:10000});
   const method=dialog.getByLabel('선택 모델 알고리즘 검증 기준');
   await method.waitFor();
   assert((await method.innerText()).includes(name.split(' ')[0]));
   await p.keyboard.press('Escape');
   assert(!(await method.isVisible()));
   if(id==='spatial_scan'||id==='bayesian'){
    assert((await panel.innerText()).includes('탐색 전용'));
    assert((await panel.innerText()).includes('실제 위험률'));
   }else{
    assert((await panel.innerText()).includes('실제 저MOS 위치 계산'));
   }
   if(id==='hdbscan'||id==='spatial_scan')await p.screenshot({path:out+'/'+id+'-1440.png',fullPage:false});
   evidence.push({model:id,candidates:total,selection:true,fullscreen:true});
  }
  // Original must remain intact after all switches
  await selector.selectOption('dbscan');
  await p.getByRole('region',{name:'조사 후보 지역 목록'}).getByRole('button',{name:/후보 지역 7/}).waitFor({timeout:18000});
  assert.equal(await p.getByRole('region',{name:'조사 후보 지역 목록'}).getByRole('button').count(),7);
  // Switch back to an alternative and check responsive layout with no overflow
  await selector.selectOption('hdbscan');
  await p.getByRole('region',{name:'선택 모델 조사 후보 목록'}).getByRole('button').first().waitFor({timeout:20000});
  const widths=[1440,1280,1024,800,680,390];
  const layout=[];
  for(const width of widths){
   await p.setViewportSize({width,height:1000});await p.waitForTimeout(250);
   const dims=await p.evaluate(()=>{
    const w=document.querySelector('[aria-label^="선택 모델 HDBSCAN 조사 후보"]');
    const map=w?.querySelector('[aria-label="대안 모델 조사 후보 지도"]');
    const side=w?.querySelector('[aria-label="모델별 후보 및 선정 근거"]');
    if(!map||!side)return null;
    const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
    return {pageWidth:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth,map:rect(map),side:rect(side)};
   });
   assert(dims,'missing layout width '+width);
   assert(dims.pageWidth<=dims.viewport+4,'page overflow at '+width+': '+JSON.stringify(dims));
   assert(dims.map.right+4<=dims.side.x||dims.map.bottom+4<=dims.side.y,'overlap at '+width+': '+JSON.stringify(dims));
   assert(dims.map.width>265&&dims.side.width>265,'too narrow '+width);
   layout.push({width,mode:dims.map.right<=dims.side.x?'side-by-side':'stacked'});
   if(width===390)await p.screenshot({path:out+'/hdbscan-390.png',fullPage:false});
  }
  assert.deepEqual(errors,[]);
  assert(requests.length>=1);
  assert(requests.every(r=>r.status===200),'model report request failed '+JSON.stringify(requests));
  console.log(JSON.stringify({pass:true,results:evidence,layout,modelResponses:requests.length,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
