// Historical source assertions use the preserved original cohort; current sources have a separate census test.
const {historicalRead,historicalJson,skipHistoricalSource}=require('./published-fixture.cjs');
if(skipHistoricalSource(__filename))return;
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {load}=require('../analyst-ts-loader.cjs');
const {normalizeDay}=load('lib/analyst/data.ts');
const {formatMdtObservation}=load('lib/analyst/mdt-observation.ts');
const PUBLIC=path.resolve('public');
test('October 30 actual source tagged MDT samples and CDR end support observation status, without cross-call bleed',()=>{
 const manifest=JSON.parse(historicalRead(path.join(PUBLIC,'voice-1030.json'),'utf8'));
 let verified=0,missing=0,results=[];
 for(const entry of manifest.days){
  if(entry.date!=='2026-10-30'||!entry.sampleCount||!entry.dataPath)continue;
  const detail=JSON.parse(historicalRead(path.join(PUBLIC,entry.dataPath),'utf8'));
  const has=detail.calls.some(c=>c.matchStatus==='MATCHED'&&detail.samples.some(r=>r[19]===c.id));
  if(!has)continue;
  const day=normalizeDay(manifest,detail,'MDT');
  for(const call of day.calls){
   const original=detail.calls.find(x=>x.id===call.id);
   const tagged=detail.samples.filter(r=>r[19]===call.id);
   const summary=call.mdtObservation;
   assert.equal(summary.taggedRows,tagged.length);
   assert(summary.timestampedRows<=summary.taggedRows);
   assert(summary.endBefore60Rows+summary.endAfter60Rows<=summary.timestampedRows);
   assert(summary.duringCallRows<=summary.timestampedRows);
   const display=formatMdtObservation(summary,call.matchStatus);
   if(tagged.length){
    verified++;
    assert.notEqual(display.headline,'해당 통화 MDT 없음');
    if(results.length<4)results.push({callStart:call.start,callEnd:call.end,status:display.headline,
      nearest:display.timeDetail,taggedRows:tagged.length});
   }else{
    missing++;
    if(call.matchStatus==='AMBIGUOUS')assert.equal(display.headline,'통화별 MDT 구분 불가');
    else assert.equal(display.headline,'해당 통화 MDT 없음');
   }
  }
  if(verified>=5&&missing>=1)break;
 }
 assert(verified>=5, 'must evaluate five real source-linked calls');
 console.log('REAL_MDT_EXAMPLES',JSON.stringify({verified,missing,examples:results}));
});
