/* eslint-disable @typescript-eslint/no-require-imports -- Local server-only client regression tests. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {analyzeCandidateWithQwen,validateCandidateReport,CANDIDATE_PROMPT_VERSION}=require('../qwen-candidate-client.cjs');

const templates=['SOP_SCOPE','SOP_COMPARISON','SOP_TIMING','SOP_CAUSE','SOP_FIELD','SOP_VERIFY'].map(id=>({id,title:'자료 확인',purpose:'확인 목적',reason:'후보 근거를 대조합니다.',materials:['원본 통화'],method:['자료를 확인합니다.'],outcomes:['근거가 부족하면 자료를 확보합니다.'],additionalData:['정상 비교 자료'],evidenceIds:['E01']}));
const facts=Array.from({length:12},(_,i)=>({id:'E'+String(i+1).padStart(2,'0'),title:'관측 근거',detail:'후보 구성 통화는 지역 전체 통화가 아닙니다.'}));
const evidence={schemaVersion:'qwen-candidate-evidence-v2',analysisTargets:[{id:'MDT_alias',kind:'mdt-grid',allowedCauseCategories:['coverage','interference'],evidenceIds:['E01','E02'],sopIds:['SOP_SCOPE','SOP_COMPARISON']}],facts,sop:{version:'candidate-sop-draft-v4',templates},
 modelInput:{analysisTargets:[{id:'MDT_alias',kind:'mdt-grid',metrics:{sampleSupport:'multiple-measurements',belowPct:{'-100':48.51}}}],scope:{dateStart:'2026-10-26',dateEnd:'2026-10-30'},summary:{customers:183,totalCalls:205,dropCalls:6,observedDays:5},byCell:[{cell:'대표 Cell 07',totalCalls:12}],
 candidate:{radiusM:850,maxPairDistanceM:1614.6286},comparison:{status:'unavailable',calls:null},metrics:{rsrp:-110.5,jitter:0.5},sop:{templates},facts}};
const baseReport={summary:{observed:'여러 고객의 저품질 통화가 반복 관측됐습니다.',priority:'후보 범위와 구간별 관측 패턴을 먼저 확인합니다.',missing:'정상 비교 자료와 저하 순간의 시간 정합 근거가 부족합니다.'},
 observations:[{text:'범위 검토가 필요한 후보입니다.',evidenceIds:['E01']}],
 hypotheses:[{category:'coverage',targetIds:['MDT_alias'],title:'RSRP 기준 이하 분포의 반복 가능성',assessment:'possible',reason:'RSRP 기준 이하 비율과 신호 분포를 해당 구간에서 확인할 필요가 있습니다.',supportingEvidenceIds:['E01','E02'],missingEvidence:'정상 비교군과 시간 정합 근거가 부족합니다.',sopIds:['SOP_SCOPE','SOP_COMPARISON']}],
 checks:[{action:'위치 근거별로 시점과 Cell을 대조합니다.',reason:'추정 위치를 실제 열화 위치로 확정할 수 없습니다.',evidenceIds:['E02']}],
 limitations:['후보 구성 통화를 지역 전체 통화의 분모로 사용할 수 없습니다.'],
 sop:templates.slice(0,2).map(template=>({sopId:template.id,reason:'현재 관측 근거와 부족한 자료를 대조해야 합니다.',evidenceIds:['E01']}))};
const clone=value=>structuredClone(value);
const config={baseUrl:'http://127.0.0.1:1/v1',model:'configured-test-model',apiKey:'private-test-key',missing:[],timeoutMs:1000,maxTokens:4096,temperature:0.2,jsonMode:false,extraBody:{chat_template_kwargs:{enable_thinking:false}}};
const response=(report=baseReport,options={})=>({model:config.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(report),reasoning_content:'not exposed'}}],...options});

test('v10 automatic analysis preserves grounded causes and their SOPs while custom sends remain exact',async t=>{
 const e={...clone(evidence),versions:{prompt:'candidate-prompt-v10'}},first=clone(baseReport);
 first.investigations=[{title:'RSRP 분포 조사',reason:'RSRP 기준 이하 분포가 확보되어 실제 구간의 경계를 대조할 대상입니다.',nextCheck:'해당 구간의 RSRP 분포를 같은 대역의 인접 관측과 대조합니다.',targetIds:['MDT_alias'],evidenceIds:['E01','E02']}];
 const sent=[];
 t.mock.method(globalThis,'fetch',async(_url,init)=>{sent.push(JSON.parse(init.body));return new Response(JSON.stringify(response(first)),{status:200});});
 assert.deepEqual(await analyzeCandidateWithQwen(config,e,new AbortController().signal),first);assert.equal(sent.length,1);
 const system=sent[0].messages[0].content;
 assert(!system.includes('hypotheses:[], sop:[]를 반드시'));assert(system.includes('investigations'));
 assert(system.includes('대상 ID를 반복하지'));assert(!system.includes('꼭 필요한 숫자는'));
 assert(system.includes('같은 callRef'));assert(system.includes('callRef는 targetIds에 넣지'));assert(system.includes('evidence-id-alias-v1'));assert(system.includes('evidenceIds[0]인 T코드'));
 for(const label of ['커버리지 부족','주파수·용량 부족','셀 중첩·간섭','셀·주파수 전환','장비·전송·단말 이상'])assert(system.includes(label),label);
 for(const instruction of ['sourceHypothesisCandidates','criteriaByEvidenceId','가설 하나의 targetIds는 최대 다섯 개','실제 충족 방향만','배경 mdt-grid와 call-criteria를 같은 가설에 합치지','targetIds 전체를 함께 연결','HO 실패나 QoE 인과를 단정하지','equipment 가설 제목은 실제 관측된 RTP'])assert(system.includes(instruction),instruction);
 assert(!system.includes('각 가설의 모든 target마다'));
 t.mock.method(globalThis,'fetch',async(_url,init)=>{sent.push(JSON.parse(init.body));return new Response(JSON.stringify(response(first)),{status:200});});
 const edited={system:'고급 원인 가설을 실제 근거와 허용 SOP로 함께 작성합니다.',user:JSON.stringify(e.modelInput)};
 assert.deepEqual(await analyzeCandidateWithQwen(config,e,new AbortController().signal,{promptOverride:edited}),first);
 assert.equal(sent.length,2);assert.deepEqual(sent[1].messages,[{role:'system',content:edited.system},{role:'user',content:edited.user}]);
 assert.deepEqual(validateCandidateReport(first,e),first,'full legacy/category validation remains available');
});

test('v10 default requires one actual eligible cause through one bounded correction while custom and insufficient sources may omit causes',async t=>{
 const e={...clone(evidence),versions:{prompt:'candidate-prompt-v10'}},valid=clone(baseReport);
 valid.investigations=[{title:'RSRP 분포 조사',reason:'RSRP 기준 이하 분포가 확보되어 실제 구간의 경계를 대조할 대상입니다.',nextCheck:'해당 구간의 RSRP 분포를 같은 대역의 인접 관측과 대조합니다.',targetIds:['MDT_alias'],evidenceIds:['E01','E02']}];
 e.modelInput.sourceHypothesisCandidates=[{category:'coverage',assessment:'possible',targetIds:['MDT_alias'],evidenceIds:['E01','E02'],sopIds:['SOP_SCOPE','SOP_COMPARISON'],criteriaByEvidenceId:{E01:{dlStatus:'matched',ulStatus:'not-matched',pollutionStatus:'insufficient'}}}];
 const empty={...clone(valid),hypotheses:[],sop:[]},sent=[];let requests=0;
 t.mock.method(globalThis,'fetch',async(_url,init)=>{sent.push(JSON.parse(init.body));return new Response(JSON.stringify(response(++requests===1?empty:valid)),{status:200});});
 assert.deepEqual(await analyzeCandidateWithQwen(config,e,new AbortController().signal),valid);assert.equal(sent.length,2);
 const retry=sent[1].messages[2].content;assert(retry.includes('적어도 한 개의 possible 가설'));assert(retry.includes('hypotheses={category,title,assessment'));assert(retry.includes('영 개에서 다섯 개'));assert(!retry.includes('hypotheses:[]'));assert(!retry.includes('가설마다 실제 관측 사건'));
 assert(retry.includes(JSON.stringify(e.modelInput.sourceHypothesisCandidates)));for(const instruction of ['가설당 대상 최대 다섯 개','같은 category SOP','MDT AREA','DL 또는 UL','핸드오버 실패 여부는 nextCheck 질문','equipment 제목은 실제 RTP','investigations는 자료 kind를 분리'])assert(retry.includes(instruction),instruction);
 assert.deepEqual(JSON.parse(sent[0].messages[1].content).sourceHypothesisCandidates,e.modelInput.sourceHypothesisCandidates);
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify(response(empty)),{status:200}));
 const edited={system:'실제 관측 조사만 반환합니다.',user:JSON.stringify(e.modelInput)};assert.deepEqual(await analyzeCandidateWithQwen(config,e,new AbortController().signal,{promptOverride:edited}),empty);
 const insufficient=clone(e);insufficient.modelInput.analysisTargets[0].metrics.belowPct={'-100':0,'-105':0,'-110':0};assert.deepEqual(await analyzeCandidateWithQwen(config,insufficient,new AbortController().signal),empty);
});

test('candidate report validates real evidence and the referenced SOP union, with server order',()=>{
 const reordered=clone(baseReport);reordered.sop.reverse();
 assert.deepEqual(validateCandidateReport(reordered,evidence),baseReport);
 assert.equal(CANDIDATE_PROMPT_VERSION,'candidate-prompt-v11');
});

test('candidate schema rejects confidence, absent evidence references, invented and missing SOPs',()=>{
 const bad=[
  r=>{r.confidence=80;},r=>{r.summary.confidence=80;},r=>{r.observations[0].evidenceIds=['E99'];},
  r=>{r.hypotheses[0].supportingEvidenceIds=[];},r=>{r.hypotheses[0].assessment='confirmed';},
  r=>{r.checks[0].evidenceIds=['E99'];},r=>{r.sop[0].sopId='SOP_INVENTED';},
  r=>{r.sop.pop();},r=>{r.sop.push({sopId:'SOP_TIMING',reason:'확인합니다.',evidenceIds:['E01']});},r=>{r.sop[1].sopId=r.sop[0].sopId;},r=>{r.sop[0].command='set power';},
  r=>{r.summary.observed='가'.repeat(181);},r=>{r.hypotheses[0].missingEvidence='';}
 ];
 for(const change of bad){const report=clone(baseReport);change(report);assert.throws(()=>validateCandidateReport(report,evidence),e=>['QWEN_INVALID_REPORT','QWEN_INVALID_SOP'].includes(e.code));}
});

test('candidate numeric validation preserves percentages, signs, exponents and binary-minus strength',()=>{
 for(const prose of ['지터999ms입니다.','RSRP −999dBm입니다.','새 수치 .999입니다.','신규 수치 9.99e2입니다.','새 수치 ９９９입니다.','독립 고객 -183명입니다.','차이 205--183입니다.']){
  const report=clone(baseReport);report.observations[0].text=prose;
  assert.throws(()=>validateCandidateReport(report,evidence),e=>e.code==='QWEN_UNSUPPORTED_NUMBER',prose);
 }
 for(const prose of ['후보 구성 205통화, 서로 다른 고객 183명입니다.','후보 구성 수 차이는 205 - 183입니다.','RSRP −110.5dBm 관측값을 확인합니다.','대표 Cell 07의 E01 근거를 확인합니다.']){
  const report=clone(baseReport);report.observations[0].text=prose;
  assert.deepEqual(validateCandidateReport(report,evidence),report,prose);
 }
 const percentageEvidence=clone(evidence);percentageEvidence.modelInput.summary.poorRatePercent=12.3;
 const report=clone(baseReport);report.observations[0].text='제공된 비교 통화 집단의 비율은 12.3%입니다.';
 assert.deepEqual(validateCandidateReport(report,percentageEvidence),report);
});

test('known counts cannot authorize confidence percentages, regional rates, raw RTP units or device changes',()=>{
 for(const prose of ['무선 원인 신뢰도는 6%입니다.','원인의 6퍼센트 확률입니다.','지역 불량률은 6%입니다.','지역 불량률은 6퍼센트입니다.','RTP 지터는 6ms입니다.','패킷 손실은 6%입니다.','출력을 6으로 조정합니다.','ssh router show status 명령을 실행합니다.']){
  const report=clone(baseReport);report.checks[0].action=prose;
  assert.throws(()=>validateCandidateReport(report,evidence),e=>['QWEN_UNSUPPORTED_INTERPRETATION','QWEN_UNSUPPORTED_ACTION'].includes(e.code),prose);
 }
});

test('candidate transport sends only modelInput and returns strict final content with safe response metadata',async t=>{
 let sent,metadata;
 t.mock.method(globalThis,'fetch',async(url,init)=>{sent={url,init,body:JSON.parse(init.body)};return new Response(JSON.stringify(response()),{status:200,headers:{'Content-Type':'application/json'}});});
 const result=await analyzeCandidateWithQwen(config,{...evidence,target:{candidateId:'PRIVATE-CANDIDATE'},calls:[{id:'PRIVATE-CALL',customerId:'PRIVATE-CUSTOMER',lat:37.5}]},new AbortController().signal,{onResponse:value=>{metadata=value;}});
 assert.deepEqual(result,baseReport);assert.equal(sent.body.model,config.model);assert.equal(sent.body.stream,false);
 assert.deepEqual(sent.body.chat_template_kwargs,{enable_thinking:false});assert.equal(sent.body.response_format,undefined);
 assert.equal(sent.init.headers.Authorization,'Bearer private-test-key');
 const body=JSON.stringify(sent.body);for(const forbidden of ['PRIVATE-CANDIDATE','PRIVATE-CALL','PRIVATE-CUSTOMER','private-test-key'])assert(!body.includes(forbidden));
 assert(sent.body.messages[0].content.includes('지역 불량률'));assert(sent.body.messages[0].content.includes('공식 승인'));
 assert.equal(metadata.responseModel,config.model);assert.equal(metadata.responseModelVerified,true);assert(metadata.durationMs>=0);
});

test('each comparison generation requires model identity even when an earlier core passed',async t=>{
 const e=clone(evidence);
 e.versions={prompt:'candidate-prompt-v11'};
 e.modelInput.comparisonContext={schemaVersion:'candidate-comparison-input-v1',gridComparisons:[{category:'coverage',evidenceIds:['E01']}],callObservations:[]};
 const report=clone(baseReport);
 report.investigations=[{title:'RSRP 분포 조사',reason:'RSRP 기준 이하 분포가 확보되어 실제 구간의 경계를 대조할 대상입니다.',nextCheck:'해당 구간의 RSRP 분포를 같은 대역의 인접 관측과 대조합니다.',targetIds:['MDT_alias'],evidenceIds:['E01','E02']}];
 let models=[];
 const requests=[];
 t.mock.method(globalThis,'fetch',async(_url,init)=>{
  requests.push(JSON.parse(init.body));
  return new Response(JSON.stringify(response(report,{model:models.shift()})),{status:200});
 });
 for(const wrong of [null,'other']){
  models=[wrong];
  await assert.rejects(()=>analyzeCandidateWithQwen(config,e),er=>er.code==='QWEN_MODEL_MISMATCH');
  models=[config.model,wrong];
  await assert.rejects(()=>analyzeCandidateWithQwen(config,e),er=>er.code==='QWEN_MODEL_MISMATCH');
  assert.deepEqual(Object.keys(JSON.parse(requests.at(-1).messages[1].content)).sort(),['comparisonContext','scope']);
 }
 assert.equal(requests.length,6);
});

test('empty, malformed, truncated, wrong-model and invented-reference model outputs cannot complete',async t=>{
 const cases=[
  [{choices:[{finish_reason:'stop',message:{content:null,reasoning:'hidden'}}]},'QWEN_EMPTY_RESPONSE'],
  [{choices:[{finish_reason:'length',message:{content:'{}'}}]},'QWEN_TRUNCATED_RESPONSE'],
  [{choices:[{finish_reason:'stop',message:{content:'not-json'}}]},'QWEN_INVALID_JSON'],
  [{model:'other-model'},'QWEN_MODEL_MISMATCH'],
  [{choices:[{finish_reason:'content_filter',message:{content:''}}]},'QWEN_RESPONSE_BLOCKED'],
 ];
 let next;
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify(response(baseReport,next)),{status:200}));
 for(const [payload,code] of cases){next=payload;await assert.rejects(()=>analyzeCandidateWithQwen(config,evidence,new AbortController().signal),e=>e.code===code);}
 const invalid=clone(baseReport);invalid.sop[0].sopId='UNKNOWN';next={choices:[{finish_reason:'stop',message:{content:JSON.stringify(invalid)}}]};
 await assert.rejects(()=>analyzeCandidateWithQwen(config,evidence,new AbortController().signal),e=>e.code==='QWEN_INVALID_SOP');
});

test('candidate cancellation and transport failure keep shared safe errors and never expose private endpoints',async t=>{
 t.mock.method(globalThis,'fetch',(_url,init)=>new Promise((resolve,reject)=>{
  const fail=()=>reject(new DOMException('private endpoint information','AbortError'));
  if(init.signal.aborted)fail();else init.signal.addEventListener('abort',fail,{once:true});
 }));
 const controller=new AbortController();const pending=analyzeCandidateWithQwen(config,evidence,controller.signal);controller.abort();
 await assert.rejects(()=>pending,e=>e.code==='ANALYSIS_CANCELLED'&&!e.message.includes('private endpoint'));
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('secret URL and credential');});
 await assert.rejects(()=>analyzeCandidateWithQwen(config,evidence,new AbortController().signal),e=>e.code==='QWEN_NETWORK_ERROR'&&!e.message.includes('secret'));
});

test('hypotheses require distinct allowed target-linked SOPs and at most five hypotheses',()=>{
 for(const links of [undefined,null,'SOP_SCOPE',{},[],['UNKNOWN'],['SOP_SCOPE','SOP_SCOPE'],['SOP_SCOPE','SOP_COMPARISON','SOP_TIMING']]){
  const report=clone(baseReport);report.hypotheses[0].sopIds=links;
  assert.throws(()=>validateCandidateReport(report,evidence),e=>['QWEN_INVALID_REPORT','QWEN_INVALID_SOP'].includes(e.code));
 }
 const tooMany=clone(baseReport);tooMany.hypotheses=Array.from({length:6},()=>clone(baseReport.hypotheses[0]));
 assert.throws(()=>validateCandidateReport(tooMany,evidence),e=>e.code==='QWEN_INVALID_REPORT');
 const linked=clone(baseReport);linked.hypotheses.push({...clone(linked.hypotheses[0]),sopIds:['SOP_COMPARISON']});
 linked.sop.reverse();assert.deepEqual(validateCandidateReport(linked,evidence).sop.map(row=>row.sopId),['SOP_SCOPE','SOP_COMPARISON']);
});


test('five-category contract preserves only explicitly returned model categories and rejects missing or invented values',()=>{
 assert.equal(validateCandidateReport(clone(baseReport),evidence).hypotheses[0].category,'coverage');
 for(const category of [undefined,'all','pci-pollution',null]){
  const report=clone(baseReport);
  if(category===undefined)delete report.hypotheses[0].category;else report.hypotheses[0].category=category;
  assert.throws(()=>validateCandidateReport(report,evidence),e=>e.code==='QWEN_INVALID_REPORT');
 }
});
test('five-category contract rejects causes outside the selected target evidence and mismatched category SOPs',()=>{
 for(const category of ['capacity','mobility','equipment']){
  const report=clone(baseReport);report.hypotheses[0].category=category;
  assert.throws(()=>validateCandidateReport(report,evidence),e=>e.code==='QWEN_UNSUPPORTED_CATEGORY');
 }
 const pollution=clone(baseReport);pollution.hypotheses[0].category='interference';assert.throws(()=>validateCandidateReport(pollution,evidence),e=>e.code==='QWEN_UNSUPPORTED_INTERPRETATION');
 const qualified=clone(evidence);qualified.sop.templates[0].causeCategory='coverage';qualified.sop.templates[1].causeCategory='interference';
 assert.throws(()=>validateCandidateReport(clone(baseReport),qualified),e=>e.code==='QWEN_INVALID_SOP');
 const report=clone(baseReport);report.hypotheses[0].sopIds=['SOP_SCOPE'];report.sop=report.sop.slice(0,1);
 assert.equal(validateCandidateReport(report,qualified).hypotheses[0].category,'coverage');
});

test('candidate-only overrides merge into the actual request and snapshot without mutating global options',async t=>{
 let body,captured;
 t.mock.method(globalThis,'fetch',async(_url,init)=>{body=JSON.parse(init.body);return new Response(JSON.stringify(response()),{status:200});});
 const selected={...config,extraBody:{chat_template_kwargs:{enable_thinking:true,thinking_budget:512},top_p:0.9,top_k:20},candidateExtraBody:{chat_template_kwargs:{enable_thinking:false},top_p:0.6}};
 const before=structuredClone(selected);
 const result=await analyzeCandidateWithQwen(selected,evidence,new AbortController().signal,{onRequest:value=>{captured=structuredClone(value);}});
 assert.deepEqual(result,baseReport);assert.deepEqual(body.chat_template_kwargs,{enable_thinking:false});
 assert.equal(body.top_p,0.6);assert.equal(body.top_k,20);assert.equal(body.max_tokens,config.maxTokens);
 assert.deepEqual(captured,body);assert.deepEqual(selected,before);
});

test('one invalid numeric report is corrected against the same evidence before completion',async t=>{
 const invalid=clone(baseReport);invalid.summary.priority='표시 반경 850m의 구성점 거리는 1614.6m입니다.';
 const attempts=[],bodies=[];let count=0;
 t.mock.method(globalThis,'fetch',async(_url,init)=>{bodies.push(JSON.parse(init.body));return new Response(JSON.stringify(response(count++===0?invalid:baseReport)),{status:200});});
 const result=await analyzeCandidateWithQwen(config,evidence,new AbortController().signal,{onAttempt:value=>attempts.push(value)});
 assert.deepEqual(result,baseReport);assert.equal(bodies.length,2);
 assert.equal(bodies[0].messages[1].content,bodies[1].messages[1].content,'the underlying evidence is unchanged');
 assert.ok(bodies[1].messages.at(-1).content.includes('QWEN_UNSUPPORTED_NUMBER'));
 assert.deepEqual(attempts.map(row=>[row.attempt,row.status]),[[1,'started'],[1,'retrying'],[2,'started'],[2,'completed']]);
});

test('numeric correction also repeats selected target mappings so the repair cannot lose source links',async t=>{
 const invalid=clone(baseReport);invalid.observations[0].text='근거에 없는 수치 999가 관측되었습니다.';
 let count=0,hint;
 t.mock.method(globalThis,'fetch',async(_url,init)=>{const body=JSON.parse(init.body);if(count)hint=body.messages.at(-1).content;return new Response(JSON.stringify(response(count++?baseReport:invalid)),{status:200});});
 assert.deepEqual(await analyzeCandidateWithQwen(config,evidence,new AbortController().signal),baseReport);assert.equal(count,2);assert.match(hint,/MDT_alias/);assert.match(hint,/E01/);assert.match(hint,/E02/);assert.match(hint,/SOP_SCOPE/);
});

test('correction identifies the exact target evidence mapping instead of permitting unrelated known facts',async t=>{
 const narrowed=clone(evidence);narrowed.analysisTargets[0].evidenceIds=['E01'];
 const invalid=clone(baseReport),valid=clone(baseReport);valid.hypotheses[0].supportingEvidenceIds=['E01'];
 let count=0,hint;
 t.mock.method(globalThis,'fetch',async(_url,init)=>{const body=JSON.parse(init.body);if(count)hint=body.messages.at(-1).content;return new Response(JSON.stringify(response(count++?valid:invalid)),{status:200});});
 assert.deepEqual(await analyzeCandidateWithQwen(config,narrowed,new AbortController().signal),valid);
 assert.equal(count,2);assert.match(hint,/MDT_alias/);assert.match(hint,/E01/);assert.match(hint,/E02/);
});

test('correction is bounded and fatal authentication failures never trigger a model retry',async t=>{
 let count=0;
 t.mock.method(globalThis,'fetch',async()=>{count++;return new Response(JSON.stringify(response(baseReport,{choices:[{finish_reason:'stop',message:{content:'INVALID'}}]})),{status:200});});
 await assert.rejects(()=>analyzeCandidateWithQwen(config,evidence,new AbortController().signal),error=>error.code==='QWEN_INVALID_JSON');
 assert.equal(count,2,'invalid output gets at most one correction attempt');
 count=0;t.mock.method(globalThis,'fetch',async()=>{count++;return new Response('{}',{status:401});});
 await assert.rejects(()=>analyzeCandidateWithQwen(config,evidence,new AbortController().signal),error=>error.code==='QWEN_AUTH_FAILED');
 assert.equal(count,1);
});

test('a generated operational action gets one correction toward original-log inspection',async t=>{
 const invalid=clone(baseReport);invalid.checks[0].action='장비 교체를 요청합니다.';
 let count=0,hint;
 t.mock.method(globalThis,'fetch',async(_url,init)=>{const body=JSON.parse(init.body);if(count)hint=body.messages.at(-1).content;return new Response(JSON.stringify(response(count++?baseReport:invalid)),{status:200});});
 assert.deepEqual(await analyzeCandidateWithQwen(config,evidence,new AbortController().signal),baseReport);
 assert.equal(count,2);assert.match(hint,/원본.*로그|로그.*조회/);assert.match(hint,/서버 SOP/);
});
