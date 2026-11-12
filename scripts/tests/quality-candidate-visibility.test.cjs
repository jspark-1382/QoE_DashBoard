// Historical source assertions use the preserved original cohort; current sources have a separate census test.
const {historicalRead,historicalJson,skipHistoricalSource}=require('./published-fixture.cjs');
if(skipHistoricalSource(__filename))return;
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {load}=require('../analyst-ts-loader.cjs');
const root=path.resolve(__dirname,'../..');
const {coreMinDays,isCoreCandidate,isCandidateShown,CORE_MIN_CALLS,CORE_MIN_CUSTOMERS}=load('lib/analyst/quality-candidate-visibility.ts');
const idx=historicalJson('../../public/quality-improvement-mixed-full/index.json');
const record=idx.entries.find(x=>x.scope.dateStart==='2026-10-26'&&x.scope.dateEnd==='2026-10-30'&&x.scope.from==='00:00'&&x.scope.to==='23:59');
const summary=JSON.parse(historicalRead(path.join(root,'public/quality-improvement-mixed-full',record.path),'utf8'));
test('default filter is a display-only 6 calls, 3 independent customers, 3 observed days',()=>{
 assert.equal(CORE_MIN_CALLS,6);
 assert.equal(CORE_MIN_CUSTOMERS,3);
 assert.equal(coreMinDays('2026-10-26','2026-10-30'),3);
 assert.equal(coreMinDays('2026-10-26','2026-10-27'),2);
 assert.equal(coreMinDays('2026-10-30','2026-10-30'),1);
 assert.equal(isCoreCandidate(6,3,3,3),true);
 assert.equal(isCoreCandidate(5,5,5,3),false);
 assert.equal(isCoreCandidate(6,2,5,3),false);
 assert.equal(isCoreCandidate(8,8,2,3),false);
 assert.equal(isCandidateShown(3,3,2,3,'all'),true);
});
test('five-day mixed DBSCAN retains 10 of 22 areas and 101 original low-MOS call members',()=>{
 const input=summary.candidates.map(c=>({...c}));
 const core=input.filter(c=>isCandidateShown(c.poorCallCount,c.poorCustomerCount,c.poorDateCount,3,'core'));
 assert.equal(summary.candidates.length,22);
 assert.equal(core.length,10);
 assert.equal(core.reduce((n,c)=>n+c.poorCallCount,0),101);
 assert.equal(core.reduce((n,c)=>n+c.gnssCallCount,0),49);
 assert.deepEqual(core.map(c=>c.id),summary.candidates.slice(0,10).map(c=>c.id));
 assert.deepEqual(summary.candidates,input,'filter must not mutate published candidates');
});
test('five alternate models use same core visibility rule, raw model candidates remain intact',()=>{
 const idx=historicalJson('../../public/quality-models-mixed-full/index.json');
 const entry=idx.entries.find(x=>x.scope.dateStart==='2026-10-26'&&x.scope.dateEnd==='2026-10-30');
 const data=JSON.parse(historicalRead(path.join(root,'public/quality-models-mixed-full',entry.path),'utf8'));
 const expected={hdbscan:10,st_dbscan:8,adaptive_kde:12,spatial_scan:20,bayesian:20};
 for(const [id,count] of Object.entries(expected)){
  const all=data.models[id].candidates;
  assert.equal(all.length,20);
  assert.equal(all.filter(c=>isCandidateShown(c.poorCalls,c.poorCustomers,c.days,3,'core')).length,count,id);
  assert.equal(all.filter(c=>isCandidateShown(c.poorCalls,c.poorCustomers,c.days,3,'all')).length,20,id);
 }
});
