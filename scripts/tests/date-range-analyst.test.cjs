/* Source-backed range selection and cross-day GNSS/3-site integrity tests. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
const {datesInRange,adjustDateRange,combineDateOverviews,dateOfCall,MAX_ANALYSIS_DAYS}
  =load('lib/analyst/date-range.ts');
const {parseSelection,resolveSelection,selectionQuery}=load('lib/analyst/selection.ts');
const {calculateProposalGrades}=load('lib/analyst/quality-proposal-metrics.ts');
const {overlayThreeSiteRough}=load('lib/analyst/three-site-rough.ts');
const days=['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30'];
const path=date=>'public/analyst-overview/MDT/'+date+'.json';
const data={};
const getDate=(date)=>data[date]??(data[date]=JSON.parse(fs.readFileSync(path(date),'utf8')));
test('range is inclusive, max 3 calendar days and never silently bridges missing dates',()=>{
 assert.equal(MAX_ANALYSIS_DAYS,3);
 assert.deepEqual(datesInRange(days,'2026-10-28','2026-10-30'),days.slice(2));
 assert.deepEqual(datesInRange(days,'2026-10-26','2026-10-30'),[]);
 assert.deepEqual(datesInRange(days,'2026-10-30','2026-10-29'),[]);
 assert.deepEqual(datesInRange(['2026-10-26','2026-10-28'],'2026-10-26','2026-10-28'),[]);
 assert.deepEqual(adjustDateRange(days,'2026-10-30','2026-10-30','start','2026-10-26'),
   {start:'2026-10-26',end:'2026-10-28'});
 assert.deepEqual(adjustDateRange(days,'2026-10-26','2026-10-26','end','2026-10-30'),
   {start:'2026-10-28',end:'2026-10-30'});
});
test('selection URL preserves range, rejects oversized period and keeps exact call date',()=>{
 const source=JSON.parse(fs.readFileSync('public/voice-1030.json','utf8'));
 const demo=source.customers.find(x=>x.dates.includes('2026-10-30'));
 assert(demo,'required real customer with 10/30 partition');
 const parsed=parseSelection('?source=MDT&view=contract&date=2026-10-30'+
  '&dateStart=2026-10-28&dateEnd=2026-10-30&customer='+demo.id);
 const resolved=resolveSelection(parsed,source);
 assert.equal(resolved.date,'2026-10-30');
 assert.equal(resolved.dateStart,'2026-10-28');
 assert.equal(resolved.dateEnd,'2026-10-30');
 const query=selectionQuery(resolved);
 assert(query.includes('dateStart=2026-10-28'));
 assert(query.includes('dateEnd=2026-10-30'));
 const malicious=resolveSelection({...parsed,dateStart:'2026-10-26',dateEnd:'2026-10-30'},source);
 assert.equal(malicious.dateStart,undefined);
 assert.equal(malicious.dateEnd,undefined);
});
test('original 3 source dates combine exactly, with no duplicate CDR IDs or location reuse',()=>{
 const sourceDays=days.slice(2).map(getDate);
 const result=combineDateOverviews(sourceDays);
 const expectedCalls=sourceDays.reduce((n,x)=>n+x.calls.length,0);
 assert.equal(expectedCalls,109125);
 assert.equal(result.calls.length,expectedCalls);
 assert.equal(new Set(result.calls.map(x=>x.id)).size,expectedCalls);
 assert.equal(result.date,'2026-10-28 ~ 2026-10-30');
 assert.equal(result.callLocations.length,sourceDays.reduce((n,d)=>n+d.callLocations.length,0));
 const scores=calculateProposalGrades(result,'00:00','23:59');
 assert.equal(scores.evaluated+scores.unavailable,result.calls.length);
 const manualPoor=sourceDays.reduce((n,d)=>n+d.calls.filter(c=>typeof c.mos==='number'&&c.mos>=1&&c.mos<3).length,0);
 assert.equal(scores.bands[0].count,manualPoor);
 const key='mdt-524f3c774fc43ddfd7e85d18:call-b95550aca3de88ed98cfe568';
 const original=sourceDays[2].calls.find(c=>c.id===key);
 assert(original);
 assert.equal(dateOfCall(original,'2026-10-28'),'2026-10-30');
 const rawPositions=new Map(result.callLocations.map(p=>[p.callId,p]));
 const candidates=sourceDays.map(d=>JSON.parse(fs.readFileSync('public/three-site-rough/'+d.date+'.json','utf8')));
 const rough={...candidates[0],date:result.date,points:candidates.flatMap(c=>c.points)};
 const merged=overlayThreeSiteRough(result,rough,true);
 const changed=merged.callLocations.find(p=>p.callId===key);
 assert(changed&&changed.positionQuality==='three-site-rough');
 assert.equal(changed.modelUncertaintyM,null);
 assert.equal(changed.usedSiteCount,3);
 for(const [id,location] of rawPositions){
  if(location.evidence==='gnss')assert.deepEqual(merged.callLocations.find(p=>p.callId===id),location);
 }
});
test('invalid mixed-revision or duplicate cross-day calls are rejected',()=>{
 const a=getDate('2026-10-29'),b=getDate('2026-10-30');
 assert.throws(()=>combineDateOverviews([a,{...b,sourceRevision:'invalid'}]),/원본 버전/);
 assert.throws(()=>combineDateOverviews([a,{...b,calls:[a.calls[0],...b.calls.slice(0,1)]}]),/중복 Call ID/);
});
