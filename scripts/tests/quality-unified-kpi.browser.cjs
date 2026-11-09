const assert=require('node:assert/strict');
const {chromium}=require(process.argv[2]||'playwright');
const origin=(process.argv[3]||'http://127.0.0.1:3019/qoe').replace(/\/$/,'');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const collected=[];
  for(const variant of ['current','improvement1','improvement2']){
   await page.goto(origin+'/?variant='+variant+'&dateStart=2026-10-30&dateEnd=2026-10-30&mapMode=current',{waitUntil:'domcontentloaded'});
   const box=page.getByLabel('주요 MOS 품질 지표');
   await box.waitFor({timeout:90000});
   const metrics=await box.locator('strong').allTextContents();
   collected.push({variant,metrics});
  }
  assert.deepEqual(collected[0].metrics,collected[1].metrics);
  assert.deepEqual(collected[0].metrics,collected[2].metrics);
  assert.equal(collected[0].metrics[0],'37,731건');
  assert.equal(collected[0].metrics[3],'288건');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({pass:true,variants:collected,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
