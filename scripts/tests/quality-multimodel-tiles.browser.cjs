const assert=require('node:assert/strict');
const {chromium}=require(process.argv[2]||'playwright');
(async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});
 try{
  const p=await b.newPage({viewport:{width:1440,height:980}});
  const statuses=[],errors=[];
  p.on('response',r=>{if(r.url().includes('api.vworld.kr'))statuses.push(r.status());});
  p.on('pageerror',e=>errors.push(e.message));
  await p.goto((process.argv[3]||'http://127.0.0.1:3019/qoe')+'/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement');
  await p.getByRole('combobox',{name:'조사 후보 알고리즘'}).waitFor({timeout:90000});
  for(const model of ['dbscan','hdbscan','adaptive_kde','spatial_scan']){
   await p.getByRole('combobox',{name:'조사 후보 알고리즘'}).selectOption(model);
   await p.getByLabel('개선 후보 지도').first().locator('.leaflet-container').waitFor({timeout:15000});
   await p.waitForTimeout(4500);
   const data=await p.getByLabel('개선 후보 지도').first().evaluate(el=>{
    const tiles=[...el.querySelectorAll('img.leaflet-tile')];return {count:tiles.length,loaded:tiles.filter(x=>x.complete&&x.naturalWidth>0).length,failed:tiles.filter(x=>x.complete&&x.naturalWidth===0).length,warning:el.querySelector('output')?.textContent??null};
   });
   console.log(JSON.stringify({model,data,vworldStatuses:{count:statuses.length,unique:[...new Set(statuses)]}}));
   assert(data.loaded>0,'VWorld map tiles unavailable for '+model);
   assert(!data.warning,'VWorld warning for '+model+': '+data.warning);
  }
  assert.deepEqual(errors,[]);
 }finally{await b.close();}
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
