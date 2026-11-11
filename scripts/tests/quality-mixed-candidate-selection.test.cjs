/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {load}=require('../analyst-ts-loader.cjs');
const root=path.resolve(__dirname,'../..');
const dirs={
  mixed:'public/quality-improvement-mixed-full',
  eval:'public/quality-improvement-mixed-evaluation',
  strict:'public/quality-improvement-full'
};
const read=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'));
const indexes=Object.fromEntries(Object.entries(dirs).map(([key,prefix])=>[key,read(prefix+'/index.json')]));
const five=idx=>idx.entries.find(e=>e.scope.dateStart==='2026-10-26'&&e.scope.dateEnd==='2026-10-30');
const full=five(indexes.mixed),prior=five(indexes.strict),hold=five(indexes.eval);
assert(full&&prior&&hold);
const summary=read(dirs.mixed+'/'+full.path),original=read(dirs.strict+'/'+prior.path),evalSummary=read(dirs.eval+'/'+hold.path);
const originalPoints=read(dirs.strict+'/'+original.observationPath).points;
const points=read(dirs.mixed+'/'+summary.observationPath).points;
const dates=[26,27,28,29,30].map(i=>'2026-10-'+i);
const overview=load('lib/analyst/date-range.ts').combineDateOverviews(
  dates.map(d=>read('public/analyst-overview/MDT/'+d+'.json')));
const rough=load('lib/analyst/quality-candidate-rough-points.ts').buildCandidateRoughPoints(
  overview,{dateStart:dates[0],dateEnd:dates.at(-1),from:'00:00',to:'23:59',
    sourceRevision:overview.sourceRevision,policy:'strict-3-site-v1'},
  dates.map(d=>read('public/three-site-rough/'+d+'.json')));
