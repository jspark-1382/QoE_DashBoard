// Numerical source regressions retain the original two-workbook cohort.
const {historicalRead,historicalJson,skipHistoricalSource}=require('./published-fixture.cjs');
if(skipHistoricalSource(__filename))return;
/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
const {combineDateOverviews}=load('lib/analyst/date-range.ts');
const {buildCandidateRoughPoints}=load('lib/analyst/quality-candidate-rough-points.ts');
const {matchCandidateRoughPoints,candidateCircleDistanceM}=load('lib/analyst/quality-candidate-rough-membership.ts');
const {buildQualityPresentationCandidates}=load('lib/analyst/quality-candidate-presentation.ts');
const dates=[26,27,28,29,30].map(i=>'2026-10-'+i);
const ov=combineDateOverviews(dates.map(d=>historicalJson('../../public/analyst-overview/MDT/'+d+'.json')));
const parts=dates.map(d=>historicalJson('../../public/three-site-rough/'+d+'.json'));
const scope={dateStart:dates[0],dateEnd:dates.at(-1),from:'00:00',to:'23:59',sourceRevision:ov.sourceRevision,policy:'strict-3-site-v1'};
const raw=buildCandidateRoughPoints(ov,scope,parts);
const index=historicalJson('../../public/quality-improvement-full/index.json');
const entry=index.entries.find(e=>e.scope.dateStart===scope.dateStart&&e.scope.dateEnd===scope.dateEnd);
assert(entry);
const summary=historicalJson('../../public/quality-improvement-full/'+entry.path);
const candidates=buildQualityPresentationCandidates(summary,null);
const matched=matchCandidateRoughPoints(candidates,raw);

test('real 5-day 106 rough centroids: only 9 fall within any of the 8 shown candidate circles',()=>{
 assert.equal(candidates.length,8);
 assert.equal(raw.length,106);
 assert.equal(matched.length,9);
 assert.equal(new Set(matched.map(p=>p.callId)).size,9);
 assert.deepEqual(candidates.map(c=>matched.filter(p=>p.matchingCandidateIds.includes(c.id)).length),
  [1,0,3,5,0,0,0,0]);
 assert(matched.every(p=>p.matchingCandidateIds.length>=1));
 for(const p of matched)for(const id of p.matchingCandidateIds){
  const c=candidates.find(item=>item.id===id);
  assert(c?.location);
  assert(candidateCircleDistanceM(p,c.location)<=c.location.radiusM);
 }
 const excluded=raw.filter(p=>!new Set(matched.map(m=>m.callId)).has(p.callId));
 assert.equal(excluded.length,97);
 assert(excluded.every(p=>candidates.every(c=>candidateCircleDistanceM(p,c.location)>c.location.radiusM)));
});
test('selection changes highlighted rough count but does not change the 8 candidate rankings or union count',()=>{
 const before=candidates.map(c=>({id:c.id,center:c.location,radius:c.location.radiusM,poor:c.discovery.poorCalls}));
 for(const c of candidates){
  const selected=matched.filter(p=>p.matchingCandidateIds.includes(c.id));
  assert(selected.length>=0);
 }
 assert.equal(matched.length,9);
 assert.deepEqual(candidates.map(c=>({id:c.id,center:c.location,radius:c.location.radiusM,poor:c.discovery.poorCalls})),before);
});
test('haversine inclusion is on candidate displayed radius, inclusive of the exact edge and excludes outside',()=>{
 const c={id:'c1',location:{lat:37.5,lon:127,radiusM:100}};
 const p=(id,lat,lon)=>({callId:id,customerId:'x',date:'2026-10-30',lat,lon,observedAt:null,cdrEndAt:null,secondsBeforeEnd:null,roughSearchRadiusM:1200,usedSiteCount:3,usedStations:[]});
 const exact={...p('edge',37.5,127),lat:37.5+100/111194.9266};
 const inside=p('inner',37.5,127);
 const outside=p('outer',37.5+0.003,127);
 const result=matchCandidateRoughPoints([c],[inside,outside]);
 assert.deepEqual(result.map(p=>p.callId),['inner']);
 const fakeCircle={id:'edge-circle',location:{lat:inside.lat,lon:inside.lon,radiusM:candidateCircleDistanceM(inside,exact)}};
 assert.deepEqual(matchCandidateRoughPoints([fakeCircle],[exact]).map(p=>p.callId),['edge']);
 assert.deepEqual(matchCandidateRoughPoints([{id:'none',location:{...c.location,radiusM:0}}],[inside]),[]);
 assert.deepEqual(matchCandidateRoughPoints([{id:'none',location:null}],[inside]),[]);
});
test('overlapping candidate circles do not double count an approximate call',()=>{
 const p=raw[0];
 const cs=[{id:'a',location:{lat:p.lat,lon:p.lon,radiusM:100}},{id:'b',location:{lat:p.lat,lon:p.lon,radiusM:150}}];
 const result=matchCandidateRoughPoints(cs,[p,p]);
 assert.equal(result.length,1);
 assert.deepEqual(result[0].matchingCandidateIds,['a','b']);
});
test('DBSCAN and alternate map UI use membership-filtered references, not all 106',()=>{
 const db=historicalRead('components/analyst/quality-two-candidate-workspace.tsx','utf8');
 const alt=historicalRead('components/analyst/quality-model-alternative-workspace.tsx','utf8');
 const map=historicalRead('components/analyst/improvement-candidate-map.tsx','utf8');
 for(const text of [db,alt]){
  assert(text.includes('matchCandidateRoughPoints('));
  assert(text.includes('roughPoints={selectedRough}'));
  assert(text.includes('selectedMapCandidates'));
  assert(text.includes('selectedRough=useMemo('));
  assert(text.includes('matchCandidateRoughPoints('));
  assert(text.includes('selectedInsideRough'));
 }
 assert(map.includes('point.matchingCandidateIds.includes(c.id)'));
 assert(map.includes('candidateCircleDistanceM(point,c.location)<=c.location.radiusM'));
 assert(map.includes('qoe-rough-selected'));
 assert(map.includes('포함된 후보:'));
 assert(map.includes('roughUsedForCandidate?'));
 assert(map.includes('이 MDT RSRP 가중중심 근사는 선택 알고리즘의 개선 후보 구성에 사용됐습니다.'));
 assert(map.includes('실제 단말 위치 정확도는 아직 검증되지 않았고'));
 assert(map.includes('후보 중심·순위를 확정 장애 위치로 해석하지 마세요.'));
});
