/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
const {combineDateOverviews}=load('lib/analyst/date-range.ts');
const {buildQualityPresentationCandidates}=load('lib/analyst/quality-candidate-presentation.ts');
const {buildCandidateRoughPoints}=load('lib/analyst/quality-candidate-rough-points.ts');
const {matchCandidateRoughPoints,candidateCircleDistanceM}=load('lib/analyst/quality-candidate-rough-membership.ts');
const {selectCandidateStationSites}=load('lib/analyst/station-map-presentation.ts');
const dates=[26,27,28,29,30].map(n=>'2026-10-'+n);
const overview=combineDateOverviews(dates.map(d=>require('../../public/analyst-overview/MDT/'+d+'.json')));
const roughDays=dates.map(d=>require('../../public/three-site-rough/'+d+'.json'));
const index=require('../../public/quality-improvement-full/index.json');
const entry=index.entries.find(e=>e.scope.dateStart===dates[0]&&e.scope.dateEnd===dates.at(-1));
assert(entry);
const summary=require('../../public/quality-improvement-full/'+entry.path);
const candidates=buildQualityPresentationCandidates(summary,null);
const all=matchCandidateRoughPoints(candidates,buildCandidateRoughPoints(overview,{
  sourceRevision:overview.sourceRevision,dateStart:dates[0],dateEnd:dates.at(-1),
  from:'00:00',to:'23:59',policy:'strict-3-site-v1'
},roughDays));
const LTE=require('../../public/station-catalog.json');
const NR=require('../../public/nr-station-catalog.json');
const selected=(id,range='inside',rat='LTE',highlightRelated=true)=>{
  const circle=candidates.filter(c=>c.id===id);
  const points=all.filter(p=>p.matchingCandidateIds.includes(id));
  const stations=selectCandidateStationSites(circle,[LTE,NR],{range,rat,highlightRelated},id,points);
  return {points,stations};
};
test('each candidate selection contains only its own rough coordinates, not others',()=>{
 assert.equal(candidates.length,8);
 assert.equal(all.length,9);
 const expected=[1,0,3,5,0,0,0,0];
 for(let i=0;i<candidates.length;i++){
   const {points,stations}=selected(candidates[i].id);
   assert.equal(points.length,expected[i],'candidate '+(i+1));
   assert(points.every(p=>p.matchingCandidateIds.includes(candidates[i].id)));
   assert(stations.every(s=>s.linkedToSelected||s.matchedCandidateIds.includes(candidates[i].id)));
   for(const s of stations.filter(s=>!s.linkedToSelected)){
     assert(candidateCircleDistanceM(s,candidates[i].location)<=candidates[i].location.radiusM,
       'unrelated station inside selected candidate '+(i+1));
   }
 }
});
test('changing selection clears old candidate markers and selects new station set',()=>{
 const first=selected(candidates[0].id);
 const third=selected(candidates[2].id);
 const fourth=selected(candidates[3].id);
 const second=selected(candidates[1].id);
 assert.deepEqual([first.points.length,third.points.length,fourth.points.length,second.points.length],[1,3,5,0]);
 assert(first.stations.some(s=>s.linkedToSelected),'first rough point has measurement sites');
 assert(second.stations.every(s=>!s.linkedToSelected),'candidate 2 has no rough point');
 assert.notDeepEqual(first.stations.map(s=>s.id).sort(),second.stations.map(s=>s.id).sort());
 assert.notDeepEqual(third.stations.map(s=>s.id).sort(),fourth.stations.map(s=>s.id).sort());
 assert.equal(second.stations.filter(s=>s.matchedCandidateIds.includes(candidates[1].id)).length,11);
 assert.equal(selected(candidates[5].id,'inside','LTE',false).stations.length,0);
 assert(selected(candidates[5].id,'near','LTE',false).stations.length>0);
});
test('single selection respects LTE/5G, 500m and hide choices',()=>{
 const id=candidates[0].id;
 const standard=selected(id,'inside','LTE',false).stations;
 const nr=selected(id,'inside','NR',false).stations;
 const both=selected(id,'inside','all',false).stations;
 const near=selected(id,'near','LTE',false).stations;
 const none=selected(id,'off','all',true).stations;
 assert.equal(standard.length,6);
 assert.equal(nr.length,4);
 assert.equal(both.length,10);
 assert(near.length>standard.length);
 assert.deepEqual(none,[]);
 assert(nr.every(s=>s.technology==='NR'));
});
test('map passes only selected rough and station layers, keeps other candidate circles',()=>{
 const db=fs.readFileSync('components/analyst/quality-two-candidate-workspace.tsx','utf8');
 const alt=fs.readFileSync('components/analyst/quality-model-alternative-workspace.tsx','utf8');
 const map=fs.readFileSync('components/analyst/improvement-candidate-map.tsx','utf8');
 for(const source of [db,alt]){
  assert(source.includes('roughPoints={selectedRough} stationSites={stationSites}'));
  assert(source.includes('selectedMapCandidates'));
  assert(source.includes('selectCandidateStationSites(selectedMapCandidates,'));
  assert(source.includes('matchingCandidateIds.includes(active'));
  assert(!source.includes('roughPoints={insideRough}'));
 }
 assert(map.includes('c.id===selectedId&&point.matchingCandidateIds.includes(c.id)'));
 assert(map.includes('!site.matchedCandidateIds.includes(selectedId)&&!site.linkedToSelected'));
 assert(map.includes('candidates.forEach((candidate,index)=>'));
 assert(map.includes("point.kind==='gnss'"),'GPS behavior unchanged');
});
