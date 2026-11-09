/* Browser QA for improvement 2. Usage: node scripts/tests/quality-improvement-two.browser.cjs <playwright-module-path> <base-url> */
const {chromium}=require(process.argv[2]||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base=(process.argv[3]||'http://127.0.0.1:3018/qoe').replace(/\/$/,'');
fs.mkdirSync('outputs/quality-improvement-two-qa',{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const results=[],errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1120}});
  page.on('pageerror',e=>errors.push(e.message));
  for(const variant of ['current','improvement1','improvement2']){
   await page.goto(base+'/?variant='+variant+'&dateStart=2026-10-30&dateEnd=2026-10-30',{waitUntil:'domcontentloaded'});
   await page.locator('[aria-label="주요 MOS 품질 지표"]').waitFor({timeout:75000});
   const kpis=await page.locator('[aria-label="주요 MOS 품질 지표"] strong').allTextContents();
   assert(kpis.length>=4,'KPI numeric values must be rendered');
   results.push({variant,kpis});
   if(variant==='improvement2'){
    await page.locator('[aria-label="개선 2안 단계별 데이터 활용률"]').waitFor();
    await page.screenshot({path:'outputs/quality-improvement-two-qa/overview-1440.png',fullPage:true});
   }
  }
  assert.deepEqual(results[0].kpis,results[1].kpis,'current vs improvement1');
  assert.deepEqual(results[0].kpis,results[2].kpis,'current vs improvement2');
  await page.goto(base+'/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement',{waitUntil:'domcontentloaded'});
  await page.getByRole('region',{name:'개선 후보 분석',exact:true}).waitFor({timeout:90000});
  await page.getByLabel('선택 개선 후보 상세 근거').waitFor({timeout:90000});
  await page.getByLabel('개선 2안 후보 선정 근거와 전후 비교').waitFor({timeout:90000});
  await page.getByLabel('후보별 고객 통화 및 반복 검증').waitFor({timeout:90000});
  assert(await page.getByText('개선 2안 · 엄격 위치 검토').isVisible());
  assert(await page.getByText('기존 분석 (위치 + Cell) · 동일 5일').isVisible());
  assert(await page.getByRole('button',{name:'관련 통화·고객을 아래 통화 목록에서 조사'}).isVisible());
  await page.screenshot({path:'outputs/quality-improvement-two-qa/candidates-1440.png',fullPage:true});
  await page.getByRole('button',{name:'관련 통화·고객을 아래 통화 목록에서 조사'}).click();
  await page.getByRole('button',{name:'관련 고객 전체 통화',exact:true}).click();
  assert(await page.locator('#qoe-proposal-four-calls').count());
  await page.setViewportSize({width:680,height:1000});
  await page.screenshot({path:'outputs/quality-improvement-two-qa/candidate-680.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({results,candidates:true,customerInvestigation:true,pageErrors:errors.length}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
