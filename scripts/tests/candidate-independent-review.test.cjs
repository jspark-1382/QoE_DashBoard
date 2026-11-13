/* eslint-disable @typescript-eslint/no-require-imports -- Deterministic server evidence regression tests. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildCandidateFindings}=require('../qwen-candidate-findings.cjs');
const candidate={medoid:{lat:37,lon:127},displayRadiusM:300};
const measurement=(samples,tail,deep=0)=>({date:'2026-11-03',band:'900(B8)',earfcn:'3743',samples,rsrpMean:-98,rsrqMean:-16,belowPct:{'-105':tail,'-110':deep},metricSamples:{'-105':samples,'-110':samples,rsrp:samples,rsrq:samples}});
const pot=(name,x,values)=>({pot:name,x,y:0,lat:37,lon:127+x/90000,analysis:values});

test('rule review groups several adjacent POTs by matching date and frequency and preserves comparison evidence',()=>{
 const grid={analysisSchemaVersion:'mdt-grid-analysis-v1',records:[
  pot('POT_A',0,[measurement(100,40,20)]),pot('POT_B',25,[measurement(100,60,20)]),
  pot('POT_C',50,[measurement(100,30,10)]),pot('POT_ZERO',75,[measurement(100,0)]),
  pot('POT_SPARSE',100,[measurement(1,100,100)]),pot('POT_OTHER_DAY',125,[{...measurement(100,90,80),date:'2026-11-04'}])
 ]};
 const result=buildCandidateFindings({candidate,grid}),review=result.independentReview;
 assert.equal(review.label,'근거 규칙 검토');assert.equal(review.reviewed.mdtTargets,6);
 assert.equal(review.reviewed.zeroTailTargets,1);assert.equal(review.reviewed.sparseTargets,1);
 const group=review.priorities.find(item=>item.targetIds.length===3);
 assert.ok(group,'three measured adjacent POTs form one practical investigation area');
 assert.deepEqual(group.targetIds.map(id=>result.analysisTargets.find(t=>t.id===id).mapPoints[0].pot).sort(),['POT_A','POT_B','POT_C']);
 assert.match(group.observation,/POT_ZERO/);assert.match(group.nextCheck,/EARFCN/);
 const zero=result.analysisTargets.find(target=>target.mapPoints[0]?.pot==='POT_ZERO');
 assert.ok(group.evidenceIds.includes(zero.evidenceIds[0]),'boundary comparison is traceable to its actual observation');
 assert.equal(group.assessment,'possible');assert.match(group.limitations.join(' '),/통화/);
 assert.ok(!review.priorities.flatMap(item=>item.targetIds).some(id=>result.analysisTargets.find(t=>t.id===id).mapPoints[0]?.pot==='POT_SPARSE'));
 const observation=result.observationGroups.find(item=>item.targetIds.length===3);
 assert.deepEqual(observation.targetIds,group.targetIds);
 assert.deepEqual(observation.comparisonTargetIds,[zero.id]);
 assert.equal(observation.kind,'mdt-adjacent-observations');assert.ok(!Object.hasOwn(observation,'category'));
});

test('rule review keeps missing tails and single measurements out of coverage priorities and bounds the shortlist',()=>{
 const records=Array.from({length:12},(_,i)=>pot('POT_'+i,i*25,[measurement(100,50,10)]));
 const result=buildCandidateFindings({candidate,grid:{analysisSchemaVersion:'mdt-grid-analysis-v1',records}});
 assert.ok(result.independentReview.priorities.length<=3);
 assert.ok(result.independentReview.priorities.every(item=>item.targetIds.length<=5));
 assert.equal(result.independentReview.reviewed.mdtTargets,12);
 const empty=buildCandidateFindings({candidate,grid:{analysisSchemaVersion:'mdt-grid-analysis-v1',records:[pot('ONE',0,[measurement(1,100)]),pot('ZERO',25,[measurement(80,0)]),pot('MISSING',50,[{...measurement(80,0),belowPct:{'-105':null,'-110':null}}])]}});
 assert.deepEqual(empty.independentReview.priorities,[]);
 assert.match(empty.independentReview.limitations.join(' '),/표본|근거/);
});

test('rule review identifies the interruption to investigate without converting vendor code or ordinary BYE into equipment failure',()=>{
 const termination={schemaVersion:'qoe-candidate-termination-v1',sourceRevision:'r',records:{
  a:{fcRaw:'9563',byeReasonRaw:'102^RTP timeout',reasonRaw:'H : Drop/V : Rx_RTP_middle_Loss'},
  b:{fcRaw:'1234',byeReasonRaw:'0: Tx Bye'}
 }};
 const result=buildCandidateFindings({candidate,termination,sourceRevision:'r',rows:[{memberId:'a',id:'a',date:'2026-10-26',is_drop:1},{memberId:'b',id:'b',date:'2026-10-26',is_drop:1}]}),review=result.independentReview;
 assert.equal(review.priorities.length,1);const item=review.priorities[0];
 assert.equal(item.category,'equipment');assert.match(item.observation,/102\^RTP timeout/);
 assert.match(item.nextCheck,/수신|송신|방향/);assert.match(item.limitations.join(' '),/확정/);
 assert.deepEqual(item.targetIds.map(id=>result.analysisTargets.find(t=>t.id===id).callIds),[['a']]);
 assert(!/9563.*(?:뜻|의미는)/.test(item.observation));
});
