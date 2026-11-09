const {chromium}=require(process.argv[2]||'playwright');
const assert=require('node:assert/strict');const fs=require('node:fs');
const base=(process.argv[3]||'http://127.0.0.1:3019/qoe').replace(/\/$/,'');
const out=process.argv[4]||'outputs/quality-improvement-two-deploy/simulator-fit-qa';fs.mkdirSync(out,{recursive:true});
const url=base+'/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement';
(async()=>{
const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1600,height:960}});
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(url,{waitUntil:'domcontentloaded'});
 const select=p.getByRole('combobox',{name:'조사 후보 알고리즘'});await select.waitFor({timeout:90000});
 const metrics=[];
 for(const model of ['dbscan','hdbscan','st_dbscan','adaptive_kde','spatial_scan','bayesian']){
  await select.selectOption(model);
  const stage=p.getByLabel(model==='dbscan'?'개선 2안 조사 후보 지도':'대안 모델 조사 후보 지도');
  await stage.getByRole('button',{name:'지도 전체 화면'}).click();
  const full=p.locator('section[role="dialog"][aria-label="'+(model==='dbscan'?'개선 2안 조사 후보 지도':'대안 모델 조사 후보 지도')+'"]');
  await full.getByRole('button',{name:'알고리즘 설명·시뮬레이션'}).click();
  const popup=p.getByRole('dialog',{name:/후보 산정 시뮬레이터/});
  const body=popup.getByLabel('시뮬레이터 팝업 내용');
  const sim=body.getByLabel(model==='dbscan'?'후보 산정 가상 시뮬레이터':model+' 상세 가상 시뮬레이터');
  await sim.waitFor({timeout:25000});
  for(const height of [960,900,768]){
   await p.setViewportSize({width:1600,height});
   await p.waitForTimeout(100);
   const m=await popup.evaluate(el=>{
    const body=el.querySelector('[aria-label="시뮬레이터 팝업 내용"]');
    const sim=body.firstElementChild;
    const actions=sim.querySelector('[class*="stepActions"],[class*="actions"]');
    const nav=sim.querySelector('[class*="phaseNav"],[class*="phases"]');
    const svg=sim.querySelector('svg[aria-label*="판정"],[data-testid="simulation-diagram"] svg,[data-testid="model-learning-diagram"],.figure svg');
    const r=e=>{if(!e)return null;const x=e.getBoundingClientRect();return {top:x.top,bottom:x.bottom,height:x.height,width:x.width}};
    return {viewport:innerHeight,dialog:r(el),content:r(body),actions:r(actions),nav:r(nav),svg:r(svg),scrollHeight:body.scrollHeight,clientHeight:body.clientHeight,scrollTop:body.scrollTop,root:r(sim),visible:!!actions&&r(actions).bottom<=r(body).bottom+3&&r(actions).top>=r(body).top-3};
   });
   assert(m.visible,model+' next/prev buttons clipped at '+height+': '+JSON.stringify(m));
   if(height>=900)assert(m.scrollHeight<=m.clientHeight+3,model+' screen does not fit at '+height+': '+JSON.stringify(m));
   if(height===960&&model==='dbscan')await p.screenshot({path:out+'/dbscan-1600x960.png'});
   if(height===900&&model==='hdbscan')await p.screenshot({path:out+'/hdbscan-1600x900.png'});
   metrics.push({model,height,content:m.clientHeight,scroll:m.scrollHeight,svgHeight:Math.round(m.svg?.height??0),actionsVisible:m.visible});
  }
  const nav=sim.locator('[class*="phaseNav"] button,[class*="phases"] button');
  assert.equal(await nav.count(),7);
  for(let k=0;k<7;k++){
   await nav.nth(k).click();
   assert.equal(await nav.nth(k).getAttribute('aria-current'),'step');
   const scroll=await body.evaluate(el=>({height:el.clientHeight,scroll:el.scrollHeight}));
   await body.evaluate(el=>el.scrollTop=0);
   const rect=await popup.evaluate(el=>{
    const content=el.querySelector('[aria-label="시뮬레이터 팝업 내용"]'),a=content.querySelector('[class*="stepActions"],[class*="actions"]');
    const cr=content.getBoundingClientRect(),r=a.getBoundingClientRect();
    return {contentBottom:cr.bottom,footerBottom:r.bottom,footerTop:r.top,contentTop:cr.top};
   });
   assert(rect.footerBottom<=rect.contentBottom+3&&rect.footerTop>=rect.contentTop-3,model+' step '+(k+1)+' next/prev not visible');
  }
  if(model!=='dbscan'){
    const disclosure=sim.getByText('실제 선택 후보 분석 근거 펼치기 (가상 시뮬레이션과 별도)');
    await disclosure.click();
    await sim.getByLabel('현재 선택 실제 후보에 모델 적용').waitFor();
    await disclosure.click();
  }
  await p.keyboard.press('Escape');
  assert(await full.isVisible());
  await p.keyboard.press('Escape');
 }
 await select.selectOption('hdbscan');
 await p.setViewportSize({width:390,height:830});
 const stage=p.getByLabel('대안 모델 조사 후보 지도');await stage.getByRole('button',{name:'지도 전체 화면'}).click();
 await p.locator('section[role="dialog"][aria-label="대안 모델 조사 후보 지도"]').getByRole('button',{name:'알고리즘 설명·시뮬레이션'}).click();
 const popup=p.getByRole('dialog',{name:/후보 산정 시뮬레이터/});
 const body=popup.getByLabel('시뮬레이터 팝업 내용');
 const nav=popup.locator('[class*="phases"] button');
 for(const stageNum of [0,3,6]){
  await nav.nth(stageNum).click();
  await body.evaluate(el=>el.scrollTop=0);
  const v=await popup.evaluate(el=>{
   const c=el.querySelector('[aria-label="시뮬레이터 팝업 내용"]');
   const a=c.querySelector('[class*="actions"]'),ca=c.getBoundingClientRect(),r=a.getBoundingClientRect();
   return {bottom:r.bottom,top:r.top,scrollBottom:ca.bottom,scrollTop:ca.top,visible:r.bottom<=ca.bottom+3&&r.top>=ca.top-3,horizontal:document.documentElement.scrollWidth-document.documentElement.clientWidth};
  });
  assert(v.horizontal<=4,'mobile horizontal overflow');
  assert(v.visible,'Mobile sticky actions not visible in step '+stageNum+': '+JSON.stringify(v));
 }
 await p.screenshot({path:out+'/hdbscan-390x830.png'});
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({pass:true,metrics,mobileSticky:true,errors}));
}finally{await browser.close()}})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});

