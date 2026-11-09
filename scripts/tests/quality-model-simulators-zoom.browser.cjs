const assert=require('node:assert/strict');
const {chromium}=require(process.argv[2]||'playwright');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const p=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto((process.argv[3]||'http://127.0.0.1:3019/qoe')+'/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement');
  const selector=p.getByRole('combobox',{name:'조사 후보 알고리즘'});
  await selector.waitFor({timeout:85000});
  const details=[];
  for(const model of ['hdbscan','st_dbscan','adaptive_kde','spatial_scan','bayesian']){
   await selector.selectOption(model);
   const panel=p.locator('[aria-label^="선택 모델 "][aria-label$=" 조사 후보"]').first();
   await panel.getByRole('button',{name:'지도 전체 화면'}).click();
   const dialog=p.getByRole('dialog',{name:'대안 모델 조사 후보 지도'});
   await dialog.getByRole('button',{name:'알고리즘 설명·시뮬레이션'}).click();
   const sim=p.getByRole('dialog',{name:/후보 산정 시뮬레이터/}).getByRole('region',{name:model+' 상세 가상 시뮬레이터'});
   await sim.waitFor({timeout:27000});
   const stages=sim.getByRole('navigation',{name:model+' 알고리즘 단계'}).getByRole('button');
   await stages.nth(3).click();
   const drawing=sim.locator('[data-testid="model-learning-diagram"]');
   const expanded=sim.getByRole('button',{name:'선택 후보 확대'});
   const overview=sim.getByRole('button',{name:'전체 관측'});
   assert.equal(await expanded.getAttribute('aria-pressed'),'true');
   const focus=await drawing.locator('[data-sim-point]').count();
   const focusCoords=await drawing.evaluate(svg=>{
    const circle=svg.querySelector('[data-sim-point="A"] circle'),other=svg.querySelector('[data-sim-point="B"] circle');
    return circle&&other?Math.abs(Number(circle.getAttribute('cx'))-Number(other.getAttribute('cx'))):0;
   });
   await overview.click();
   assert.equal(await overview.getAttribute('aria-pressed'),'true');
   const full=await drawing.locator('[data-sim-point]').count();
   const fullCoords=await drawing.evaluate(svg=>{
    const circle=svg.querySelector('[data-sim-point="A"] circle'),other=svg.querySelector('[data-sim-point="B"] circle');
    return circle&&other?Math.abs(Number(circle.getAttribute('cx'))-Number(other.getAttribute('cx'))):0;
   });
   assert(full>focus,model+' view toggle must reveal non-members/normal points');
   assert(focusCoords>fullCoords,model+' zoom must increase actual spatial scale');
   await expanded.click();
   assert.equal(await drawing.locator('[data-sim-point]').count(),focus);
   details.push({model,focusPoints:focus,allPoints:full,scaleRatio:Number((focusCoords/fullCoords).toFixed(2))});
   if(model==='hdbscan'){
    await sim.getByRole('button',{name:'초기화'}).click();
    await sim.getByRole('button',{name:'단계 자동 재생'}).click();
    await p.waitForTimeout(2250);
    const current=await stages.evaluateAll(nodes=>nodes.findIndex(n=>n.getAttribute('aria-current')==='step'));
    assert(current>=1,'autoplay did not advance');
    await sim.getByRole('button',{name:'자동 재생 중지'}).click();
    const stopped=await stages.evaluateAll(nodes=>nodes.findIndex(n=>n.getAttribute('aria-current')==='step'));
    await p.waitForTimeout(1750);
    assert.equal(await stages.evaluateAll(nodes=>nodes.findIndex(n=>n.getAttribute('aria-current')==='step')),stopped,'pause failed');
   }
   await p.keyboard.press('Escape');
   await p.keyboard.press('Escape'); // underlying fullscreen stays open after first Esc
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({pass:true,zoom:details,autoplayAndPause:true,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});

