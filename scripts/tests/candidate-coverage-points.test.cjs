/* eslint-disable @typescript-eslint/no-require-imports -- Shared browser/server source projections. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildCoveragePoints}=require('../../lib/analyst/candidate-coverage-points.mjs');
const {buildCandidateFindings}=require('../qwen-candidate-findings.cjs');
const {comparisonExample}=require('../candidate-coverage-comparison.cjs');
const {publicCandidateEvidence}=require('../qwen-candidate-public-evidence.cjs');
const {buildSourceInvestigationCandidates,buildSourceHypothesisCandidates}=require('../qwen-candidate-cause-assessment.cjs');
const date='2026-11-03';
function row(band,earfcn,below100,below105,extras={}) {
 return {date,band,earfcn,samples:100,belowPct:{'-100':below100,'-105':below105},...extras};
}
function measured(records) {
 return buildCandidateFindings({grid:{analysisSchemaVersion:'mdt-grid-analysis-v1',records:records.map(([pot,x,analysis])=>({
  pot,x,y:0,lat:37,lon:127+x/90000,analysis}))},candidate:{medoid:{lat:37,lon:127},displayRadiusM:500}});
}
test('rank diverse measured frequencies and independent areas, with separate traceable comparisons',()=>{
 const f=measured([
  ['P',0,[row('2.1','475',70,60),row('900','3743',0,0)]],
  ['Q',25,[row('2.1','475',0,0)]],
  ['R',100,[row('1.8광','1550',15,10)]],
  ['S',125,[row('1.8광','1550',null,null,{phrMean:-1})]],
  ['T',250,[row('2.1','475',20,15)]],
  ['sparse',275,[row('1.8협','1694',100,100,{samples:2})]],
  ['unweighted',300,[row('900','3743',90,85,{metricSamples:{'-100':2,'-105':1}})]],
 ]);
 const points=buildCoveragePoints(f.analysisTargets,f.neighbourLinks),byId=new Map(f.analysisTargets.map(t=>[t.id,t]));
 assert.equal(points.reviewedCombinations,8);
 assert.equal(points.qualifiedCombinations,4);
 assert.equal(points.qualifiedPotCount,4);
 assert.equal(points.areaCount,3);
 assert.deepEqual(points.points.map(p=>p.pot),['P','S','T','R']);
 assert.equal(points.points[0].band,'2.1');
 assert.deepEqual(points.points[0].metric,{kind:'dl-rsrp',thresholdDbm:-100,percent:70});
 assert.deepEqual(points.points[1].metric,{kind:'ul-phr',mean:-1});
 assert.match(points.points[1].reason,/PHR 원본 평균 -1/);
 assert(!points.points[1].reason.includes('RSRP'));
 const first=points.points[0];
 assert.deepEqual(first.comparisons.map(c=>[c.kind,byId.get(c.targetId).mapPoints[0].pot,c.distanceM]),
  [['adjacent-same-carrier','Q',25],['same-pot-other-band','P',0]]);
 assert.equal(comparisonExample(points).primaryTargetId,first.targetId);
 const projected=publicCandidateEvidence({...f,coveragePoints:points,independentReview:undefined,causeAssessments:[],modelInput:{analysisTargets:[]}});
 assert.deepEqual(new Set(projected.analysisTargets.map(row=>row.id)),new Set(points.points.flatMap(p=>[p.targetId,...p.comparisons.map(c=>c.targetId)])));
 const filtered=f.analysisTargets.filter(t=>t.mapPoints[0].pot==='S');
 const saved=buildCoveragePoints(filtered,f.neighbourLinks);
 assert.deepEqual([saved.reviewedCombinations,saved.qualifiedPotCount,saved.areaCount,saved.points[0].areaSize],[1,1,1,1]);
 assert.deepEqual(saved.points[0].comparisons,[]);
 assert.deepEqual(buildCoveragePoints([],f.neighbourLinks).points,[]);
});
test('saved field evidence includes each measured immediate neighbour even if its signal is weaker',()=>{
 const findings=measured([
  ['west',0,[row('2.1','475',88,60)]],['survey',25,[row('2.1','475',50,45)]],
  ['east',50,[row('2.1','475',6,2)]],['far',75,[row('2.1','475',90,70)]],
 ]);
 const id=pot=>findings.analysisTargets.find(t=>t.mapPoints[0].pot===pot).id;
 const coveragePoints={points:[{targetId:id('survey'),comparisons:[{targetId:id('east'),kind:'adjacent-same-carrier',distanceM:25}]}]};
 const projected=publicCandidateEvidence({...findings,coveragePoints,independentReview:undefined,causeAssessments:[],modelInput:{analysisTargets:[]}});
 assert.deepEqual(new Set(projected.analysisTargets.map(t=>t.mapPoints[0].pot)),new Set(['west','survey','east']));
 assert.equal(projected.neighbourLinks.length,2);
 for(const target of projected.analysisTargets)assert(target.evidenceIds.every(id=>projected.facts.some(f=>f.id===id)));
});
test('band-level DL context uses supported weights for the same date and carrier, including zero-percent POTs',()=>{
 const findings=measured([
  ['A',0,[row('2.1','475',50,30,{samples:200,metricSamples:{'-100':80}}),row('900','3743',55,25)]],
  ['B',25,[row('2.1','475',0,0,{samples:400,metricSamples:{'-100':120}})]],
  ['C',50,[row('2.1','475',90,80,{samples:200,metricSamples:{'-100':1}})]],
 ]);
 const summaries=buildCoveragePoints(findings.analysisTargets,findings.neighbourLinks).bandSummaries;
 assert.equal(summaries.length,2);
 assert.deepEqual(summaries.find(group=>group.earfcn==='475'),{
  sourceDate:date,band:'2.1',earfcn:'475',validPots:2,weakPots:1,sourceWeight:200,weakPercent:20
 });
});
test('model links supply multiple independent options, preserve category breadth and keep same-carrier groups separate',()=>{
 const f=measured([
  ['P',0,[row('2.1','475',50,45)]],['Q',25,[row('2.1','475',20,15)]],
  ['R',250,[row('1.8광','1550',30,20)]],['Z',275,[row('900','3743',0,0)]],
 ]);
 const points=buildCoveragePoints(f.analysisTargets,f.neighbourLinks);
 const call={id:'C',kind:'call-criteria',allowedCauseCategories:['mobility'],sopIds:['R'],
  evidenceIds:['C1'],metrics:{criteria:{frequencyChange:{status:'matched'}}}};
 const model={analysisTargets:[...f.modelTargets,call],targetIdPolicy:'evidence-id-alias-v1',
  sop:{templates:[{id:'R',causeCategory:'mobility'},{id:'MDT_COVERAGE_REVIEW',causeCategory:'coverage'}]},
  coveragePointTargetIds:points.points.map(point=>point.targetId)};
 const hypotheses=buildSourceHypothesisCandidates(model);
 assert.deepEqual(hypotheses.map(option=>option.category),['coverage','mobility','coverage','coverage']);
 assert(hypotheses.every(option=>option.targetIds.length===1&&option.targetIds[0]===option.evidenceIds[0]));
 const source=buildSourceInvestigationCandidates(model);
 assert.deepEqual(source.map(option=>[option.kind,option.targetIds.length]),[['mdt-grid',2],['call-criteria',1],['mdt-grid',1]]);
 for(const group of source.filter(row=>row.kind==='mdt-grid')){
  assert.equal(group.comparisonScope,'independent-points-same-carrier');
  const measured=group.evidenceIds.map(id=>f.modelTargets.find(t=>t.evidenceIds.includes(id)));
  assert.equal(new Set(measured.map(t=>[t.sourceDates,t.band,t.earfcn].join('/'))).size,1);
 }
 model.coveragePointTargetIds=[];
 assert.deepEqual(buildSourceInvestigationCandidates(model).map(row=>row.kind),['call-criteria']);
 assert.deepEqual(buildSourceHypothesisCandidates(model).map(row=>row.category),['mobility']);
});
