/* eslint-disable @typescript-eslint/no-require-imports -- Browser regression runner. */
const {chromium}=require(process.argv[2]||'playwright');
const assert=require('node:assert/strict');
require('node:fs').mkdirSync('outputs/quality-revision-qa',{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:2560,height:1340}}),errors=[],results=[];
  let phase='initial';
  page.on('pageerror',error=>errors.push({phase,message:error.message,stack:error.stack}));
  for(const width of [2560,1440,680]){
   await page.setViewportSize({width,height:1340});
   const pair=[];
   for(const variant of ['current','improvement1']){
    phase=variant+'-'+width;
    await page.goto('http://127.0.0.1:3016/qoe/?variant='+variant+'&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement');
    const workspace=page.getByRole('region',{name:'개선 후보 분석',exact:true});
    await workspace.getByLabel('선택 개선 후보 상세 근거').waitFor({timeout:60000});
    await page.evaluate(()=>document.fonts.ready);
    const bounds=await workspace.boundingBox(),filterBounds=await page.getByLabel('품질 현황 분석 조건').boundingBox();
    const result={variant,width,workspaceY:bounds.y,filterBottom:filterBounds.y+filterBounds.height,
     kpiCount:await page.getByLabel('주요 MOS 품질 지표').count(),chartCount:await page.getByText('MOS 점수 분포',{exact:true}).count(),
     coverageCount:await page.getByText('위치 자료 수집·활용 현황',{exact:false}).count(),
     mapBounds:await workspace.locator('[data-map-surface]').boundingBox(),
     tableCount:await page.locator('#qoe-proposal-four-calls').count()};
    await page.screenshot({path:'outputs/quality-revision-qa/candidate-fullpage-'+variant+'-'+width+'.png'});
    pair.push(result);
   }
   results.push(pair);
   assert.equal(pair[1].kpiCount,pair[0].kpiCount,'candidate mode must not add overview KPI cards');
   assert.equal(pair[1].chartCount,pair[0].chartCount,'candidate mode must not add overview charts');
   assert.equal(pair[1].coverageCount,pair[0].coverageCount,'candidate mode must not add an overview coverage block');
   assert.equal(pair[1].tableCount,pair[0].tableCount,'call investigation must be opt-in');
   for(const key of ['workspaceY','filterBottom'])assert(Math.abs(pair[0][key]-pair[1][key])<=1,key+' must match at '+width);
   for(const key of ['x','y','width','height'])assert(Math.abs(pair[0].mapBounds[key]-pair[1].mapBounds[key])<=1,'map '+key+' must match at '+width);
  }
  phase='investigation';
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('http://127.0.0.1:3016/qoe/?variant=improvement1&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement');
  const investigate=page.getByRole('button',{name:'관련 통화·고객을 아래 통화 목록에서 조사'});
  await investigate.waitFor({timeout:60000});await investigate.click();
  await page.getByRole('button',{name:'관련 고객 전체 통화',exact:true}).waitFor();
  assert.equal(await page.locator('#qoe-proposal-four-calls').count(),1);
  phase='return-to-overview';
  await page.getByRole('button',{name:'품질현황',exact:true}).click();
  await page.getByLabel('주요 MOS 품질 지표').waitFor();assert(await page.getByText('MOS 점수 분포',{exact:true}).isVisible());
  for(let i=0;i<10;i++){
   phase='repeat-candidate-'+i;
   await page.getByRole('button',{name:'개선후보',exact:true}).click();
   await page.getByLabel('선택 개선 후보 상세 근거').waitFor();await page.waitForTimeout(150);
   phase='repeat-overview-'+i;
   await page.getByRole('button',{name:'품질현황',exact:true}).click();
   await page.getByLabel('주요 MOS 품질 지표').waitFor();await page.waitForTimeout(150);
  }
  await page.waitForTimeout(500);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({results,investigation:true,overviewRestored:true,repeatedModeSwitches:20,pageErrors:0}));
 }finally{await browser.close()}
})().catch(error=>{console.error(error.message);process.exitCode=1});
