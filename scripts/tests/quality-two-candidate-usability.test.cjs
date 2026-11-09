/* Existing raw evidence must validate the improvement 2 presentation: no inferred repeats. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {load}=require('../analyst-ts-loader.cjs');
const root=path.resolve(__dirname,'../..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const {buildCandidateCustomerRows,repeatedCustomerCount,candidateAdministrativeDong,candidateEvidenceSummary,candidateStatus,candidateTitle,verifyCandidateSummaryConsistency}=load('lib/analyst/quality-two-candidate-view-model.ts');
const index=read('public/quality-improvement/index.json');
const entry=index.entries.find(x=>x.scope.dateStart==='2026-10-26'&&x.scope.dateEnd==='2026-10-30'&&x.scope.from==='00:00'&&x.scope.to==='23:59');
const summary=read('public/quality-improvement/'+entry.path);

test('5-day strict candidate summary is bound to source revision and 7 independently identified areas',()=>{
 assert.equal(summary.scope.sourceRevision,index.sourceRevision);
 assert.equal(summary.scope.policy,'strict-3-site-v1');
 assert.equal(summary.candidates.length,7);
 assert.equal(new Set(summary.candidates.map(x=>x.id)).size,7);
 assert.equal(summary.candidates.filter(c=>c.validationStatus==='reobserved').length,3);
 assert(summary.candidates.some(c=>c.rank===null&&c.rangeReviewRequired===true));
 assert.equal(candidateTitle(0),'후보 지역 1');
 assert.equal(candidateStatus(summary.candidates[0]).label,'범위 검토 필요');
});

test('every candidate matches individual source call IDs, low MOS, distinct customer counts, dates, validation, and GNSS/radio evidence',()=>{
 for(const card of summary.candidates){
  const detail=read('public/quality-improvement/'+card.detailPath);
  assert.deepEqual(verifyCandidateSummaryConsistency(summary,detail),[],card.label);
  const evidence=candidateEvidenceSummary(detail);
  assert.equal(evidence.gnss+evidence.radio,card.poorCallCount,card.id);
  const rows=buildCandidateCustomerRows(detail);
  assert.equal(rows.filter(c=>c.discoveryCalls>0).length,card.poorCustomerCount,card.id);
  assert.equal(rows.reduce((a,b)=>a+b.discoveryCalls,0),card.poorCallCount,card.id);
  assert.equal(rows.filter(c=>c.discoveryCalls===0&&c.verificationCalls>0).length,card.validationNewCustomers,card.id);
  assert(rows.every(r=>r.calls.every(c=>c.mos!=null&&c.mos>=1&&c.mos<3)));
  assert(rows.every(r=>r.calls.every(c=>c.isDiscovery!==c.isVerification)));
 }
});

test('first area: five different customers have one discovery call each across three days, not five customers with repeat calls',()=>{
 const card=summary.candidates[0];
 const detail=read('public/quality-improvement/'+card.detailPath);
 const rows=buildCandidateCustomerRows(detail);
 assert.equal(card.poorCustomerCount,5);
 assert.equal(card.poorCallCount,5);
 assert.equal(card.poorDateCount,3);
 assert.equal(card.validationNewCustomers,2);
 assert.equal(rows.filter(r=>r.discoveryCalls>0).length,5);
 assert.equal(rows.filter(r=>r.verificationCalls>0).length,2);
 assert.equal(repeatedCustomerCount(rows),0,'same-customer repeat is not independent-customer repeat');
 assert.equal(rows.filter(r=>r.discoveryCalls===0&&r.verificationCalls===1).length,2);
});

test('two low MOS calls from the same customer count as one repeated customer, not two affected customers',()=>{
 const first=read('public/quality-improvement/'+summary.candidates[0].detailPath);
 const one=first.calls[0],two={...one,callId:'2',rawCallId:'2',date:'2026-10-28'};
 const duplicate={...first,candidate:{...first.candidate,memberCallIds:[one.callId,two.callId],nearbyPoints:[
 {...first.candidate.nearbyPoints[0],callId:one.callId},
 {...first.candidate.nearbyPoints[0],callId:two.callId,date:'2026-10-28'}]},calls:[one,two]};
 const rows=buildCandidateCustomerRows(duplicate);
 assert.equal(rows.length,1);
 assert.equal(rows[0].discoveryCalls,2);
 assert.equal(rows[0].poorDates,2);
 assert.equal(repeatedCustomerCount(rows),1);
});

test('candidate area names are sourced only from the actual point-in-polygon administrative boundaries',()=>{
 const overview=read('public/analyst-overview/MDT/2026-10-30.json');
 const card=summary.candidates[0];
 const name=candidateAdministrativeDong(overview,card.medoid.lat,card.medoid.lon);
 assert.equal(typeof name,'string');
 assert(overview.administrativeDongs.some(d=>d.label===name));
 assert.equal(candidateAdministrativeDong(overview,-99,-99),null);
 assert.equal(candidateAdministrativeDong({administrativeDongs:[]},card.medoid.lat,card.medoid.lon),null);
 assert.equal(candidateAdministrativeDong(overview,NaN,127),null);
});

test('UI separates new candidate panel from 1 and hides reporting outlines by default',()=>{
 const panel=fs.readFileSync(path.join(root,'components/analyst/quality-improvement-candidate-panel.tsx'),'utf8');
 const two=fs.readFileSync(path.join(root,'components/analyst/quality-two-candidate-workspace.tsx'),'utf8');
 const rootUi=fs.readFileSync(path.join(root,'components/analyst/quality-proposal-four.tsx'),'utf8');
 const css=fs.readFileSync(path.join(root,'components/analyst/quality-proposal-four.module.css'),'utf8');
 assert(panel.includes('if(proposalTwo)return'));
 assert(panel.includes('<CandidateWorkspaceView'),'1 must retain its own shared candidate view');
 for(const label of ['조사 후보 지역 목록','선택한 조사 대상','선정 이유','선택 지역의 고객별 통화','원본 근거·Cell·RF','후보 구성 위치 근거','후보 범위가 다른 후보와 겹칠 수 있어'])
  assert(two.includes(label),'missing explanation '+label);
 assert(!rootUi.includes('QualityTwoHeader'));
 assert(rootUi.includes('data-review-mode="off"'));
 assert(css.includes('.improvementTwo[data-review-mode="on"] .kpis'));
 assert(!css.includes('.improvementTwo .kpis::before,.improvementTwo .charts::before,.improvementTwo .geography::before{content'));
});
