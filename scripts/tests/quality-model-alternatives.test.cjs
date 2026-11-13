// Numerical source regressions retain the original two-workbook cohort.
const {historicalRead,historicalJson,skipHistoricalSource}=require('./published-fixture.cjs');
if(skipHistoricalSource(__filename))return;
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=path.resolve(__dirname,'../..');
const read=p=>JSON.parse(historicalRead(path.join(base,p),'utf8'));
const index=read('public/quality-improvement/index.json');
const alternativeIndex=read('public/quality-models/index.json');
const models=['hdbscan','st_dbscan','adaptive_kde','spatial_scan','bayesian'];
test('all 15 published strict-3-site scopes have distinct, source-locked alternative model results',()=>{
 assert.equal(index.sourceRevision,alternativeIndex.sourceRevision);
 assert.equal(alternativeIndex.entries.length,index.entries.length);
 const unique=new Set();
 for(const entry of alternativeIndex.entries){
  const source=index.entries.find(x=>x.scopeKey===entry.scopeKey);
  assert(source,'missing strict base scope '+entry.scopeKey);
  assert.deepEqual(entry.scope,source.scope);
  assert(!unique.has(entry.scopeKey));unique.add(entry.scopeKey);
  const report=read('public/quality-models/'+entry.path);
  assert.equal(report.schemaVersion,'quality-alternative-models-v1');
  assert.equal(report.sourceRevision,index.sourceRevision);
  assert.equal(report.scopeKey,entry.scopeKey);
  assert.deepEqual(report.scope,entry.scope);
  const overlap=report.discoveryDates.filter(d=>report.validationDates.includes(d));
  assert.deepEqual(overlap,[]);
  assert.deepEqual(Object.keys(report.models).sort(),models.slice().sort());
  for(const id of models){
   const data=report.models[id];
   assert(data.status===('spatial_scan'===id||'bayesian'===id?'exploratory-located-only':'computed'));
   assert.equal(data.candidates.length,entry.candidateCounts[id]);
   assert.equal(new Set(data.candidates.map(c=>c.id)).size,data.candidates.length);
   assert(data.candidates.every(c=>c.poorCustomers>=3&&c.days>=2));
   for(const c of data.candidates){
    assert(c.poorCalls===c.members.length);
    assert(c.poorCustomers===new Set(c.members.map(p=>p.customerId)).size);
    assert(c.days===new Set(c.members.map(p=>p.date)).size);
    assert.equal(c.validationNewCustomers,
      new Set(c.validationPoints.filter(p=>!c.members.some(m=>m.customerId===p.customerId)).map(p=>p.customerId)).size);
    assert(c.members.every(p=>report.discoveryDates.includes(p.date)&&p.mos>=1&&p.mos<3&&['gnss','reviewed-radio'].includes(p.kind)));
    assert(c.validationPoints.every(p=>report.validationDates.includes(p.date)));
    assert(c.lat>=-90&&c.lat<=90&&c.lon>=-180&&c.lon<=180);
    assert(c.radiusM>=100&&Number.isFinite(c.rankingScore));
    assert.equal(c.rangeReviewRequired,c.maxPairDistanceM>200);
   }
  }
 }
});
test('5-day holdout comparison retains baseline and computes real distinct candidates',()=>{
 const entry=alternativeIndex.entries.find(e=>e.scope.dateStart==='2026-10-26'&&e.scope.dateEnd==='2026-10-30');
 assert(entry);
 const baseSummary=read('public/quality-improvement/'+index.entries.find(e=>e.scopeKey===entry.scopeKey).path);
 const report=read('public/quality-models/'+entry.path);
 assert.equal(baseSummary.candidates.length,7);
 assert.deepEqual(report.discoveryDates,['2026-10-26','2026-10-27','2026-10-28','2026-10-29']);
 assert.deepEqual(report.validationDates,['2026-10-30']);
 assert.equal(report.coverage.poorScored,1403);
 assert.equal(report.coverage.poorLocated,131);
 assert.equal(report.coverage.normalScored,129537);
 assert.equal(report.coverage.normalLocated,294);
 assert.equal(report.models.hdbscan.candidates.length,16);
 assert.equal(report.models.st_dbscan.candidates.length,5);
 assert.equal(report.models.adaptive_kde.candidates.length,15);
 assert.equal(report.models.spatial_scan.candidates.length,17);
 assert.equal(report.models.bayesian.candidates.length,20);
 assert(report.models.spatial_scan.candidates.every(c=>c.metric.conditionalPermutationP>=.01));
 assert(report.models.bayesian.candidates.every(c=>c.metric.credibleLow<=c.metric.posteriorMean&&c.metric.credibleHigh>=c.metric.posteriorMean));
});
test('source code only exposes risk models as experimental conditional observed-sample results',()=>{
 const ui=historicalRead(path.join(base,'components/analyst/quality-model-alternative-workspace.tsx'),'utf8');
 const selector=historicalRead(path.join(base,'components/analyst/quality-improvement-candidate-panel.tsx'),'utf8');
 const loader=historicalRead(path.join(base,'lib/analyst/quality-model-alternatives.ts'),'utf8');
 assert(selector.includes('개선 후보 산정 모델 선택'));
 assert(selector.includes("selectedModel==='dbscan'"));
 assert(selector.includes('<QualityModelAlternativeWorkspace'));
 assert(ui.includes('탐색 전용')&&ui.includes('망 전체 불량률'));
 assert(ui.includes('<ImprovementCandidateMap'));
 assert(ui.includes('실제 원본 통화'));
 assert(loader.includes('loadAlternativeModelReport'));
 assert(loader.includes('scopeKey!==entry.scopeKey'));
});
