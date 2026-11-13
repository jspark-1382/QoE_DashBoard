/* eslint-disable @typescript-eslint/no-require-imports -- Local Node tests. */
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const {createHash}=require('node:crypto');
const {createCandidateFixture,addAlternativeFixture}=require('./qwen-candidate-fixture.cjs');
const {collectCandidateEvidence,validateCandidateTarget,candidateRequestKey}=require('../qwen-candidate-evidence.cjs');
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'qwen-candidate-evidence-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return createCandidateFixture(root);}
const save=(file,value)=>fs.writeFileSync(file,JSON.stringify(value));

test('candidate collection uses all server-verified multi-customer members and no regional denominator',t=>{
 const f=fixture(t),before=digest(f.dbPath),db=new DatabaseSync(f.dbPath);
 // Same customer's additional normal call is not part of this location cohort.
 db.prepare('INSERT INTO calls VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('private-a:normal','normal','private-a','2026-10-26',36000,4,4,0,'private-cell-a','private-area',36010,'{}');db.close();
 const snapshot=digest(f.dbPath),e=collectCandidateEvidence(f);
 assert.equal(e.summary.customers,2);assert.equal(e.summary.totalCalls,3);assert.equal(e.summary.dropCalls,1);
 assert.equal(e.summary.meanQoe,1);assert.equal(e.summary.meanMos,1.833333);
 assert.equal(e.summary.regionalPoorRate,null);assert.equal(e.comparison.status,'unavailable');assert.equal(e.comparison.calls,null);
 assert.equal(e.members.length,3);assert.equal(e.calls.length,3);assert.equal(e.byDay.reduce((n,r)=>n+r.totalCalls,0),3);assert.equal(e.byCell.reduce((n,r)=>n+r.totalCalls,0),3);assert.equal(e.byHour.reduce((n,r)=>n+r.totalCalls,0),3);
 assert.equal(e.location.gpsCalls,2);assert.equal(e.location.roughCalls,1);assert.equal(e.coverage.population,'candidate-members');
 assert.equal(digest(f.dbPath),snapshot);assert.notEqual(before,snapshot);
 assert.ok(e.calls.some(c=>c.qoe===-1.5));
});

test('model declares the exact source-owned evidence alias policy with one unique sent T fact per canonical target',t=>{
 const e=collectCandidateEvidence(fixture(t)),input=e.modelInput;
 assert.equal(input.targetIdPolicy,'evidence-id-alias-v1');
 const aliases=input.analysisTargets.flatMap(target=>target.evidenceIds);
 assert.equal(aliases.length,input.analysisTargets.length);assert.equal(new Set(aliases).size,aliases.length);
 assert(aliases.every(alias=>/^T\d+$/.test(alias)&&input.facts.some(fact=>fact.id===alias)));
 assert(input.analysisTargets.every(target=>e.analysisTargets.some(source=>source.id===target.id&&source.evidenceIds[0]===target.evidenceIds[0])));
 assert(input.analysisTargets.every(target=>!/^T\d+$/.test(target.id)),'canonical target IDs are preserved; wire policy only declares their exact evidence aliases');
});

test('full population remains separate from bounded deterministic details and model omits identifiers',t=>{
 const f=fixture(t),db=new DatabaseSync(f.dbPath),insert=db.prepare('INSERT INTO calls VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
 for(let i=0;i<40;i++){
  const raw='extra-'+i,id='private-extra-'+i+':'+raw,memberId='2026-10-26:'+id;
  insert.run(id,raw,'private-extra-'+i,'2026-10-26',38000+i,2,2,0,'private-cell-a','private-area',38010+i,'{}');
  f.detail.calls.push({date:'2026-10-26',callId:memberId,rawCallId:raw,customerId:'private-extra-'+i,mos:2,sourceRevision:f.sourceRevision});
  f.detail.candidate.memberCallIds.push(memberId);f.detail.candidate.nearbyPoints.push({callId:memberId,customerId:'private-extra-'+i,date:'2026-10-26',lat:37.50001,lon:127.05001,kind:'gnss',role:'discovery-member'});
 }
 db.close();f.detail.candidate.poorCallCount=43;f.detail.candidate.poorCustomerCount=42;
 Object.assign(f.summary.candidates[0],{poorCallCount:43,poorCustomerCount:42,gnssCallCount:42});save(f.detailPath,f.detail);save(f.summaryPath,f.summary);
 const e=collectCandidateEvidence(f),model=JSON.stringify(e.modelInput);
 assert.equal(e.summary.totalCalls,43);assert.equal(e.members.length,43);assert.equal(e.calls.length,32);assert.equal(e.coverage.sampledCalls,32);
 for(const forbidden of ['private-a','private-b','private-cell','PRIVATE-CONTRACT','customerId','rawCallId','href','37.50001','127.05001',f.target.candidateId,e.candidate.memberSetHash,e.fingerprint])assert.equal(model.includes(forbidden),false,forbidden);
 assert.equal(model.includes('scopeKey'),false);assert.equal(model.includes('medoid'),false);assert.equal(model.includes('"lat"'),false);assert.equal(model.includes('"lon"'),false);
 assert.equal(e.facts.filter(fact=>/^E\d+$/.test(fact.id)).length,13);
 assert.equal(e.analysisTargets.filter(target=>target.kind==='call-quality').length,6);
 assert(e.analysisTargets.every(target=>target.evidenceIds.every(id=>e.facts.some(fact=>fact.id===id))));
 assert.equal(e.sop.templates.length,e.modelInput.sop.templates.length);
 assert.deepEqual(e.sop.templates.map(s=>s.id),e.modelInput.sop.templates.map(s=>s.id));
});

test('missing radio, RTP and background references stay missing and alter draft procedure selection',t=>{
 const f=fixture(t),db=new DatabaseSync(f.dbPath);db.exec('DELETE FROM days');db.close();
 f.detail.candidate.rangeReviewRequired=false;f.summary.candidates[0].rangeReviewRequired=false;save(f.detailPath,f.detail);save(f.summaryPath,f.summary);
 const e=collectCandidateEvidence(f);
 assert.equal(e.coverage.radioCalls,0);assert.equal(e.coverage.rtpCalls,0);assert.equal(e.coverage.matchedMdt.status,'unavailable');assert.equal(e.coverage.matchedMdt.measurementRows,null);assert.equal(e.mdtGrid.status,'unavailable');
 assert.equal(e.radio.meanRsrp,null);assert(e.rtp.every(r=>r.mean===null));
 assert.equal(e.sop.templates[0].id,'COMPARISON_CHECK');assert(!e.sop.templates.some(s=>s.id==='RADIO_REVIEW'||s.id==='RTP_REVIEW'));
 assert.match(e.sop.templates.find(s=>s.id==='TIMING_ALIGNMENT').reason,/부족/);
 assert(e.calls.every(c=>c.rsrp===null&&c.sinr===null));
});

test('range review and data-backed branches keep real evidence references without workflow checkboxes',t=>{
 const e=collectCandidateEvidence(fixture(t)),ids=new Set(e.facts.map(f=>f.id));
 assert.equal(e.sop.status,'draft');assert.equal(e.sop.templates[0].id,'COMPARISON_CHECK');
 for(const id of ['COMPARISON_CHECK','TIMING_ALIGNMENT','POST_CHANGE_CHECK'])assert(e.sop.templates.some(s=>s.id===id));
 for(const step of e.sop.templates){assert(step.evidenceIds.every(id=>ids.has(id)));for(const key of ['materials','method','outcomes','additionalData'])assert(step[key].length);assert.equal(Object.hasOwn(step,'completed'),false);}
 assert.match(e.sop.notice,/회사 승인 절차가 아닌/);
 assert.match(e.sop.templates.find(s=>s.id==='POST_CHANGE_CHECK').reason,/별도 검증일이 없어/);
});

test('candidate target rejects browser-provided cohorts, malformed identity and unsupported algorithms',t=>{
 const f=fixture(t),target=f.target;
 for(const value of [null,{}, {...target,candidateId:'../other'},{...target,callIds:['made-up']},{...target,customerId:'x'},{...target,scope:{...target.scope,from:'24:00'}},{...target,scope:{...target.scope,dateStart:'2026-02-30'}},{...target,candidateScope:{...target.candidateScope,modelId:'invented'}}])assert.throws(()=>validateCandidateTarget(value),e=>e.code==='INVALID_CANDIDATE_TARGET');
 assert.throws(()=>collectCandidateEvidence({...f,sourceRevision:'stale'}),e=>e.code==='STALE_REVISION');
 assert.throws(()=>collectCandidateEvidence({...f,target:{...target,candidateId:'unknown'}}),e=>e.code==='CANDIDATE_NOT_FOUND');
 assert.throws(()=>collectCandidateEvidence({...f,target:{...target,candidateScope:{...target.candidateScope,scopeKey:'wrong-scope'}}}),e=>e.code==='CANDIDATE_SCOPE_MISMATCH');
});

test('changed artifacts invalidate cache identity and bad members or paths cannot be accepted',t=>{
 const f=fixture(t),key=candidateRequestKey(f.target,f.publicDir),request=candidateRequestKey(f.target);
 f.summary.candidates[0].rank=2;save(f.summaryPath,f.summary);
 assert.notEqual(candidateRequestKey(f.target,f.publicDir),key);assert.equal(candidateRequestKey(f.target),request);
 f.detail.candidate.nearbyPoints[0].lat=null;save(f.detailPath,f.detail);
 assert.throws(()=>collectCandidateEvidence(f),e=>e.code==='CANDIDATE_EVIDENCE_MISMATCH');
 f.index.entries[0].path='../outside.json';save(f.indexPath,f.index);
 assert.throws(()=>candidateRequestKey(f.target,f.publicDir),e=>e.code==='CANDIDATE_EVIDENCE_MISMATCH');
});

test('candidate source verification rejects absent members and out-of-range days without changing source',t=>{
 const f=fixture(t),db=new DatabaseSync(f.dbPath);db.prepare('UPDATE calls SET customer_id=? WHERE raw_id=?').run('other-customer','call-a');db.close();
 assert.throws(()=>collectCandidateEvidence(f),e=>e.code==='CANDIDATE_EVIDENCE_MISMATCH');
});

test('all five alternative model artifacts bind candidate IDs, parameters and verified member set',t=>{
 for(const modelId of ['hdbscan','st_dbscan','adaptive_kde','spatial_scan','bayesian']){
  const f=fixture(t),alt=addAlternativeFixture(f,modelId),e=collectCandidateEvidence({...f,target:alt.target});
  assert.equal(e.summary.totalCalls,3,modelId);assert.equal(e.summary.customers,2);assert.equal(e.comparison.status,'unavailable');
  assert.equal(e.target.candidateScope.modelId,modelId);assert.deepEqual(e.candidate.parameters,alt.report.models[modelId].parameters);
  assert.throws(()=>collectCandidateEvidence({...f,target:{...alt.target,candidateId:'from-another-model'}}),e=>e.code==='CANDIDATE_NOT_FOUND');
  alt.report.models[modelId].candidates[0].members[0].date='2026-10-29';save(alt.reportPath,alt.report);
  assert.throws(()=>collectCandidateEvidence({...f,target:alt.target}),e=>e.code==='CANDIDATE_EVIDENCE_MISMATCH');
 }
});

test('server procedures expose actionable conditions and post-change checks only for available causes',t=>{
 const e=collectCandidateEvidence(fixture(t));
 assert.equal(e.sop.version,'candidate-sop-draft-v7');
 for(const step of e.sop.templates){
  assert(['radio','rtp','drop','members'].includes(step.targetKind));
  assert(step.checkNow.length>0);assert(step.verifyAfter.length>0);
  assert(step.conditionalActions.length>0);
  assert(step.conditionalActions.every(row=>row.when.trim()&&row.action.trim()));
 }
 assert.equal(e.analysisTargets.filter(target=>target.sopIds.length).length,0);
 assert(e.analysisTargets.some(target=>target.kind==='call-quality'));
 assert(e.sop.templates.every(step=>step.targetKind==='members'));
 const f=fixture(t);const enriched={analysisSchemaVersion:'mdt-grid-analysis-v1',records:[{pot:'POT_FIXTURE',lat:37.5,lon:127.05,analysis:[{date:'2026-11-03',band:'900(B8)',earfcn:'3743',samples:268,rsrpMean:-98.2684,rsrqMean:-16.5937,phrMean:null,belowPct:{'-105':48.5075,'-110':20.5224},metricSamples:{'-105':268,'-110':268}}]}]};f.write('quality-improvement/mdt-grid-analysis-v1.json',enriched);f.write('quality-improvement/mdt-grid-25m-v1.json',{...enriched,analysisSchemaVersion:undefined,analysisSource:'quality-improvement/mdt-grid-analysis-v1.json',records:enriched.records.map(({analysis:_analysis,...display})=>display)});
 f.write('quality-improvement/candidate-termination-v1.json',{schemaVersion:'qoe-candidate-termination-v1',sourceRevision:f.sourceRevision,records:{[f.detail.calls[1].callId]:{fcRaw:'9563',byeReasonRaw:'102^RTP timeout',reasonRaw:'H : Drop/V : Rx_RTP_middle_Loss',releaseCauseRaw:'0: Tx Bye'}}});
 const targeted=collectCandidateEvidence(f),causeTargets=targeted.analysisTargets.filter(target=>target.sopIds.length);assert.equal(causeTargets.length,2);
 for(const target of causeTargets){const procedure=targeted.sop.templates.find(s=>target.sopIds.includes(s.id));assert(procedure);assert.deepEqual(procedure.evidenceIds,target.evidenceIds);assert(procedure.checkNow.length);assert(procedure.conditionalActions.length);assert(procedure.verifyAfter.length);}
 assert(targeted.analysisTargets.filter(target=>['call-quality','call-pattern'].includes(target.kind)).every(target=>target.sopIds.length===0&&target.allowedCauseCategories.length===0));
 const sent=JSON.stringify(targeted.modelInput);assert(!sent.includes('POT_FIXTURE'));assert(!sent.includes('"lat"'));assert(sent.includes('48.51'));assert(sent.includes('RTP timeout'));assert.equal(targeted.analysisTargets.find(t=>t.kind==='mdt-grid').mapPoints[0].lat,37.5);

});
test('zero Drop and absent detailed metrics cannot supply cause-specific procedures',t=>{
 const f=fixture(t),db=new DatabaseSync(f.dbPath);
 db.exec('DELETE FROM days; UPDATE calls SET is_drop=0');db.close();
 const e=collectCandidateEvidence(f);
 assert.equal(e.summary.dropCalls,0);
 assert(!e.sop.templates.some(row=>['RADIO_REVIEW','RTP_REVIEW','SIP_REVIEW'].includes(row.id)));
 assert(e.sop.templates.every(row=>row.targetKind==='members'));
});

test('thin/full grid mismatch fails rather than interpreting a mixed publication generation',()=>{
 const {validateGridPair}=require('../qwen-candidate-evidence.cjs');
 const display={analysisSource:'quality-improvement/mdt-grid-analysis-v1.json',sourceDates:['2026-11-03'],sources:[{file:'a',sourceRows:1}],records:[{pot:'p',lat:37,lon:127,rsrp:-90,samples:2,bands:{'900':[-90,2]}}]};
 const full={...structuredClone(display),analysisSchemaVersion:'mdt-grid-analysis-v1'};full.records[0].analysis=[{date:'2026-11-03'}];assert.doesNotThrow(()=>validateGridPair(display,full));
 full.records[0].rsrp=-91;assert.throws(()=>validateGridPair(display,full),e=>e.code==='CANDIDATE_EVIDENCE_MISMATCH');full.records[0].rsrp=-90;full.sources[0].sourceRows=2;assert.throws(()=>validateGridPair(display,full),e=>e.code==='CANDIDATE_EVIDENCE_MISMATCH');
});

test('inputSignature mismatch rejects even when legacy projections match',()=>{
 const {validateGridPair}=require('../qwen-candidate-evidence.cjs');
 const display={inputSignature:'old',records:[{pot:'p',lat:37.5,lon:127}]};
 const full={...structuredClone(display),inputSignature:'new',analysisSchemaVersion:'mdt-grid-analysis-v1'};
 assert.throws(()=>validateGridPair(display,full),e=>e.code==='CANDIDATE_EVIDENCE_MISMATCH');
});
test('missing display pointer cannot bypass mixed positions or allow an orphan full artifact',()=>{
 const {validateGridPair}=require('../qwen-candidate-evidence.cjs');
 const legacy={records:[{pot:'p',lat:37.4,lon:127}]},full={analysisSchemaVersion:'mdt-grid-analysis-v1',records:[{pot:'p',lat:37.5,lon:127}]};
 assert.throws(()=>validateGridPair(legacy,full),e=>e.code==='CANDIDATE_EVIDENCE_MISMATCH');
 assert.throws(()=>validateGridPair(null,full),e=>e.code==='CANDIDATE_EVIDENCE_MISMATCH');
 assert.doesNotThrow(()=>validateGridPair(legacy,null));
});
