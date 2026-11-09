const {chromium}=require(process.argv[2]||'playwright');const assert=require('node:assert/strict');const fs=require('node:fs');
const base=(process.argv[3]||'http://127.0.0.1:3019/qoe').replace(/\/$/,'');
const out=process.argv[4]||'outputs/quality-improvement-two-deploy/sim-readable-qa';fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1600,height:960}}); const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base+'/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement',{waitUntil:'domcontentloaded'});
 const picker=p.getByRole('combobox',{name:'조사 후보 알고리즘'});await picker.waitFor({timeout:80000});
 const results=[];
 for(const id of ['dbscan','hdbscan','st_dbscan','adaptive_kde','spatial_scan','bayesian']){
  await picker.selectOption(id);
  const frame=p.getByLabel(id==='dbscan'?'개선 2안 조사 후보 지도':'대안 모델 조사 후보 지도');
  await frame.getByRole('button',{name:'지도 전체 화면'}).click();
  const full=p.locator('section[role="dialog"][aria-label="'+(id==='dbscan'?'개선 2안 조사 후보 지도':'대안 모델 조사 후보 지도')+'"]');
  await full.getByRole('button',{name:'알고리즘 설명·시뮬레이션'}).click();
  const dialog=p.getByRole('dialog',{name:/후보 산정 시뮬레이터/});
  const sim=dialog.getByLabel(id==='dbscan'?'후보 산정 가상 시뮬레이터':id+' 상세 가상 시뮬레이터');
  await sim.waitFor({timeout:25000});
  const step=sim.locator('[class*="phaseNav"] button,[class*="phases"] button');
  for(const k of [0,3,6]){
   await step.nth(k).click();
   await p.waitForTimeout(90);
   await dialog.getByLabel('시뮬레이터 팝업 내용').evaluate(el=>el.scrollTop=0);
   const x=await dialog.evaluate(el=>{
    const body=el.querySelector('[aria-label="시뮬레이터 팝업 내용"]');
    const sim=el.querySelector('[aria-label="후보 산정 가상 시뮬레이터"],[aria-label$="상세 가상 시뮬레이터"]');
    const diagram=sim?.querySelector('[data-testid="simulation-diagram"] svg,[data-testid="model-learning-diagram"]');
    const label=sim?.querySelector('input[type="range"]')?.closest('[class*="rangeControl"],[class*="slider"]')?.querySelector('label');
    const actions=sim?.querySelector('[class*="stepActions"],[class*="actions"]');
    const r=e=>{if(!e)return null;let q=e.getBoundingClientRect();return {x:Math.round(q.x),y:Math.round(q.y),width:Math.round(q.width),height:Math.round(q.height),bottom:Math.round(q.bottom)};};
    return {dialog:r(el),body:r(body),sim:r(sim),diagram:r(diagram),actions:r(actions),bodyScroll:body.scrollHeight,bodyHeight:body.clientHeight,headingPx:parseFloat(getComputedStyle(el.querySelector('h2')).fontSize),labelPx:label?parseFloat(getComputedStyle(label).fontSize):null,actionPx:actions?parseFloat(getComputedStyle(actions.querySelector('button')).fontSize):null};
   });
   assert(x.dialog.width>=1450,id+' popup not fullscreen: '+JSON.stringify(x));
   assert(x.headingPx>=20,id+' title too small');
   assert(x.diagram?.width>=350,id+' diagram too small in step '+k+': '+JSON.stringify(x));
   assert(x.actions,id+' actions unavailable');
   results.push({id,k,...x});
   if(k===3&&['dbscan','hdbscan'].includes(id))await p.screenshot({path:out+'/'+id+'-stage4-desktop.png',fullPage:false});
  }
  await p.keyboard.press('Escape');assert(await full.isVisible());await p.keyboard.press('Escape');
 }
 await picker.selectOption('dbscan');await p.setViewportSize({width:390,height:830});
 const frame=p.getByLabel('개선 2안 조사 후보 지도');await frame.getByRole('button',{name:'지도 전체 화면'}).click();
 await p.locator('section[role="dialog"][aria-label="개선 2안 조사 후보 지도"]').getByRole('button',{name:'알고리즘 설명·시뮬레이션'}).click();
 const modal=p.getByRole('dialog',{name:/후보 산정 시뮬레이터/});
 await modal.getByLabel('후보 산정 가상 시뮬레이터').locator('[class*="phaseNav"] button').nth(3).click();
 await p.screenshot({path:out+'/dbscan-stage4-mobile.png',fullPage:false});
 const mobile=await modal.evaluate(el=>({width:el.getBoundingClientRect().width,scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
 assert(mobile.scroll<=mobile.client+4);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({pass:true,results,mobile,errors}));
}finally{await browser.close();}})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