const mixedTag='gps-mdt-rough-unvalidated-v1';
test('new mixed DBSCAN uses 131 original GPS and 106 existing poor-MDT estimates, exactly 237 distinct calls',()=>{
 assert.equal(summary.locationMode,mixedTag);
 assert.equal(summary.locationUnvalidated,true);
 assert.deepEqual(summary.inputCounts,{gnss:131,rough:106});
 assert.equal(points.length,237);
 assert.equal(new Set(points.map(p=>p.callId)).size,237);
 assert.deepEqual(points.filter(p=>p.kind==='gnss').map(p=>p.callId).sort(),
  originalPoints.map(p=>p.callId).sort(),'audited original GPS call IDs are unchanged');
 assert.deepEqual(points.filter(p=>p.kind==='rough').map(p=>p.callId).sort(),
  rough.map(p=>p.date+':'+p.callId).sort(),'all rough input IDs must match existing 106 low-QoE overlays');
 assert(points.filter(p=>p.kind==='rough').every(p=>
    p.positionStatus==='unvalidated'&&p.estimationMethod==='THREE_SITE_RSRP_CENTROID'&&
    p.roughSearchRadiusM>=600&&p.roughSearchRadiusM<=5000));
});
test('original 8 strict candidates untouched, mixed calculation yields 22 with 19 MDT-inclusive candidates',()=>{
 assert.equal(original.candidates.length,8);
 assert.equal(summary.candidates.length,22);
 assert.equal(summary.candidates.filter(c=>c.roughCallCount>0).length,19);
 assert.equal(summary.inputCounts.gnss+summary.inputCounts.rough,237);
 assert(summary.candidates.some(c=>c.medoid.kind==='rough'),'some representative centers are unvalidated MDT points');
});
test('each published candidate has evidence for every member, valid counts and provisional decision labels',()=>{
 const source=new Map(points.map(p=>[p.callId,p]));
 let count=0,roughMembers=0;
 for(const card of summary.candidates){
  const detail=read(dirs.mixed+'/'+card.detailPath),candidate=detail.candidate;
  assert.equal(detail.locationMode,mixedTag);
  assert.equal(detail.scopeKey,summary.scopeKey);
  assert.equal(detail.calls.length,candidate.nearbyPoints.length);
  assert.equal(new Set(candidate.memberCallIds).size,candidate.memberCallIds.length);
  assert.equal(card.poorCallCount,candidate.memberCallIds.length);
  assert.equal(card.poorCustomerCount,new Set(detail.calls.map(c=>c.customerId)).size);
  assert.equal(card.poorDateCount,new Set(detail.calls.map(c=>c.date)).size);
  assert.equal(card.gnssCallCount+card.roughCallCount,card.poorCallCount);
  assert.equal(card.roughCallCount,candidate.memberCallIds.filter(id=>source.get(id)?.kind==='rough').length);
  assert.equal(card.gnssCallCount,candidate.memberCallIds.filter(id=>source.get(id)?.kind==='gnss').length);
  assert(candidate.nearbyPoints.every(p=>p.role==='discovery-member'));
  assert(candidate.memberCallIds.every(id=>source.has(id)));
  assert.equal(detail.decisions.filter(p=>p.status==='provisional').length,card.roughCallCount);
  assert(detail.decisions.filter(p=>p.status==='provisional').every(p=>p.kind==='rough'&&p.reasons.includes('position-accuracy-unvalidated')));
  assert(detail.decisions.filter(p=>p.kind==='gnss').every(p=>p.status==='accepted'));
  roughMembers+=card.roughCallCount;count++;
 }
 assert.equal(count,22);
 assert(roughMembers>0);
});
test('all 15 date ranges and 6 valid evaluation ranges publish separate audited/unvalidated status',()=>{
 assert.equal(indexes.mixed.entries.length,15);
 assert.equal(indexes.eval.entries.length,6);
 assert.equal(indexes.mixed.locationMode,mixedTag);
 assert.equal(indexes.eval.locationMode,mixedTag);
 for(const [name,prefix] of [['mixed',dirs.mixed],['eval',dirs.eval]]){
  for(const entry of indexes[name].entries){
   const s=read(prefix+'/'+entry.path);
   assert.equal(s.locationMode,mixedTag);
   assert.equal(s.scope.sourceRevision,overview.sourceRevision);
   assert.equal(s.scope.policy,'strict-3-site-v1','existing source reference, not validation claim');
   assert(s.candidates.every(card=>fs.existsSync(path.join(root,prefix,card.detailPath))));
   assert.equal(new Set(s.candidates.map(c=>c.id)).size,s.candidates.length);
   if(name==='mixed')assert.equal(s.validationDates.length,0);
   else assert.equal(s.validationDates.length,1);
  }
 }
 assert.equal(evalSummary.candidates.length,18);
 assert.deepEqual(evalSummary.validationDates,['2026-10-30']);
});
test('candidate map selected layer contains exactly the selected candidate MDT member calls, not all 106',()=>{
 const {buildQualityPresentationCandidates}=load('lib/analyst/quality-candidate-presentation.ts');
 const {matchCandidateRoughPoints}=load('lib/analyst/quality-candidate-rough-membership.ts');
 const {candidateEvidenceSummary}=load('lib/analyst/quality-two-candidate-view-model.ts');
 const mapped=buildQualityPresentationCandidates(summary,null);
 const matched=matchCandidateRoughPoints(mapped,rough);
 for(const card of summary.candidates){
  const detail=read(dirs.mixed+'/'+card.detailPath);
  const members=new Set(detail.candidate.nearbyPoints.filter(p=>p.kind==='rough'&&p.role==='discovery-member').map(p=>p.callId));
  const selected=matched.filter(p=>
     p.matchingCandidateIds.includes(card.id)&&
     members.has(p.callId.startsWith(p.date+':')?p.callId:p.date+':'+p.callId));
  assert.equal(selected.length,card.roughCallCount);
  const evidence=candidateEvidenceSummary(detail);
  assert.equal(evidence.gnss,card.gnssCallCount);
  assert.equal(evidence.rough,card.roughCallCount);
  assert.equal(evidence.radio,0);
 }
});
test('UI defaults to mixed while strict original files and GPS-only alternative models are clearly distinct',()=>{
 const panel=fs.readFileSync(path.join(root,'components/analyst/quality-improvement-candidate-panel.tsx'),'utf8');
 const ui=fs.readFileSync(path.join(root,'components/analyst/quality-two-candidate-workspace.tsx'),'utf8');
 const alt=fs.readFileSync(path.join(root,'components/analyst/quality-model-alternative-workspace.tsx'),'utf8');
 const loader=fs.readFileSync(path.join(root,'lib/analyst/quality-improvement-candidates.ts'),'utf8');
 assert(panel.includes("proposalTwo?'mixed':'strict'"));
 assert(loader.includes("'/qoe/quality-improvement-mixed-full/'"));
 assert(loader.includes("'/qoe/quality-improvement-mixed-evaluation/'"));
 assert(ui.includes("p=>p.kind==='rough'&&p.role==='discovery-member'"));
 assert(ui.includes('roughUsedForCandidate={usingMixed}'));
 assert(ui.includes("MDT 근사 '+evidence.rough"));
 assert(alt.includes('GPS와 MDT RSRP 가중중심 근사를 DBSCAN과 동일한 저QoE 입력으로 사용합니다.'));
});
