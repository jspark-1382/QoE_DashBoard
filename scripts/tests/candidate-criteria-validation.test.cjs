/* eslint-disable @typescript-eslint/no-require-imports -- Explicit source-rule validation regressions. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateCandidateReport,createCandidatePromptDraft,CANDIDATE_PROMPT_VERSION}=require('../qwen-candidate-client.cjs');
function fixture(){
 const criteria={dl:{status:'matched',threshold:-100,validSamples:4,observedCount:1,minimum:-110,missing:[]},ul:{status:'matched',threshold:3,validSamples:4,observedCount:1,minimum:2,missing:['PHR 원본 단위 미확인']},pollution:{status:'matched',threshold:3,validSamples:4,observedCount:3,missing:[],windowSeconds:30,window:{startedAt:'10:00:00',endedAt:'10:00:25',changes:3,eventCount:4,events:[0,1,2,3].map(i=>({at:'10:00:'+String(i*5).padStart(2,'0'),cellChanged:i>0,pciChanged:false,frequencyChanged:false}))}}};
 const ids={coverage:'RULE_COVERAGE_REVIEW',interference:'RULE_INTERFERENCE_REVIEW',uplink:'RULE_UPLINK_REVIEW'};
 const templates=Object.entries(ids).map(([causeCategory,id])=>({id,causeCategory}));
 const target={id:'RULE_A',kind:'call-criteria',allowedCauseCategories:Object.keys(ids),evidenceIds:['T01'],sopIds:Object.values(ids),callIds:['original-a'],sourceDates:['2026-10-26']};
 const e={schemaVersion:'qwen-candidate-evidence-v2',versions:{prompt:'candidate-prompt-v9'},analysisTargets:[target],facts:[{id:'T01'}],sop:{templates},modelInput:{analysisTargets:[{id:target.id,kind:target.kind,evidenceIds:['T01'],metrics:{criteria}}],facts:[{id:'T01'}]}};
 const h=category=>({category,title:category==='uplink'?'UL PHR 기본 기준 확인':category==='coverage'?'DL 기본 조건에 따른 커버리지 확인':'Pollution 기본 조건에 따른 전환 반복 확인',assessment:'possible',reason:category==='uplink'?'UL PHR 기본 조건 관측을 확인할 후보입니다.':category==='coverage'?'DL RSRP 기본 조건에 해당하여 해당 통화의 무선 관측을 확인할 후보입니다.':'Pollution 조건에 해당하는 serving PCI·Cell-ID 변경 반복을 원본 기록에서 대조할 후보입니다.',supportingEvidenceIds:['T01'],missingEvidence:'원인 판정에는 같은 시각의 무선·음성 기록과 비교 자료가 필요합니다.',targetIds:['RULE_A'],sopIds:[ids[category]]});
 const r={summary:{observed:'통화의 기본 무선 조건과 전환 반복이 관측되었습니다.',priority:'해당 통화의 DL·UL 조건과 serving 변경 시각을 원본에서 대조합니다.',missing:'PHR 단위와 실제 종료 시각 및 정상 비교 자료가 미확인입니다.'},investigations:[{title:'DL·UL 기본 조건과 Pollution 관측 대조',reason:'DL RSRP·UL PHR 기본 조건 및 실제 serving 변경 반복이 있어 원본 통화를 대조할 대상입니다.',nextCheck:'해당 통화의 기준 해당 시각과 MOS·QoE 저하 및 serving 기록을 대조합니다.',targetIds:['RULE_A'],evidenceIds:['T01']}],observations:[{text:'DL·UL 기본 기준과 Pollution 조건이 관측되었습니다.',evidenceIds:['T01']}],hypotheses:Object.keys(ids).map(h),checks:[{action:'실제 serving PCI·Cell-ID 변경 시각을 통화 원본과 대조합니다.',reason:'전환 반복 관측과 실패 여부를 구분할 자료를 확인합니다.',evidenceIds:['T01']}],limitations:['기본 기준 해당 관측은 확정 원인이나 핸드오버 실패를 뜻하지 않습니다.'],sop:Object.values(ids).map(sopId=>({sopId,reason:'해당 기준의 실제 원본 관측을 대조합니다.',evidenceIds:['T01']}))};
 return {e,r,criteria,h};
}
test('v9 uses four-category cause hypotheses with grounded investigation targets and exact source rules',()=>{
 const {e,r}=fixture();assert.deepEqual(validateCandidateReport(r,e),r);assert.equal(CANDIDATE_PROMPT_VERSION,'candidate-prompt-v11');
 const prompt=createCandidatePromptDraft(e).system;for(const word of ['-100','PHR','EARFCN','overlap','hypotheses'])assert(prompt.includes(word));assert(!prompt.includes('hypotheses:[], sop:[]를 반드시'));
});
test('explicit nonconfirmation stays negative without authorizing a separate affirmative failure or cause',()=>{
 const {e,r}=fixture();r.hypotheses=[r.hypotheses[1]];r.sop=[r.sop[1]];
 for(const ending of ['확정 아님','확정은 아님','확정이 아닙니다']){r.hypotheses[0].reason='Pollution 기준 충족으로 간섭 원인 후보이나 '+ending;const raw=structuredClone(r);assert.doesNotThrow(()=>validateCandidateReport(r,e));assert.deepEqual(r,raw);}
 for(const reason of ['Pollution 기준 충족으로 간섭 원인이 확정입니다.','Pollution 기준의 간섭이 확정된 원인입니다. 다른 판단은 확정 아님.','Pollution 기준의 핸드오버 실패가 확정입니다. 다른 판단은 확정 아님.','Pollution 기준의 간섭이 확정된 원인이나 다른 판단은 확정 아님']){r.hypotheses[0].reason=reason;assert.throws(()=>validateCandidateReport(r,e),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');}
});
test('basic criterion matches support possible hypotheses while unobserved criteria and causal certainty remain rejected',()=>{
 for(const change of [(e,r)=>{r.hypotheses[0].assessment='supported';},e=>{e.modelInput.analysisTargets[0].metrics.criteria.dl.status='not-matched';e.modelInput.analysisTargets[0].metrics.criteria.ul.status='insufficient';},e=>{e.modelInput.analysisTargets[0].metrics.criteria.pollution.window.events.forEach(event=>{event.cellChanged=false;event.pciChanged=false;event.frequencyChanged=true;});},e=>{e.modelInput.analysisTargets[0].metrics.criteria.pollution.window.changes=2;},(_e,r)=>{r.hypotheses[1].reason='Pollution 조건이 간섭 발생의 확정 원인입니다.';},(_e,r)=>{r.hypotheses[1].reason='Pollution 조건이 핸드오버 실패를 확인했습니다.';}]){const {e,r}=fixture();change(e,r);assert.throws(()=>validateCandidateReport(r,e),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');}
});
test('missing load cannot become capacity evidence and same-category SOP links remain required',()=>{
 const {e,r}=fixture();e.analysisTargets[0].allowedCauseCategories.push('capacity');e.analysisTargets[0].sopIds.push('RULE_CAPACITY');e.sop.templates.push({id:'RULE_CAPACITY',causeCategory:'capacity'});
 r.hypotheses=[{...r.hypotheses[0],category:'capacity',title:'부하 자료 확인',reason:'실제 PRB 부하와 트래픽을 확인합니다.',sopIds:['RULE_CAPACITY']}];r.sop=[{sopId:'RULE_CAPACITY',reason:'원본 부하 기록을 확인합니다.',evidenceIds:['T01']}];
 assert.throws(()=>validateCandidateReport(r,e),error=>error.code==='QWEN_INVALID_REPORT');
 const mismatch=fixture();mismatch.r.hypotheses[0].sopIds=['RULE_INTERFERENCE_REVIEW'];assert.throws(()=>validateCandidateReport(mismatch.r,mismatch.e),error=>error.code==='QWEN_INVALID_SOP');
});
test('Pollution observation does not authorize hypothetical HO failure even with read-only logs',()=>{const {e,r}=fixture();r.hypotheses=[r.hypotheses[1]];r.sop=[r.sop[1]];r.hypotheses[0].reason='빈번한 셀 변경이 핸드오버 실패와 관련 있을 수 있습니다.';r.hypotheses[0].missingEvidence='핸드오버 이벤트 로그가 필요합니다.';r.checks[0].action='핸드오버 이벤트 로그를 대조합니다.';assert.throws(()=>validateCandidateReport(r,e),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');});

test('criterion investigations may ask about source-allowed cause candidates without diagnosing an event',()=>{
 const {e,r}=fixture();r.investigations[0].reason='30초 내 실제 PCI 또는 Cell-ID 변경이 기준 이상 관측되어 간섭 또는 전환 과다 후보로 조사합니다.';assert.doesNotThrow(()=>validateCandidateReport(r,e));
 const coverage=structuredClone(r);coverage.investigations[0].reason='DL RSRP 또는 UL PHR 기본 기준 해당 관측이 있어 커버리지 후보로 조사합니다.';assert.doesNotThrow(()=>validateCandidateReport(coverage,e));
 for(const change of [e=>{e.analysisTargets[0].allowedCauseCategories=['coverage'];},e=>{e.modelInput.analysisTargets[0].metrics.criteria.pollution.status='not-matched';},e=>{e.modelInput.analysisTargets[0].metrics.criteria.pollution.window.changes=2;},(_e,r)=>{r.investigations[0].reason='실제 PCI 변경이 관측되어 간섭이 발생한 원인 후보로 조사합니다.';},(_e,r)=>{r.investigations[0].reason='실제 PCI 변경이 관측되어 간섭이 확정된 원인 후보로 조사합니다.';},(_e,r)=>{r.investigations[0].reason='실제 PCI 변경이 관측되어 핸드오버 실패 후보로 조사합니다.';}]){const badE=structuredClone(e),badR=structuredClone(r);badR.hypotheses=[];badR.sop=[];change(badE,badR);assert.throws(()=>validateCandidateReport(badR,badE),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');}
});
test('approved DL basic threshold descriptions do not authorize arbitrary SINR or PHR-unit interpretations',()=>{
 const {e,r}=fixture();r.investigations[0].reason='DL RSRP 기본 기준 불량 조건이 관측되어 해당 통화의 기본 기준을 대조합니다.';assert.doesNotThrow(()=>validateCandidateReport(r,e));
 for(const text of ['SINR은 불량합니다.','UL PHR은 3 dB입니다.']){const bad=fixture();bad.r.investigations[0].reason=text;assert.throws(()=>validateCandidateReport(bad.r,bad.e),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');}
 for(const text of ['SINR은 불량합니다.','RTP는 양호합니다.']){const bad=fixture();bad.r.hypotheses[0].reason='DL RSRP 기본 조건에 해당합니다. '+text;assert.throws(()=>validateCandidateReport(bad.r,bad.e),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');}
});
test('MDT UL source mean belongs only to uplink and requires explicit average semantics',()=>{const {e,r}=fixture();const target=e.analysisTargets[0],model=e.modelInput.analysisTargets[0];target.kind=model.kind='mdt-grid';target.allowedCauseCategories=['uplink'];target.sopIds=['RULE_UPLINK_REVIEW'];model.metrics={phrMean:2,criteria:{ul:{status:'matched',threshold:3,mean:2,aggregation:'source-grid-mean'}}};r.hypotheses=[r.hypotheses[2]];r.sop=[r.sop[2]];r.hypotheses[0].title='UL PHR 평균 기본 기준 조사';r.hypotheses[0].reason='UL PHR 평균 기준 관측을 원본에서 대조할 후보입니다.';r.investigations[0]={title:'UL PHR 평균 기본 기준 조사',reason:'UL PHR 평균 기준 관측이 있어 원본 평균을 대조할 대상입니다.',nextCheck:'같은 날짜의 원본 PHR 평균과 집계 정의를 확인합니다.',targetIds:['RULE_A'],evidenceIds:['T01']};r.observations[0].text='UL PHR 평균 관측이 있습니다.';r.summary.observed='UL PHR 평균 관측이 있습니다.';assert.doesNotThrow(()=>validateCandidateReport(r,e));for(const change of [(e,r)=>r.hypotheses[0].category='coverage',(e,r)=>{r.hypotheses[0].title='UL PHR 기준 조사';r.hypotheses[0].reason='UL PHR 기준 관측을 대조합니다.';},e=>e.modelInput.analysisTargets[0].metrics.criteria.ul.mean=4]){const e2=structuredClone(e),r2=structuredClone(r);change(e2,r2);assert.throws(()=>validateCandidateReport(r2,e2));}});

test('up to five grounded hypotheses are supported without requiring all categories or changing legacy readability',()=>{
 const {e,r,h}=fixture();r.hypotheses=Array.from({length:5},()=>h('coverage'));r.sop=r.sop.slice(0,1);assert.doesNotThrow(()=>validateCandidateReport(r,e));r.hypotheses.push(h('coverage'));assert.throws(()=>validateCandidateReport(r,e),error=>error.code==='QWEN_INVALID_REPORT');
 const legacy=fixture();delete legacy.r.investigations;legacy.e.versions.prompt='candidate-prompt-v9';assert.doesNotThrow(()=>validateCandidateReport(legacy.r,legacy.e));
});
