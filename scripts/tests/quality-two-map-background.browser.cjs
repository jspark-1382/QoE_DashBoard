const assert=require('node:assert/strict');
const {chromium}=require(process.argv[2]||'playwright');
const root=(process.argv[3]||'http://127.0.0.1:3019/qoe').replace(/\/$/,'');
const url=root+'/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement';
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:950}});
  const errors=[];const tileStatus=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{try{if(new URL(r.url()).hostname==='api.vworld.kr')tileStatus.push(r.status());}catch{}});
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.getByRole('region',{name:'조사 후보 지역 목록'}).getByRole('button',{name:/후보 지역 1/}).waitFor({timeout:90000});
  const m=page.getByLabel('개선 후보 지도').first();
  await m.locator('.leaflet-container').waitFor({timeout:30000});
  await page.waitForTimeout(6000);
  const take=async(label)=>{
    const state=await m.evaluate(el=>{
     const imgs=[...el.querySelectorAll('img.leaflet-tile')];
     return {tileElements:imgs.length,loaded:imgs.filter(x=>x.complete&&x.naturalWidth>0).length,failed:imgs.filter(x=>x.complete&&x.naturalWidth===0).length,notice:el.querySelector('output')?.textContent??null,markers:el.querySelectorAll('path.leaflet-interactive').length};
    });
    console.log(JSON.stringify({label,...state,vworldTileResponses:tileStatus.length,responseClasses:[...new Set(tileStatus)],pageErrors:errors}));
    return state;
  };
  const before=await take('normal');
  await page.getByRole('button',{name:'지도 전체 화면'}).click();
  await page.waitForTimeout(3000);
  const after=await take('fullscreen');
  if(process.argv[4])await page.screenshot({path:process.argv[4],fullPage:false});
  assert(before.loaded>0&&after.loaded>0,'VWorld background tiles must be loaded in normal and fullscreen views');
  assert(!before.notice&&!after.notice,'Background map must not show tile warning');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({pass:true,normalTiles:before.loaded,fullscreenTiles:after.loaded,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
