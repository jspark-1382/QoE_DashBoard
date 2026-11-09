const {chromium}=require(process.argv[2]||'playwright');
const fs=require('node:fs');
const origin=(process.argv[3]||'http://127.0.0.1:3019/qoe').replace(/\/$/,'');
const output=process.argv[4]||'outputs/quality-improvement-two-deploy/title-inline-qa';
fs.mkdirSync(output,{recursive:true});
const url=origin+'/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement';
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1600,height:920}});
 const problems=[];page.on('pageerror',e=>problems.push(e.message));
 await page.goto(url,{waitUntil:'domcontentloaded'});
 const selector=page.getByRole('combobox',{name:'조사 후보 알고리즘'});
 await selector.waitFor({timeout:90000});
 const all=[];
 for(const type of ['dbscan','hdbscan']){
  await selector.selectOption(type);
  for(const width of [1600,1369,1100,800,390]){
   await page.setViewportSize({width,height:920});
   const frame=page.getByLabel(type==='dbscan'?'개선 2안 조사 후보 지도':'대안 모델 조사 후보 지도');
   await frame.getByRole('button',{name:'지도 전체 화면'}).waitFor({timeout:35000});
   const normal=await frame.evaluate(el=>{
    const title=el.querySelector('[class*="mapTitleBlock"]');
    const controls=el.querySelector('[aria-label="개선 2안 분석 설정"]');
    const h=el.querySelector('[class*="mapHeading"],[class*="mapHead"]');
    const r=e=>{const x=e?.getBoundingClientRect();return x?{x:x.x,y:x.y,w:x.width,h:x.height,right:x.right,bottom:x.bottom}:null};
    return {title:r(title),controls:r(controls),header:r(h)};
   });
   if(width===1600&&type==='dbscan')await page.screenshot({path:output+'/normal-1600.png'});
   await frame.getByRole('button',{name:'지도 전체 화면'}).click();
   const dialog=page.locator(type==='dbscan'?'section[role="dialog"][aria-label="개선 2안 조사 후보 지도"]':'section[role="dialog"][aria-label="대안 모델 조사 후보 지도"]');
   await dialog.waitFor({timeout:20000});
   const full=await dialog.evaluate(el=>{
    const title=el.querySelector('[class*="railTitleRow"] h2,[class*="railTitleRow"] h3');
    const controls=el.querySelector('[aria-label="전체화면 분석 설정"]');
    const row=el.querySelector('[class*="railTitleRow"]');
    const map=el.querySelector('[aria-label="개선 후보 지도"]');
    const r=e=>{const x=e?.getBoundingClientRect();return x?{x:x.x,y:x.y,w:x.width,h:x.height,right:x.right,bottom:x.bottom}:null};
    return {title:r(title),controls:r(controls),row:r(row),map:r(map),scroll:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth};
   });
   if(type==='dbscan'&&[1600,1369,390].includes(width))await page.screenshot({path:output+'/dbscan-full-'+width+'.png'});
   all.push({type,width,normal,full});
   await page.keyboard.press('Escape');
  }
 }
 console.log(JSON.stringify({geometry:all,errors:problems}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
