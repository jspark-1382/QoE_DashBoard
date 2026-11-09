/* Full browser QA for redesigned Improvement 2. Script runs on temporary 3019 and live 3016. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.argv[2]||'playwright');
const root=(process.argv[3]||'http://127.0.0.1:3019/qoe').replace(/\/$/,'');
const out=process.argv[4]||'outputs/quality-improvement-two-deploy/usability-qa';
fs.mkdirSync(out,{recursive:true});
const candidateQuery='/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement';
const oneDayQuery=variant=>'/?variant='+variant+'&dateStart=2026-10-30&dateEnd=2026-10-30&mapMode=current';
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const result={};const errors=[];
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1050}});
 page.on('pageerror',e=>errors.push(e.message));
 const region=page.getByRole('region',{name:'개선 2안 조사 후보 분석'});
 await page.goto(root+candidateQuery,{waitUntil:'domcontentloaded'});
 await region.waitFor({timeout:90000});
 const list=page.getByRole('region',{name:'조사 후보 지역 목록'});
 await list.getByRole('button',{name:/후보 지역 1/}).waitFor({timeout:90000});
 await page.getByRole('region',{name:'선택 후보 지역 요약'}).waitFor();
 await page.getByLabel('선택 후보 고객 통화 근거').waitFor({timeout:90000});
 const rows=list.getByRole('button');
 assert.equal(await rows.count(),7);
 const selected=page.getByRole('region',{name:'선택 후보 지역 요약'});
 const firstText=await selected.innerText();
 assert(firstText.includes('후보 지역 1'),firstText);
 assert(firstText.includes('서로 다른 고객')&&firstText.includes('5명'));
 assert(firstText.includes('저MOS 통화')&&firstText.includes('5건'));
 assert(firstText.includes('관측된 날짜')&&firstText.includes('3일'));
 assert(firstText.includes('범위 검토 필요'));
 const customers=page.getByLabel('선택 후보 고객 통화 근거');
 assert((await customers.innerText()).includes('같은 고객의 지역 내 저MOS 2회 이상'));
 assert((await customers.innerText()).includes('0명'));
 const names=await customers.locator('details').count();
 assert.equal(names,7,'5 discovery customers plus 2 new verification customers');
 const firstCustomer=customers.locator('details').first();await firstCustomer.locator('summary').click();
 assert(await firstCustomer.getByText(/선정 근거|검증일 관측/).count()>0);
 // Selection must change right panel without reloading or showing stale detail.
 await rows.nth(1).click();
 await page.waitForFunction(()=>document.querySelector('[aria-label="선택 후보 지역 요약"]')?.textContent?.includes('후보 지역 2'),null,{timeout:12000});
 await page.waitForFunction(()=>document.querySelector('[aria-label="선택 후보 고객 통화 근거"]')?.textContent?.includes('고객 A'),null,{timeout:12000});
 assert.equal(await rows.nth(1).getAttribute('aria-pressed'),'true');
 assert.equal(await rows.first().getAttribute('aria-pressed'),'false');
 // Selected map must draw a highlighted circle marker and allow wheel handling.
 const map=page.getByLabel('개선 후보 지도');
 await map.locator('.leaflet-container').waitFor({timeout:30000});
 assert((await map.locator('.leaflet-interactive').count())>=7,'candidate markers should exist');
 const mapStyle=await map.locator('.leaflet-container').evaluate(el=>getComputedStyle(el).pointerEvents);
 assert.notEqual(mapStyle,'none');
 await map.locator('.leaflet-container').hover();
 await page.mouse.wheel(0,-450);
 await page.waitForTimeout(500);
 await page.getByRole('button',{name:'지도 전체 화면'}).click();
 await page.getByRole('dialog',{name:'개선 2안 조사 후보 지도'}).waitFor({timeout:12000});
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'지도 전체 화면'}).waitFor({timeout:12000});
 await rows.last().click();
 await page.waitForFunction(()=>document.querySelector('[aria-label="선택 후보 지역 요약"]')?.textContent?.includes('후보 지역 7'),null,{timeout:12000});
 // The report header and its emphasis toggle have been intentionally removed.
 const shell=page.locator('[data-review-mode]').first();
 assert.equal(await shell.getAttribute('data-review-mode'),'off');
 assert.equal(await page.getByRole('region',{name:'개선 2안 분석 안내'}).count(),0);
 assert.equal(await page.getByRole('button',{name:'본부장 요구 강조'}).count(),0);
 // Main investigation link must lead to existing call-list workflow.
 await page.getByRole('button',{name:/이 지역 통화 목록에서 자세히 보기/}).click();
 await page.locator('#qoe-proposal-four-calls').waitFor({timeout:20000});
 result.selection=true;
 // Candidate mode remains structurally valid across full HD, laptop, tablet and phone widths.
 const widths=[2560,1440,1280,1024,680,390];
 const layout=[];
 for(const width of widths){
  await page.setViewportSize({width,height:1050});
  await page.waitForTimeout(220);
  const dims=await page.evaluate(()=>{
   const workspace=document.querySelector('[aria-label="개선 2안 조사 후보 분석"]');
   const map=document.querySelector('[aria-label="개선 2안 조사 후보 지도"]');
   const inspect=document.querySelector('[aria-label="선택 지역 조사 내용"]');
   const list=document.querySelector('[aria-label="조사 후보 지역 목록"]');
   const selected=document.querySelector('[aria-label="선택 후보 지역 요약"]');
   if(!workspace||!map||!inspect||!list||!selected)return null;
   const box=e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height};};
   return {viewport:document.documentElement.clientWidth,pageScrollWidth:document.documentElement.scrollWidth,workspace:box(workspace),scrollWidth:workspace.scrollWidth,clientWidth:workspace.clientWidth,map:box(map),inspect:box(inspect),list:box(list),selected:box(selected)};
  });
  assert(dims,'Expected all candidate sections at '+width);
  assert(dims.scrollWidth<=dims.clientWidth+4,'workspace overflows horizontally at '+width+': '+JSON.stringify(dims));
  assert(dims.pageScrollWidth<=dims.viewport+4,'Page has horizontal overflow at '+width+': '+JSON.stringify(dims));
  assert(dims.list.width>=270&&dims.selected.width>=270,'side panel too narrow at '+width+': '+JSON.stringify(dims));
  const horizontallyDisjoint=dims.map.right+7<=dims.inspect.x;
  const verticallyDisjoint=dims.map.bottom+5<=dims.inspect.y;
  assert(horizontallyDisjoint||verticallyDisjoint,'Map and detail overlap '+width+': '+JSON.stringify(dims));
  layout.push({width,workspace:Math.round(dims.clientWidth),map:Math.round(dims.map.width),detail:Math.round(dims.inspect.width),orientation:horizontallyDisjoint?'side-by-side':'stacked'});
  if(width===1440||width===680||width===390){await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.waitForTimeout(220);await page.screenshot({path:out+'/candidate-'+width+'.png',fullPage:true});}
 }
 result.layout=layout;
 // Preserve existing KPI values across all variants. 
 const kpis=[];
 await page.setViewportSize({width:1440,height:1080});
 for(const variant of ['current','improvement1','improvement2']){
  await page.goto(root+oneDayQuery(variant),{waitUntil:'domcontentloaded'});
  await page.getByLabel('주요 MOS 품질 지표').waitFor({timeout:90000});
  kpis.push({variant,values:await page.getByLabel('주요 MOS 품질 지표').locator('strong').allTextContents()});
 }
 assert.deepEqual(kpis[0].values,kpis[1].values);
 assert.deepEqual(kpis[0].values,kpis[2].values);
 assert.equal(kpis[2].values[0],'37,731건');
 assert.equal(kpis[2].values[3],'288건');
 await page.screenshot({path:out+'/overview-1440.png',fullPage:true});
 result.kpis=kpis;
 result.errors=errors;
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify(result));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
