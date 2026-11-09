const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {load}=require('../analyst-ts-loader.cjs');
const root=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const sim=load('lib/analyst/quality-two-simulation.ts');
test('neighbour and final display circles are separate and use the strict policy',()=>{
 assert.equal(sim.SIM_NEIGHBOR_EPS_M,100);
 assert.equal(sim.SIM_DISPLAY_MARGIN_M,20);
 for(const spacing of [20,45,65,80,100]){
  const result=sim.evaluateCandidateSimulation({...sim.DEFAULT_SIM_SETTINGS,spacingM:spacing});
  if(!result.qualifies)continue;
  const maxDist=Math.max(...result.members.map(p=>Math.hypot(p.x-result.medoid.x,p.y-result.medoid.y)));
  assert.equal(result.maxCenterDistanceM,maxDist);
  assert.equal(result.displayRadiusM,Math.ceil(Math.max(sim.SIM_NEIGHBOR_EPS_M,maxDist+sim.SIM_DISPLAY_MARGIN_M)/10)*10);
  assert.equal(result.members.length,5);
 }
 const near=sim.evaluateCandidateSimulation({...sim.DEFAULT_SIM_SETTINGS,spacingM:45});
 assert.equal(near.maxCenterDistanceM,90);
 assert.equal(near.displayRadiusM,110);
 const chained=sim.evaluateCandidateSimulation({...sim.DEFAULT_SIM_SETTINGS,spacingM:65});
 assert.equal(chained.maxCenterDistanceM,130);
 assert.equal(chained.displayRadiusM,150);
 assert.equal(chained.maxPairDistanceM,260);
 assert.equal(chained.rangeReviewRequired,true);
});
test('step 4 renders one neighbor circle per valid observation; step 5 and 7 add one final circle',()=>{
 const src=read('components/analyst/quality-two-simulator.tsx');
 assert(src.includes('data-circle-kind="neighbor"'));
 assert(src.includes('key={\'eps-\'+p.id}'));
 assert(src.includes('SIM_NEIGHBOR_EPS_M*scale'));
 assert(src.includes('data-circle-kind="final"'));
 assert(src.includes('result.displayRadiusM*scale'));
 assert(src.includes('phase>=3&&result.points.length>0'));
 assert(src.includes('phase>=4&&result.qualifies'));
 assert(src.includes('const maxRadiusM=Math.max'));
 for(const phrase of ['100m 이웃 검색 원','대표점 기준 최종 조사 범위 원','최종 표시 반경','범위 검토','대표점→최원거리'])assert(src.includes(phrase),phrase);
});
test('actual candidate geometry also contains every neighbor circle plus the separate final display circle',()=>{
 const src=read('components/analyst/quality-two-real-geometry.tsx');
 assert(src.includes("candidate.nearbyPoints.filter(p=>p.role==='discovery-member'"));
 assert(src.includes('data-circle-kind="neighbor"'));
 assert(src.includes('data-circle-kind="final"'));
 assert(src.includes('SIM_NEIGHBOR_EPS_M*scale'));
 assert(src.includes('candidate.displayRadiusM*scale'));
 assert(src.includes('candidate.maxCenterDistanceM.toFixed(1)'));
 assert(src.includes('candidate.maxPairDistanceM.toFixed(1)'));
 assert(src.includes('extentX=Math.max(candidate.displayRadiusM'));
 assert(src.includes('extentY=Math.max(candidate.displayRadiusM'));
});
