const {chromium}=require(process.argv[2]||'playwright');const assert=require('node:assert/strict');
const base=process.argv[3]||'http://127.0.0.1:3019/qoe';
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
const p=await browser.newPage({viewport:{width:1600,height:768}}); const errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.goto(base+'/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement',{waitUntil:'domcontentloaded'});
const picker=p.getByRole('combobox',{name:'조사 후보 알고리즘'});await picker.waitFor({timeout:85000});
const records=[];
for(const id of ['dbscan','hdbscan','st_dbscan','adaptive_kde','spatial_scan','bayesian']){
 for(const [width,height] of [[1600,768],[390,830]]){
  await p.setViewportSize({width,height});await picker.selectOption(id);
  const frame=p.getByLabel(id==='dbscan'?'개선 2안 조사 후보 지도':'대안 모델 조사 후보 지도');
  await frame.getByRole('button',{name:'지도 전체 화면'}).click();
  const full=p.locator('section[role="dialog"][aria-label="'+(id==='dbscan'?'개선 2안 조사 후보 지도':'대안 모델 조사 후보 지도')+'"]');
  await full.getByRole('button',{name:'알고리즘 설명·시뮬레이션'}).click();
  const popup=p.getByRole('dialog',{name:/후보 산정 시뮬레이터/});
  const sim=popup.getByLabel(id==='dbscan'?'후보 산정 가상 시뮬레이터':id+' 상세 가상 시뮬레이터');
  await sim.waitFor({timeout:25000});
  const nav=sim.locator('[class*="phaseNav"] button,[class*="phases"] button');
  assert.equal(await nav.count(),7);
  for(const stage of [0,3,6]){
   await nav.nth(stage).click();
   const body=popup.getByLabel('시뮬레이터 팝업 내용');
   await body.evaluate(el=>el.scrollTop=0);
   const dims=await popup.evaluate(el=>{
    const content=el.querySelector('[aria-label="시뮬레이터 팝업 내용"]');
    const controls=content.querySelector('[class*="stepActions"],[class*="actions"]');
    const q=el.getBoundingClientRect(),v=content.getBoundingClientRect(),a=controls.getBoundingClientRect();
    return {popupW:q.width,bodyH:v.height,scrollH:content.scrollHeight,scrollW:document.documentElement.scrollWidth,screenW:document.documentElement.clientWidth,actionsY:a.top,actionsBottom:a.bottom,bodyTop:v.top,bodyBottom:v.bottom};
   });
   assert(dims.scrollW<=dims.screenW+4,'Horizontal overflow '+id+' '+width);
   assert(dims.popupW<=width+1,'Modal width overflow '+id+' '+width);
   assert(dims.actionsBottom<=dims.bodyBottom+4&&dims.actionsY>=dims.bodyTop-4,'Actions cut '+JSON.stringify({id,width,stage,dims}));
   records.push({id,width,height,stage,visible:true,scroll:Math.round(dims.scrollH-dims.bodyH)});
  }
  await p.keyboard.press('Escape');assert(await full.isVisible());await p.keyboard.press('Escape');
 }
}
assert.deepEqual(errors,[]);
console.log(JSON.stringify({pass:true,models:6,checks:records.length,results:records,errors}));
}finally{await browser.close()}})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
