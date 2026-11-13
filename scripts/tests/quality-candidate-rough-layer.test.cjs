// Numerical source regressions retain the original two-workbook cohort.
const {historicalRead,historicalJson,skipHistoricalSource}=require('./published-fixture.cjs');
if(skipHistoricalSource(__filename))return;
/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
const {combineDateOverviews}=load('lib/analyst/date-range.ts');
const {buildCandidateRoughPoints,loadCandidateRoughPoints}=load('lib/analyst/quality-candidate-rough-points.ts');
const {overlayThreeSiteRough}=load('lib/analyst/three-site-rough.ts');
const {buildImprovedView}=load('lib/analyst/improved-overview.ts');
const {buildQualityScopeObservationPoints}=load('lib/analyst/quality-improvement-candidates.ts');
const dates=[26,27,28,29,30].map(n=>'2026-10-'+n);
const overview=combineDateOverviews(dates.map(d=>historicalJson('../../public/analyst-overview/MDT/'+d+'.json')));
const partitions=dates.map(d=>historicalJson('../../public/three-site-rough/'+d+'.json'));
const index=historicalJson('../../public/quality-improvement/index.json');
const scope={sourceRevision:overview.sourceRevision,dateStart:dates[0],dateEnd:dates.at(-1),
  from:'00:00',to:'23:59',policy:'strict-3-site-v1'};
const evidence={revision:index.sourceRevision,policy:'strict-3-site-v1',
  censusComplete:true,records:index.evidence.flatMap(e=>historicalJson('../../public/quality-improvement/'+e.path).records)};
const baselineEntry=historicalJson('../../public/quality-improvement-full/index.json').entries.find(
  e=>e.scope.dateStart===scope.dateStart&&e.scope.dateEnd===scope.dateEnd);
const baseline=historicalJson('../../public/quality-improvement-full/'+baselineEntry.path);

test('existing overview and new candidate reference layer share exactly 106 low-QoE rough points',()=>{
 const points=buildCandidateRoughPoints(overview,scope,partitions);
 const composite={...partitions[0],date:overview.date,points:partitions.flatMap(p=>p.points)};
 const original=overlayThreeSiteRough(overview,composite,true);
 const map=buildImprovedView(original,{from:scope.from,to:scope.to,hour:null,districtId:null,evidence:'all',band:'poor'});
 const rough=map.locations.filter(p=>p.positionQuality==='three-site-rough');
 assert.equal(points.length,106);
 assert.deepEqual(points.map(p=>p.callId).sort(),rough.map(p=>p.callId).sort());
 assert.deepEqual(dates.map(d=>points.filter(p=>p.date===d).length),[13,25,20,25,23]);
 assert.equal(new Set(points.map(p=>p.callId)).size,106);
 for(const point of points){
   assert(point.usedSiteCount>=3);
   assert.equal(point.usedStations.length,point.usedSiteCount);
   assert(point.roughSearchRadiusM>=600&&point.roughSearchRadiusM<=5000);
   assert(point.usedStations.every(s=>Number.isFinite(s.rsrpDbm)&&s.ruId&&s.cellId));
 }
});
test('GPS strict-approval evidence is separate and candidate counts cannot change',()=>{
 const points=buildCandidateRoughPoints(overview,scope,partitions);
 const gps=buildQualityScopeObservationPoints(overview,scope,evidence);
 assert.deepEqual([gps.filter(p=>p.kind==='gnss').length,gps.filter(p=>p.kind==='reviewed-radio').length],[131,0]);
 assert.equal(new Set([...points.map(p=>p.callId),...gps.map(p=>p.callId)]).size,237);
 assert.equal(baseline.candidates.length,8);
 assert.equal(points.some(p=>p.usedStations.length<3),false);
});
test('time and date scope filter the approximate layer identically to the overview',()=>{
 const dayScope={...scope,dateStart:'2026-10-30',dateEnd:'2026-10-30'};
 const day=JSON.parse(historicalRead('public/analyst-overview/MDT/2026-10-30.json','utf8'));
 const only=buildCandidateRoughPoints(day,dayScope,[partitions.at(-1)]);
 assert.equal(only.length,23);
 const hourScope={...scope,from:'10:00',to:'10:59'};
 const filtered=buildCandidateRoughPoints(overview,hourScope,partitions);
 const original=overlayThreeSiteRough(overview,{...partitions[0],date:overview.date,points:partitions.flatMap(p=>p.points)},true);
 const reference=buildImprovedView(original,{from:'10:00',to:'10:59',hour:null,districtId:null,evidence:'estimated',band:'poor'})
   .locations.filter(p=>p.positionQuality==='three-site-rough');
 assert.deepEqual(filtered.map(p=>p.callId).sort(),reference.map(p=>p.callId).sort());
});
test('reject partial datasets, swapped versions, altered methods and missing dates',()=>{
 assert.deepEqual(buildCandidateRoughPoints(overview,scope,partitions.slice(0,4)),[]);
 assert.deepEqual(buildCandidateRoughPoints(overview,scope,[{...partitions[0],sourceRevision:'bad'},...partitions.slice(1)]),[]);
 assert.deepEqual(buildCandidateRoughPoints(overview,scope,[{...partitions[0],method:'NOT_REVIEWED'},...partitions.slice(1)]),[]);
 assert.deepEqual(buildCandidateRoughPoints(overview,scope,[partitions[0],partitions[0],...partitions.slice(2)]),[]);
});
test('browser loader fetches only scoped, verified source partitions',async()=>{
 const oldFetch=global.fetch;
 const fetched=[];
 global.fetch=async(url,options)=>{
   fetched.push(url);
   assert.equal(options.cache,'no-cache');
   const date=String(url).match(/(\d{4}-\d\d-\d\d)\.json$/)?.[1];
   assert(date);
   return {ok:true,json:async()=>partitions[dates.indexOf(date)]};
 };
 try{
   const data=await loadCandidateRoughPoints(overview,scope);
   assert.equal(data.length,106);
   assert.equal(fetched.length,5);
   assert(fetched.every(url=>url.startsWith('/qoe/three-site-rough/')));
 }finally{global.fetch=oldFetch;}
});
test('map overlays hollow orange reference diamonds with source details, never modifying algorithms',()=>{
 const panel=historicalRead('components/analyst/quality-improvement-candidate-panel.tsx','utf8');
 const map=historicalRead('components/analyst/improvement-candidate-map.tsx','utf8');
 const dbscan=historicalRead('components/analyst/quality-two-candidate-workspace.tsx','utf8');
 const alt=historicalRead('components/analyst/quality-model-alternative-workspace.tsx','utf8');
 assert(panel.includes('loadCandidateRoughPoints(overview,scope,controller.signal)'));
 assert(panel.includes('roughPoints={roughPoints}'));
 assert(dbscan.includes('roughPoints={selectedRough}'));
 assert(alt.includes('roughPoints={selectedRough}'));
 assert(dbscan.includes('삼각 측량 근사'));
 assert(alt.includes('MDT 근사'));
 assert(map.includes('qoe-rough-location-marker'));
 assert(map.includes("active?'#b45309':'#d97706'"));
 assert(map.includes("roughPoints,"));
 assert(map.includes('point.usedStations'));
 assert(map.includes('roughUsedForCandidate?'));
 assert(map.includes('이 MDT RSRP 가중중심 근사는 선택 알고리즘의 개선 후보 구성에 사용됐습니다.'));
 assert(map.includes('roughSearchRadiusM'));
 assert(map.includes('원본 통화 상세'));
 assert(!historicalRead('scripts/voice_improvement_1.py','utf8').includes('quality-candidate-rough-points'));
});
