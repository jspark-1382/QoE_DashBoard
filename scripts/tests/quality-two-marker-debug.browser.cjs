const {chromium}=require(process.argv[2]||'playwright');
(async()=>{
const b=await chromium.launch({channel:'msedge',headless:true});
try{const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto('http://127.0.0.1:3019/qoe/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&mapMode=improvement');
await p.getByRole('region',{name:'조사 후보 지역 목록'}).getByRole('button',{name:/후보 지역 1/}).waitFor({timeout:90000});
await p.getByRole('button',{name:'지도 전체 화면'}).click();
const dialog=p.getByRole('dialog',{name:'개선 2안 조사 후보 지도'});
const map=dialog.getByLabel('개선 후보 지도');
await map.locator('.leaflet-interactive').first().waitFor();
const el=map.locator('path.leaflet-interactive[fill="#8fa4b3"]');
console.log('GREY',await el.count());
for(let i=0;i<Math.min(await el.count(),8);i++){
 const m=el.nth(i);
 const rect=await m.boundingBox();
 const before=await p.getByLabel('현재 선택 후보 알고리즘 적용 예시').locator('h4').innerText();
 try{await m.click({timeout:5000});await p.waitForTimeout(500);}catch(e){console.log('CLICK ERROR',i,e.message.slice(0,300));}
 const after=await p.getByLabel('현재 선택 후보 알고리즘 적용 예시').locator('h4').innerText();
 console.log('CLICK',i,rect,before,'->',after);
}
}finally{await b.close();}
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
