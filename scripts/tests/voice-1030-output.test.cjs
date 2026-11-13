// Numerical source regressions retain the original two-workbook cohort.
const {historicalRead,historicalJson,skipHistoricalSource}=require('./published-fixture.cjs');
if(skipHistoricalSource(__filename))return;
/* eslint-disable @typescript-eslint/no-require-imports */
// Validates the refreshed Oct 26-30 CDR/MDT source and all five daily summaries.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {load}=require('../analyst-ts-loader.cjs');
const {getOverviewAnalytics}=load('lib/analyst/overview-analytics.ts');
const root=path.resolve(__dirname,'../..');
const manifestPath=path.join(root,'public/voice-1030.json');
const auditPath=path.join(root,'outputs/voice-1030-quality-report.json');
const manifest=JSON.parse(historicalRead(manifestPath,'utf8'));
const audit=JSON.parse(historicalRead(auditPath,'utf8'));
const dates=['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30'];

assert.deepEqual(manifest.meta.dates,dates);
assert.deepEqual(manifest.meta.sourceFiles,[audit.cdrFile,audit.mdtFile]);
assert(manifest.meta.sourceFiles.every(file=>file.startsWith('261026_1030_')));
assert.equal(manifest.meta.qoeBasis,'rtcp-mos-v5');
assert.equal(manifest.meta.poorQoeThreshold,3);
assert.equal(manifest.meta.mosWarningThreshold,3.5);
assert.equal(manifest.meta.totalCalls,audit.sourceCdr.publishedCalls);
assert.equal(manifest.days.reduce((sum,d)=>sum+d.callCount,0),manifest.meta.totalCalls);
assert.equal(new Set(manifest.customers.map(c=>c.id)).size,manifest.customers.length,
  'one customer record across all available dates');
const byId=new Map(manifest.customers.map(customer=>[customer.id,customer]));
for(const day of manifest.days){
 assert(byId.has(day.customerId));
 assert(byId.get(day.customerId).dates.includes(day.date));
 assert(dates.includes(day.date));
}
const totals={poor:0,warning:0,good:0,missing:0};
const summaries={};
for(const date of dates){
 const output=path.join(root,'public/analyst-overview/MDT',date+'.json');
 assert(fs.existsSync(output),'missing daily overview '+date);
 const overview=JSON.parse(historicalRead(output,'utf8'));
 const dayEntries=manifest.days.filter(day=>day.date===date);
 assert.equal(overview.sourceRevision,manifest.meta.revision,'stale daily location revision '+date);
 assert.equal(overview.date,date);
 assert.equal(overview.source,'MDT');
 assert.equal(overview.calls.length,dayEntries.reduce((sum,entry)=>sum+entry.callCount,0));
 assert.equal(overview.administrativeMappingAudit.totalCdrCalls,overview.calls.length);
 assert.equal(overview.callLocations.length,overview.administrativeMappingAudit.locatedCalls);
 assert.equal(new Set(overview.callLocations.map(p=>p.callId)).size,overview.callLocations.length);
 assert(overview.calls.length>0);
 const local={poor:0,warning:0,good:0,missing:0};
 for(const call of overview.calls){
  assert.equal(call.mos,call.qoe,'MOS CDR original identity');
  if(call.mos===null||call.mos===undefined)local.missing++;
  else if(call.mos<3)local.poor++;
  else if(call.mos<3.5)local.warning++;
  else local.good++;
 }
 for(const key of Object.keys(totals))totals[key]+=local[key];
 const stats=getOverviewAnalytics(overview.calls,'mos',3);
 assert.equal(stats.evaluated,local.poor+local.warning+local.good);
 assert.equal(stats.bands.find(b=>b.id==='poor').count,local.poor);
 assert.equal(stats.bands.find(b=>b.id==='fair').count,local.warning);
 assert.equal(stats.bands.find(b=>b.id==='good').count,local.good);
 assert.equal(audit.sourceCdr['published_'+date],overview.calls.length);
 summaries[date]={calls:overview.calls.length,...local,positions:overview.callLocations.length};
}
assert.deepEqual(totals,{
 poor:audit.sourceCdr.poorMos,
 warning:audit.sourceCdr.warningMos,
 good:audit.sourceCdr.goodMos,
 missing:audit.sourceCdr.missingOrInvalidMos,
});
assert.equal(audit.matching.cdrMatched+audit.matching.cdrUnmatched+audit.matching.cdrAmbiguous,manifest.meta.totalCalls);
const example=manifest.days.find(day=>day.sampleCount>0);
assert(example);
const detail=JSON.parse(historicalRead(path.join(root,'public',example.dataPath),'utf8'));
assert(detail.calls.every(call=>call.mosV5Original===call.mos));
assert(detail.calls.every(call=>call.matchStatus));
assert(detail.calls.every(call=>call.rtp&&Object.hasOwn(call.rtp,'rxJitter')));
assert(detail.samples.every(sample=>sample[16]===detail.calls.find(call=>call.id===sample[19]).mos));
assert(detail.samples.every(sample=>sample[13]===null));
console.log('PASS multi-day Oct26-30 CDR MOS(v5), MDT joins, customer date consolidation, per-day SHP summaries',JSON.stringify(summaries));
