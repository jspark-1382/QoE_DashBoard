// Historical source assertions use the preserved original cohort; current sources have a separate census test.
const {historicalRead,historicalJson,skipHistoricalSource}=require('./published-fixture.cjs');
if(skipHistoricalSource(__filename))return;
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=p=>JSON.parse(historicalRead(path.join(root,p),'utf8'));
const old=read('public/quality-improvement/index.json');
const full=read('public/quality-improvement-full/index.json');
const evalModels=read('public/quality-models/index.json');
const fullModels=read('public/quality-models-full/index.json');
const ids=['hdbscan','st_dbscan','adaptive_kde','spatial_scan','bayesian'];
test('all-period DBSCAN and five alternatives keep all 15 scopes independently from holdout',()=>{
 assert.equal(full.analysisMode,'all');assert.equal(fullModels.analysisMode,'all');
 assert.equal(old.sourceRevision,full.sourceRevision);assert.equal(old.sourceRevision,fullModels.sourceRevision);
 assert.equal(full.entries.length,15);assert.equal(fullModels.entries.length,15);
 for(const e of full.entries){
  const oldEntry=old.entries.find(x=>JSON.stringify(x.scope)===JSON.stringify(e.scope));
  assert(oldEntry);
  const baseline=read('public/quality-improvement/'+oldEntry.path);
  const report=read('public/quality-improvement-full/'+e.path);
  const multi=fullModels.entries.find(x=>x.scopeKey===e.scopeKey);
  assert(multi);
  const ml=read('public/quality-models-full/'+multi.path);
  assert.deepEqual(report.discoveryDates,Array.from({length:Date.parse(e.scope.dateEnd)-Date.parse(e.scope.dateStart)===0?1:(Date.parse(e.scope.dateEnd)-Date.parse(e.scope.dateStart))/86400000+1},(_,i)=>new Date(Date.parse(e.scope.dateStart)+i*86400000).toISOString().slice(0,10)));
  assert.deepEqual(report.validationDates,[]);
  assert.deepEqual(ml.validationDates,[]);
  assert.equal(ml.analysisMode,'all');
  assert.equal(ml.discoveryDates.length,report.discoveryDates.length);
  assert(report.scopeKey.startsWith('full-'));
  assert(ml.scopeKey===report.scopeKey);
  assert.notEqual(report.scopeKey,baseline.scopeKey);
  for(const card of report.candidates){
   assert.equal(card.validationStatus,'not-applicable');assert.equal(card.validationNewCustomers,0);
   assert(card.poorCustomerCount>=3&&card.poorDateCount>=2);
   assert.equal(card.rangeReviewRequired,card.rank===null);
   const d=read('public/quality-improvement-full/'+card.detailPath);
   assert.equal(d.scopeKey,report.scopeKey);
   assert.equal(d.candidate.memberCallIds.length,card.poorCallCount);
   assert.equal(d.calls.length,card.poorCallCount);
   assert.deepEqual(new Set(d.calls.map(c=>c.callId)),new Set(d.candidate.memberCallIds));
   assert(new Set(d.calls.map(c=>c.customerId)).size===card.poorCustomerCount);
   assert(d.calls.every(c=>c.mos>=1&&c.mos<3&&report.discoveryDates.includes(c.date)));
   assert(d.candidate.nearbyPoints.every(p=>p.role==='discovery-member'));
  }
  assert.deepEqual(Object.keys(ml.models).sort(),ids.slice().sort());
  for(const id of ids){
   const data=ml.models[id];
   assert.equal(data.candidates.length,multi.candidateCounts[id]);
   assert(data.candidates.every(c=>c.members.every(p=>ml.discoveryDates.includes(p.date))&&c.validationPoints.length===0&&c.validationStatus==='not-applicable'));
  }
 }
});
test('five-day full-period results add Oct 30 to candidate calculation, not a claimed holdout',()=>{
 const get=(idx,path,mode)=>read(path+'/'+idx.entries.find(e=>e.scope.dateStart==='2026-10-26'&&e.scope.dateEnd==='2026-10-30').path);
 const a=get(full,'public/quality-improvement-full'),b=get(old,'public/quality-improvement');
 const m=get(fullModels,'public/quality-models-full'),oldm=get(evalModels,'public/quality-models');
 assert.equal(a.candidates.length,8);assert.equal(b.candidates.length,7);
 assert.equal(a.discoveryDates.length,5);assert.equal(b.discoveryDates.length,4);
 assert.equal(m.models.st_dbscan.candidates.length,7);assert.equal(oldm.models.st_dbscan.candidates.length,5);
 assert.equal(m.models.adaptive_kde.candidates.length,18);
 assert.equal(m.models.hdbscan.candidates.length,20);
 assert.deepEqual(m.validationDates,[]);assert.deepEqual(oldm.validationDates,['2026-10-30']);
});
test('default mode and mode-isolated fetches exist in client',()=>{
 const ui=historicalRead(path.join(root,'components/analyst/quality-improvement-candidate-panel.tsx'),'utf8');
 const src=historicalRead(path.join(root,'lib/analyst/quality-model-alternatives.ts'),'utf8');
 assert(ui.includes("useState<'all'|'evaluation'>('all')"));
 assert(ui.includes("disabled={!eligibleEvaluation}"));
 assert(ui.includes("loadQualityCandidateSummary(scope,controller.signal,effectiveMode,proposalTwo?'mixed':'strict')"));
 assert(ui.includes("loadQualityCandidateDetail(summary,activeId,controller.signal,effectiveMode)"));
 assert(ui.includes('analysisMode={effectiveMode}'));
 assert(src.includes("'/qoe/quality-models-full/'"));
});
