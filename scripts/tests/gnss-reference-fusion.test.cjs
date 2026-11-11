/* eslint-disable @typescript-eslint/no-require-imports -- Exercises TypeScript through the shared CJS loader. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
const {makeGnssReference,latestGnssReference,GNSS_REFERENCE_POLICY}=load('lib/location-estimation/gnss-reference.ts');
const {normalizeDay}=load('lib/analyst/data.ts');

test('last GNSS is only from the past; age radius increases without making synthetic coordinates',()=>{
 const fix={timestamp:1_700_000_000_000,lat:37.48,lon:127.05,locationSource:'gnss'};
 const same=makeGnssReference(fix,fix.timestamp);
 assert.equal(same.ageSeconds,0);
 assert.equal(same.movementRadiusM,250);
 const at90=makeGnssReference(fix,fix.timestamp+90_000);
 assert.equal(at90.ageSeconds,90);
 assert.equal(at90.movementRadiusM,3250);
 assert.equal(at90.method,'last-observed-gnss');
 assert.equal(makeGnssReference(fix,fix.timestamp-1),null,'future observation must not anchor earlier time');
 assert.equal(makeGnssReference(fix,fix.timestamp+181_000),null,'stale fix cannot become a BYE position');
 assert.equal(makeGnssReference({...fix,locationSource:'radio'},fix.timestamp+1),null);
 assert.equal(GNSS_REFERENCE_POLICY.maxAgeSeconds,180);
});
test('GNSS reference picks the latest real fix only, not future, station or modeled point',()=>{
 const base=1_700_000_000_000;
 const rows=[
  {timestamp:base-45000,lat:37.48,lon:127.05,locationSource:'gnss'},
  {timestamp:base-20000,lat:37.49,lon:127.055,locationSource:'radio'},
  {timestamp:base-11000,lat:37.482,lon:127.051,locationSource:'gnss'},
  {timestamp:base+1000,lat:37.5,lon:127.06,locationSource:'gnss'},
 ];
 const anchor=latestGnssReference(rows,base);
 assert.equal(anchor.observedAt,base-11000);
 assert.equal(anchor.lat,37.482);
 assert.equal(anchor.ageSeconds,11);
});
test('real MDT call with GNSS retains original fixes and has end reference; no false points on later missing GNSS samples',()=>{
 const manifest=JSON.parse(fs.readFileSync('public/voice-1030.json','utf8'));
 const entries=manifest.days.filter(d=>d.gnssSampleCount>0);
 let selected;
 for(const entry of entries){
  const raw=JSON.parse(fs.readFileSync('public/'+entry.dataPath,'utf8'));
  const day=normalizeDay(manifest,raw,'MDT');
  const call=day.calls.find(c=>c.endGnssReference&&day.samples.some(s=>
    s.callId===c.id&&s.gnssReference&&s.lat===null));
  if(call){selected={day,call};break;}
 }
 assert(selected,'source must contain a call with a past GNSS and a later no-fix MDT observation');
 const {day,call}=selected;
 const real=day.samples.filter(s=>s.callId===call.id&&s.locationSource==='gnss');
 assert(real.length>0);
 const anchor=call.endGnssReference;
 assert(anchor);
 const gnssBefore=real.filter(s=>s.timestamp<=anchor.targetAt);
 const latest=Math.max(...gnssBefore.map(s=>s.timestamp));
 assert.equal(anchor.observedAt,latest);
 assert(gnssBefore.some(s=>s.timestamp===anchor.observedAt&&s.lat===anchor.lat&&s.lon===anchor.lon));
 for(const missing of day.samples.filter(s=>s.callId===call.id&&s.gnssReference&&s.lat===null)){
  assert(missing.gnssReference.observedAt<=missing.timestamp);
  assert(missing.gnssReference.targetAt===missing.timestamp);
  assert.equal(missing.locationSource,'unavailable');
  assert(missing.gnssReference.ageSeconds>=0&&missing.gnssReference.ageSeconds<=180);
 }
});
test('customer-only map shows GNSS movement envelope and BYE site separately; global map does not plot assumed routes',()=>{
 const map=fs.readFileSync('components/analyst/analyst-map.tsx','utf8');
 const contract=fs.readFileSync('components/analyst/contract-workspace.tsx','utf8');
 assert(map.includes('gnssReference?:GnssReference|null'));
 assert(map.includes('radius,'));
 assert(map.includes('이동 가능 영역'));
 assert(map.includes('실제 단말 경로가 아닙니다'));
 assert(map.includes('if(emphasizeLocationSource&&showGnss&&gnssReference)'));
 assert(contract.includes('const mapReference=sample?.gnssReference??endReference'));
 assert(contract.includes('gnssReference={mapReference}'));
 assert(contract.includes('마지막 GPS 실측 기준점'));
 assert(contract.includes('120km/h'));
 assert(contract.includes('BYE Cell 기지국 참고 위치가 없으면'));
});


test('2026-10-30 combined GNSS anchor + verified BYE station remains two different geographical records',()=>{
 const overview=JSON.parse(fs.readFileSync('public/analyst-overview/MDT/2026-10-30.json','utf8'));
 const p=overview.callLocations.find(p=>p.positionQuality==='gnss-last-known'&&p.byeRuId);
 assert(p,'must contain a recent earlier GNSS and a separate BYE tower reference');
 assert.equal(p.evidence,'gnss');
 assert(p.gnssReferenceAgeSec>60&&p.gnssReferenceAgeSec<=180);
 assert.equal(p.referenceBasis,'last-known-gnss');
 assert.equal(p.possibleRadiusM,Math.round(250+p.gnssReferenceAgeSec*120/3.6));
 assert(p.byeStationLat&&p.byeStationLon);
 assert(p.byeCellId&&p.byeRuId);
 assert(p.lat!==p.byeStationLat||p.lon!==p.byeStationLon,
   'serving tower must never overwrite original GNSS coordinate');
 const c=overview.calls.find(c=>c.id===p.callId);
 assert(c);
 assert.equal(c.endCellId,p.byeCellId);
 assert.equal((Date.parse(p.cdrEndAt)-Date.parse(p.observedAt))/1000,p.secondsBeforeEnd);
 const source=fs.readFileSync('scripts/administrative_dong.py','utf8');
 assert(source.includes('MAX_END_POSITION_AGE_SECONDS = 180.0'));
 assert(source.includes('GNSS_ASSUMED_SPEED_KMH = 120.0'));
 assert(source.includes('GNSS_BASE_OFFSET_M = 250.0'));
});
