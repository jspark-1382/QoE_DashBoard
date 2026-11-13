// Historical source assertions use the preserved original cohort; current sources have a separate census test.
const {historicalRead,historicalJson,skipHistoricalSource}=require('./published-fixture.cjs');
if(skipHistoricalSource(__filename))return;
/* eslint-disable @typescript-eslint/no-require-imports -- Uses the shared CJS test loader. */
/* Conservative publication policy: never confuse solver candidates with handset locations. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
const {reviewAdaptivePosition}=load('lib/location-estimation/review.ts');
const {normalizeDay}=load('lib/analyst/data.ts');
const prototypeSites=[
 {siteId:'S1',estimatedDistanceM:350,deltaTimeSec:1},
 {siteId:'S2',estimatedDistanceM:475,deltaTimeSec:-2},
 {siteId:'S3',estimatedDistanceM:600,deltaTimeSec:3},
];
function candidate(extra={}){
 return {
  method:'MULTILATERATION',siteCount:3,usedSites:prototypeSites.map(x=>({...x})),
  estimatedLat:37.48,estimatedLon:127.06,estimatedAccuracyM:650,
  residualErrorM:95,geometry:.48,confidenceScore:75,windowSec:10,
  jump:false,warnings:[],...extra,
 };
}
test('plausible three independent-site candidate passes a conservative review gate',()=>{
 const r=reviewAdaptivePosition(candidate());
 assert.equal(r.accepted,true);
 assert.deepEqual(r.reasons,[]);
 assert.equal(r.cappedSites,0);
});
test('reject saturated distances, unvalidated uncertainty, 2 sites, geometry, stale estimates and jumps separately',()=>{
 const cases=[
  [candidate({usedSites:prototypeSites.map(x=>({...x,estimatedDistanceM:1500}))}),'거리 포화'],
  [candidate({estimatedAccuracyM:3143}),'모델 불확실성'],
  [candidate({method:'WEIGHTED_2_SITE',siteCount:2,usedSites:prototypeSites.slice(0,2)}),'독립 기지국 3곳'],
  [candidate({geometry:.02}),'배치 조건'],
  [candidate({usedSites:prototypeSites.map((x,i)=>({...x,deltaTimeSec:i===1?15:1}))}),'관측 시간차'],
  [candidate({windowSec:60}),'시간창 과다'],
  [candidate({residualErrorM:1100}),'거리 잔차'],
  [candidate({jump:true}),'이동 속도'],
  [candidate({estimatedLat:null}),'좌표 없음'],
 ];
 for(const [row,reason] of cases){
  const result=reviewAdaptivePosition(row);
  assert.equal(result.accepted,false,reason);
  assert(result.reasons.some(x=>x.includes(reason)),JSON.stringify(result));
 }
});
test('2026-10-30 reported call #29 keeps CDR MOS, withholds all 48 low-quality modeled handset coordinates',()=>{
 const manifest=JSON.parse(historicalRead('public/voice-1030.json','utf8'));
 const entry=manifest.days.find(d=>d.date==='2026-10-30'&&d.customerId==='mdt-54f36ba5c24410cc2b256068');
 assert(entry);
 const raw=JSON.parse(historicalRead('public/'+entry.dataPath,'utf8'));
 const normalized=normalizeDay(manifest,raw,'MDT');
 const call=normalized.calls.find(c=>c.start==='21:37:36');
 assert(call);
 assert.equal(call.endCellId,'1664768');
 assert.equal(call.qoe,2.933899);
 const samples=normalized.samples.filter(s=>s.callId===call.id);
 const rejected=samples.filter(s=>s.estimation?.review&&!s.estimation.review.accepted);
 const located=samples.filter(s=>s.lat!=null&&s.lon!=null);
 assert.equal(rejected.length,48,'retain 48 per-row model diagnostics');
 assert.equal(located.length,0,'no fictional handset route may be drawn south of the stations');
 const row=samples.find(s=>s.time==='21:38:56');
 assert(row);
 assert.equal(row.estimation.method,'MULTILATERATION');
 assert.equal(row.estimation.siteCount,3);
 assert.equal(row.estimation.review.cappedSites,3);
 assert(row.estimation.review.reasons.some(reason=>reason.includes('거리 포화')));
 assert(row.estimation.review.reasons.some(reason=>reason.includes('모델 불확실성')));
 assert(row.accuracyM>3000);
 assert(row.estimation.candidateLat!=null,'retain original untrusted solver candidate ONLY in diagnostics');
 assert.equal(row.lat,null,'never copy rejected solver candidate to user map');
 assert.equal(row.lon,null);
 const bye=raw.baseStations.filter(station=>station.cellId===call.endCellId);
 assert.equal(bye.length,1,'a local MDT record may contain only one RU candidate');
 const overview=JSON.parse(historicalRead('public/analyst-overview/MDT/2026-10-30.json','utf8'));
 const reference=overview.callLocations.find(p=>p.callId===entry.customerId+':'+call.id);
 assert(reference,'the authorized MDT-first policy can expose a separate registered tower reference');
 assert.equal(reference.evidence,'bye-cell','rejected radio coordinates never become a handset position');
 assert.equal(reference.positionQuality,'bye-cell-site');
 assert.equal(reference.byeSelectionMethod,'mdt');
 assert.equal(reference.byeCandidateCount,3);
 assert.equal(reference.byeSelectionMdtRu,bye[0].baseStationId);
 assert.equal(reference.byeRuId,bye[0].baseStationId);
 assert.equal(reference.lat,bye[0].latitude);
 assert.equal(reference.lon,bye[0].longitude);
 assert(reference.byeSelectionDeltaSeconds>=-1&&reference.byeSelectionDeltaSeconds<=30);
 assert.equal(reference.observedAt,null);
 assert.equal(reference.usedSiteCount,null);
 assert.equal(reference.modelUncertaintyM,null);
});
test('GNSS observed location always takes precedence over rejected radio candidate',()=>{
 const manifest=JSON.parse(historicalRead('public/voice-1030.json','utf8'));
 const dayEntry=manifest.days.find(d=>d.sampleCount>0&&d.gnssSampleCount>0);
 assert(dayEntry,'at least one date has GNSS observations');
 const raw=JSON.parse(historicalRead('public/'+dayEntry.dataPath,'utf8'));
 const out=normalizeDay(manifest,raw,'MDT');
 const gnss=out.samples.find(s=>s.locationSource==='gnss');
 assert(gnss);
 assert(gnss.lat!==null&&gnss.lon!==null);
 assert.equal(gnss.locationSource,'gnss');
});
