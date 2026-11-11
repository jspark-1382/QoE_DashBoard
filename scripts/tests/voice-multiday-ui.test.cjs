/* Multi-day UI date scoping regression, run with refreshed source manifest. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const dates=['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30'];

test('five-day source is fully queryable without reusing another day, default latest',()=>{
 const source=JSON.parse(read('public/voice-1030.json'));
 assert.deepEqual(source.meta.dates,dates);
 const selected=read('lib/analyst/selection.ts');
 assert(selected.includes("dataset.meta.dates.at(-1)"));
 const overviewFiles=dates.map(date=>JSON.parse(read('public/analyst-overview/MDT/'+date+'.json')));
 for(let i=0;i<dates.length;i++){
  const day=overviewFiles[i];
  assert.equal(day.date,dates[i]);
  assert.equal(day.sourceRevision,source.meta.revision);
  assert(day.calls.length>30000);
  assert(day.callLocations.length>0);
  const keys=new Set(day.calls.map(call=>call.id));
  assert(day.callLocations.every(pos=>keys.has(pos.callId)));
 }
 const allIds=overviewFiles.flatMap(day=>day.calls.map(call=>call.id));
 assert.equal(new Set(allIds).size,allIds.length,'CDR call IDs must be unique across the five days');
});
test('proposal 4 supports a bounded date range while the other independent screens retain daily sources',()=>{
 const four=read('components/analyst/quality-proposal-four.tsx');
 const improved=read('components/analyst/improved-quality-overview.tsx');
 for(const screen of [improved]){
  assert(screen.includes('value={selectedDate}')||screen.includes('value={ctx.overview.date}'));
  assert(screen.includes('onChange='));
  assert(screen.includes("loadOverview(dataset,'MDT',selectedDate")||
         screen.includes("loadOverview(dataset,'MDT',date")||
         screen.includes("loadOverview(dataset, 'MDT', date"));
  assert(screen.includes('meta.dates'));
 }
 assert(four.includes('aria-label="분석 시작일"'));
 assert(four.includes('aria-label="분석 종료일"'));
 assert(four.includes("loadOverview(dataset,'MDT',day"));
 assert(four.includes('combineDateOverviews(summaries)'));
 assert(four.includes('datesInRange(dataset.meta.dates,startDate,selectedDate)'));
 assert(four.includes('setSelectedBand(null)'));
 assert(four.includes("focusKey={'proposal-four-'+startDate+'-'+selectedDate+'-'+customerFocusKey}"));
 assert(four.includes("link.download=`voice-${distributionMode==='drop'?'sip-drop':'mos'}-"));
 assert(four.includes('-'+String.fromCharCode(36)+'{startDate}_'+String.fromCharCode(36)+'{selectedDate}.csv'));
 assert(four.includes('aria-label="품질 현황 분석 조건"'));
});
