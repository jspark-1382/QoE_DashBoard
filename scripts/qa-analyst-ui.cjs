// Real-data, local browser acceptance checks. Pass bundled Playwright directory as argv[2].
const {chromium}=require(process.argv[2]||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base=process.argv[3]||'http://localhost:3001/qoe/';
const output='outputs/analyst-ui/browser';fs.mkdirSync(output,{recursive:true});
const manifest=JSON.parse(fs.readFileSync('public/mdt-data.json','utf8'));
const rich=manifest.customers.reduce((best,c)=>(c.gnssSampleCount??0)>(best?.gnssSampleCount??-1)?c:best,null);
const detailFor=id=>{const entry=manifest.days.find(d=>d.customerId===id);return {entry,day:JSON.parse(fs.readFileSync(path.join('public',entry.dataPath),'utf8'))};};
const missingEntry=manifest.days.find(d=>d.sampleCount===0);
(async()=>{let browser;const errors=[],requests=[];
 try{
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1920,height:1080}});
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/mdt-data/'))requests.push(r.url());});
 await page.goto(base+'?source=MDT',{waitUntil:'domcontentloaded',timeout:90000});
 await page.getByLabel('전체 분석 요약').waitFor({timeout:60000});
  fs.writeFileSync(output+'/fonts.json',JSON.stringify(await page.getByLabel('전체 분석 요약').evaluate(el=>({font:getComputedStyle(el).fontFamily,body:getComputedStyle(document.body).fontFamily})),null,2));
 const summary=await page.getByLabel('전체 분석 요약').innerText();assert(summary.includes('25,548'));assert(summary.includes('23,085'));assert(summary.includes('2,583'));assert(summary.includes('2,463'));
 assert.equal(requests.length,0,'Overview requests no individual customer partitions');
 await page.locator('.leaflet-container').waitFor();
 await page.screenshot({path:output+'/overview-1920.png',fullPage:true});
 const region=page.getByLabel('조사할 구역 순위');await region.getByRole('button').first().click();
 await page.waitForFunction(()=>new URL(location.href).searchParams.has('cell'));
 const chosenGrid=new URL(page.url()).searchParams.get('cell');
 const list=page.getByLabel('조사 통화 목록');assert((await list.innerText()).includes('선택 구역의 통화'));
 await list.getByRole('button',{name:/통화 분석$/}).first().click();
 await page.getByLabel('선택 통화 무선 시간축').waitFor({timeout:30000});
 const detailUrl=new URL(page.url());assert.equal(detailUrl.searchParams.get('view'),'contract');assert(detailUrl.searchParams.get('call'));assert.equal(detailUrl.searchParams.get('cell'),chosenGrid);
 await page.getByRole('button',{name:'품질 현황으로 돌아가기',exact:true}).click();
 await page.getByLabel('전체 분석 요약').waitFor();assert.equal(new URL(page.url()).searchParams.get('cell'),chosenGrid);
 const hour=page.getByRole('button',{name:/14시 저품질/});await hour.click();
 assert.equal(await page.getByLabel('전체 분석 요약').innerText(),summary,'Investigation does not redefine global totals');
 assert.equal(new URL(page.url()).searchParams.get('hour'),'14');
 await page.getByLabel('전체 분석 요약').getByRole('button',{name:/위치 없는 저품질/}).click();
 assert.equal(new URL(page.url()).searchParams.get('missing'),'1');assert.equal(new URL(page.url()).searchParams.get('cell'),null);
 await page.setViewportSize({width:1366,height:768});await page.screenshot({path:output+'/overview-1366.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Overview no horizontal overflow');
 // Contract search does not switch target until the exact result is selected.
 await page.setViewportSize({width:1920,height:1080});const search=page.getByRole('combobox',{name:'서비스 계약번호 검색'});
 const before=new URL(page.url()).searchParams.get('view');await search.fill(rich.sourceContractId);await page.getByRole('option').filter({hasText:rich.sourceContractId}).waitFor();
 assert.equal(new URL(page.url()).searchParams.get('view'),before);
 await page.getByRole('option').filter({hasText:rich.sourceContractId}).click();
 await page.getByLabel('선택 통화 무선 시간축').waitFor({timeout:30000});
 const r=detailFor(rich.id),events=r.day.samples.map((raw,index)=>({raw,index})).filter(({raw})=>raw[21].inCallWindow!==false);
 assert.equal(new URL(page.url()).searchParams.get('customer'),rich.id);assert((await page.locator('body').innerText()).includes(rich.sourceContractId));
 await page.locator('[aria-label^="GNSS 관측"]').first().waitFor({timeout:30000});
 await page.getByText('위치 근거',{exact:true}).click();
 assert((await page.locator('body').innerText()).includes('정확도 정보 없음'));
 const range=page.getByRole('slider',{name:'관측 시점 선택'});await range.press('End');
 await page.waitForFunction(index=>new URL(location.href).searchParams.get('sample')===String(index),events.at(-1).index);
 const callBefore=new URL(page.url()).searchParams.get('call'),rendererBefore=await page.locator('.leaflet-overlay-pane > svg, .leaflet-overlay-pane > canvas').count();
 for(let i=0;i<12;i++)await range.press('ArrowLeft');
 assert.equal(new URL(page.url()).searchParams.get('call'),callBefore);
 const rendererAfter=await page.locator('.leaflet-overlay-pane > svg, .leaflet-overlay-pane > canvas').count();assert(rendererAfter<=rendererBefore+1,'Selection does not accumulate Leaflet renderers');
 await page.screenshot({path:output+'/contract-1920.png',fullPage:true});
 await page.setViewportSize({width:1366,height:768});await page.screenshot({path:output+'/contract-1366.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 // A delayed prior customer must not replace a subsequently selected cached customer.
 const slower=manifest.customers.find(c=>c.id!==rich.id&&!requests.some(url=>url.includes(manifest.days.find(d=>d.customerId===c.id).dataPath)));
 const slowerDetail=detailFor(slower.id);let began;const slowStarted=new Promise(resolve=>{began=resolve;});
 await page.route('**/'+slowerDetail.entry.dataPath,async route=>{began();await new Promise(resolve=>setTimeout(resolve,450));try{await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(slowerDetail.day)});}catch{ /* Request cancellation is expected. */ }});
 await search.fill(slower.sourceContractId);await page.getByRole('option').filter({hasText:slower.sourceContractId}).click();await slowStarted;
 await search.fill(rich.sourceContractId);await page.getByRole('option').filter({hasText:rich.sourceContractId}).click();await page.getByLabel('선택 통화 무선 시간축').waitFor();
 await page.waitForTimeout(600);assert.equal(new URL(page.url()).searchParams.get('customer'),rich.id);assert((await page.locator('body').innerText()).includes(rich.sourceContractId));
 // Independent no-event calls are still visible and selectable.
 await page.goto(base+`?source=MDT&customer=${missingEntry.customerId}&date=${missingEntry.date}`,{waitUntil:'domcontentloaded'});
 await page.getByLabel('선택 통화 무선 시간축').waitFor({timeout:30000});assert((await page.locator('body').textContent()).includes('평가 불가'));assert((await page.locator('body').textContent()).includes('관측 이벤트가 없습니다'));
 await page.screenshot({path:output+'/no-event-call.png',fullPage:true});
 // Measured inline source is still usable; no nonexistent MOS/GNSS provenance is invented.
 await page.getByLabel('데이터 출처',{exact:true}).selectOption('실측');await page.getByLabel('전체 분석 요약').waitFor();
 const measured=JSON.parse(fs.readFileSync('public/executive-data.json','utf8')),customer=measured.customers[0];
 await page.getByRole('combobox',{name:'계약번호 / 고객 검색'}).fill(customer.displayName);await page.getByRole('option').filter({hasText:customer.displayName}).first().click();
 await page.getByLabel('선택 통화 무선 시간축').waitFor();assert((await page.locator('body').textContent()).replace(/\s/g,'').includes('GNSS확보율미제공'));
 await page.screenshot({path:output+'/measured-1366.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({browserErrors:errors,overviewWithoutPartitionRequests:true,globalDenominator:true,regionToCallAndBack:true,hourInvestigation:true,missingLocationList:true,originalContractSearch:true,gnssEvidence:true,sampleSelection:true,rendererStable:true,lateCustomerResponseGuard:true,noEventCall:true,measuredRegression:true,desktopFits:true,partitionRequests:requests.length}));
 }finally{await browser?.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
