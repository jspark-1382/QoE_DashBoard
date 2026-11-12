// Numerical source regressions retain the original two-workbook cohort.
const {historicalRead,historicalJson,skipHistoricalSource}=require('./published-fixture.cjs');
if(skipHistoricalSource(__filename))return;
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {load}=require('../analyst-ts-loader.cjs');
const root=path.resolve(__dirname,'../..');
const read=filename=>JSON.parse(historicalRead(path.join(root,filename),'utf8'));
const D={all:'public/quality-models-mixed-full',evaluation:'public/quality-models-mixed-evaluation'};
const baseline={all:'public/quality-improvement-mixed-full',evaluation:'public/quality-improvement-mixed-evaluation'};
const methodNames=['hdbscan','st_dbscan','adaptive_kde','spatial_scan','bayesian'];
const tag='gps-mdt-rough-unvalidated-v1';
const data=Object.fromEntries(Object.entries(D).map(([mode,directory])=>[mode,read(directory+'/index.json')]));
const scope5=e=>e.scope.dateStart==='2026-10-26'&&e.scope.dateEnd==='2026-10-30';
const get=(mode)=>read(D[mode]+'/'+data[mode].entries.find(scope5).path);
const full=get('all'),holdout=get('evaluation');
const original=read('public/quality-models-full/index.json');

