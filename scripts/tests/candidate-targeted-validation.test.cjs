/* eslint-disable @typescript-eslint/no-require-imports -- Native Node server-only regression fixtures. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {validateCandidateReport,analyzeCandidateWithQwen}=require('../qwen-candidate-client.cjs');
const evidence={"schemaVersion":"qwen-candidate-evidence-v2","facts":[{"id":"T01"},{"id":"T02"}],"analysisTargets":[{"id":"MDT_a","kind":"mdt-grid","evidenceIds":["T01"],"sopIds":["TG_MDT_a"]},{"id":"MDT_b","kind":"mdt-grid","evidenceIds":["T02"],"sopIds":["TG_MDT_b"]}],"sop":{"templates":[{"id":"TG_MDT_a"},{"id":"TG_MDT_b"}]},"modelInput":{"analysisTargets":[{"id":"MDT_a","kind":"mdt-grid","metrics":{"sampleSupport":"multiple-measurements","samples":268,"belowPct":{"-100":48.51}}},{"id":"MDT_b","kind":"mdt-grid","metrics":{"sampleSupport":"sparse","samples":1,"belowPct":{"-100":0}}}]}};
const report=()=>({"summary":{"observed":"실제 분포 관측","priority":"해당 대역 점검","missing":"독립 실측 필요"},"observations":[{"text":"RSRP 기준 이하 비율 48.51%를 확인했습니다.","evidenceIds":["T01"]}],"hypotheses":[{"category":"coverage","title":"RSRP 기준 이하 비율이 높은 구간","assessment":"possible","reason":"RSRP 분포와 RSRQ를 해당 구간에서 대조합니다.","supportingEvidenceIds":["T01"],"missingEvidence":"동시 음성 측정 필요","sopIds":["TG_MDT_a"],"targetIds":["MDT_a"]}],"checks":[{"action":"동일 구간을 재측정합니다.","reason":"별도 날짜 재현 확인","evidenceIds":["T01"]}],"limitations":["배경 MDT입니다."],"sop":[{"sopId":"TG_MDT_a","reason":"해당 구간의 원본을 확인합니다.","evidenceIds":["T01"]}]});

test('zero hypotheses and empty SOP permitted; explicit existing target and target-specific evidence/SOP required',()=>{
 const z=report();z.hypotheses=[];z.sop=[];assert.deepEqual(validateCandidateReport(z,evidence),z);
 for(const change of [r=>delete r.hypotheses[0].targetIds,r=>r.hypotheses[0].targetIds=['unknown'],r=>r.hypotheses[0].supportingEvidenceIds=['T02'],r=>{r.hypotheses[0].sopIds=['TG_MDT_b'];r.sop[0].sopId='TG_MDT_b';}]){const r=report();change(r);assert.throws(()=>validateCandidateReport(r,evidence));}
});
test('generic RTP-score, wide scope and radio-availability causes rejected despite valid target ID',()=>{
 for(const reason of ['RTP 손실이 QoE 저하를 유발합니다.','후보 범위가 넓어 여러 원인일 수 있습니다.','무선 자료를 확보했으므로 원인을 검토합니다.']){const r=report();r.hypotheses[0].title='원인 가설';r.hypotheses[0].reason=reason;assert.throws(()=>validateCandidateReport(r,evidence),e=>e.code==='QWEN_UNSUPPORTED_INTERPRETATION');}
});
test('single measurement cannot be supported; displayed MDT percent permitted without relaxing RTP unit guard',()=>{
 const r=report();assert.deepEqual(validateCandidateReport(r,evidence),r);
 const sparse=structuredClone(evidence);sparse.modelInput.analysisTargets[0].metrics.sampleSupport='sparse';r.hypotheses[0].assessment='supported';assert.throws(()=>validateCandidateReport(r,sparse),e=>e.code==='QWEN_UNSUPPORTED_INTERPRETATION');
});
test('actual merged outbound snapshot and invalid final response retained at send/receive boundary',async t=>{
 let sent,captured,received;const config={baseUrl:'http://127.0.0.1:1/v1',model:'model',apiKey:'secret',missing:[],timeoutMs:1000,maxTokens:500,temperature:0,jsonMode:true,extraBody:{chat_template_kwargs:{enable_thinking:false}}};
 t.mock.method(globalThis,'fetch',async(_url,init)=>{sent=JSON.parse(init.body);assert.deepEqual(captured,sent);return new Response(JSON.stringify({model:'model',choices:[{finish_reason:'stop',message:{content:'INVALID FINAL'}}]}),{status:200});});
 await assert.rejects(()=>analyzeCandidateWithQwen(config,evidence,new AbortController().signal,{onRequest:b=>{captured=structuredClone(b);},onRawResponse:raw=>{received=raw;}}),e=>e.code==='QWEN_INVALID_JSON');assert.equal(JSON.parse(received).choices[0].message.content,'INVALID FINAL');assert.equal(sent.response_format.type,'json_object');assert.deepEqual(sent.chat_template_kwargs,{enable_thinking:false});
});
test('unknown FC cannot acquire the meaning of a concurrently observed BYE cause',()=>{
 const e=structuredClone(evidence);e.analysisTargets[0].kind='termination-group';e.modelInput.analysisTargets[0]={id:'MDT_a',kind:'termination-group',metrics:{...e.modelInput.analysisTargets[0].metrics,rawCodes:{fcRaw:'9563',byeReasonRaw:'102^RTP timeout'}}};
 for(const reason of ['FC 9563의 의미는 RTP timeout입니다.','FC 9563은 RTP timeout을 뜻합니다.','FC 9563은 수신 중단 오류를 나타냅니다.']){
  const r=report();r.hypotheses[0].category='equipment';r.hypotheses[0].title='종료 원문 조사';r.hypotheses[0].reason=reason;assert.throws(()=>validateCandidateReport(r,e),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION',reason);
 }
 const r=report();r.hypotheses[0].category='equipment';r.hypotheses[0].title='종료 원문 조사';r.hypotheses[0].reason='FC 의미는 미등록이며 BYE 102^RTP timeout이 관측되어 종료 주체와 중단 구간을 대조합니다.';assert.doesNotThrow(()=>validateCandidateReport(r,e));
});

test('every linked target needs a selected SOP so its improvement panel cannot be empty',()=>{
 const r=report();r.hypotheses[0].targetIds.push('MDT_b');r.hypotheses[0].supportingEvidenceIds.push('T02');
 assert.throws(()=>validateCandidateReport(r,evidence),error=>error.code==='QWEN_INVALID_SOP');
 r.hypotheses[0].sopIds.push('TG_MDT_b');r.sop.push({sopId:'TG_MDT_b',reason:'함께 선정한 대상의 원본을 대조합니다.',evidenceIds:['T02']});
 assert.doesNotThrow(()=>validateCandidateReport(r,evidence));
});

test('selected source targets complete missing redundant evidence links without changing the raw report',()=>{
 const r=report(),resolutions=[];r.hypotheses[0].targetIds.push('MDT_b');r.hypotheses[0].sopIds.push('TG_MDT_b');r.sop.push({sopId:'TG_MDT_b',reason:'함께 선정한 대상의 원본을 대조합니다.',evidenceIds:['T02']});
 const normalized=validateCandidateReport(r,evidence,{onReferenceResolution:value=>resolutions.push(value)});
 assert.deepEqual(r.hypotheses[0].supportingEvidenceIds,['T01']);assert.deepEqual(normalized.hypotheses[0].supportingEvidenceIds,['T01','T02']);
 assert.deepEqual(resolutions,[{policy:'selected-target-evidence-v1',addedEvidence:[{hypothesis:0,targetId:'MDT_b',evidenceId:'T02'}]}]);
 const unrelated=report();unrelated.hypotheses[0].supportingEvidenceIds=['T01','T02'];assert.throws(()=>validateCandidateReport(unrelated,evidence),error=>error.code==='QWEN_INVALID_REPORT');
});

test('three observed termination groups may retain their three distinct server procedures in one hypothesis',()=>{
 const e=structuredClone(evidence),r=report();
 e.analysisTargets=[];e.modelInput.analysisTargets=[];e.sop.templates=[];e.facts=[];
 for(const suffix of ['a','b','c']){
  const id='TERM_'+suffix,evidenceId='T_'+suffix,sopId='TG_TERM_'+suffix;
  e.analysisTargets.push({id,kind:'termination-group',allowedCauseCategories:['equipment'],evidenceIds:[evidenceId],sopIds:[sopId]});
  e.modelInput.analysisTargets.push({id,kind:'termination-group',metrics:{rawCodes:{byeReasonRaw:'102^RTP timeout'}}});e.sop.templates.push({id:sopId,causeCategory:'equipment'});e.facts.push({id:evidenceId});
 }
 r.observations=[{text:'RTP timeout 종료 원문이 관측되었습니다.',evidenceIds:['T_a']}];
 r.hypotheses=[{category:'equipment',title:'RTP timeout 종료 주체와 중단 구간 확인',assessment:'possible',reason:'RTP timeout 원문을 같은 통화의 로그와 대조합니다.',supportingEvidenceIds:['T_a','T_b','T_c'],missingEvidence:'종료 주체와 중단 구간의 원본 로그가 부족합니다.',sopIds:['TG_TERM_a','TG_TERM_b','TG_TERM_c'],targetIds:['TERM_a','TERM_b','TERM_c']}];
 r.checks=[{action:'같은 통화의 원본 로그를 대조합니다.',reason:'중단 시작 구간을 확인합니다.',evidenceIds:['T_a']}];
 r.sop=['a','b','c'].map(suffix=>({sopId:'TG_TERM_'+suffix,reason:'해당 종료 원문을 원본 로그와 대조합니다.',evidenceIds:['T_'+suffix]}));
 assert.deepEqual(validateCandidateReport(r,e),r);
 const wrong=structuredClone(r);wrong.hypotheses[0].sopIds.push('TG_MDT_a');assert.throws(()=>validateCandidateReport(wrong,e),error=>error.code==='QWEN_INVALID_SOP');
 for(const suffix of ['d','e']){
  const id='TERM_'+suffix,evidenceId='T_'+suffix,sopId='TG_TERM_'+suffix;
  e.analysisTargets.push({id,kind:'termination-group',allowedCauseCategories:['equipment'],evidenceIds:[evidenceId],sopIds:[sopId]});e.modelInput.analysisTargets.push({id,kind:'termination-group',metrics:{rawCodes:{byeReasonRaw:'102^RTP timeout'}}});e.sop.templates.push({id:sopId,causeCategory:'equipment'});e.facts.push({id:evidenceId});r.hypotheses[0].targetIds.push(id);r.hypotheses[0].supportingEvidenceIds.push(evidenceId);r.hypotheses[0].sopIds.push(sopId);r.sop.push({sopId,reason:'해당 종료 원문을 원본 로그와 대조합니다.',evidenceIds:[evidenceId]});
 }
 assert.doesNotThrow(()=>validateCandidateReport(r,e),'all five selected targets keep their distinct permitted procedures');
 e.analysisTargets[0].sopIds.push('TG_EXTRA');e.sop.templates.push({id:'TG_EXTRA',causeCategory:'equipment'});r.hypotheses[0].sopIds.push('TG_EXTRA');r.sop.push({sopId:'TG_EXTRA',reason:'추가 로그를 대조합니다.',evidenceIds:['T_a']});
 assert.throws(()=>validateCandidateReport(r,e),error=>error.code==='QWEN_INVALID_SOP','a sixth otherwise permitted procedure exceeds the bound');
});
test('MDT coverage needs a positive weak-signal observation but may include a zero-percent comparison target',()=>{
 const e=structuredClone(evidence),r=report();r.observations[0].text='RSRP 기준 이하 분포를 비교합니다.';
 for(const belowPct of [{'-100':0,'-110':0},{'-100':null,'-110':null},{'-100':0,'-110':null}]){
  e.modelInput.analysisTargets[0].metrics.belowPct=belowPct;
  assert.throws(()=>validateCandidateReport(r,e),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');
 }
 e.modelInput.analysisTargets[0].metrics.belowPct={'-100':0,'-110':0};
 e.modelInput.analysisTargets[1].metrics.belowPct={'-100':12,'-110':0};
 r.hypotheses[0].targetIds.push('MDT_b');r.hypotheses[0].supportingEvidenceIds.push('T02');
 r.hypotheses[0].sopIds.push('TG_MDT_b');r.sop.push({sopId:'TG_MDT_b',reason:'비교 대상의 분포를 대조합니다.',evidenceIds:['T02']});
 assert.doesNotThrow(()=>validateCandidateReport(r,e));
 e.modelInput.analysisTargets[1].metrics.belowPct={'-100':0,'-110':0};
 r.hypotheses[0].category='interference';
 assert.throws(()=>validateCandidateReport(r,e),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION','MDT alone does not establish the same-call Pollution transition criterion');
});

test('actual rounded-distance failure stays rejected without broad numeric tolerance',()=>{
 const e=structuredClone(evidence),r=report();
 e.modelInput.candidate={radiusM:130,maxPairDistanceM:170.529425};
 r.limitations=['표시 반경 130m·구성점 최대 거리 170.5m 내 단일 기지국 원인으로 확정 불가'];
 assert.throws(()=>validateCandidateReport(r,e),error=>error.code==='QWEN_UNSUPPORTED_NUMBER');
 r.limitations=['후보 전체를 단일 기지국 원인으로 확정할 수 없습니다.'];
 assert.doesNotThrow(()=>validateCandidateReport(r,e),'geometry may be omitted from model prose while the UI retains exact server values');
});
test('MDT distribution prose must name its actual radio metric rather than only thresholds and percentages',()=>{
 const e=structuredClone(evidence),r=report();
 e.modelInput.frequency={band:900,earfcn:3743};e.modelInput.thresholds=[-100,-110];
 e.modelInput.analysisTargets[0].metrics.belowPct['-110']=20.52;
 r.hypotheses[0].title='900MHz 대역 음영에 의한 무선 열화';
 r.hypotheses[0].reason='MDT 900/3743 POT에서 -100 이하 48.51%·-110 이하 20.52%로 음영 꼬리가 두드러지나 측정일이 후보 기간과 불일치';
 assert.throws(()=>validateCandidateReport(r,e),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');
 r.hypotheses[0].title='900MHz RSRP 기준 이하 분포 검토';
 r.hypotheses[0].reason='RSRP 기준 이하 비율 -100 이하 48.51%·-110 이하 20.52%의 분포를 같은 대역에서 확인합니다.';
 assert.doesNotThrow(()=>validateCandidateReport(r,e),'explicit RSRP distribution with exact source numbers remains accepted');
});

test('observed MDT percentages followed by a qualitative possibility are not invented confidence',()=>{
 const e=structuredClone(evidence),r=report();
 e.modelInput.analysisTargets[0].metrics.belowPct['-110']=20.52;
 e.modelInput.thresholds=[-100,-110];
 r.hypotheses[0].reason='MDT_a 대상의 RSRP 기준 이하 비율이 -100 기준 48.51%, -110 기준 20.52%로 음영 가능성이 있습니다.';
 assert.doesNotThrow(()=>validateCandidateReport(r,e));
});
test('known metric percentages cannot be reassigned to confidence, probability or regional failure rates',()=>{
 const e=structuredClone(evidence);e.modelInput.analysisTargets[0].metrics.belowPct['-110']=20.52;
 for(const reason of [
  '음영 가능성은 20.52%입니다.',
  '음영 가능성이 약 20.52%로 추정됩니다.',
  'RSRP 기준 이하 분포로 판단할 때 음영 가능성 추정치는 20.52%입니다.',
  'RSRP 기준 이하 비율은 48.51%이며 음영 가능성 수치는 20.52%입니다.',
  '20.52%의 음영 가능성이 있습니다.',
  '20.52%의 확률로 음영이 발생합니다.',
  '무선 원인 신뢰도는 48.51%입니다.',
  '지역 불량률은 20.52%입니다.',
  'RSRP 기준 이하 비율은 20.52%이며 무선 원인 신뢰도는 48.51%입니다.',
  'RSRP 기준 이하 비율은 20.52%이며 음영 가능성은 48.51%입니다.',
  'RSRP 기준 이하 비율은 20.52%이고 48.51%의 음영 가능성입니다.'
 ]){
  const r=report();r.hypotheses[0].reason=reason;
  assert.throws(()=>validateCandidateReport(r,e),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION',reason);
 }
});

test('a concrete interruption needs a diagnostic focus rather than a broad equipment label',()=>{
 const e=structuredClone(evidence);e.analysisTargets[0].kind='termination-group';
 e.modelInput.analysisTargets[0]={id:'MDT_a',kind:'termination-group',metrics:{rawCodes:{fcRaw:'9563',byeReasonRaw:'102^RTP timeout'},rawFieldStatus:{fcRaw:'present',byeReasonRaw:'present'}}};
 const r=report();r.hypotheses[0].category='equipment';
 r.observations[0].text='실제 종료 원문을 확인했습니다.';
 r.hypotheses[0].title='장비·전송·단말 이상';r.hypotheses[0].reason='FC 9563과 BYE 102^RTP timeout이 관측되어 장비·전송·단말 이상 가능성이 있습니다.';
 assert.throws(()=>validateCandidateReport(r,e),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');
 r.hypotheses[0].title='RTP timeout의 수신 중단 구간 확인';
 r.hypotheses[0].reason='BYE 102^RTP timeout이 관측되어 마지막 수신 RTP와 최초 BYE 발신 주체를 맞춰 중단 구간을 확인합니다.';
 assert.doesNotThrow(()=>validateCandidateReport(r,e));
});

test('a coherent coverage hypothesis can identify five evidence-bearing POTs with shared coverage SOP',()=>{
 const e=structuredClone(evidence),r=report();
 e.sop.templates=[{id:'MDT_COVERAGE_REVIEW',causeCategory:'coverage'}];
 for(let i=0;i<5;i++){
  const id='MDT_'+String.fromCharCode(97+i),evidenceId='T0'+(i+1);
  e.analysisTargets[i]={id,kind:'mdt-grid',evidenceIds:[evidenceId],sopIds:['MDT_COVERAGE_REVIEW']};
  e.modelInput.analysisTargets[i]={id,kind:'mdt-grid',metrics:{sampleSupport:'multiple-measurements',belowPct:{'-100':48.51}}};
  e.facts[i]={id:evidenceId};
 }
 r.hypotheses[0].targetIds=['MDT_a','MDT_b','MDT_c','MDT_d','MDT_e'];
 r.hypotheses[0].supportingEvidenceIds=['T01','T02','T03','T04','T05'];
 r.hypotheses[0].sopIds=['MDT_COVERAGE_REVIEW'];r.sop=[{sopId:'MDT_COVERAGE_REVIEW',reason:'연속된 POT의 신호 분포를 대조합니다.',evidenceIds:['T01','T02','T03','T04','T05']}];
 assert.doesNotThrow(()=>validateCandidateReport(r,e));
});

test('a full public target that was omitted from Qwen input cannot become a model hypothesis or cited fact',()=>{
 const e=structuredClone(evidence),r=report();
 e.modelInput.analysisTargets=e.modelInput.analysisTargets.slice(0,1);e.modelInput.facts=[{id:'T01'}];
 r.hypotheses[0].targetIds=['MDT_b'];r.hypotheses[0].supportingEvidenceIds=['T02'];
 r.hypotheses[0].category='interference';r.hypotheses[0].sopIds=['TG_MDT_b'];r.sop=[{sopId:'TG_MDT_b',reason:'해당 RSRP 관측을 확인합니다.',evidenceIds:['T02']}];
 assert.throws(()=>validateCandidateReport(r,e),error=>error.code==='QWEN_INVALID_REPORT');
 r.hypotheses=[];r.sop=[];r.observations[0].evidenceIds=['T02'];
 assert.throws(()=>validateCandidateReport(r,e),error=>error.code==='QWEN_INVALID_REPORT');
});

test('live-observed RSRP variation above the weak reference cannot become a coverage cause',()=>{
 const e=structuredClone(evidence),r=report();
 e.analysisTargets[0].kind='call-radio';e.analysisTargets[0].allowedCauseCategories=['coverage','interference'];
 e.modelInput.analysisTargets[0]={id:'MDT_a',kind:'call-radio',metrics:{observations:12,minRsrp:-98,maxRsrp:-78}};
 r.observations[0].text='동일 통화의 RSRP 변화가 관측되었습니다.';
 r.hypotheses[0].title='통화 구간 RSRP 변화와 커버리지 영향 검토';
 r.hypotheses[0].reason='동일 통화 RSRP 변화가 있어 커버리지 영향을 확인합니다.';
 assert.throws(()=>validateCandidateReport(r,e),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');
 e.modelInput.analysisTargets[0].metrics.minRsrp=-110;
 assert.doesNotThrow(()=>validateCandidateReport(r,e),'an actual low observation can support a coverage investigation, with timing uncertainty retained');
});

test('a grouped observed coverage area cannot collapse to one POT without an evidence-specific exclusion',()=>{
 const e=structuredClone(evidence),r=report();
 e.modelInput.observationGroups=[{id:'AREA_a',kind:'mdt-adjacent-observations',targetIds:['MDT_a','MDT_b','MDT_c'],comparisonTargetIds:[]}];
 for(const id of ['MDT_b','MDT_c']){
  const fid=id==='MDT_b'?'T02':'T03';
  const publicIndex=e.analysisTargets.findIndex(target=>target.id===id),modelIndex=e.modelInput.analysisTargets.findIndex(target=>target.id===id);
  e.analysisTargets[publicIndex>=0?publicIndex:e.analysisTargets.length]={id,kind:'mdt-grid',evidenceIds:[fid],sopIds:['TG_MDT_a']};
  e.modelInput.analysisTargets[modelIndex>=0?modelIndex:e.modelInput.analysisTargets.length]={id,kind:'mdt-grid',metrics:{samples:80,belowPct:{'-100':20}}};
  if(!e.facts.some(f=>f.id===fid))e.facts.push({id:fid});
 }
 assert.throws(()=>validateCandidateReport(r,e),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');
 r.hypotheses[0].missingEvidence='MDT_b와 MDT_c는 인접 RSRP 분포가 다른 구간인지 확인하지 못해 이번 원인 대상에서 제외하고 경계 비교로 남깁니다.';
 assert.doesNotThrow(()=>validateCandidateReport(r,e));
});

test('group correction names only the actual omitted server targets before a successful retry',async t=>{
 const e=structuredClone(evidence),r=report();
 e.modelInput.observationGroups=[{id:'AREA_a',kind:'mdt-adjacent-observations',targetIds:['MDT_a','MDT_b','MDT_c'],comparisonTargetIds:[]}];
 e.analysisTargets[1]={id:'MDT_b',kind:'mdt-grid',evidenceIds:['T02'],sopIds:['TG_MDT_a']};
 e.analysisTargets.push({id:'MDT_c',kind:'mdt-grid',evidenceIds:['T03'],sopIds:['TG_MDT_a']});
 e.modelInput.analysisTargets[1]={id:'MDT_b',kind:'mdt-grid',metrics:{belowPct:{'-100':20}}};
 e.modelInput.analysisTargets.push({id:'MDT_c',kind:'mdt-grid',metrics:{belowPct:{'-100':20}}});e.facts.push({id:'T03'});
 const complete=structuredClone(r);complete.hypotheses[0].targetIds=['MDT_a','MDT_b','MDT_c'];complete.hypotheses[0].supportingEvidenceIds=['T01','T02','T03'];
 let count=0,correction;
 t.mock.method(globalThis,'fetch',async(_url,init)=>{const body=JSON.parse(init.body);if(count)correction=body.messages.at(-1).content;return new Response(JSON.stringify({model:'model',choices:[{finish_reason:'stop',message:{content:JSON.stringify(count++?complete:r)}}]}),{status:200});});
 const config={baseUrl:'http://127.0.0.1:1/v1',model:'model',apiKey:'secret-not-in-prompt',missing:[],timeoutMs:1000,maxTokens:2000,temperature:0,jsonMode:true};
 assert.deepEqual(await analyzeCandidateWithQwen(config,e,new AbortController().signal),complete);
 assert.match(correction,/MDT_b/);assert.match(correction,/MDT_c/);assert.match(correction,/누락/);assert.ok(!correction.includes(config.apiKey));
 assert.match(correction,/결함을 단정하지/);assert.match(correction,/교체.*설정 변경/);assert.match(correction,/서버 SOP/);
});

function terminationReport(){
 const e=structuredClone(evidence),r=report();e.analysisTargets[0].kind='termination-group';
 e.modelInput.analysisTargets[0]={id:'MDT_a',kind:'termination-group',metrics:{rawCodes:{fcRaw:'9563',byeReasonRaw:'102^RTP timeout'},rawFieldStatus:{fcRaw:'present',byeReasonRaw:'present'}}};
 r.observations[0].text='실제 종료 원문을 확인했습니다.';r.hypotheses[0].category='equipment';
 r.hypotheses[0].title='RTP timeout의 수신 중단 구간 확인';r.hypotheses[0].reason='BYE 102^RTP timeout이 관측되어 마지막 수신 RTP와 최초 BYE 발신 주체를 맞춰 중단 구간을 확인합니다.';
 return {e,r};
}

test('RTP timeout alone cannot certify a failed link, device or terminal in any model prose',()=>{
 for(const [field,claim] of [
  ['title','RTP timeout을 일으킨 전송 링크 장애'],
  ['reason','BYE 102^RTP timeout으로 전송 링크 장애가 확인되었습니다.'],
  ['reason','BYE 102^RTP timeout의 원인은 단말 결함입니다.'],
  ['reason','BYE 102^RTP timeout과 장비 고장이 함께 확인되었습니다.'],
  ['observed','전송 구간 장애가 원인으로 확인되었습니다.']
 ]){
  const {e,r}=terminationReport();r.hypotheses[0].assessment='supported';
  if(field==='observed')r.summary.observed=claim;else r.hypotheses[0][field]=claim;
  assert.throws(()=>validateCandidateReport(r,e),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION',claim);
 }
});

test('model checks cannot request direct replacement or reconfiguration outside the server procedures',()=>{
 for(const action of ['장비 교체를 요청합니다.','전송 링크를 복구합니다.','단말을 재기동합니다.','장비 파라미터 변경을 검토합니다.','안테나 틸트를 조정합니다.','장비 교체','안테나 틸트 조정']){
  const {e,r}=terminationReport();r.checks[0].action=action;
  assert.throws(()=>validateCandidateReport(r,e),error=>error.code==='QWEN_UNSUPPORTED_ACTION',action);
 }
});

test('component fault queries and explicit uncertainty remain valid read-only investigation',()=>{
 for(const reason of [
  'BYE 102^RTP timeout이 관측되어 전송 구간 로그와 오류 여부를 확인합니다.',
  'BYE 102^RTP timeout만으로 장비 장애로 확정할 수 없습니다.',
  'BYE 102^RTP timeout의 종료 주체와 전송 링크 장애 여부를 동기화 로그에서 확인합니다.'
 ]){const {e,r}=terminationReport();r.hypotheses[0].reason=reason;assert.doesNotThrow(()=>validateCandidateReport(r,e),reason);}
});

test('captured grouped report uses future component inspection while leaving fault and timing unresolved',()=>{
 const captured=capturedTerminationFixture();
 assert.doesNotThrow(()=>validateCandidateReport(captured.report,captured.evidence));
 const confirmed=structuredClone(captured.report);
 confirmed.hypotheses.find(row=>row.category==='equipment').reason='BYE 102^RTP timeout으로 전송 링크 장애가 확인되었습니다.';
 assert.throws(()=>validateCandidateReport(confirmed,captured.evidence),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');
 const causal=structuredClone(captured.report);
 causal.hypotheses.find(row=>row.category==='equipment').title='RTP timeout을 일으킨 전송 링크 장애';
 assert.throws(()=>validateCandidateReport(causal,captured.evidence),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');
});

test('captured Korean RTP interruption witness is supported only by an actual recognized raw event',()=>{
 const captured=capturedTerminationFixture();
 const translated=structuredClone(captured.report),equipment=translated.hypotheses.find(row=>row.category==='equipment');
 equipment.reason='종료 원문에 RTP 수신 중단 코드가 관측되어 중단 시작 구간을 확인합니다.';
 assert.doesNotThrow(()=>validateCandidateReport(translated,captured.evidence));
 const unknown=structuredClone(captured.evidence),term=unknown.modelInput.analysisTargets.find(target=>target.kind==='termination-group');
 term.metrics.rawCodes={fcRaw:'9563',byeReasonRaw:'0: Tx Bye'};
 equipment.reason='FC 9563이 기록되어 RTP 수신 중단 시작 구간을 확인합니다.';
 assert.throws(()=>validateCandidateReport(translated,unknown),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION','an unknown FC and general BYE cannot invent an RTP interruption event');
});

test('captured RTP receive-loss translation requires the actual Rx_RTP_middle_Loss source token',()=>{
 const captured=capturedTerminationFixture(),translated=structuredClone(captured.report);
 const equipment=translated.hypotheses.find(row=>row.category==='equipment');
 equipment.title='RTP 수신 손실과 BYE 종료 주체의 시간 정합 확인';
 equipment.reason='RTP 수신 손실과 BYE 원문이 관측되어 중단 구간과 종료 주체의 시간 정합을 확인합니다.';
 assert.doesNotThrow(()=>validateCandidateReport(translated,captured.evidence));
 const unknown=structuredClone(captured.evidence),term=unknown.modelInput.analysisTargets.find(target=>target.kind==='termination-group');
 term.metrics.rawCodes={fcRaw:'9563',byeReasonRaw:'0: Tx Bye'};
 equipment.reason='FC 9563이 기록되어 RTP 수신 손실과 종료 주체의 시간 정합을 확인합니다.';
 assert.throws(()=>validateCandidateReport(translated,unknown),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION');
 term.metrics.rawCodes={fcRaw:'9563',byeReasonRaw:'102^RTP timeout'};
 assert.throws(()=>validateCandidateReport(translated,unknown),error=>error.code==='QWEN_UNSUPPORTED_INTERPRETATION','RTP timeout alone does not establish the specific receive-loss code');
});

function capturedTerminationFixture(){const captured=structuredClone(require('./fixtures/candidate-captured-future-check.json'));captured.report.hypotheses=captured.report.hypotheses.filter(h=>h.category==='equipment');const ids=new Set(captured.report.hypotheses.flatMap(h=>h.sopIds));captured.report.sop=captured.report.sop.filter(s=>ids.has(s.sopId));return captured;}
