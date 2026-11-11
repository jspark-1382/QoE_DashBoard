const {effectiveCallQoe}=require('../analyst-ts-loader.cjs').load('lib/analyst/derived-qoe.ts');
/* Source-backed range selection and cross-day GNSS/3-site integrity tests. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
const {datesInRange,adjustDateRange,combineDateOverviews,dateOfCall}
  =load('lib/analyst/date-range.ts');
const {parseSelection,resolveSelection,selectionQuery}=load('lib/analyst/selection.ts');
const {calculateProposalGrades}=load('lib/analyst/quality-proposal-metrics.ts');
const {overlayThreeSiteRough}=load('lib/analyst/three-site-rough.ts');
const days=['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30'];
const path=date=>'public/analyst-overview/MDT/'+date+'.json';
const data={};
const getDate=(date)=>data[date]??(data[date]=JSON.parse(fs.readFileSync(path(date),'utf8')));
test('range includes every available day without a duration cap and never bridges missing dates',()=>{
 assert.deepEqual(datesInRange(days,'2026-10-28','2026-10-30'),days.slice(2));
 assert.deepEqual(datesInRange(days,'2026-10-26','2026-10-30'),days);
 const month=Array.from({length:30},(_,index)=>'2026-10-'+String(index+1).padStart(2,'0'));
 assert.deepEqual(datesInRange(month,month[0],month.at(-1)),month);
 assert.deepEqual(datesInRange(days,'2026-10-30','2026-10-29'),[]);
 assert.deepEqual(datesInRange(days,'2026-10-25','2026-10-30'),[]);
 assert.deepEqual(datesInRange(['2026-10-26','2026-10-28'],'2026-10-26','2026-10-28'),[]);
 assert.deepEqual(adjustDateRange(days,'2026-10-30','2026-10-30','start','2026-10-26'),
   {start:'2026-10-26',end:'2026-10-30'});
 assert.deepEqual(adjustDateRange(days,'2026-10-26','2026-10-26','end','2026-10-30'),
   {start:'2026-10-26',end:'2026-10-30'});
 assert.deepEqual(adjustDateRange(days,'2026-10-26','2026-10-28','start','2026-10-30'),
   {start:'2026-10-30',end:'2026-10-30'});
 assert.deepEqual(adjustDateRange(days,'2026-10-28','2026-10-30','end','2026-10-26'),
   {start:'2026-10-26',end:'2026-10-26'});
});
test('selection URL preserves full range, rejects invalid endpoints and keeps exact call date',()=>{
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
 const fullRange=resolveSelection({...parsed,dateStart:'2026-10-26',dateEnd:'2026-10-30'},source);
 assert.equal(fullRange.date,'2026-10-30');
 assert.equal(fullRange.dateStart,'2026-10-26');
 assert.equal(fullRange.dateEnd,'2026-10-30');
 const invalid=resolveSelection({...parsed,dateStart:'2026-10-25',dateEnd:'2026-10-30'},source);
 assert.equal(invalid.dateStart,undefined);
 assert.equal(invalid.dateEnd,undefined);
});
test('all five source dates combine with original call IDs, MOS and positions intact',()=>{
 const sourceDays=days.map(getDate);
 const originalCalls=sourceDays.flatMap(day=>day.calls.map(call=>[call.id,call.mos,call.startTimestamp]));
 const originalPositions=sourceDays.flatMap(day=>day.callLocations??[]);
 const positionSnapshot=JSON.stringify(originalPositions);
 const result=combineDateOverviews(sourceDays);
 assert.equal(result.date,'2026-10-26 ~ 2026-10-30');
 assert.equal(result.calls.length,184232);
 assert.equal(new Set(result.calls.map(call=>call.id)).size,184232);
 assert.deepEqual(result.calls.map(call=>[call.id,call.mos,call.startTimestamp]),originalCalls);
 assert.equal(JSON.stringify(result.callLocations),positionSnapshot);
 assert.equal(JSON.stringify(sourceDays.flatMap(day=>day.callLocations??[])),positionSnapshot);
 const grades=calculateProposalGrades(result,'00:00','23:59');
 assert.equal(grades.evaluated+grades.unavailable,184232);
 assert.equal(grades.bands[0].count,sourceDays.reduce((n,day)=>n+
  day.calls.filter(call=>effectiveCallQoe(call)!==null&&effectiveCallQoe(call)<3).length,0));
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
 const manualPoor=sourceDays.reduce((n,d)=>n+d.calls.filter(c=>effectiveCallQoe(c)!==null&&effectiveCallQoe(c)<3).length,0);
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
