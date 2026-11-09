/* Verify executive-request red framing in improvement2 only, against real browser. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.argv[2]||'playwright');
const base=(process.argv[3]||'http://127.0.0.1:3019/qoe').replace(/\/$/,'');
const out='outputs/quality-improvement-two-deploy/red-border-qa';
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1080}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const outline=async(selector)=>await page.locator(selector).first().evaluate(el=>({width:getComputedStyle(el).outlineWidth,style:getComputedStyle(el).outlineStyle,color:getComputedStyle(el).outlineColor}));
  const border=async(selector)=>await page.locator(selector).first().evaluate(el=>({width:getComputedStyle(el).borderTopWidth,color:getComputedStyle(el).borderTopColor}));
  const old=[];
  for(const variant of ['current','improvement1']){
   await page.goto(base+'/?variant='+variant+'&dateStart=2026-10-30&dateEnd=2026-10-30',{waitUntil:'domcontentloaded'});
   await page.getByLabel('주요 MOS 품질 지표').waitFor({timeout:90000});
   const r=await outline('[aria-label="주요 MOS 품질 지표"]');
   assert.notEqual(r.style,'solid','Old quality variants must not receive red outline');
   old.push({variant,outline:r});
  }
  await page.goto(base+'/?variant=improvement2&dateStart=2026-10-30&dateEnd=2026-10-30',{waitUntil:'domcontentloaded'});
  await page.getByLabel('주요 MOS 품질 지표').waitFor({timeout:90000});
  await page.getByLabel('개선 2안 단계별 데이터 활용률').waitFor({timeout:90000});
  const kpi=await outline('[aria-label="주요 MOS 품질 지표"]');
  const chart=await outline('[data-request-label="본부장 요구 · 품질/시간/고객"]');
  const map=await outline('[data-request-label="본부장 요구 · 저품질 위치 지도"]');
  const collection=await border('[aria-label="개선 2안 단계별 데이터 활용률"]');
  const roadmap=await border('[data-request-label="본부장 요구 · 고도화 로드맵"]');
  for(const v of [kpi,chart,map,collection,roadmap]){assert.equal(v.width,'3px');if('style' in v)assert.equal(v.style,'solid');assert(v.color.startsWith('rgb(225, 38, 54)'));}
  await page.screenshot({path:out+'/overview.png',fullPage:true});
  await page.goto(base+'/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement',{waitUntil:'domcontentloaded'});
  await page.getByLabel('선택 개선 후보 상세 근거').waitFor({timeout:90000});
  await page.getByLabel('후보별 고객 통화 및 반복 검증').waitFor({timeout:90000});
  await page.getByLabel('개선 2안 후보 선정 근거와 전후 비교').waitFor({timeout:90000});
  const candidateMap=await outline('[data-request-label="본부장 요구 · GNSS/3-Site 후보 지도"]');
  const audit=await border('[aria-label="개선 2안 후보 선정 근거와 전후 비교"]');
  const customer=await border('[aria-label="후보별 고객 통화 및 반복 검증"]');
  for(const v of [candidateMap,audit,customer]){assert.equal(v.width,'3px');if('style' in v)assert.equal(v.style,'solid');assert(v.color.startsWith('rgb(225, 38, 54)'));}
  await page.screenshot({path:out+'/candidates.png',fullPage:true});
  await page.setViewportSize({width:680,height:980});
  await page.screenshot({path:out+'/candidates-680.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({old,kpi,chart,map,collection,roadmap,candidateMap,audit,customer,pageErrors:errors.length,screenshots:3}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
