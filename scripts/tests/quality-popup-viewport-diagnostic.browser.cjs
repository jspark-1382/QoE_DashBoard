const {chromium}=require(process.argv[2]||'playwright');
(async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});
 try{
 const p=await b.newPage({viewport:{width:1600,height:900}});
 await p.goto((process.argv[3]||'http://127.0.0.1:3016/qoe')+'/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement',{waitUntil:'domcontentloaded'});
 const picker=p.getByRole('combobox',{name:'조사 후보 알고리즘'});await picker.waitFor({timeout:90000});
 for(const model of ['dbscan','hdbscan']){
  await picker.selectOption(model);
  const stage=p.getByLabel(model==='dbscan'?'개선 2안 조사 후보 지도':'대안 모델 조사 후보 지도');
  await stage.getByRole('button',{name:'지도 전체 화면'}).click();
  const dialog=p.getByRole('dialog',{name:model==='dbscan'?'개선 2안 조사 후보 지도':'대안 모델 조사 후보 지도'});
  await dialog.getByRole('button',{name:'시뮬레이터 열기'}).click();
  const sim=p.getByRole('dialog',{name:/후보 산정 시뮬레이터/});
  const source=sim.getByLabel('시뮬레이터 팝업 내용');
  for(const height of [960,900,768]){
   await p.setViewportSize({width:1600,height});await p.waitForTimeout(150);
   const info=await sim.evaluate(el=>{
    const get=s=>el.querySelector(s);
    const r=e=>{if(!e)return null;const x=e.getBoundingClientRect();return {y:Math.round(x.y),bottom:Math.round(x.bottom),h:Math.round(x.height),w:Math.round(x.width)}};
    const content=get('[aria-label="시뮬레이터 팝업 내용"]');
    const root=content?.firstElementChild;
    return {popup:r(el),content:r(content),scroll:content?.scrollHeight,visible:content?.clientHeight,sim:r(root),nav:r(get('[aria-label="알고리즘 단계 선택"],nav[aria-label$="알고리즘 단계"]')),diagram:r(get('[data-testid="simulation-diagram"] svg,[data-testid="model-learning-diagram"]')),controls:r(get('[aria-label="시뮬레이터 조건 조절"],[aria-label$="모델 파라미터 조정"]')),actions:r(root?.querySelector('[class*="stepActions"],[class*="actions"]'))};
   });
   console.log(JSON.stringify({model,height,info}));
  }
  await p.keyboard.press('Escape');await p.keyboard.press('Escape');
 }
 }finally{await b.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
