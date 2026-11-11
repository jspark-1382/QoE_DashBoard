const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {load}=require('../analyst-ts-loader.cjs');
const base=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(base,p),'utf8');
const {evaluateCandidateSimulation:run,DEFAULT_SIM_SETTINGS:defaults}=load('lib/analyst/quality-two-simulation.ts');
const scenario=overrides=>run({...defaults,...overrides});
test('visual simulator default matches the 100m / 2 observations / 3 customers / 2 days policy',()=>{
 const x=scenario({});
 assert.equal(x.points.length,5);assert.equal(x.clusters.length,1);
 assert.equal(x.members.length,5);assert.equal(x.customers,5);assert.equal(x.days,3);
 assert.equal(x.medoid.id,'D3');
 assert.equal(x.maxPairDistanceM,180);
 assert.equal(x.maxCenterDistanceM,90);
 assert.equal(x.displayRadiusM,110);
 assert.equal(x.rangeReviewRequired,false);
 assert.equal(x.nearbyNewCustomers,2);
 assert.equal(x.validationPass,true);
});
test('MOS boundary is strict 1 <= MOS < 3 and evidence is a separate gate',()=>{
 assert.equal(scenario({mos:2.9}).accepted,true);
 assert.equal(scenario({mos:3}).accepted,false);
 assert.equal(scenario({mos:3.5}).members.length,0);
 assert.equal(scenario({uniqueMdt:false}).accepted,false);
 assert.equal(scenario({locationKind:'bye-cell'}).accepted,false);
 assert.equal(scenario({locationKind:'reviewed-radio'}).qualifies,true);
 assert.equal(scenario({locationKind:'gnss'}).qualifies,true);
});
test('100m applies to neighbours; chained group above 200m stays candidate but rank is held',()=>{
 const x=scenario({spacingM:65});
 assert.equal(x.clusters.length,1);
 assert.equal(x.maxPairDistanceM,260);
 assert.equal(x.displayRadiusM,150);
 assert.equal(x.rangeReviewRequired,true);
 assert.equal(x.qualifies,true);
 assert.equal(x.validationPass,true,'validation is independent of range-review status');
});
test('points over 100m apart cannot create even a minSamples=2 DBSCAN group',()=>{
 const x=scenario({spacingM:105});
 assert.equal(x.clusters.length,0);
 assert.equal(x.noise.length,5);
 assert.equal(x.qualifies,false);
 assert.equal(x.medoid,null);
 assert.equal(x.displayRadiusM,0);
});
test('repeated calls from one customer cannot meet 3 distinct customers criterion',()=>{
 const x=scenario({uniqueCustomers:1});
 assert.equal(x.members.length,5);
 assert.equal(x.customers,1);
 assert.equal(x.qualifies,false);
 assert.equal(x.validationPoints.length,0);
});
test('1 observed day also excludes candidate, independent of customers and call count',()=>{
 const x=scenario({observedDays:1});
 assert.equal(x.customers,5);
 assert.equal(x.days,1);
 assert.equal(x.qualifies,false);
});
test('new customer validation needs two distinct new customers within 100m of a discovery member',()=>{
 assert.equal(scenario({newCustomers:1}).validationPass,false);
 assert.equal(scenario({newCustomers:2}).validationPass,true);
 assert.equal(scenario({newCustomers:3,validationDistanceM:145}).nearbyNewCustomers,0);
 assert.equal(scenario({newCustomers:3,validationDistanceM:145}).validationPass,false);
 assert.equal(scenario({newCustomers:3,validationDistanceM:60}).nearbyNewCustomers,3);
 assert.equal(scenario({newCustomers:2,validationDistanceM:100}).nearbyNewCustomers,1,'offset >100 for one of two observations');
});
test('visual teaching is separated from real data and offers an actual evidence geometry',()=>{
 const guide=read('components/analyst/quality-two-algorithm-guide.tsx');
 const sim=read('components/analyst/quality-two-simulator.tsx');
 const actual=read('components/analyst/quality-two-real-geometry.tsx');
 assert(guide.includes('<QualityTwoSimulator summary={summary}/>'));
 assert(guide.includes('계산 규칙 · 단계별 상세 설명 펼치기'));
 assert(guide.includes('<QualityTwoRealGeometry detail={validDetail}/>'));
 for(const v of ['가상 연습용','실제 개선 후보·원본 통화·위치 자료','가상 QoE 점수','가상 고유 고객 수','가상 관측일 수','가상 관측점 간격','검증일 신규 고객 수','검증일 거리','시뮬레이션 상황 선택','단계 선택','가상 시뮬레이션 초기화']){
  assert(sim.includes(v),v);
 }
 assert(actual.includes('candidate.nearbyPoints'));
 assert(actual.includes('candidate.displayRadiusM'));
});
