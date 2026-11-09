const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.argv[2]||'playwright');
const root=(process.argv[3]||'http://127.0.0.1:3019/qoe').replace(/\/$/,'');
const out=process.argv[4]||'outputs/quality-improvement-two-deploy/model-simulators-qa';
fs.mkdirSync(out,{recursive:true});
const BASE=path.resolve('public/quality-model-simulations/v1');
const manifest=JSON.parse(fs.readFileSync(path.join(BASE,'index.json'),'utf8'));
const url=root+'/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement';
const displays={hdbscan:'HDBSCAN',st_dbscan:'ST-DBSCAN',adaptive_kde:'Adaptive KDE',spatial_scan:'Spatial Scan',bayesian:'Bayesian (Empirical Bayes)'};
const canon=(c,p)=>c+'|'+Object.entries(p).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,v])=>k+':'+(k==='bandwidth_scale'?Number(v).toFixed(1):String(v))).join('|');
(async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});
 try{
  const p=await b.newPage({viewport:{width:1440,height:950}});
  const errors=[],failed=[];
  p.on('pageerror',e=>errors.push(e.message));
  p.on('response',r=>{if(r.url().includes('quality-model-simulations')&&r.status()!==200)failed.push({url:r.url(),code:r.status()});});
  await p.goto(url,{waitUntil:'domcontentloaded'});
  const selector=p.getByRole('combobox',{name:'조사 후보 알고리즘'});
  await selector.waitFor({timeout:85000});
  const tested=[];
  for(const [model,name] of Object.entries(displays)){
   const fixture=JSON.parse(fs.readFileSync(path.join(BASE,model+'.json'),'utf8'));
   const def=manifest.defaults[model];
   const start=fixture.states[canon('focused',def)];
   assert(start,'default state missing '+model+' '+canon('focused',def));
   await selector.selectOption(model);
   const panel=p.getByRole('region',{name:'선택 모델 '+name+' 조사 후보'});
   await panel.waitFor({timeout:40000});
   const baselineCount=await panel.getByRole('region',{name:'선택 모델 조사 후보 목록'}).getByRole('button').count();
   const map=panel.getByLabel('개선 후보 지도');
   await map.locator('.leaflet-container').waitFor({timeout:30000});
   const originalMapMarkers=await map.locator('.leaflet-interactive').count();
   await panel.getByRole('button',{name:'지도 전체 화면'}).click();
   const dlg=p.getByRole('dialog',{name:'대안 모델 조사 후보 지도'});
   await dlg.getByRole('button',{name:'알고리즘 설명·시뮬레이션'}).click();
   const modal=p.getByRole('dialog',{name:new RegExp('^'+name.split(' ')[0]+'.*후보 산정 시뮬레이터')});
   const rail=modal.getByLabel('시뮬레이터 팝업 내용');
   const sim=rail.getByRole('region',{name:model+' 상세 가상 시뮬레이터'});
   await sim.waitFor({timeout:25000});
   const phases=sim.getByRole('navigation',{name:model+' 알고리즘 단계'}).getByRole('button');
   assert.equal(await phases.count(),7,model+' steps');
   assert.equal(await sim.getByRole('button',{name:/기본: 두 지역에 모인 저MOS/}).getAttribute('aria-pressed'),'true');
   assert((await sim.innerText()).includes(start.candidates.length+'개 후보'));
   assert((await sim.innerText()).includes('가상 학습 데이터'));
   const svg=sim.locator('[data-testid="model-learning-diagram"]');
   await svg.waitFor();
   assert.equal(await svg.locator('[data-sim-point]').count(),start.points.length+(['spatial_scan','bayesian'].includes(model)?start.normalPoints.length:0));
   for(let stage=0;stage<=6;stage++){
    await phases.nth(stage).click();
    assert.equal(await phases.nth(stage).getAttribute('aria-current'),'step');
    assert((await sim.innerText()).includes('STEP '+(stage+1)+' / 7'));
    const formula=sim.getByLabel('단계별 공식과 실제 계산값');
    assert(await formula.isVisible(),model+' formula missing stage='+stage);
   }
   assert(await sim.getByLabel('현재 선택 실제 후보에 모델 적용').count()===1||await sim.getByLabel('현재 선택 실제 후보에 모델 적용').count()===0);
   await sim.getByText('실제 선택 후보 분석 근거 펼치기 (가상 시뮬레이션과 별도)').click();
   const real=sim.getByLabel('현재 선택 실제 후보에 모델 적용');
   await real.waitFor();
   assert((await real.innerText()).includes('후보 지역 1'),model+' real example not synced');
   assert((await real.innerText()).includes('발견'),model+' real dates absent');
   assert(await real.locator('[data-testid="model-actual-geometry"]').count()===1);
   await sim.getByText('실제 선택 후보 분석 근거 펼치기 (가상 시뮬레이션과 별도)').click();
   if(model==='bayesian'){
    await phases.nth(3).click();
    assert(await sim.getByRole('img',{name:'가중 Beta 사전분포와 사후분포의 확률 밀도'}).count()===0 || await sim.getByLabel('가중 Beta 사전분포와 사후분포의 확률 밀도').count()===1);
    assert((await sim.innerText()).includes('실제 Beta 분포 계산 곡선'));
   }
   // First parameter moves between Python precomputed values; the displayed
   // candidate count must match the *real engine* result for the new key.
   const [firstKey,values]=Object.entries(manifest.controls[model])[0];
   const label=manifest.labels[model][firstKey];
   const slider=sim.getByRole('slider',{name:label});
   await slider.fill(String(values.length-1));
   const changed={...def,[firstKey]:values[values.length-1]};
   const expected=fixture.states[canon('focused',changed)];
   assert(expected,model+' selected fixture missing');
   assert((await sim.innerText()).includes(expected.candidates.length+'개 후보'),model+' slider not synced');
   // Change scenario and ensure a completely new Python result is selected.
   await sim.getByRole('button',{name:/정상 표본 증가: 위험도 변화/}).click();
   const expanded=fixture.states[canon('controls',changed)];
   assert(expanded);
   assert((await sim.innerText()).includes(expanded.candidates.length+'개 후보'),model+' scenario not synced');
   await sim.getByRole('button',{name:'초기화'}).click();
   assert.equal(await phases.nth(0).getAttribute('aria-current'),'step');
   assert((await sim.innerText()).includes(start.candidates.length+'개 후보'));
   // Controls must not silently change the actual source-backed map count.
   await sim.getByText('실제 선택 후보 분석 근거 펼치기 (가상 시뮬레이션과 별도)').click();
   assert((await sim.getByLabel('현재 선택 실제 후보에 모델 적용').innerText()).includes('후보 지역 1'));
   await sim.getByText('실제 선택 후보 분석 근거 펼치기 (가상 시뮬레이션과 별도)').click();
   // Underlying candidate list is inert while simulator popup is active.
   if(model==='hdbscan'||model==='spatial_scan'||model==='bayesian'){
    await rail.evaluate(el=>el.scrollTo(0,0));
    await p.screenshot({path:out+'/'+model+'-step0.png'});
    await phases.nth(3).click();
    await p.screenshot({path:out+'/'+model+'-step4.png'});
   }
   await p.keyboard.press('Escape');
   assert(!(await sim.isVisible()));
   await p.keyboard.press('Escape'); // close the still-open fullscreen map
   assert.equal(await panel.getByRole('region',{name:'선택 모델 조사 후보 목록'}).getByRole('button').count(),baselineCount);
   assert((await map.locator('.leaflet-interactive').count())>=originalMapMarkers-5,model+' map dropped markers');
   // Selection of a DIFFERENT actual candidate updates the corresponding
   // grounded example when returning to the fullscreen map.
   await panel.getByRole('region',{name:'선택 모델 조사 후보 목록'}).getByRole('button').nth(1).click();
   await panel.getByRole('button',{name:'지도 전체 화면'}).click();
   await dlg.getByRole('button',{name:'알고리즘 설명·시뮬레이션'}).click();
   const replacement=p.getByRole('dialog',{name:new RegExp('^'+name.split(' ')[0]+'.*후보 산정 시뮬레이터')}).getByRole('region',{name:model+' 상세 가상 시뮬레이터'});
   await replacement.waitFor({timeout:20000});
   await replacement.getByText('실제 선택 후보 분석 근거 펼치기 (가상 시뮬레이션과 별도)').click();
   await replacement.getByLabel('현재 선택 실제 후보에 모델 적용').getByText('후보 지역 2',{exact:true}).waitFor();
   await p.keyboard.press('Escape');
   await p.keyboard.press('Escape');
   tested.push({model,defaultCandidates:start.candidates.length,modelsRealCandidates:baselineCount,sevenSteps:true,parameterChanged:true,scenarioChanged:true,sourceExampleSynced:true});
  }
  // Baseline DBSCAN simulator is now launched through the same popup workflow.
  await selector.selectOption('dbscan');
  const old=p.getByRole('region',{name:'조사 후보 지역 목록'});
  await old.waitFor({timeout:30000});
  assert.equal(await old.getByRole('button').count(),8,'full-period default DBSCAN has 8 candidates; holdout has 7');
  await p.getByRole('button',{name:'지도 전체 화면'}).click();
  await p.getByRole('dialog',{name:'개선 2안 조사 후보 지도'}).getByRole('button',{name:'알고리즘 설명·시뮬레이션'}).click();
  await p.getByRole('dialog',{name:'DBSCAN · 후보 산정 시뮬레이터'}).getByRole('region',{name:'후보 산정 가상 시뮬레이터'}).waitFor();
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape'); // close the fullscreen map after the popup
  assert.deepEqual(failed,[]);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({pass:true,tested,failed,errors}));
 }finally{await b.close();}
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});