test('five algorithms are independently regenerated for 15 full scopes + 6 holdout scopes, strict artifacts preserved',()=>{
 assert.equal(data.all.entries.length,15);assert.equal(data.evaluation.entries.length,6);
 assert.equal(original.entries.length,15);
 assert.equal(data.all.sourceRevision,original.sourceRevision);
 for(const mode of Object.keys(D)){
  const idx=data[mode],oldIdx=read(baseline[mode]+'/index.json');
  assert.equal(idx.locationMode,tag);
  assert.equal(idx.locationUnvalidated,true);
  for(const e of idx.entries){
   const report=read(D[mode]+'/'+e.path);
   assert.equal(report.locationMode,tag);
   assert.equal(report.analysisMode,mode);
   assert.equal(report.sourceRevision,idx.sourceRevision);
   assert.equal(report.scopeKey,e.scopeKey);
   assert.deepEqual(Object.keys(report.models).sort(),methodNames.slice().sort());
   const base=oldIdx.entries.find(x=>x.scope.dateStart===e.scope.dateStart&&x.scope.dateEnd===e.scope.dateEnd);
   assert(base);
   const summary=read(baseline[mode]+'/'+base.path);
   const observed=read(baseline[mode]+'/'+summary.observationPath).points;
   assert.equal(report.inputCounts.gpsPoor+report.inputCounts.roughPoor,
     observed.filter(p=>report.discoveryDates.includes(p.date)).length);
   assert.equal(report.coverage.poorLocated,
     report.inputCounts.gpsPoor+report.inputCounts.roughPoor+
       (mode==='evaluation'?observed.filter(p=>report.validationDates.includes(p.date)).length:0));
   for(const name of methodNames){
    const model=report.models[name];
    assert.equal(model.discoveryLocatedPoorCalls,report.inputCounts.gpsPoor+report.inputCounts.roughPoor);
    assert.equal(model.discoveryLocatedNormalCalls,report.inputCounts.gpsNormal+report.inputCounts.roughNormal);
    assert.equal(model.parameters.locationInputs,'GPS + MDT THREE_SITE_RSRP_CENTROID (unvalidated)');
    assert.equal(model.candidates.length,e.candidateCounts[name]);
    assert(model.candidates.length<=20);
    for(const candidate of model.candidates){
     assert.equal(candidate.locationMode,tag);
     assert.equal(candidate.locationUnvalidated,true);
     assert.equal(candidate.roughCalls,candidate.members.filter(p=>p.kind==='rough').length);
     assert.equal(candidate.gnssCalls,candidate.members.filter(p=>p.kind==='gnss').length);
     assert.equal(candidate.roughCalls+candidate.gnssCalls,candidate.poorCalls);
     assert.equal(new Set(candidate.members.map(p=>p.customerId)).size,candidate.poorCustomers);
     assert.equal(new Set(candidate.members.map(p=>p.date)).size,candidate.days);
     assert(candidate.members.every(p=>p.mos>=1&&p.mos<3&&report.discoveryDates.includes(p.date)));
     assert(candidate.members.every(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)));
     assert(candidate.members.filter(p=>p.kind==='rough').every(p=>
       p.positionStatus==='unvalidated'&&p.estimationMethod==='THREE_SITE_RSRP_CENTROID'));
     assert(candidate.validationPoints.every(p=>report.validationDates.includes(p.date)));
    }
   }
  }
 }
});
test('all algorithms share the full-window poor-call GPS 131 + RSRP MDT 106 and source-matched normal controls',()=>{
 assert.deepEqual(full.inputCounts,{gpsPoor:131,roughPoor:106,gpsNormal:294,roughNormal:159});
 assert.deepEqual(full.discoveryDates,['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30']);
 assert.equal(full.coverage.poorLocated,237);
 assert.equal(full.coverage.normalLocated,453);
 const roughAccepted=read('public/quality-improvement-mixed-full/index.json');
 const entry=roughAccepted.entries.find(scope5);
 const summary=read('public/quality-improvement-mixed-full/'+entry.path);
 const originals=read('public/quality-improvement-mixed-full/'+summary.observationPath).points;
 const originalsById=new Map(originals.map(p=>[p.callId,p]));
 for(const name of methodNames){
  const selected=full.models[name].candidates;
  assert(selected.length>0);
  assert(selected.some(c=>c.roughCalls>0));
  assert(selected.every(c=>c.members.every(p=>originalsById.get(p.callId)?.kind===p.kind)));
  assert.equal(full.models[name].discoveryLocatedPoorCalls,237);
  assert.equal(full.models[name].discoveryLocatedNormalCalls,453);
 }
 assert(full.models.hdbscan.candidates.some(c=>c.roughCalls>0));
 assert(full.models.st_dbscan.candidates.some(c=>c.roughCalls>0));
 assert(full.models.adaptive_kde.candidates.some(c=>c.roughCalls>0));
 assert(full.models.spatial_scan.candidates.some(c=>c.roughCalls>0));
 assert(full.models.bayesian.candidates.some(c=>c.roughCalls>0));
});
test('evaluation uses 4 days discovery GPS+MDT and Oct 30 out-of-sample only',()=>{
 assert.deepEqual(holdout.inputCounts,{gpsPoor:101,roughPoor:83,gpsNormal:229,roughNormal:135});
 assert.deepEqual(holdout.discoveryDates,['2026-10-26','2026-10-27','2026-10-28','2026-10-29']);
 assert.deepEqual(holdout.validationDates,['2026-10-30']);
 for(const name of methodNames){
  const model=holdout.models[name];
  assert.equal(model.discoveryLocatedPoorCalls,184);
  assert(model.candidates.every(c=>c.members.every(m=>m.date!=='2026-10-30')));
  assert(model.candidates.every(c=>c.validationPoints.every(p=>p.date==='2026-10-30')));
 }
});
test('each alternative model selects only its own MDT member call IDs; can show points outside display radius as member proof',()=>{
 const {buildCandidateRoughPoints}=load('lib/analyst/quality-candidate-rough-points.ts');
 const {combineDateOverviews}=load('lib/analyst/date-range.ts');
 const dates=[26,27,28,29,30].map(d=>'2026-10-'+d);
 const ov=combineDateOverviews(dates.map(d=>read('public/analyst-overview/MDT/'+d+'.json')));
 const rough=buildCandidateRoughPoints(ov,{sourceRevision:ov.sourceRevision,dateStart:dates[0],dateEnd:dates.at(-1),from:'00:00',to:'23:59',policy:'strict-3-site-v1'},dates.map(d=>read('public/three-site-rough/'+d+'.json')));
 for(const name of methodNames){
  for(const c of full.models[name].candidates){
   const ids=new Set(c.members.filter(p=>p.kind==='rough').map(p=>p.callId));
   const selected=rough.filter(p=>ids.has(p.callId.startsWith(p.date+':')?p.callId:p.date+':'+p.callId));
   assert.equal(selected.length,c.roughCalls,name+': selected layer must match actual rough model members');
  }
 }
});
test('UI uses mixed model API and correct GPS frequency/RSRP sidecar on every model map',()=>{
 const src=p=>historicalRead(path.join(root,p),'utf8');
 const client=src('components/analyst/quality-model-alternative-workspace.tsx');
 const panel=src('components/analyst/quality-improvement-candidate-panel.tsx');
 const lib=src('lib/analyst/quality-model-alternatives.ts');
 const map=src('components/analyst/improvement-candidate-map.tsx');
 assert(panel.includes("locationSource={proposalTwo?'mixed':'strict'}"));
 assert(client.includes('loadAlternativeModelReport(scope,ctrl.signal,analysisMode,locationSource)'));
 assert(!client.includes('GPS_BANDS.map'));
 assert(client.includes('roughUsedForCandidate={usingMixed}'));
 assert(client.includes("radioLabel:usingMixed?'MDT RSRP 근사 (미검증)'"));
 assert(src('components/analyst/quality-two-candidate-workspace.tsx').includes('c.roughCallCount??proof?.rough??0'));
 assert(!src('components/analyst/quality-investigation-rail.tsx').includes("(active.radioLabel??'검토 통과 삼각 측량')"));
 assert(client.includes('sourceRevision={overview.sourceRevision}'));
 assert(client.includes("active.members.filter(p=>p.kind==='rough')"));
 assert(client.includes("filter(p=>p.kind!=='rough')"));
 assert(lib.includes("'/qoe/quality-models-mixed-full/'"));
 assert(lib.includes("'/qoe/quality-models-mixed-evaluation/'"));
 assert(map.includes('roughUsedForCandidate||candidateCircleDistanceM'));
 assert(map.includes("gpsBand(rf?.earfcn)"));
 assert(map.includes("gpsMarkerSvg(band,rf?.rsrpDbm)"));
});
