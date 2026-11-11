/* 개선 2안 독립 회귀: 현재/1안 보존 및 본부장 보고 필수 항목 확인 */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {load}=require('../analyst-ts-loader.cjs');
const root=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('improvement 2 is the default quality overview and historic variant links retain conditions',()=>{
 const router=read('app/page.tsx'),nav=read('components/analyst/quality-top-nav.tsx');
 const state=load('lib/analyst/quality-comparison-state.ts');
 assert.match(router,/variant===\x27improvement2\x27/);
 assert.match(router,/\x27current\x27:\x27improvement2\x27/);
 assert(!nav.includes('>개선 1안</Link>')&&!nav.includes('>개선 2안</Link>'));
 assert(nav.includes('품질 현황'));
 const query='?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&customer=a&customer=b&selectedBand=poor&mapMode=improvement&from=09:00&to=19:00';
 const parsed=state.parseQualityComparisonState(query,['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30']);
 assert(parsed.ok);
 assert.deepEqual(parsed.state.customerIds,['a','b']);
 assert(state.qualityComparisonHref(parsed.state,'improvement2').includes('variant=improvement2'));
 assert(state.qualityComparisonHref(parsed.state,'improvement1').includes('variant=improvement1'));
});

test('report 2 inherits raw dataset and includes denominator-labeled coverage, strict candidates, customer evidence and unverified field items',()=>{
 const main=read('components/analyst/quality-proposal-four.tsx'),report=read('components/analyst/quality-improvement-two.tsx');
 const candidate=read('components/analyst/quality-improvement-candidate-panel.tsx');
 assert(main.includes('const improvementTwo=variant==='));
 assert(main.includes('const improvement=variant===\x27improvement1\x27||variant===\x27improvement2\x27'));
 assert(!main.includes('<QualityTwoCoverage metrics={improvementMetrics}/>'));
 assert(!main.includes('<QualityTwoFieldRoadmap/>'));
 assert(!main.includes('QualityTwoHeader'), 'Both improvement 2 modes must omit the report header');
 assert(main.includes('proposalTwo={improvementTwo}'));
 for(const marker of ['전체 SIP CDR','유효 RTCP QoE(v5)','MDT 고유 연결','GPS 실측 채택','엄격 삼각 측량 채택','위치 활용 가능 통화','U = G + T','100m','약 1km','강원도','SCAN','녹음','NQI·WING','10초/30초','Rule-based']){
  assert(report.includes(marker),'missing report source requirement '+marker);
 }
 assert(candidate.includes('<QualityTwoCandidateCustomers detail={detail}/>'));
 assert(candidate.includes('<QualityTwoCandidateAudit scope={scope} summary={summary} onSelectCandidate={setSelectedId}/>'));
 assert(report.includes("validateImprovementReport(historic.value,scope.sourceRevision)"));
 assert(report.includes("scope.dateStart==='2026-10-26'&&scope.dateEnd==='2026-10-30'"));
});

test('strict policy is not silently replaced by a rough/basestation point; source assets are unchanged',()=>{
 const index=JSON.parse(read('public/quality-improvement/index.json'));
 const original=JSON.parse(read('public/improvement-candidates/2026-10-26_2026-10-30.json'));
 const strictEntry=index.entries.find(e=>e.scope.dateStart==='2026-10-26'&&e.scope.dateEnd==='2026-10-30');
 assert(strictEntry);
 const strict=JSON.parse(read('public/quality-improvement/'+strictEntry.path));
 assert.equal(strict.scope.sourceRevision,index.sourceRevision);
 assert.equal(original.sourceRevision,index.sourceRevision);
 assert.equal(strict.scope.policy,'strict-3-site-v1');
 assert.equal(strict.candidates.length,7);
 assert.equal(original.summary.candidateCount,5);
 assert.equal(original.summary.cellCandidateCount,2);
 const {compareCandidateLocations,haversineMeters}=load('lib/analyst/quality-improvement-two-comparison.ts');
 assert.equal(haversineMeters({lat:37.5,lon:127},{lat:37.5,lon:127}),0);
 const matches=compareCandidateLocations(original,strict);
 assert.equal(matches.length,original.summary.spatialCandidateCount);
 assert(matches.every(m=>m.nearestId&&Number.isFinite(m.nearestDistanceM)&&m.nearestDistanceM>=0));
 assert.deepEqual(compareCandidateLocations({...original,sourceRevision:'different'},strict),[]);
 // Values belong to different data + algorithm policies, not effect size.
 assert(read('components/analyst/quality-improvement-two.tsx').includes('후보 수의 차이는 위치 입력·필터·군집 정책'));
});
