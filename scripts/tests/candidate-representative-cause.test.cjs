/* eslint-disable @typescript-eslint/no-require-imports -- Verify the same selector used by the modal. */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {load} = require('../analyst-ts-loader.cjs');
const {getCandidateRepresentativeCause: select,getCandidateGridContrast,getCandidateSelectedGrid} = load('lib/analyst/candidate-representative-cause');
const {investigationCoverage} = load('lib/analyst/candidate-investigation-presentation');
const {buildCoveragePoints} = require('../../lib/analyst/candidate-coverage-points.mjs');
const date = '2026-11-03';
function grid(id, low, lower, band='2.1', channel='475', samples=100) {
  return {id,kind:'mdt-grid',band,earfcn:channel,sourceDates:[date],metrics:[
    {label:'측정 수',value:samples}, {label:'RSRP ≤-100 dBm',value:low,unit:'%'},
    {label:'RSRP ≤-105 dBm',value:lower,unit:'%'},
  ],mapPoints:[{pot:id+'-pot',lat:37,lon:127,date,band}],allowedCauseCategories:['coverage'],
  evidenceIds:['E'+id],callIds:[]};
}
function call(id, category, criterion) {
  return {id,kind:category === 'equipment'?'termination-group':'call-criteria',sourceDates:[date],
    metrics:category === 'equipment'?[{label:'byeReasonRaw',value:'102^RTP timeout'}]:[],
    allowedCauseCategories:[category],criteria:criterion?{[criterion]:{status:'matched'}}:{},
    callIds:[id],evidenceIds:['E'+id],mapPoints:[]};
}
function fixture(targets, pairs=[], options={}) {
  const categories=['coverage','capacity','interference','mobility','equipment'];
  const evidence={schemaVersion:'qwen-candidate-evidence-v2',versions:{evidence:'candidate-evidence-v7'},
    target:{scope:{dateStart:'2026-10-26',dateEnd:'2026-10-30'}},summary:{totalCalls:options.totalCalls??8},
    facts:targets.map(t=>({id:t.evidenceIds[0]})), calls:targets.filter(t=>t.kind!=='mdt-grid').map(t=>({id:t.callIds[0]})),
    members:[], analysisTargets:targets, neighbourLinks:pairs.map(([a,b])=>[a,b,'동쪽',25]),
    causeAssessments:categories.map(category=>{
      const targetsInRow=targets.filter(t=>t.allowedCauseCategories.includes(category)).slice(0,options.listLimit??5);
      return {category,status:targetsInRow.length?'possible':'insufficient',reason:'저장 원본',nextCheck:'추가 확인',missingEvidence:[],
        targetIds:targetsInRow.map(t=>t.id),evidenceIds:targetsInRow.flatMap(t=>t.evidenceIds)};
    })};
  return {evidence};
}
test('map directions are relative to the selected survey point; zero and missing remain distinct',()=>{
  const job=fixture([grid('W',0,null),grid('P',55,40),grid('N',5,1)]);
  job.evidence.neighbourLinks=[['W','P','동쪽',25],['P','N','북쪽',25]];
  const point=investigationCoverage(job.evidence).points.find(p=>p.pot==='P-pot');
  const contrast=getCandidateGridContrast(job.evidence,point);
  assert.deepEqual(contrast.peers.map(p=>[p.pot,p.direction,p.pct]),[['N-pot','북쪽',5],['W-pot','서쪽',0]]);
  assert.equal(contrast.average,2.5);
  assert.equal(getCandidateGridContrast(job.evidence,point,{thresholdDbm:-105}).peers.length,1);
  assert.equal(getCandidateGridContrast(job.evidence,point,{thresholdDbm:-110}),undefined);
});
test('selecting an adjacent grid uses that exact target and frequency as the comparison origin even if the same POT is shortlisted in another band',()=>{
  const focus=grid('F',21.77,9), peer=grid('S',0,0), otherBand=grid('X',85,40,'900','3743');
  otherBand.mapPoints[0].pot=peer.mapPoints[0].pot;
  const job=fixture([focus,peer,otherBand],[['F','S']]);
  const chosen=getCandidateSelectedGrid(peer,'comparison',-100);
  assert.equal(chosen.earfcn,'475');
  assert.equal(chosen.sourceDate,date);
  assert.equal(chosen.metric.percent,0);
  const contrast=getCandidateGridContrast(job.evidence,chosen,{thresholdDbm:-100});
  assert.equal(contrast.own,0);
  assert.equal(contrast.average,21.77);
  assert.deepEqual(contrast.peers.map(p=>[p.id,p.direction]),[['F','서쪽']]);
  const unrelated=getCandidateSelectedGrid(call('C','interference','overlap'),'survey');
  assert.equal(unrelated,undefined);
});
test('uses all same-carrier, supported direct peers at the operational threshold; delta reproduces from the displayed percentages',()=>{
  const primary = grid('P',55.60,48.51), a=grid('A',7.31,0.91), b=grid('B',5.28,1.21), foreign=grid('C',0,0,'900','3743');
  const sparse=grid('D',0,0,'2.1','475',5);
  const wrongDay=grid('Z',0,0); wrongDay.sourceDates=['2026-11-02']; wrongDay.mapPoints[0].date='2026-11-02';
  const job=fixture([primary,a,b,foreign,sparse,wrongDay],[['P','A'],['P','B'],['P','C'],['P','D'],['P','Z']]);
  const hero=select(job);
  assert.equal(hero.title,'2.1 GHz 커버리지 검토 필요');
  assert.match(hero.summary,/55\.60%, 25 m 인접 POT 2곳 평균 6\.30%.*49\.30%p/);
  assert.deepEqual(hero.comparisonTargetIds,['A','B']);
  assert.equal(hero.comparisonTargetId,undefined);
  assert.equal(hero.targetId,'P');
  assert.equal(hero.thresholdDbm,-100);
  assert(hero.details.some(text=>text.includes('저장된 측정 자료')));
  job.evidence.coveragePoints=buildCoveragePoints(job.evidence.analysisTargets,job.evidence.neighbourLinks);
  assert(select(job).details.some(text=>text.includes('후보 원본 측정 자료')));
});
test('a higher eligible peer is included in the mean rather than picking only the favourable comparator',()=>{
  const job=fixture([grid('P',71,55),grid('A',10,2),grid('B',83,9)],[['P','A'],['P','B']]);
  job.evidence.coveragePoints=buildCoveragePoints(job.evidence.analysisTargets,job.evidence.neighbourLinks);
  job.evidence.coveragePoints.points=job.evidence.coveragePoints.points.filter(p=>p.targetId==='P');
  const hero=select(job);
  assert.deepEqual(hero.comparisonTargetIds,['A','B']);
  assert.match(hero.summary,/2곳 평균 46\.50%/);
  assert.match(hero.title,/국소 차이 판단 보류/);
});
test('sparse/foreign ID cannot establish a regional representative cause',()=>{
  const job=fixture([grid('P',100,99,'900','3743',2)]);
  assert.equal(select(job).category,null);
  job.evidence.causeAssessments[0].targetIds=['not-in-snapshot'];
  assert.equal(select(job).category,null);
});
test('same-snapshot termination counts beyond the source card limit can outweigh a grid comparison; ordinary cell changes cannot',()=>{
  const grids=[grid('P',55,45),grid('A',5,2)], links=[['P','A']];
  const drops=['a','b','c'].map(id=>call(id,'equipment'));
  const job=fixture([...grids,...drops],links,{listLimit:1,totalCalls:4});
  const hero=select(job);
  assert.equal(hero.category,'equipment');
  assert.match(hero.title,/RTP 중단/);
  assert.deepEqual(hero.callIds,['a','b','c']);
  assert.match(hero.summary,/4건 중 최소 3건/);
  const transitions=['a','b','c'].map(id=>call(id,'mobility','frequencyChange'));
  assert.equal(select(fixture([...grids,...transitions],links,{totalCalls:4})).category,'coverage');
  assert.equal(select(fixture(transitions)).category,'mobility');
  assert.equal(select(fixture([call('a','interference','overlap')])).category,'interference');
});
test('no comparable peer or no positive gap does not claim an isolated field deficit',()=>{
  const job=fixture([grid('P',55,45)]);
  assert.match(select(job).summary,/인접 비교값은 미확보/);
  const even=fixture([grid('P',1,0),grid('A',1,0)],[['P','A']]);
  assert.match(select(even).title,/국소 차이 판단 보류/);
  assert.match(select(even).summary,/같습니다/);
  assert.equal(select(fixture([])).category,null);
});
test('an actual pre-assessment snapshot can yield a source-only comparison while a broken modern assessment cannot',()=>{
  const job=fixture([grid('P',55,45),grid('N',4,0)],[['P','N']]);
  delete job.evidence.causeAssessments;
  job.status='completed';
  assert.equal(select(job).category,null);
  job.evidence.versions.evidence='candidate-evidence-v4';
  const hero=select(job);
  assert.match(hero.details[0],/저장 측정값으로 재검토/);
  assert.match(hero.summary,/51\.00%p/);
  job.evidence.facts=job.evidence.facts.filter(f=>f.id!=='EN');
  assert.equal(select(job).category,null);
  assert.match(select(job).summary,/저장 당시 원인별 평가가 없으며/);
});
