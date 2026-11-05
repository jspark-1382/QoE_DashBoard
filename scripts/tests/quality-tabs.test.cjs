const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('main route renders current quality overview, while original remains under view=overview',()=>{
 const source=read('app/page.tsx');
 assert.match(source,/await searchParams/);
 assert.match(source,/view === 'overview' \|\| view === 'contract'/);
 assert.match(source,/return <AnalystDashboard \/>/);
 assert.match(source,/return <QualityProposalFour \/>/);
 assert(read('app/overview-proposal-4/page.tsx').includes('<QualityProposalFour />'),
   'keep older bookmarks accessible as an alias');
});
test('all active navigation bars use quality overview, legacy, customer and MOS tabs',()=>{
 const fresh=read('components/analyst/quality-proposal-four.tsx');
 const legacy=read('components/analyst/analyst-dashboard.tsx');
 const secondary=read('components/analyst/improved-quality-overview.tsx');
 const mos=read('components/analyst/mos-lab.tsx');
 const top=read('components/analyst/quality-top-nav.tsx');
 for(const item of [fresh,legacy,secondary,mos]){
   assert(item.includes('QualityTopNav'), 'all main views must share the same top nav');
   for(const n of [1,2,3])
     assert(!item.includes('href="/overview-proposal-'+n+'"'),'retired tab must be absent');
 }
 const order=['품질 현황','고객·통화 분석','MOS 알고리즘 비교','기존안'];
 const positions=order.map(label=>top.indexOf('>'+label));
 assert(positions.every(x=>x>=0),'shared tabs have all requested labels');
 assert(positions.every((x,i)=>i===0||positions[i-1]<x),'legacy must be after MOS');
 assert(fresh.includes('<QualityTopNav active="quality" date={date}/>'));
 assert(legacy.includes('resolved.view === \'overview\' ? \'legacy\' : \'contract\''));
 assert(mos.includes('active="mos"'));
 assert(legacy.includes('<h1>기존안 · 품질 현황</h1>'));
 assert(fresh.includes('aria-label="분석 시작일"'));
 assert(fresh.includes('aria-label="분석 종료일"'));
 assert(legacy.includes('onAnalyze={(call)'));
});
test('proposal 1/2/3 routes and their exclusive implementation are absent',()=>{
 for(const n of [1,2,3])
   assert(!fs.existsSync(path.join(root,'app/overview-proposal-'+n+'/page.tsx')));
 for(const file of ['components/analyst/quality-proposals.tsx','components/analyst/quality-proposals.module.css'])
   assert(!fs.existsSync(path.join(root,file)));
 assert(fs.existsSync(path.join(root,'components/analyst/quality-overview.tsx')));
 assert(fs.existsSync(path.join(root,'app/overview-proposal-4/page.tsx')));
});
test('original CDR, GNSS and MOS schemas are not touched by tab changes',()=>{
 const source=JSON.parse(read('public/voice-1030.json'));
 assert.deepEqual(source.meta.dates,['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30']);
 assert.equal(source.meta.revision,'557c39d2c6a9a5b4c69b');
 const day=JSON.parse(read('public/analyst-overview/MDT/2026-10-30.json'));
 assert.equal(day.calls.length,37731);
 assert.equal(day.callLocations.filter(p=>p.evidence==='gnss').length,116);
});
