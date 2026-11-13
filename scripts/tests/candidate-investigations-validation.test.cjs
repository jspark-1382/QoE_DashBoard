/* eslint-disable @typescript-eslint/no-require-imports -- Source-grounded model contract regressions. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateCandidateReport,createCandidatePromptDraft,analyzeCandidateWithQwen,CANDIDATE_PROMPT_VERSION}=require('../qwen-candidate-client.cjs');

const evidence=()=>({schemaVersion:'qwen-candidate-evidence-v2',facts:[{id:'T01'},{id:'T02'},{id:'T03'}],sop:{templates:[]},analysisTargets:[
 {id:'CALL_a',kind:'call-quality',allowedCauseCategories:[],evidenceIds:['T01'],sopIds:[]},
 {id:'CALL_b',kind:'call-quality',allowedCauseCategories:[],evidenceIds:['T02'],sopIds:[]},
 {id:'PATTERN_a',kind:'call-pattern',allowedCauseCategories:[],evidenceIds:['T03'],sopIds:[]}
],modelInput:{analysisTargets:[
 {id:'CALL_a',kind:'call-quality',metrics:{qoe:2.1,mos:2.4,rsrp:-95,sinr:-3,rtp:{rxJitter:17}}},
 {id:'CALL_b',kind:'call-quality',metrics:{qoe:2.2,mos:2.5,rsrp:-110}},
 {id:'PATTERN_a',kind:'call-pattern',metrics:{calls:7,observedDays:4}}
],facts:[{id:'T01'},{id:'T02'},{id:'T03'}]}});
const report=()=>({summary:{observed:'음성 품질 저하 통화가 관측됐습니다.',priority:'해당 통화의 무선과 음성 원본 시각을 대조합니다.',missing:'원본 지표의 단위와 저하 순간의 시각 대조가 필요합니다.'},observations:[{text:'MOS와 통화 무선 지표가 함께 확보됐습니다.',evidenceIds:['T01']}],hypotheses:[],checks:[{action:'같은 통화의 원본 기록 시각을 대조합니다.',reason:'무선과 음성 저하가 동시에 발생했는지 확인합니다.',evidenceIds:['T01']}],limitations:['관측만으로 특정 망 구간의 원인을 확정하지 않습니다.'],sop:[],investigations:[{title:'음성 품질 저하 통화의 무선·RTP 대조',reason:'같은 통화에서 MOS와 RSRP·SINR 및 RTP 원본 지표가 확보돼 함께 대조할 대상입니다.',nextCheck:'원본 MOS 저하 시각과 RSRP·SINR 및 송수신 RTP 기록을 같은 시각으로 대조합니다.',targetIds:['CALL_a'],evidenceIds:['T01']}]});

test('source-grounded investigations select exact calls without forcing a cause category or SOP',()=>{
 const e=evidence(),r=report();
 assert.deepEqual(validateCandidateReport(r,e),r);
 assert.equal(CANDIDATE_PROMPT_VERSION,'candidate-prompt-v11');
 const prompt=createCandidatePromptDraft(e).system;
 assert(prompt.includes('investigations'));assert(prompt.includes('call-quality'));assert(prompt.includes('call-pattern'));
});

test('legacy reports remain readable without generated investigation entries',()=>{
 const r=report();delete r.investigations;
 assert.deepEqual(validateCandidateReport(r,evidence()),r);
});
test('exact source-owned distinct call counts are structural prose without authorizing that number as a metric',()=>{
 const e=evidence(),r=report();e.analysisTargets[2]={...e.analysisTargets[1],id:'CALL_c',evidenceIds:['T03']};e.modelInput.analysisTargets[2]={id:'CALL_c',kind:'call-quality',metrics:{mos:2.6,rsrp:-97,rtp:{txJitter:17}}};e.modelInput.analysisTargets[1].metrics.rtp={txJitter:17};
 e.calls=e.analysisTargets.map((target,index)=>({id:'original-'+index,date:'2026-10-26'}));e.analysisTargets.forEach((target,index)=>{target.callIds=[e.calls[index].id];target.sourceDates=[e.calls[index].date];});
 r.investigations[0]={title:'통화별 무선·RTP 관측 대조',reason:'3개 통화의 MOS/QoE 저하 구간과 RSRP·SINR·RTP 원본 수치를 통화별로 구분하여 대조',nextCheck:'각 통화의 RTP 필드 단위·방향 정의를 확인하고 무선 저하 시각과 정밀 시간 정합 시도',targetIds:['CALL_a','CALL_b','CALL_c'],evidenceIds:['T01','T02','T03']};const raw=structuredClone(r);assert.deepEqual(validateCandidateReport(r,e),r);assert.deepEqual(r,raw);
 const countAfter=structuredClone(r);countAfter.investigations[0].reason='통화 3건의 MOS·QoE 관측을 각 통화별로 대조합니다.';assert.doesNotThrow(()=>validateCandidateReport(countAfter,e));
 for(const reason of ['2개 통화의 MOS·QoE 관측을 대조합니다.','통화 4건의 MOS·QoE 관측을 대조합니다.','3개 통화의 SINR 3을 대조합니다.','3개 통화의 RTP 원본 수치 3을 대조합니다.']){const bad=structuredClone(r);bad.investigations[0].reason=reason;assert.throws(()=>validateCandidateReport(bad,e),error=>error.code==='QWEN_UNSUPPORTED_NUMBER');}
 const duplicate=structuredClone(e);duplicate.analysisTargets[2].callIds=[duplicate.calls[0].id];assert.throws(()=>validateCandidateReport(r,duplicate),error=>error.code==='QWEN_UNSUPPORTED_NUMBER');const truthful=structuredClone(r);truthful.investigations[0].reason='2개 통화의 MOS·QoE 관측을 각 통화별로 대조합니다.';assert.doesNotThrow(()=>validateCandidateReport(truthful,duplicate));
});

test('investigations reject unknown, unsent, duplicate and unrelated target evidence',()=>{
 for(const mutate of [
  r=>{r.investigations[0].targetIds=['NOT_SENT'];},
  r=>{r.investigations[0].targetIds=['CALL_a','CALL_a'];},
  r=>{r.investigations[0].evidenceIds=['T02'];},
  r=>{r.investigations[0].evidenceIds=['T01','T02'];},
  r=>{r.investigations[0].category='equipment';},
  r=>{r.investigations[0].nextCheck='';},
  r=>{r.investigations[0].targetIds=Array(6).fill('CALL_a');},
  r=>{r.investigations=Array(7).fill(r.investigations[0]);}
 ]){const r=report();mutate(r);assert.throws(()=>validateCandidateReport(r,evidence()),error=>error.code==='QWEN_INVALID_REPORT');}
 const e=evidence();e.modelInput.analysisTargets=e.modelInput.analysisTargets.slice(1);
 assert.throws(()=>validateCandidateReport(report(),e),error=>error.code==='QWEN_INVALID_REPORT');
});

test('missing redundant investigation source links are completed without changing raw model data',()=>{
 const r=report();r.investigations[0].targetIds.push('CALL_b');r.investigations[0].title='음성 품질 저하 통화의 무선 지표 대조';r.investigations[0].reason='각 통화의 MOS와 RSRP 원본 지표가 확보돼 함께 대조할 대상입니다.';const raw=structuredClone(r);let resolution;
 const result=validateCandidateReport(r,evidence(),{onReferenceResolution:value=>{resolution=value;}});
 assert.deepEqual(result.investigations[0].evidenceIds,['T01','T02']);assert.deepEqual(r,raw);
 assert.deepEqual(resolution.addedEvidence,[{investigation:0,targetId:'CALL_b',evidenceId:'T02'}]);
});

test('investigations retain exact numbers, raw RTP units and safe read-only action boundaries',()=>{
 for(const [field,prose,code] of [
  ['reason','MOS 999가 관측됐습니다.','QWEN_UNSUPPORTED_NUMBER'],
  ['reason','RTP 지터는 17ms입니다.','QWEN_UNSUPPORTED_INTERPRETATION'],
  ['nextCheck','장비를 재기동합니다.','QWEN_UNSUPPORTED_ACTION'],
  ['reason','전송 링크 장애가 확인되었습니다.','QWEN_UNSUPPORTED_INTERPRETATION'],
  ['reason','핸드오버 실패가 확인되었습니다.','QWEN_UNSUPPORTED_INTERPRETATION']
 ]){const r=report();r.investigations[0][field]=prose;assert.throws(()=>validateCandidateReport(r,evidence()),error=>error.code===code,prose);}
});

test('unobserved causes remain unsupported even when phrased as suspicions or inferred findings',()=>{
 for(const reason of ['핸드오버 실패가 의심됩니다.','핸드오버 실패 가능성이 확인되었습니다.','용량 부족으로 추정됩니다.','셀 과부하가 의심됩니다.','전송 링크 이상 가능성이 있습니다.','SINR이 낮아 간섭이 의심됩니다.','무선 신호가 양호합니다.','RSRP가 정상입니다.']){
  const r=report();r.investigations[0].reason=reason;
  assert.throws(()=>validateCandidateReport(r,evidence()),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION',reason);
 }
 const r=report();r.investigations[0].nextCheck='해당 통화의 핸드오버 실패 여부를 원본 로그에서 확인합니다.';
 assert.doesNotThrow(()=>validateCandidateReport(r,evidence()),'additional log inspection does not assert that a failure occurred');
 r.investigations[0].nextCheck='같은 통화의 무선 원본에서 간섭 여부를 추가 측정으로 확인합니다.';
 assert.doesNotThrow(()=>validateCandidateReport(r,evidence()));
});

test('observation-only calls cannot be promoted to equipment hypotheses',()=>{
 const r=report();r.hypotheses=[{category:'equipment',title:'음성 품질 저하 통화',assessment:'possible',reason:'MOS 저하를 대조합니다.',supportingEvidenceIds:['T01'],missingEvidence:'동시 구간 기록이 부족합니다.',sopIds:['TG_CALL_a'],targetIds:['CALL_a']}];
 assert.throws(()=>validateCandidateReport(r,evidence()),error=>error.code==='QWEN_UNSUPPORTED_CATEGORY');
});

test('a number from another call cannot be reassigned to a selected investigation',()=>{
 const r=report();r.investigations[0].reason='MOS 2.5가 확보돼 원본 기록을 대조할 대상입니다.';
 assert.throws(()=>validateCandidateReport(r,evidence()),error=>error.code==='QWEN_UNSUPPORTED_NUMBER');
});

test('nextCheck may request measurement to distinguish interference from load without diagnosing either',()=>{
 const r=report();r.investigations[0].nextCheck='같은 통화의 SINR과 셀 부하를 측정해 간섭과 부하 영향을 구분합니다.';
 assert.doesNotThrow(()=>validateCandidateReport(r,evidence()));
 for(const field of ['title','reason']){const bad=report();bad.investigations[0][field]='SINR과 셀 부하를 측정해 간섭과 부하 영향을 구분합니다.';assert.throws(()=>validateCandidateReport(bad,evidence()),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');}
 for(const nextCheck of ['간섭이 발생하여 SINR과 셀 부하를 측정해 영향을 구분합니다.','SINR을 측정해 전송 링크 장애가 확인되었습니다.','SINR을 측정해 전송 링크 장애가 있음을 확인합니다.']){const bad=report();bad.investigations[0].nextCheck=nextCheck;assert.throws(()=>validateCandidateReport(bad,evidence()),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');}
});

test('nextCheck accepts explicit time alignment wording from an actual captured radio investigation',()=>{
 const r=report();r.investigations[0].nextCheck='무선 시계열의 변화 시각을 MOS·QoE 저하 구간 및 RSRQ·SINR과 맞춥니다.';
 assert.doesNotThrow(()=>validateCandidateReport(r,evidence()));
});

test('asking to obtain a normal comparison cohort is distinct from grading radio quality as normal',()=>{
 const r=report();r.investigations[0].nextCheck='원본 무선 시계열의 변화 시각을 MOS·QoE 저하 구간 및 RSRQ·SINR과 맞추고, 정상 비교군을 확보합니다.';
 assert.doesNotThrow(()=>validateCandidateReport(r,evidence()));
 r.investigations[0].reason='RSRP와 SINR은 정상입니다.';assert.throws(()=>validateCandidateReport(r,evidence()),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');
});

test('future normal-denominator acquisition in nextCheck is not a radio grade or an escape for one',()=>{
 for(const nextCheck of ['통화별 무선·RTP·종료 원문을 비교하고 동일 조건 정상 통화 분모를 확보합니다.','연결 통화를 날짜·고객·시각별로 나누어 무선·RTP·종료 원문이 같은지 비교하고 정상 분모를 확보합니다.','연결 통화를 날짜·고객·시각별로 나누어 무선·RTP·종료 원문이 같은지 비교하고 정상 분모 확보']){
  const r=report();r.investigations[0].nextCheck=nextCheck;const raw=structuredClone(r);assert.deepEqual(validateCandidateReport(r,evidence()),raw);assert.deepEqual(r,raw);
 }
 const r=report();r.investigations[0].nextCheck='RSRP는 정상입니다. 무선 원문을 비교하고 정상 분모를 확보합니다.';
 assert.throws(()=>validateCandidateReport(r,evidence()),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');
 r.investigations[0].nextCheck='RSRP가 정상이며 무선 원문을 비교하고 정상 분모를 확보합니다.';
 assert.throws(()=>validateCandidateReport(r,evidence()),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');
});

test('positive-tail MDT with measured RSRQ can ask a coverage-versus-interference differential question',()=>{
 const {e,r}=mdtInvestigationFixture();e.modelInput.analysisTargets[0].band='900';e.modelInput.analysisTargets[0].earfcn='3743';
 Object.assign(r.investigations[0],{title:'배경 MDT 격자 RSRP 분포 및 인접 비교',reason:'900MHz EARFCN 3743의 특정 POT에서 RSRP 평균이 낮고 기준 이하 비율이 높아 커버리지 또는 간섭 확인 필요',nextCheck:'선택 POT와 같은 날짜·대역·EARFCN 인접 POT의 RSRP·RSRQ를 비교하고 서빙·이웃 셀 신호를 확인합니다.'});
 assert.doesNotThrow(()=>validateCandidateReport(r,e));
 for(const change of [value=>{value.modelInput.analysisTargets[0].metrics.rsrqMean=null;},value=>{value.modelInput.analysisTargets[0].metrics.belowPct={'-100':0,'-110':0};},value=>{value.modelInput.analysisTargets[0].metrics.belowPct={'-100':null,'-110':null};},value=>{value.analysisTargets[0].allowedCauseCategories=['coverage'];}]){const bad=structuredClone(e);change(bad);assert.throws(()=>validateCandidateReport(r,bad),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');}
 for(const reason of ['RSRP 분포에서 커버리지 또는 간섭이 원인으로 확인되었습니다. 커버리지 또는 간섭 확인 필요','RSRP 분포에서 간섭이 발생했습니다. 커버리지 또는 간섭 확인 필요']){const bad=structuredClone(r);bad.investigations[0].reason=reason;assert.throws(()=>validateCandidateReport(bad,e),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');}
 const quality=report();quality.investigations[0].reason='RSRP 분포가 관측되어 커버리지 또는 간섭 확인 필요';assert.throws(()=>validateCandidateReport(quality,evidence()),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');
});

test('an explicit BYE and RTP time alignment can use the Korean 맞춰 verb',()=>{
 const r=report();r.investigations[0].nextCheck='마지막 송수신 RTP와 최초 BYE 시각을 단말·IMS 로그와 맞춰 중단 구간을 찾습니다.';
 assert.doesNotThrow(()=>validateCandidateReport(r,evidence()));
});

function mdtInvestigationFixture(){
 const e=evidence();e.analysisTargets[0]={id:'MDT_A',kind:'mdt-grid',allowedCauseCategories:['coverage','interference'],evidenceIds:['T01'],sopIds:[],mapPoints:[{pot:'POT_A'}]};
 e.modelInput.analysisTargets[0]={id:'MDT_A',kind:'mdt-grid',evidenceIds:['T01'],metrics:{rsrpMean:-100,rsrqMean:-13,belowPct:{'-100':42,'-110':null}}};
 e.modelInput.referenceThresholds=[-110,-115];
 const r=report();r.investigations=[{title:'RSRP 분포 조사',reason:'RSRP -100dBm 이하 비율이 관측되어 인접 분포를 확인할 대상입니다.',nextCheck:'같은 대역의 인접 POT와 RSRP·RSRQ 분포를 비교합니다.',targetIds:['MDT_A'],evidenceIds:['T01']}];
 return {e,r};
}

test('selected MDT threshold keys with present observations are actual scoped numeric evidence',()=>{
 const {e,r}=mdtInvestigationFixture();assert.doesNotThrow(()=>validateCandidateReport(r,e));
 r.investigations[0].reason='RSRP -110dBm 이하 비율이 관측되어 인접 분포를 확인합니다.';
 assert.throws(()=>validateCandidateReport(r,e),error=>error.code==='QWEN_UNSUPPORTED_NUMBER','a null selected threshold is not an available observation');
 r.investigations[0].reason='RSRP -115dBm 이하 비율이 관측되어 인접 분포를 확인합니다.';
 e.modelInput.analysisTargets[1]={id:'CALL_b',kind:'mdt-grid',metrics:{belowPct:{'-115':12}}};
 assert.throws(()=>validateCandidateReport(r,e),error=>error.code==='QWEN_UNSUPPORTED_NUMBER','a threshold from another target is not selected evidence');
});

test('source-supported MDT candidate investigation wording is a question rather than a confirmed cause',()=>{
 const {e,r}=mdtInvestigationFixture();r.investigations[0].reason='선택 POT에서 RSRP 기준 이하 비율이 관측되어 커버리지 또는 간섭 후보로 조사 필요';
 assert.doesNotThrow(()=>validateCandidateReport(r,e));
 for(const reason of ['RSRP 기준 이하 비율이 관측되어 간섭이 확정된 원인 후보로 조사 필요합니다.','RSRP 분포가 관측되어 간섭이 원인입니다.','RSRP 분포가 관측되어 간섭이 의심됩니다.']){r.investigations[0].reason=reason;assert.throws(()=>validateCandidateReport(r,e),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION',reason);}
 r.investigations[0].reason='선택 POT에서 RSRP 기준 이하 비율이 관측되어 간섭 후보로 조사 필요';e.analysisTargets[0].allowedCauseCategories=['coverage'];assert.throws(()=>validateCandidateReport(r,e),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION','an unavailable cause category remains unavailable');
 const quality=report();quality.investigations[0].reason='RSRP와 SINR이 관측되어 커버리지 또는 간섭 후보로 조사 필요';assert.throws(()=>validateCandidateReport(quality,evidence()),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION','observation-only call sources do not gain MDT cause questions');
});

test('a positive-tail MDT boundary question permits nominal investigation wording without diagnosing a cause',()=>{
 const {e,r}=mdtInvestigationFixture();e.modelInput.analysisTargets[0].band='900';
 r.investigations[0]={title:'900MHz MDT 격자 음영 확인',reason:'인접 POT 간 RSRP 분포 차이로 음영 경계 확인 필요',nextCheck:'인접 POT의 RSRP·RSRQ 평균과 기준 이하 비율 비교',targetIds:['MDT_A'],evidenceIds:['T01']};
 assert.doesNotThrow(()=>validateCandidateReport(r,e));
 const captured=structuredClone(r);Object.assign(captured.investigations[0],{title:'배경 MDT 분포의 음영 경계 비교',reason:'별도 측정일의 MDT 격자에서 RSRP 기준 이하 비율이 높은 구간과 인접 POT의 분포 차이를 확인합니다.',nextCheck:'선택 POT와 인접 POT의 RSRP·RSRQ 분포를 비교하고 서빙·이웃 셀 신호를 실측으로 확인합니다.'});assert.doesNotThrow(()=>validateCandidateReport(captured,e));
 const synonym=structuredClone(r);Object.assign(synonym.investigations[0],{title:'MDT 격자 기반 커버리지 음영 확인',reason:'배경 MDT 데이터에서 다수 격자의 신호 세기가 기준 이하로 나타나는 분포가 관측되었습니다.',nextCheck:'해당 격자의 인접 POT 신호와 실측 서빙 셀 정보를 비교하여 음영 반복 여부를 확인합니다.'});assert.doesNotThrow(()=>validateCandidateReport(synonym,e));const noSource=structuredClone(e);noSource.modelInput.analysisTargets[0].metrics={};assert.throws(()=>validateCandidateReport(synonym,noSource),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');const asserted=structuredClone(synonym);asserted.investigations[0].reason='신호 세기 기준 이하 분포 때문에 커버리지 음영이 발생한 원인입니다.';assert.throws(()=>validateCandidateReport(asserted,e),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');
 const noTail=structuredClone(e);noTail.modelInput.analysisTargets[0].metrics.belowPct={'-100':0,'-110':0};assert.throws(()=>validateCandidateReport(captured,noTail),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');
 for(const ending of ['음영 경계를 확인합니다','음영 경계를 확인할 필요가 있습니다','음영 경계 확인필요','음영 경계를 조사합니다','음영 경계를 검토할 필요']){const future=structuredClone(r);future.investigations[0].title='배경 MDT 격자 RSRP 분포 및 인접 비교';future.investigations[0].reason='RSRP 평균과 기준 이하 비율이 관측되어 '+ending;assert.doesNotThrow(()=>validateCandidateReport(future,e),ending);}
 for(const belowPct of [{'-100':0,'-110':0},{'-100':null,'-110':null}]){const missing=structuredClone(e);missing.modelInput.analysisTargets[0].metrics.belowPct=belowPct;assert.throws(()=>validateCandidateReport(r,missing),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');}
 const disallowed=structuredClone(e);disallowed.analysisTargets[0].allowedCauseCategories=['interference'];assert.throws(()=>validateCandidateReport(r,disallowed),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');
 for(const [title,reason] of [
  ['900MHz MDT 격자 음영 원인 확정','인접 POT 간 RSRP 분포 차이로 음영 경계 확인 필요'],
  ['900MHz MDT 격자 음영 확인','RSRP 분포 차이로 음영 발생이 원인으로 확정되었습니다. 음영 경계 확인 필요'],
  ['900MHz MDT 격자 음영 확인','RSRP 분포 차이로 간섭이 발생하여 음영 경계 확인 필요'],
  ['900MHz MDT 격자 음영 확인','RSRP 분포 차이로 음영 경계를 확인했습니다.'],
  ['900MHz MDT 격자 음영 확인','RSRP 분포 차이로 음영이 확인되었습니다.']
 ]){const bad=structuredClone(r);Object.assign(bad.investigations[0],{title,reason});assert.throws(()=>validateCandidateReport(bad,e),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');}
 const quality=report();Object.assign(quality.investigations[0],{title:'RSRP 분포 음영 확인',reason:'통화 RSRP 분포 차이로 음영 경계 확인 필요'});assert.throws(()=>validateCandidateReport(quality,evidence()),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');
});

function terminationInvestigationFixture(){
 const e=evidence();e.analysisTargets[0]={id:'TERM_A',kind:'termination-group',allowedCauseCategories:['equipment'],evidenceIds:['T01'],sopIds:['TG_TERM_A'],callIds:['actual-call']};
 e.modelInput.analysisTargets[0]={id:'TERM_A',kind:'termination-group',evidenceIds:['T01'],metrics:{calls:1,dropCalls:1,rawCodes:{fcRaw:'9563',reasonRaw:'H : Drop/V : Rx_RTP_middle_Loss',byeReasonRaw:'102^RTP timeout'},rawFieldStatus:{fcRaw:'present',reasonRaw:'present',byeReasonRaw:'present'}}};
 e.sop.templates=[{id:'TG_TERM_A',causeCategory:'equipment'}];
 const r=report();r.observations[0].text='종료 원문이 연결된 통화가 있습니다.';
 r.investigations=[{title:'종료 원문 연결 통화의 종료 주체 및 흐름 대조',reason:'FC/BYE/REASON 원문이 연결된 통화를 열어 종료 직전 주체와 중단 전후 흐름을 확인합니다.',nextCheck:'연결 통화의 마지막 송수신 RTP와 최초 BYE 시각·발신 주체를 같은 통의 무선·IMS 기록과 대조합니다.',targetIds:['TERM_A'],evidenceIds:['T01']}];
 return {e,r};
}
test('generic equipment category candidates remain possible only with actual RTP source, missing logs and same-source read-only checks',()=>{
 const {e,r}=terminationInvestigationFixture();r.hypotheses=[{category:'equipment',assessment:'possible',title:'RTP 수신 손실 및 종료 원문이 관측된 통화의 중단 가능성',reason:'RTP 수신 중간 손실과 타임아웃이 포함된 종료 원문이 연결된 통화가 있어, 장비·전송·단말 이상을 원인 후보로 조사합니다.',missingEvidence:'동일 통화의 단말·무선·IMS·전송 구간별 동기화 로그 및 벤더 코드 공식 해석이 부족합니다.',targetIds:['TERM_A'],supportingEvidenceIds:['T01'],sopIds:['TG_TERM_A']}];r.sop=[{sopId:'TG_TERM_A',reason:'해당 종료 원본을 대조합니다.',evidenceIds:['T01']}];r.checks=[{action:'종료 통화의 마지막 송수신 RTP 시각과 최초 BYE 발신 주체를 로그로 대조합니다.',reason:'RTP 중단 주체와 최초 중단 구간을 확인하여 장비·전송·단말 이상 여부를 구분합니다.',evidenceIds:['T01']}];assert.doesNotThrow(()=>validateCandidateReport(r,e));
 const alternatives=structuredClone(r),source=structuredClone(e);Object.assign(alternatives.hypotheses[0],{title:'RTP 수신 손실 및 종료 원문에 따른 전송·단말 이상 가능성',reason:'RTP timeout 및 수신 중간 손실 종료 원문은 전송 구간 또는 단말의 RTP 처리 이상 후보입니다.',missingEvidence:'단말·무선·IMS·전송 구간별 동기화 로그 및 벤더 FC 코드 공식 해석'});alternatives.checks[0].action='원본 MOS를 대조합니다.';source.sop.templates[0].checkNow=['실제 RTP timeout 원문의 중단 시각을 단말·전송 로그와 대조합니다.'];assert.doesNotThrow(()=>validateCandidateReport(alternatives,source));const named=structuredClone(alternatives);named.hypotheses[0].reason='RTP timeout 원문에서 SBC 단말 이상 후보를 조사합니다.';assert.throws(()=>validateCandidateReport(named,source),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');
 for(const change of [(_e,r)=>{r.hypotheses[0].missingEvidence='정상 비교 자료가 필요합니다.';},(_e,r)=>{r.checks[0].action='원본 MOS를 대조합니다.';},(_e,r)=>{r.checks[0].evidenceIds=['T02'];},e=>{e.modelInput.analysisTargets[0].metrics.rawCodes={byeReasonRaw:'0: Tx Bye'};},(_e,r)=>{r.hypotheses[0].reason='RTP timeout 관측으로 전송 링크 결함을 원인 후보로 조사합니다.';},(_e,r)=>{r.hypotheses[0].reason='RTP timeout 관측으로 장비·전송·단말 이상이 발생한 원인 후보로 조사합니다.';},(_e,r)=>{r.hypotheses[0].reason='장비·전송·단말 이상이 확정된 원인입니다.';},(_e,r)=>{r.hypotheses[0].reason='BYE RTP timeout을 유발한 장비·전송·단말 이상 후보로 조사합니다.';}]){const badE=structuredClone(e),badR=structuredClone(r);change(badE,badR);assert.throws(()=>validateCandidateReport(badR,badE),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');}
});

test('an exact-source termination investigation may inspect logs without reprinting the raw vendor code',()=>{
 const {e,r}=terminationInvestigationFixture();assert.deepEqual(validateCandidateReport(r,e),r);
 const legacy=structuredClone(r);delete legacy.investigations;
 legacy.hypotheses=[{category:'equipment',title:r.investigations[0].title,reason:r.investigations[0].reason,assessment:'possible',supportingEvidenceIds:['T01'],missingEvidence:'중단 시각의 동기화 로그가 부족합니다.',targetIds:['TERM_A'],sopIds:['TG_TERM_A']}];
 legacy.sop=[{sopId:'TG_TERM_A',reason:'해당 종료 원문을 원본 로그와 대조합니다.',evidenceIds:['T01']}];
 assert.throws(()=>validateCandidateReport(legacy,e),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION','legacy root-cause hypotheses still require an actual event witness');
});

test('a generic termination investigation does not authorize invented events, missing-field claims or vendor-code meanings',()=>{
 for(const change of [
  (e,r)=>{e.modelInput.analysisTargets[0].metrics.rawCodes={fcRaw:'9563',byeReasonRaw:'0: Tx Bye'};r.investigations[0].reason='RTP timeout 수신 중단이 관측되어 같은 통화의 로그를 대조합니다.';},
  (e,r)=>{e.modelInput.analysisTargets[0].metrics.rawCodes={fcRaw:'9563',byeReasonRaw:'102^RTP timeout'};r.investigations[0].reason='RTP 수신 손실이 관측되어 같은 통화의 로그를 대조합니다.';},
  (_e,r)=>{r.investigations[0].reason='FC 원문이 미확보라서 같은 통화의 로그를 대조합니다.';},
  (_e,r)=>{r.investigations[0].reason='FC 코드는 SIP 종료를 의미합니다.';}
 ]){const {e,r}=terminationInvestigationFixture();change(e,r);assert.throws(()=>validateCandidateReport(r,e),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');}
});

test('radio and voice-quality targets may join only when the actual public call and source dates are identical',()=>{
 const e=evidence(),date='2026-10-26';
 e.analysisTargets[0]={id:'CALL_a100dc892606',kind:'call-quality',allowedCauseCategories:[],evidenceIds:['T01'],sopIds:[],callIds:['exact-same-call'],sourceDates:[date]};
 e.analysisTargets[1]={id:'RADIO_bd5046101ee3',kind:'call-radio',allowedCauseCategories:['coverage'],evidenceIds:['T02'],sopIds:[],callIds:['exact-same-call'],sourceDates:[date]};
 e.modelInput.analysisTargets[0]={id:e.analysisTargets[0].id,kind:'call-quality',sourceDates:[date],metrics:{qoe:2.4,mos:2.5,rsrp:-100,sinr:-3,rtp:{rxJitter:17}}};
 e.modelInput.analysisTargets[1]={id:e.analysisTargets[1].id,kind:'call-radio',sourceDates:[date],metrics:{observations:11,minRsrp:-113,maxRsrp:-97}};
 for(const target of e.modelInput.analysisTargets.slice(0,2))target.callRef='CALL_REF_A';
 const r=report();r.investigations=[{title:'통화 구간 무선 변화와 음성 품질 대조',reason:'통화 구간에서 RSRP 변화가 관측된 RADIO 대상과 저품질 CALL 대상을 연결하여 무선 변화와 음성 저하 시각을 대조합니다.',nextCheck:'원본 무선 시계열의 변화 시각을 MOS·QoE 저하 구간 및 RSRQ·SINR과 맞춥니다.',targetIds:[e.analysisTargets[1].id,e.analysisTargets[0].id],evidenceIds:['T02','T01']}];
 assert.deepEqual(validateCandidateReport(r,e),r);
 const alias=structuredClone(r);alias.investigations[0].targetIds=['CALL_REF_A'];assert.throws(()=>validateCandidateReport(alias,e),error=>error.code==='QWEN_INVALID_REPORT','callRef cannot replace a real target ID');
 for(const change of [
  value=>{value.analysisTargets[1].callIds=['other-call'];},
  value=>{value.analysisTargets[1].callIds=['exact-same-call','other-call'];},
  value=>{value.analysisTargets[1].callIds=[];},
  value=>{value.analysisTargets[1].sourceDates=['2026-10-27'];},
  value=>{value.analysisTargets[1].sourceDates=[];},
  value=>{value.analysisTargets[1].kind='mdt-grid';}
 ]){const bad=structuredClone(e);change(bad);assert.throws(()=>validateCandidateReport(r,bad),error=>error.code==='QWEN_INVALID_REPORT');}
});

function aliasInvestigationFixture(){
 const e=evidence();e.modelInput.targetIdPolicy='evidence-id-alias-v1';
 for(const model of e.modelInput.analysisTargets)model.evidenceIds=[...e.analysisTargets.find(target=>target.id===model.id).evidenceIds];
 const r=report();r.investigations[0].targetIds=['T01'];return {e,r};
}

test('declared exact T aliases resolve to a unique sent public target without modifying the raw response',()=>{
 const {e,r}=aliasInvestigationFixture(),raw=structuredClone(r);let resolution;
 const output=validateCandidateReport(r,e,{onReferenceResolution:value=>{resolution=value;}});
 assert.deepEqual(output.investigations[0].targetIds,['CALL_a']);assert.deepEqual(r,raw);
 assert.deepEqual(resolution,{policy:'selected-target-evidence-v1',addedEvidence:[],targetAliases:[{scope:'investigation',index:0,providedId:'T01',targetId:'CALL_a'}]});
 const legacy=structuredClone(e);delete legacy.modelInput.targetIdPolicy;assert.throws(()=>validateCandidateReport(r,legacy),error=>error.code==='QWEN_INVALID_REPORT');
 const canonical=structuredClone(r);canonical.investigations[0].targetIds=['CALL_a'];assert.deepEqual(validateCandidateReport(canonical,legacy),canonical);assert.deepEqual(validateCandidateReport(canonical,e),canonical);
});

test('T aliases reject unrelated, ambiguous, unsent and model-mismatched references instead of guessing IDs',()=>{
 for(const change of [
  (e,r)=>{r.investigations[0].targetIds=['T99'];},
  (e,r)=>{e.facts.push({id:'E01'});e.modelInput.facts.push({id:'E01'});r.investigations[0].targetIds=['E01'];},
  (_e,r)=>{r.investigations[0].targetIds=['CALL_REF_A'];},
  (_e,r)=>{r.investigations[0].targetIds=['CALL_b'];},
  (_e,r)=>{r.investigations[0].targetIds=['CALL_a_typo'];},
  (_e,r)=>{r.investigations[0].targetIds=['T01','CALL_a'];},
  (e)=>{e.modelInput.analysisTargets=e.modelInput.analysisTargets.filter(target=>target.id!=='CALL_a');},
  (e)=>{e.modelInput.analysisTargets[0].evidenceIds=['T02'];},
  (e)=>{e.analysisTargets.push({...structuredClone(e.analysisTargets[0]),id:'CALL_ambiguous'});e.modelInput.analysisTargets.push({...structuredClone(e.modelInput.analysisTargets[0]),id:'CALL_ambiguous'});},
  (e)=>{e.analysisTargets[1].id='T01';e.modelInput.analysisTargets[1].id='T01';}
 ]){const {e,r}=aliasInvestigationFixture();change(e,r);let metadata;assert.throws(()=>validateCandidateReport(r,e,{onReferenceResolution:value=>{metadata=value;}}),error=>error.code==='QWEN_INVALID_REPORT');assert.equal(metadata,undefined);}
});

test('alias metadata is emitted only after every claim passes validation',()=>{
 const {e,r}=aliasInvestigationFixture();r.investigations[0].reason='RSRP와 SINR은 양호합니다.';let metadata;
 assert.throws(()=>validateCandidateReport(r,e,{onReferenceResolution:value=>{metadata=value;}}),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');assert.equal(metadata,undefined);
});

test('explicit advanced hypotheses may use the same source-owned T alias policy and preserve all category guards',()=>{
 const {e,r}=mdtInvestigationFixture();e.modelInput.targetIdPolicy='evidence-id-alias-v1';e.analysisTargets[0].sopIds=['MDT_COVERAGE_REVIEW'];e.sop.templates=[{id:'MDT_COVERAGE_REVIEW',causeCategory:'coverage'}];
 r.investigations[0].targetIds=['T01'];r.hypotheses=[{category:'coverage',title:'RSRP 기준 이하 분포의 경계 확인',reason:'RSRP 기준 이하 분포를 같은 대역의 인접 관측과 비교합니다.',assessment:'possible',supportingEvidenceIds:['T01'],missingEvidence:'같은 시각의 통화와 무선 원본 정합이 부족합니다.',targetIds:['T01'],sopIds:['MDT_COVERAGE_REVIEW']}];r.sop=[{sopId:'MDT_COVERAGE_REVIEW',reason:'선택 구간의 원본 분포를 대조합니다.',evidenceIds:['T01']}];
 const raw=structuredClone(r);let metadata;const result=validateCandidateReport(r,e,{onReferenceResolution:value=>{metadata=value;}});
 assert.deepEqual(result.investigations[0].targetIds,['MDT_A']);assert.deepEqual(result.hypotheses[0].targetIds,['MDT_A']);assert.deepEqual(r,raw);
 assert.deepEqual(metadata.targetAliases.map(row=>row.scope).sort(),['hypothesis','investigation']);
 const bad=structuredClone(r);bad.hypotheses[0].category='equipment';assert.throws(()=>validateCandidateReport(bad,e),error=>error.code==='QWEN_UNSUPPORTED_CATEGORY');
});

function perCallPresentationFixture(){
 const e=evidence();e.calls=[{id:'original-a',date:'2026-10-26'},{id:'original-c',date:'2026-10-28'}];
 e.analysisTargets=[['RADIO_A','call-radio','T01','original-a','2026-10-26'],['CALL_A','call-quality','T02','original-a','2026-10-26'],['RADIO_C','call-radio','T03','original-c','2026-10-28'],['CALL_C','call-quality','T04','original-c','2026-10-28']].map(([id,kind,fact,call,date])=>({id,kind,evidenceIds:[fact],callIds:[call],sourceDates:[date],sopIds:[],allowedCauseCategories:[]}));
 e.facts=e.analysisTargets.map(target=>({id:target.evidenceIds[0]}));e.modelInput.facts=e.facts;
 e.modelInput.analysisTargets=e.analysisTargets.map(target=>({id:target.id,kind:target.kind,evidenceIds:target.evidenceIds,callRef:target.callIds[0]==='original-a'?'CALL_REF_A':'CALL_REF_C',sourceDates:target.sourceDates,metrics:target.kind==='call-radio'?{observations:8,minRsrp:-108,maxRsrp:-94}:{qoe:2.4,mos:2.5,rsrp:-102,sinr:-3,rtp:{rxJitter:17}}}));
 const r=report();r.investigations=[{title:'통화별 무선 변화와 음성 품질 대조',reason:'각 통화에서 RSRP 변화와 MOS·QoE 및 RTP 관측을 따로 대조할 필요가 있습니다.',nextCheck:'각 통화 원본에서 RSRP 변화 시각과 음성 저하 구간을 대조합니다.',targetIds:e.analysisTargets.map(target=>target.id),evidenceIds:e.facts.map(fact=>fact.id)}];return {e,r};
}

test('mixed radio and quality targets may form an explicit per-call presentation of multiple known original calls',()=>{
 const {e,r}=perCallPresentationFixture();assert.deepEqual(validateCandidateReport(r,e),r);
 const named=structuredClone(r);named.investigations[0].title='통화 무선 변화와 음성 품질·RTP 관측 대조';named.investigations[0].reason='CALL_REF_A와 CALL_REF_C 통화에서 RSRP 변화 구간과 RTP 손실·지터가 관측되어 무선 상태와 음성 저하의 연관성을 확인해야 합니다.';named.investigations[0].nextCheck='통화 원본의 RSRP 시계열 변화 시각을 MOS·QoE 저하 구간과 대조하고 RTP 필드의 단위·방향을 확인합니다.';assert.doesNotThrow(()=>validateCandidateReport(named,e));
 const independent=structuredClone(named);independent.investigations[0].targetIds=['RADIO_A','CALL_C'];independent.investigations[0].evidenceIds=['T01','T04'];independent.investigations[0].reason='CALL_REF_A 통화에서 RSRP 변화가 관측되었고 CALL_REF_C 통화에서 낮은 QoE와 RTP 손실이 기록되어 각각 원본을 대조합니다.';assert.doesNotThrow(()=>validateCandidateReport(independent,e));
 const locallyScoped=structuredClone(r);locallyScoped.investigations[0].reason='각 통화의 RSRP 변화와 음성·RTP를 같은 통화에서 대조합니다.';assert.doesNotThrow(()=>validateCandidateReport(locallyScoped,e));
 const completePairs=structuredClone(r);Object.assign(completePairs.investigations[0],{title:'무선 변화와 음성 품질 대조',reason:'연결된 통화의 RSRP 변화와 MOS·QoE 및 RTP 원본 관측을 대조할 필요가 있습니다.',nextCheck:'통화 원본에서 RSRP 변화 시각과 음성 저하 구간을 대조합니다.'});assert.doesNotThrow(()=>validateCandidateReport(completePairs,e));
 const partial=structuredClone(completePairs);partial.investigations[0].targetIds=['RADIO_A','CALL_A','CALL_C'];partial.investigations[0].evidenceIds=['T01','T02','T04'];assert.throws(()=>validateCandidateReport(partial,e),error=>error.code==='QWEN_INVALID_REPORT','unqualified partial pairs cannot borrow the complete-pair exception');
});

test('per-call presentation never permits unknown originals, date mismatches, foreign refs, MDT mixes or single-call assertions',()=>{
 for(const change of [
  (e)=>{e.calls=e.calls.filter(call=>call.id!=='original-c');},
  (e)=>{e.calls[1].date='2026-10-29';},
  (e)=>{e.analysisTargets[2].sourceDates=['2026-10-28','2026-10-29'];},
  (e)=>{e.analysisTargets[0].kind='mdt-grid';},
  (_e,r)=>{r.investigations[0].reason='각 통화별로 RSRP 변화를 CALL_REF_FOREIGN과 대조합니다.';},
  (_e,r)=>{r.investigations[0].title='통화 무선 변화 대조';r.investigations[0].reason='동일 통화·Cell·주파수에서 RSRP 변화와 MOS·QoE가 관측됩니다.';r.investigations[0].nextCheck='통화 원본의 시각을 대조합니다.';},
  (_e,r)=>{r.investigations[0].reason='각 통화별 모든 관측은 하나의 통화에서 RSRP 변화와 음성 저하를 보여줍니다.';},
  (_e,r)=>{r.investigations[0].reason='각 통화별 CALL_REF_A와 CALL_REF_C는 동일한 통화이며 RSRP 변화와 음성 관측이 있습니다.';},
  (_e,r)=>{r.investigations[0].nextCheck='CALL_REF_A의 RSRP 변화 시각을 CALL_REF_C의 MOS·QoE 저하 시각에 맞춥니다.';},
  (_e,r)=>{r.investigations[0].reason='선택한 RADIO_A와 CALL_C는 같은 통화에서 RSRP 변화와 MOS 저하가 관측됩니다.';},
  (_e,r)=>{r.investigations[0].reason='선택한 T01과 T04는 같은 통화에서 RSRP 변화와 MOS 저하가 관측됩니다.';},
  (_e,r)=>{r.investigations[0].nextCheck='RADIO_A의 RSRP 변화 시각을 CALL_C의 MOS 저하 시각에 맞춥니다.';},
  (_e,r)=>{r.investigations[0].nextCheck='T01의 RSRP 변화 시각을 T04의 MOS 저하 시각에 맞춥니다.';}
 ]){const {e,r}=perCallPresentationFixture();change(e,r);assert.throws(()=>validateCandidateReport(r,e),error=>error.code==='QWEN_INVALID_REPORT');}
});

test('an exact selected distinct POT count is structural text without authorizing that number as a metric',()=>{
 const e=evidence();e.sop.templates=[];
 e.analysisTargets=Array.from({length:5},(_,i)=>({id:'MDT_'+String.fromCharCode(65+i),kind:'mdt-grid',allowedCauseCategories:['coverage'],evidenceIds:['T0'+(i+1)],sopIds:[],mapPoints:[{pot:'POT_'+String.fromCharCode(65+i)}]}));
 e.modelInput.analysisTargets=e.analysisTargets.map(target=>({id:target.id,kind:target.kind,evidenceIds:target.evidenceIds,metrics:{rsrpMean:-100,belowPct:{'-100':42}}}));
 e.facts=e.analysisTargets.map(target=>({id:target.evidenceIds[0]}));e.modelInput.facts=e.facts;e.modelInput.summary={customers:4};
 const r=report();r.investigations=[{title:'RSRP 분포 조사',reason:'선택한 5개 POT에서 RSRP 기준 이하 비율이 관측돼 경계를 조사합니다.',nextCheck:'같은 대역의 인접 POT와 RSRP 분포를 비교합니다.',targetIds:e.analysisTargets.map(target=>target.id),evidenceIds:e.facts.map(fact=>fact.id)}];
 const raw=structuredClone(r);assert.deepEqual(validateCandidateReport(r,e),raw);assert.deepEqual(r,raw);
 r.investigations[0].reason='선택한 POT 5개의 RSRP 기준 이하 분포를 비교할 대상입니다.';assert.doesNotThrow(()=>validateCandidateReport(r,e));
 r.investigations[0].reason='선택한 4개 POT에서 RSRP 분포가 관측됐습니다.';assert.throws(()=>validateCandidateReport(r,e),error=>error.code==='QWEN_UNSUPPORTED_NUMBER');
 r.investigations[0].reason='선택한 5개 POT에서 SINR 5가 관측됐습니다.';assert.throws(()=>validateCandidateReport(r,e),error=>error.code==='QWEN_UNSUPPORTED_NUMBER');
 r.investigations[0].reason=raw.investigations[0].reason;e.analysisTargets[4].mapPoints[0].pot=e.analysisTargets[0].mapPoints[0].pot;
 assert.throws(()=>validateCandidateReport(r,e),error=>error.code==='QWEN_UNSUPPORTED_NUMBER','five target combinations with only four actual POTs cannot claim five POTs');
});

test('new default analyses correct missing investigations with a complete object schema and source mapping',async t=>{
 const e=evidence();e.versions={prompt:'candidate-prompt-v10'};const legacy=report();delete legacy.investigations;const sent=[];
 const config={baseUrl:'http://127.0.0.1:1/v1',model:'fixture-model',apiKey:'fixture-secret',missing:[],timeoutMs:1000,maxTokens:4096,temperature:0.2,jsonMode:false,extraBody:{}};
 t.mock.method(globalThis,'fetch',async(_url,init)=>{sent.push(JSON.parse(init.body));return new Response(JSON.stringify({model:config.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(sent.length===1?legacy:report())}}]}),{status:200});});
 assert.deepEqual(await analyzeCandidateWithQwen(config,e,new AbortController().signal),report());
 assert.equal(sent.length,2);const correction=sent[1].messages.at(-1).content;
 for(const key of ['summary','investigations','observations','hypotheses','checks','limitations','sop'])assert(correction.includes(key),key);
 assert(correction.includes('CALL_a'));assert(correction.includes('T01'));
});
