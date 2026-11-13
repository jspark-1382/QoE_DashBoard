/* eslint-disable @typescript-eslint/no-require-imports -- Candidate API integration regressions use a local HTTP server. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {createQwenAnalysisHandler}=require('../qwen-analysis-api.cjs');
const {collectCandidateEvidence}=require('../qwen-candidate-evidence.cjs');
const {createCandidateFixture}=require('./qwen-candidate-fixture.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function candidateReport(input){
 const target=input?.analysisTargets?.find(row=>row.kind==='call-criteria'&&row.allowedCauseCategories?.includes('coverage'))??input?.analysisTargets?.find(row=>row.kind==='call-quality')??input?.analysisTargets?.[0],rules=input?.targetRules?.[target?.kind];
 const allowed=target?.allowedCauseCategories??rules?.allowedCauseCategories??[];
 const coverage=allowed.includes('coverage')&&(target?.kind==='call-criteria'&&(target.metrics.criteria.dl.status==='matched'||target.metrics.criteria.ul.status==='matched')||target?.kind==='mdt-grid'&&Object.values(target.metrics.belowPct??{}).some(value=>value>0));
 const sopIds=(target?.sopIds??rules?.sopByCategory?.coverage??[]).filter(id=>input.sop.templates.some(row=>row.id===id&&(!row.causeCategory||row.causeCategory==='coverage')));
 const title=target?.kind==='call-criteria'?'DL·UL 기본 기준 통화 대조':target?.kind==='mdt-grid'?'RSRP 분포 조사':'MOS·QoE 통화 원본 대조';
 const reason=target?.kind==='call-criteria'?'DL RSRP 기본 기준 해당 관측이 있어 해당 통화의 원본 기록을 대조할 대상입니다.':target?.kind==='mdt-grid'?'RSRP 분포가 확보되어 경계를 대조할 대상입니다.':'같은 통화의 MOS·QoE 관측이 확보되어 원본 기록을 대조할 대상입니다.';
 const investigations=target?[{title,reason,nextCheck:'선택한 대상의 원본 기록을 같은 관측 시각으로 대조합니다.',targetIds:[target.id],evidenceIds:target.evidenceIds}]:[];
 const hypotheses=coverage&&sopIds.length?[{category:'coverage',title:target.kind==='call-criteria'?'DL RSRP 기본 기준의 커버리지 후보':'RSRP 기준 이하 분포의 커버리지 후보',assessment:'possible',reason:target.kind==='call-criteria'?'DL RSRP 기본 기준에 해당하여 해당 통화의 무선 관측을 확인할 후보입니다.':'RSRP 기준 이하 분포와 비율을 인접 구간에서 대조할 후보입니다.',supportingEvidenceIds:target.evidenceIds,missingEvidence:'같은 시각의 무선·음성 원본과 정상 비교 자료가 필요합니다.',targetIds:[target.id],sopIds}]:[];
 return {summary:{observed:'여러 고객의 저품질 통화가 후보로 관측됐습니다.',priority:'범위와 시점별 패턴을 먼저 대조합니다.',missing:'정상 비교군과 저하 순간의 정밀 정합 근거가 부족합니다.'},
  investigations,...(input?.comparisonContext?{comparison:mockComparison(input.comparisonContext)}:{}),
  observations:[{text:'후보 범위와 위치 근거는 추가 검토가 필요합니다.',evidenceIds:['E04']}],
  hypotheses,
  checks:[{action:'Cell과 관측 시각별로 원본 통화를 대조합니다.',reason:'위치와 시간 정합의 부족을 먼저 확인합니다.',evidenceIds:['E06']}],
  limitations:['후보 구성 통화를 지역 전체 통화의 분모로 사용할 수 없습니다.'],
  sop:hypotheses.length?sopIds.map(sopId=>({sopId,reason:'해당 기준의 실제 원본 관측을 대조합니다.',evidenceIds:target.evidenceIds})):[]};
}
function mockComparison(context){
 const rows=[...context.gridComparisons,...context.callObservations];
 if(!rows.length)return null;
 const primary=rows[0], alternative=rows.find(row=>row.category!==primary.category);
 const side=row=>({category:row.category,evidenceIds:row.evidenceIds});
 return {schemaVersion:'cause-comparison-v1',assessment:'unresolved',primary:side(primary),alternative:alternative?side(alternative):null,
  interpretation:'약전계의 공간 분포와 통화 중 셀 복귀·주파수 변경·RTP 중단을 조사할 수 있으나 관측 시점이 다릅니다.',
  limitation:'같은 위치에서 통화 품질이 떨어졌는지를 입증할 위치와 시각 연결이 부족합니다.',
  nextCheck:'동일 지점에서 음성이 끊기는 순간 신호가 유지되면 RTP 수신 경로를 확인합니다.'};
}
// Give the transport fixture a real cited termination event for the focused
// comparison requests. Its base data deliberately has no positive criteria.
function withTerminationEvidence(options){
 const e=collectCandidateEvidence(options), id='TG_fallback_fixture', fact='T9001';
 const publicTarget={id,kind:'termination-group',sourceDates:[e.calls[0].date],allowedCauseCategories:['equipment'],callIds:[e.calls[0].id],evidenceIds:[fact],sopIds:[],metrics:[{label:'byeReasonRaw',value:'RTP timeout'}],mapPoints:[],title:'RTP 종료',observation:'RTP timeout',limitations:[],band:null,earfcn:null};
 e.analysisTargets.push(publicTarget);
 e.modelInput.analysisTargets.push({...publicTarget,metrics:{rawCodes:{byeReasonRaw:'RTP timeout'}}});
 e.facts.push({id:fact,title:'RTP 종료 원문',detail:'RTP timeout'});e.modelInput.facts.push({id:fact});
 e.modelInput.comparisonContext.callObservations.push({category:'equipment',indicator:'rtpTermination',matchedCalls:1,assessableCalls:1,citedEvidenceScope:'all-matched-targets',evidenceIds:[fact]});
 return e;
}
async function listen(handler){
 const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {server,base:'http://127.0.0.1:'+server.address().port};
}
async function close(server){if(!server)return;await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});}
async function setup(t,options={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qwen-candidate-api-')),fixture=createCandidateFixture(root);
 const received=[];let responder=options.respond;
 const upstream=await listen(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw),record={body,authorization:req.headers.authorization};received.push(record);
  let input;try{input=JSON.parse(body.messages[1].content);}catch{input=body.messages[1].content;}
  // Custom prompt text is intentionally opaque to the mock upstream. Its
  // structured response still uses the fixture's actual server-owned sources.
  const responseInput=Array.isArray(input?.analysisTargets)?input:collectCandidateEvidence({publicDir:fixture.publicDir,dbPath:fixture.dbPath,sourceRevision:fixture.sourceRevision,target:fixture.target}).modelInput;
  const report=candidateReport(responseInput);
  const send=(value=report,status=200,finalContent)=>{if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(status===200?{model:'fixture-model',choices:[{finish_reason:'stop',message:{content:finalContent??JSON.stringify(value)}}]}:{error:{message:'PRIVATE-UPSTREAM-DIAGNOSTIC'}}));};
  if(responder)await responder({input,body,send,number:received.length});else send();
 });
 fs.writeFileSync(path.join(root,'.env'),'QWEN_BASE_URL='+upstream.base+'/v1\nQWEN_MODEL=fixture-model\nQWEN_API_KEY=PRIVATE-API-KEY\n');
 const handlerOptions={root,env:{},collectEvidence:options.collectEvidence,maxRunning:options.maxRunning??2,maxQueued:2,jobTtlMs:options.jobTtlMs??180000};
 let handler=createQwenAnalysisHandler(handlerOptions);
 const api=await listen((req,res)=>{void handler(req,res).then(handled=>{if(!handled){res.writeHead(404);res.end();}});});
 t.after(async()=>{await handler.close();await close(api.server);await close(upstream.server);fs.rmSync(root,{recursive:true,force:true});});
 async function request(route,method='GET',body){
  const init={method,headers:{'Content-Type':'application/json'}};if(body!==undefined&&method!=='GET')init.body=JSON.stringify(body);
  const response=await fetch(api.base+'/qoe/api/analysis/'+route,init);return {status:response.status,body:await response.json()};
 }
 return {...fixture,root,request,received,upstream:upstream.base,respond:fn=>{responder=fn;},restart:async()=>{await handler.close();handler=createQwenAnalysisHandler(handlerOptions);}};
}
async function waitFor(api,id,statuses){
 for(let i=0;i<200;i++){const result=await api.request('jobs/'+id);if(result.status!==200)throw Error('작업 조회 실패: '+JSON.stringify(result.body));if(statuses.includes(result.body.status))return result.body;await sleep(10);}
 throw Error('후보 작업이 지정한 상태에 도달하지 않았습니다.');
}
function mutateSummary(api){const summary=JSON.parse(fs.readFileSync(api.summaryPath,'utf8'));summary.candidates[0].label='동일 구성의 후보 표시명 변경';fs.writeFileSync(api.summaryPath,JSON.stringify(summary));}

test('candidate production worker aggregates multiple customers and returns only verified public report and safe metadata',async t=>{
 const api=await setup(t),started=await api.request('jobs','POST',api.target);
 assert.equal(started.status,202);assert.deepEqual(started.body.target,api.target);
 const job=await waitFor(api,started.body.id,['completed','failed']);
 assert.equal(job.status,'completed',JSON.stringify(job.error));assert.equal(job.evidence.summary.customers,2);assert.equal(job.evidence.summary.totalCalls,3);
 assert.equal(job.evidence.comparison.status,'unavailable');assert.equal(job.evidence.comparison.calls,null);
 assert.equal(job.evidence.candidate.rangeReviewRequired,true);assert.equal(job.evidence.candidate.validationDates.length,0);
 assert.deepEqual(job.report.hypotheses,[]);assert.deepEqual(job.report.sop,[]);assert(job.evidence.causeAssessments.every(row=>row.status==='insufficient'));assert.equal(job.evidence.analysisTargets.find(row=>row.id===job.report.investigations[0].targetIds[0]).kind,'call-quality');assert(job.evidence.sop.templates.some(row=>row.id==='COMPARISON_CHECK'));
 assert.equal(job.evidence.modelInput,undefined);assert.equal(job.modelVerification.responseModel,'fixture-model');assert.equal(job.modelVerification.responseModelVerified,true);
 assert.equal(api.received.length,1);assert.equal(api.received[0].body.model,'fixture-model');assert.equal(api.received[0].authorization,'Bearer PRIVATE-API-KEY');
 const prompt=JSON.stringify(api.received[0].body);
 for(const hidden of [api.target.candidateId,'private-a','private-b','private-cell','PRIVATE-CONTRACT','PRIVATE-API-KEY','127.0.0.1'])assert(!prompt.includes(hidden),hidden);
 const publicJob=JSON.stringify(job);assert(!publicJob.includes('PRIVATE-API-KEY'));assert(!publicJob.includes(api.upstream));assert(!publicJob.includes('PRIVATE-UPSTREAM-DIAGNOSTIC'));
});

test('public candidate snapshots retain sent and rule-priority detail while full server evidence stays intact',async t=>{
 let internal;
 const api=await setup(t,{collectEvidence:options=>{
  const evidence=collectCandidateEvidence(options),baseTarget={id:'BASE',kind:'mdt-grid',allowedCauseCategories:[],evidenceIds:['BASE_FACT'],sopIds:[evidence.sop.templates[0].id],metrics:[],mapPoints:[],callIds:[],sourceDates:[],band:'900',earfcn:'3743',title:'선택 원문',observation:'RSRP 관측',limitations:[]};
  evidence.analysisTargets=[baseTarget];evidence.modelInput.analysisTargets=[{id:'BASE',kind:'mdt-grid',evidenceIds:['BASE_FACT'],metrics:{belowPct:{'-105':12}}}];evidence.facts.push({id:'BASE_FACT',title:'기본 관측',detail:'선택 원문'});evidence.modelInput.facts.push({id:'BASE_FACT'});
  for(let i=0;i<120;i++){
   evidence.analysisTargets.push({...baseTarget,id:'EXTRA_'+i,evidenceIds:['EXTRA_FACT_'+i],metrics:[{label:'추가 원문',value:'상세 관측'.repeat(400)}]});evidence.facts.push({id:'EXTRA_FACT_'+i,title:'추가 관측',detail:'원본 상세'});
  }
  evidence.neighbourLinks=[['EXTRA_119',baseTarget.id,'동쪽',25],['EXTRA_0','EXTRA_1','동쪽',25]];
  evidence.independentReview={schemaVersion:'candidate-independent-review-v1',priorities:[{targetIds:['EXTRA_119'],evidenceIds:['EXTRA_FACT_119']}]};
  evidence.sop.templates[0].evidenceIds.push(...Array.from({length:120},(_,i)=>'EXTRA_FACT_'+i));
  for(const call of evidence.calls)call.radioSeries=[{rsrp:-105,raw:'연속 무선 원문'.repeat(400)}];
  internal=evidence;return evidence;
 }});
 const started=await api.request('jobs','POST',api.target),job=await waitFor(api,started.body.id,['completed','failed']);assert.equal(job.status,'completed',JSON.stringify(job.error));
 assert.equal(job.evidence.publicCoverage.reviewedTargets,internal.analysisTargets.length);assert.equal(job.evidence.publicCoverage.omittedTargets,119);assert.equal(job.evidence.publicCoverage.radioSeriesIncluded,false);
 assert(job.evidence.analysisTargets.some(row=>row.id==='EXTRA_119'));assert(!job.evidence.analysisTargets.some(row=>row.id==='EXTRA_0'));
 assert(job.evidence.facts.some(row=>row.id==='EXTRA_FACT_119'));assert(!job.evidence.facts.some(row=>row.id==='EXTRA_FACT_0'));
 assert.deepEqual(job.evidence.neighbourLinks,[['EXTRA_119',internal.analysisTargets[0].id,'동쪽',25]]);assert(job.evidence.calls.every(call=>!Object.hasOwn(call,'radioSeries')));
 assert(job.evidence.sop.templates.every(row=>row.evidenceIds.every(id=>job.evidence.facts.some(fact=>fact.id===id))));
 assert.equal(internal.analysisTargets.filter(row=>row.id.startsWith('EXTRA_')).length,120);assert.equal(internal.facts.filter(row=>row.id.startsWith('EXTRA_FACT_')).length,120);assert.equal(internal.neighbourLinks.length,2);assert(internal.calls.every(call=>call.radioSeries.length===1));
 assert(Buffer.byteLength(JSON.stringify(job.evidence))<Buffer.byteLength(JSON.stringify(internal))/2);
 await api.restart();const saved=await api.request('jobs/'+job.id);assert.deepEqual(saved.body.evidence.publicCoverage,job.evidence.publicCoverage);assert.equal(api.received.length,1);
});

test('source-graph completion is disclosed separately while original Qwen evidence references remain captured',async t=>{
 const api=await setup(t,{collectEvidence:options=>{
  const evidence=collectCandidateEvidence(options);
  evidence.analysisTargets=['A','B'].map(suffix=>({id:'MDT_'+suffix,kind:'mdt-grid',allowedCauseCategories:['coverage'],evidenceIds:['T_'+suffix],sopIds:['COMPARISON_CHECK'],metrics:[],mapPoints:[],callIds:[],sourceDates:[],band:'900',earfcn:'3743',title:'조사 대상',observation:'RSRP 분포',limitations:[]}));
  evidence.modelInput.analysisTargets=['A','B'].map(suffix=>({id:'MDT_'+suffix,kind:'mdt-grid',evidenceIds:['T_'+suffix],metrics:{belowPct:{'-100':18,'-105':12}}}));
  for(const suffix of ['A','B']){evidence.facts.push({id:'T_'+suffix,title:'관측',detail:'RSRP 분포'});evidence.modelInput.facts.push({id:'T_'+suffix});}
  return evidence;
 },respond:({input,send})=>{
  const report=candidateReport(input);report.hypotheses=[{category:'coverage',targetIds:['MDT_A','MDT_B'],title:'RSRP 기준 이하 분포의 경계 확인',assessment:'possible',reason:'RSRP 분포를 이웃 구간과 대조합니다.',supportingEvidenceIds:['T_A'],missingEvidence:'같은 시각의 통화와 무선 로그가 부족합니다.',sopIds:['COMPARISON_CHECK']}];report.sop=[{sopId:'COMPARISON_CHECK',reason:'선택 구간의 원본을 대조합니다.',evidenceIds:['T_A']}];send(report);
 }});
 const draft=await api.request('candidate-prompt','POST',api.target);
 const started=await api.request('jobs','POST',{...api.target,promptOverride:{system:'고급 분석: 실제 대상의 원인 가설과 허용 SOP를 함께 검증합니다.',user:draft.body.user}}),job=await waitFor(api,started.body.id,['completed','failed']);assert.equal(job.status,'completed',JSON.stringify(job.error));
 assert.deepEqual(job.report.hypotheses[0].supportingEvidenceIds,['T_A','T_B']);assert.deepEqual(job.referenceResolution,{policy:'selected-target-evidence-v1',addedEvidence:[{hypothesis:0,targetId:'MDT_B',evidenceId:'T_B'}]});
 const captured=await api.request('jobs/'+job.id+'/diagnostics');assert.deepEqual(JSON.parse(captured.body.response.content).hypotheses[0].supportingEvidenceIds,['T_A']);assert.deepEqual(captured.body.referenceResolution,job.referenceResolution);
 await api.restart();const saved=await api.request('jobs/'+job.id);assert.deepEqual(saved.body.referenceResolution,job.referenceResolution);assert.equal(api.received.length,1);
});

test('same candidate conditions reuse active and completed jobs without duplicate model requests',async t=>{
 let release;const api=await setup(t,{respond:({send})=>new Promise(resolve=>{release=()=>{send();resolve();};})});
 const first=await api.request('jobs','POST',api.target);await waitFor(api,first.body.id,['analyzing']);
 const duplicate=await api.request('jobs','POST',api.target);assert.equal(duplicate.status,202);assert.equal(duplicate.body.id,first.body.id);assert.equal(duplicate.body.reused,true);
 while(!release)await sleep(5);release();
 const completed=await waitFor(api,first.body.id,['completed','failed']);assert.equal(completed.status,'completed');
 const cached=await api.request('jobs','POST',api.target);assert.equal(cached.body.id,first.body.id);assert.equal(cached.body.status,'completed');assert.equal(cached.body.reused,true);
 assert.equal(api.received.length,1);
});

test('candidate prompt preparation returns the actual sanitized default messages without inference',async t=>{
 const api=await setup(t),draft=await api.request('candidate-prompt','POST',api.target);
 assert.equal(draft.status,200);assert.deepEqual(draft.body.target,api.target);assert.equal(typeof draft.body.fingerprint,'string');
 assert.match(draft.body.system,/한국어/);assert.equal(typeof draft.body.user,'string');
 const input=JSON.parse(draft.body.user);assert(Array.isArray(input.facts));assert(Array.isArray(input.analysisTargets));
 for(const hidden of [api.target.candidateId,'private-a','private-b','PRIVATE-CONTRACT','PRIVATE-API-KEY'])assert(!draft.body.user.includes(hidden),hidden);
 assert.equal(api.received.length,0);
 const started=await api.request('jobs','POST',api.target);assert.equal((await waitFor(api,started.body.id,['completed','failed'])).status,'completed');
 assert.deepEqual(api.received[0].body.messages,[{role:'system',content:draft.body.system},{role:'user',content:draft.body.user}]);
 assert.equal((await api.request('candidate-prompt','POST',{...api.target,memberCallIds:[]})).status,400);
});

test('an invalid optional comparison is retried then excluded from a valid saved core report with partial diagnostics',async t=>{
 const api=await setup(t,{collectEvidence:withTerminationEvidence,respond:({input,send})=>{
  const report=candidateReport(input);
  report.comparison={schemaVersion:'unknown',interpretation:'근거 없는 해석'};
  send(report);
 }});
 const start=await api.request('jobs','POST',api.target);
 const job=await waitFor(api,start.body.id,['failed','completed']);
 assert.equal(job.status,'completed',JSON.stringify(job.error));
 assert.equal(Object.hasOwn(job.report,'comparison'),false);
 assert.equal(job.attempt.errorCode,'QWEN_INVALID_COMPARISON');
 assert.equal(api.received.length,2);
 await api.restart();
 const diagnostics=(await api.request('jobs/'+job.id+'/diagnostics')).body;
 assert.equal(diagnostics.validation.status,'partial');
 assert.equal(diagnostics.validation.code,'QWEN_INVALID_COMPARISON');
 assert.equal(JSON.parse(diagnostics.response.content).comparison.schemaVersion,'unknown');
 assert.equal(diagnostics.attempts[0].validation.status,'failed');
});

test('a standalone comparative reading can be saved after two rejected full reports with independent provenance',async t=>{
 const api=await setup(t,{collectEvidence:withTerminationEvidence,respond:({input,number,send})=>{
  if(number<=2){send({hypotheses:[]});return;}
  assert.deepEqual(Object.keys(input).sort(),['comparisonContext','scope']);
  send(mockComparison(input.comparisonContext));
 }});
 const started=await api.request('jobs','POST',api.target);
 const done=await waitFor(api,started.body.id,['completed','failed']);
 assert.equal(done.status,'completed',JSON.stringify(done.error));
 assert.equal(api.received.length,3);
 assert.equal(done.report.mode,'comparison-only');
 assert.deepEqual(done.report.hypotheses,[]);
 assert.deepEqual(done.report.investigations,[]);
 assert.equal(done.report.summary.observed,done.report.comparison.interpretation);
 assert.equal(done.modelVerification.responseModelVerified,true);
 await api.restart();
 const diagnostics=(await api.request('jobs/'+done.id+'/diagnostics')).body;
 assert.deepEqual(diagnostics.sectionOrigins,{coreAttempt:null,comparisonAttempt:3});
 assert.equal(diagnostics.validation.status,'partial');
 assert.equal(diagnostics.validation.code,'QWEN_INVALID_CORE');
 assert.equal(diagnostics.attempts.at(-1).phase,'comparison');
 assert.deepEqual(JSON.parse(diagnostics.response.content),done.report.comparison);
 const saved=(await api.request('candidate-history','POST',api.target)).body.jobs[0];
 assert.equal(saved.id,done.id);
 assert.equal(saved.report.mode,'comparison-only');
});
test('a validated core and a dedicated reading retain separate exact model outputs after restart',async t=>{
 const api=await setup(t,{collectEvidence:withTerminationEvidence,respond:({input,number,send})=>{
  if(number===1){const report=candidateReport(input);delete report.comparison;send(report);}
  else send(mockComparison(input.comparisonContext));
 }});
 const started=await api.request('jobs','POST',api.target);
 const done=await waitFor(api,started.body.id,['completed','failed']);
 assert.equal(done.status,'completed',JSON.stringify(done.error));
 assert.equal(api.received.length,2);
 assert.equal(done.report.mode,undefined);
 await api.restart();
 const diagnostics=(await api.request('jobs/'+done.id+'/diagnostics')).body;
 assert.deepEqual(diagnostics.sectionOrigins,{coreAttempt:1,comparisonAttempt:2});
 assert.equal(diagnostics.validation.status,'passed');
 const {comparison,...core}=done.report;
 assert.deepEqual(core,JSON.parse(diagnostics.attempts[0].response.content));
 assert.deepEqual(comparison,JSON.parse(diagnostics.attempts[1].response.content));
});

test('an edited prompt sends exact text, persists a valid report, and cannot replace default reuse identity',async t=>{
 const api=await setup(t),normal=await api.request('jobs','POST',api.target);assert.equal((await waitFor(api,normal.body.id,['completed','failed'])).status,'completed');
 const promptOverride={system:'  직접 작성한 시스템 지시\n',user:'근거와 대조해 답변하세요.\n'};
 const started=await api.request('jobs','POST',{...api.target,promptOverride});assert.equal(started.status,202);assert.notEqual(started.body.id,normal.body.id);
 const custom=await waitFor(api,started.body.id,['completed','failed']);assert.equal(custom.status,'completed',JSON.stringify(custom.error));
 assert.equal(custom.promptEdited,true);assert.match(custom.promptHash,/^[a-f0-9]{64}$/);assert.equal(custom.persistence.status,'saved');
 assert.deepEqual(api.received[1].body.messages,[{role:'system',content:promptOverride.system},{role:'user',content:promptOverride.user}]);
 const diagnostics=await api.request('jobs/'+custom.id+'/diagnostics');assert.deepEqual(diagnostics.body.request.messages,api.received[1].body.messages);
 const history=await api.request('candidate-history','POST',api.target);assert.equal(history.body.jobs.find(row=>row.id===custom.id).currentConditionsMatch,true);
 const defaultAgain=await api.request('jobs','POST',api.target);assert.equal(defaultAgain.body.id,normal.body.id);assert.equal(api.received.length,2);
 await api.restart();const persisted=await api.request('candidate-history','POST',api.target);assert.equal(persisted.body.jobs.find(row=>row.id===custom.id).currentConditionsMatch,true);
 const resent=await api.request('jobs','POST',{...api.target,promptOverride});assert.notEqual(resent.body.id,custom.id);
 assert.equal((await waitFor(api,resent.body.id,['completed','failed'])).status,'completed');assert.equal(api.received.length,3);
});

test('edited prompts have independent active identities but identical active sends deduplicate',async t=>{
 const releases=[];const api=await setup(t,{respond:({send})=>new Promise(resolve=>{releases.push(()=>{send();resolve();});})});
 const firstPrompt={system:'system one',user:'user one'},secondPrompt={system:'system one',user:'user two'};
 const first=await api.request('jobs','POST',{...api.target,promptOverride:firstPrompt});await waitFor(api,first.body.id,['analyzing']);
 const duplicate=await api.request('jobs','POST',{...api.target,promptOverride:firstPrompt});assert.equal(duplicate.body.id,first.body.id);assert.equal(duplicate.body.reused,true);
 const second=await api.request('jobs','POST',{...api.target,promptOverride:secondPrompt});assert.notEqual(second.body.id,first.body.id);await waitFor(api,second.body.id,['analyzing']);
 while(releases.length<2)await sleep(5);for(const release of releases)release();
 assert.equal((await waitFor(api,first.body.id,['completed','failed'])).status,'completed');assert.equal((await waitFor(api,second.body.id,['completed','failed'])).status,'completed');assert.equal(api.received.length,2);
});

test('invalid edited output remains diagnostic with exactly one request and does not enter saved history',async t=>{
 const api=await setup(t,{respond:({send})=>send(null,200,'자유 형식 실험 응답')}),promptOverride={system:'JSON 강제 지시 없는 실험',user:'자유롭게 답변해 주세요.'};
 const started=await api.request('jobs','POST',{...api.target,promptOverride}),failed=await waitFor(api,started.body.id,['completed','failed']);
 assert.equal(failed.status,'failed');assert.equal(failed.error.code,'QWEN_INVALID_JSON');assert.equal(failed.report,undefined);assert.equal(failed.evidence.summary.totalCalls,3);assert.equal(api.received.length,1);
 const diagnostics=await api.request('jobs/'+failed.id+'/diagnostics');assert.equal(diagnostics.body.response.content,'자유 형식 실험 응답');assert.equal(diagnostics.body.validation.status,'failed');assert.deepEqual(diagnostics.body.request.messages,[{role:'system',content:promptOverride.system},{role:'user',content:promptOverride.user}]);
 assert.deepEqual((await api.request('candidate-history','POST',api.target)).body.jobs,[]);
});

test('prompt override validation rejects unknown fields, empties, oversize text and target injection before inference',async t=>{
 const api=await setup(t);
 for(const promptOverride of [null,[],{system:'s',user:'u',extra:true},{system:' ',user:'u'},{system:'s',user:''},{system:1,user:'u'},{system:'s'.repeat(32001),user:'u'},{system:'s',user:'u'.repeat(200001)}]){
  const invalid=await api.request('jobs','POST',{...api.target,promptOverride});assert.equal(invalid.status,400,JSON.stringify(invalid.body));assert.equal(invalid.body.code,'ANALYSIS_INVALID_PROMPT');
 }
 const injected=await api.request('jobs','POST',{...api.target,promptOverride:{system:'s',user:'u'},memberCallIds:['private-a:call-a']});assert.equal(injected.status,400);assert.equal(injected.body.code,'INVALID_CANDIDATE_TARGET');
 const oversized=await api.request('jobs','POST',{...api.target,unexpected:'u'.repeat(17000)});assert.equal(oversized.status,413);
 const accepted=await api.request('jobs','POST',{...api.target,promptOverride:{system:'시스템'.repeat(10000),user:'사용자'.repeat(60000)}});assert.equal(accepted.status,202);assert.equal((await waitFor(api,accepted.body.id,['completed','failed'])).status,'completed');assert.equal(api.received.length,1);
});

test('cancelled candidate collection cannot publish late evidence or overwrite a fresh retry',async t=>{
 let release,collections=0;
 const api=await setup(t,{collectEvidence:options=>{
  collections++;if(collections===1)return new Promise(resolve=>{release=()=>resolve(collectCandidateEvidence(options));});
  return Promise.resolve(collectCandidateEvidence(options));
 }});
 const first=await api.request('jobs','POST',api.target);await waitFor(api,first.body.id,['collecting']);
 const cancelled=await api.request('jobs/'+first.body.id,'DELETE');assert.equal(cancelled.body.status,'cancelled');
 const retry=await api.request('jobs','POST',api.target);assert.notEqual(retry.body.id,first.body.id);
 const fresh=await waitFor(api,retry.body.id,['completed','failed']);assert.equal(fresh.status,'completed');
 release();await sleep(25);
 const old=await api.request('jobs/'+first.body.id);assert.equal(old.body.status,'cancelled');assert.equal(old.body.report,undefined);assert.equal(old.body.evidence,undefined);
 assert.equal((await api.request('jobs/'+retry.body.id)).body.status,'completed');assert.equal(api.received.length,1);
});

test('candidate model failure retains deterministic evidence and retry creates a separate successful job',async t=>{
 const api=await setup(t,{respond:({send})=>send(null,401)}),started=await api.request('jobs','POST',api.target);
 const failed=await waitFor(api,started.body.id,['failed','completed']);assert.equal(failed.status,'failed');assert.equal(failed.error.code,'QWEN_AUTH_FAILED');
 assert.equal(failed.evidence.summary.totalCalls,3);assert.equal(failed.report,undefined);assert(!JSON.stringify(failed).includes('PRIVATE-UPSTREAM-DIAGNOSTIC'));
 api.respond(null);const retry=await api.request('jobs','POST',api.target);assert.notEqual(retry.body.id,started.body.id);
 assert.equal((await waitFor(api,retry.body.id,['completed','failed'])).status,'completed');assert.equal(api.received.length,2);
});

test('stale source, unknown candidate, scope manipulation and client-supplied member lists are rejected before inference',async t=>{
 const api=await setup(t);
 const stale=await api.request('jobs','POST',{...api.target,sourceRevision:'previous-revision'});assert.equal(stale.status,409);assert.equal(stale.body.code,'STALE_REVISION');
 const unknown=await api.request('jobs','POST',{...api.target,candidateId:'unknown-candidate'});assert.equal(unknown.status,404);assert.equal(unknown.body.code,'CANDIDATE_NOT_FOUND');
 const scope=await api.request('jobs','POST',{...api.target,candidateScope:{...api.target.candidateScope,scopeKey:'manipulated-scope'}});assert.equal(scope.status,409);assert.equal(scope.body.code,'CANDIDATE_SCOPE_MISMATCH');
 const calls=await api.request('jobs','POST',{...api.target,memberCallIds:['private-a:call-a']});assert.equal(calls.status,400);assert.equal(calls.body.code,'INVALID_CANDIDATE_TARGET');
 const parameters=await api.request('jobs','POST',{...api.target,candidateScope:{...api.target.candidateScope,epsM:999}});assert.equal(parameters.status,400);
 assert.equal(api.received.length,0);
});

test('changed candidate artifact contents invalidate completed-result reuse even with the same displayed candidate ID',async t=>{
 const api=await setup(t),first=await api.request('jobs','POST',api.target),completed=await waitFor(api,first.body.id,['completed','failed']);assert.equal(completed.status,'completed');
 mutateSummary(api);
 const second=await api.request('jobs','POST',api.target);assert.notEqual(second.body.id,first.body.id);assert.notEqual(second.body.reused,true);
 const fresh=await waitFor(api,second.body.id,['completed','failed']);assert.equal(fresh.status,'completed');assert.notEqual(fresh.evidence.fingerprint,completed.evidence.fingerprint);assert.equal(api.received.length,2);
});

test('artifact changes during collection retain evidence but stop model inference and require a new analysis',async t=>{
 let release;const api=await setup(t,{collectEvidence:options=>new Promise(resolve=>{release=()=>resolve(collectCandidateEvidence(options));})});
 const started=await api.request('jobs','POST',api.target);await waitFor(api,started.body.id,['collecting']);mutateSummary(api);release();
 const failed=await waitFor(api,started.body.id,['failed','completed']);assert.equal(failed.status,'failed');assert.equal(failed.error.code,'ANALYSIS_CONDITIONS_CHANGED');
 assert.equal(failed.evidence.summary.totalCalls,3);assert.equal(failed.report,undefined);assert.equal(api.received.length,0);
});

test('artifact changes while Qwen is responding cannot publish an old report as current',async t=>{
 let release;const api=await setup(t,{respond:({send})=>new Promise(resolve=>{release=()=>{send();resolve();};})});
 const started=await api.request('jobs','POST',api.target);await waitFor(api,started.body.id,['analyzing']);while(!release)await sleep(5);
 mutateSummary(api);release();
 const failed=await waitFor(api,started.body.id,['failed','completed']);assert.equal(failed.status,'failed');assert.equal(failed.error.code,'ANALYSIS_CONDITIONS_CHANGED');
 assert.equal(failed.evidence.summary.totalCalls,3);assert.equal(failed.report,undefined);assert.equal(failed.modelVerification.responseModelVerified,true);
 api.respond(null);const retry=await api.request('jobs','POST',api.target);assert.notEqual(retry.body.id,started.body.id);assert.equal((await waitFor(api,retry.body.id,['completed','failed'])).status,'completed');
});

test('completed candidate results survive memory expiry and are reused without another inference',async t=>{
 const api=await setup(t,{jobTtlMs:100}),started=await api.request('jobs','POST',api.target);assert.equal((await waitFor(api,started.body.id,['completed','failed'])).status,'completed');
 await sleep(125);
 const previous=await api.request('jobs/'+started.body.id);assert.equal(previous.status,200);assert.equal(previous.body.persistence.status,'saved');
 const retry=await api.request('jobs','POST',api.target);assert.equal(retry.body.id,started.body.id);assert.equal(retry.body.status,'completed');assert.equal(api.received.length,1);
});

test('explicit reruns retain only the latest three durable results and diagnostics after server restart',async t=>{
 const api=await setup(t),ids=[];
 for(let i=0;i<4;i++){
  const created=await api.request('jobs','POST',i?{...api.target,rerun:true}:api.target);
  assert.equal(created.status,202);assert(!ids.includes(created.body.id));ids.push(created.body.id);
  const completed=await waitFor(api,created.body.id,['completed','failed']);assert.equal(completed.status,'completed',JSON.stringify(completed.error));assert.equal(completed.persistence.status,'saved');
 }
 assert.equal(api.received.length,4);
 const before=(await api.request('jobs/'+ids[3]+'/diagnostics')).body;
 await api.restart();
 const history=await api.request('candidate-history','POST',api.target);
 assert.equal(history.status,200);assert.equal(history.body.limit,3);assert.deepEqual(history.body.target,api.target);assert.deepEqual(history.body.jobs.map(job=>job.id),ids.slice(1).reverse());
 assert.equal((await api.request('jobs/'+ids[0])).status,404);
 assert.equal((await api.request('jobs/'+ids[3])).body.persistence.status,'saved');
 assert.deepEqual((await api.request('jobs/'+ids[3]+'/diagnostics')).body,before);
 const other=await api.request('candidate-history','POST',{...api.target,candidateScope:{...api.target.candidateScope,modelId:'bayesian'}});assert.deepEqual(other.body.jobs,[]);
 const reused=await api.request('jobs','POST',api.target);assert.equal(reused.body.id,ids[3]);assert.equal(api.received.length,4);
 const stored=fs.readdirSync(path.join(api.root,'outputs','candidate-ai-analysis')).filter(name=>name.endsWith('.json')).map(name=>fs.readFileSync(path.join(api.root,'outputs','candidate-ai-analysis',name),'utf8')).join('');
 assert(!stored.includes(ids[0]));assert(!stored.includes('PRIVATE-API-KEY'));assert(!stored.includes(api.upstream));assert(!stored.includes('modelInput'));assert(!stored.includes('dbPath'));
});

test('history reads need no current model configuration and an unrelated corrupt group cannot hide a saved result',async t=>{
 const api=await setup(t),started=await api.request('jobs','POST',api.target);
 assert.equal((await waitFor(api,started.body.id,['completed','failed'])).status,'completed');
 await api.restart();fs.unlinkSync(path.join(api.root,'.env'));
 fs.writeFileSync(path.join(api.root,'outputs','candidate-ai-analysis','0'.repeat(64)+'.json'),'{corrupt');
 const history=await api.request('candidate-history','POST',api.target);assert.equal(history.status,200);assert.equal(history.body.jobs[0].id,started.body.id);
 assert.equal((await api.request('jobs/'+started.body.id)).status,200);assert.equal(api.received.length,1);
});

test('history identifies changed artifacts and model settings without starting another inference',async t=>{
 const api=await setup(t),started=await api.request('jobs','POST',api.target);
 assert.equal((await waitFor(api,started.body.id,['completed','failed'])).status,'completed');await api.restart();
 const history=()=>api.request('candidate-history','POST',api.target);
 assert.equal((await history()).body.jobs[0].currentConditionsMatch,true);
 const local=path.join(api.root,'.env.local');fs.writeFileSync(local,'QWEN_TEMPERATURE=0.3\n');
 assert.equal((await history()).body.jobs[0].currentConditionsMatch,false);fs.unlinkSync(local);
 assert.equal((await history()).body.jobs[0].currentConditionsMatch,true);
 const source=path.join(api.publicDir,'voice-1030.json'),original=fs.readFileSync(source,'utf8');fs.writeFileSync(source,JSON.stringify({meta:{revision:'changed-source'}}));
 assert.equal((await history()).body.jobs[0].currentConditionsMatch,false);fs.writeFileSync(source,original);
 assert.equal((await history()).body.jobs[0].currentConditionsMatch,true);mutateSummary(api);
 assert.equal((await history()).body.jobs[0].currentConditionsMatch,false);assert.equal((await api.request('jobs/'+started.body.id)).body.currentConditionsMatch,false);assert.equal(api.received.length,1);
});

test('diagnostics are read-only exact merged request and response snapshots; completed reuse preserves originals',async t=>{
 const api=await setup(t),start=await api.request('jobs','POST',api.target),job=await waitFor(api,start.body.id,['completed','failed']);assert.equal(job.status,'completed');assert.equal(job.diagnosticsAvailable,true);assert.equal(job.diagnostics,undefined);
 const first=(await api.request('jobs/'+job.id+'/diagnostics')).body;
 assert.equal(first.status,'captured');assert.equal(first.validation.status,'passed');assert.deepEqual(first.request.messages,api.received[0].body.messages);
 assert.equal(first.request.model,'fixture-model');assert.equal(first.request.parameters.stream,false);assert.equal(first.response.content,JSON.stringify(job.report));assert(first.request.capturedAt>=job.createdAt);
 assert(!JSON.stringify(first).includes('PRIVATE-API-KEY'));assert(!JSON.stringify(first).includes(api.upstream));
 const repeat=await api.request('jobs','POST',api.target),reused=(await api.request('jobs/'+job.id+'/diagnostics')).body;
 assert.equal(repeat.body.reused,true);assert.equal(reused.reused,true);assert.deepEqual(reused.request,first.request);assert.deepEqual(reused.response,first.response);
 assert.equal((await api.request('jobs/'+job.id+'/diagnostics','DELETE')).status,405);assert.equal(api.received.length,1);
});
test('invalid final response remains inspectable after validation failure and retry snapshots belong to new job',async t=>{
 const api=await setup(t,{respond:({send})=>send(null,200,'not valid JSON PRIVATE-API-KEY')}),start=await api.request('jobs','POST',api.target),failed=await waitFor(api,start.body.id,['completed','failed']);
 assert.equal(failed.status,'failed');assert.equal(failed.error.code,'QWEN_INVALID_JSON');
 const d=(await api.request('jobs/'+failed.id+'/diagnostics')).body;assert.equal(d.validation.status,'failed');assert.equal(d.validation.code,'QWEN_INVALID_JSON');assert.equal(d.response.content,'not valid JSON [REDACTED]');assert(d.response.receivedAt);assert(d.request.messages.length);
 assert.equal(failed.attempt.attempt,2);assert.equal(failed.attempt.status,'failed');assert.equal(d.attempts.length,2);assert(d.attempts.every(attempt=>attempt.validation.status==='failed'));assert(!JSON.stringify(d).includes('PRIVATE-API-KEY'));
 api.respond(null);const retry=await api.request('jobs','POST',api.target);assert.notEqual(retry.body.id,failed.id);assert.equal((await waitFor(api,retry.body.id,['completed','failed'])).status,'completed');
 assert.deepEqual((await api.request('jobs/'+failed.id+'/diagnostics')).body,d);assert.equal(api.received.length,3);
});

test('a validated automatic retry saves both redacted attempt snapshots and restores them after restart',async t=>{
 const api=await setup(t,{respond:({send,number})=>number===1?send(null,200,'invalid PRIVATE-API-KEY'):send()});
 const start=await api.request('jobs','POST',api.target),completed=await waitFor(api,start.body.id,['completed','failed']);
 assert.equal(completed.status,'completed');assert.equal(completed.attempt.attempt,2);assert.equal(completed.attempt.status,'completed');assert.equal(completed.persistence.status,'saved');assert.equal(api.received.length,2);
 const before=(await api.request('jobs/'+completed.id+'/diagnostics')).body;
 assert.equal(before.attempts.length,2);assert.equal(before.attempts[0].validation.status,'failed');assert.equal(before.attempts[0].response.content,'invalid [REDACTED]');assert.equal(before.attempts[1].validation.status,'passed');assert.equal(before.response.content,JSON.stringify(completed.report));
 await api.restart();assert.deepEqual((await api.request('jobs/'+completed.id+'/diagnostics')).body,before);
});
test('not-sent collection and cancelled late response never fabricate or overwrite diagnostics',async t=>{
 let releaseCollection;const collecting=await setup(t,{collectEvidence:options=>new Promise(resolve=>{releaseCollection=()=>resolve(collectCandidateEvidence(options));})});
 const pending=await collecting.request('jobs','POST',collecting.target);await waitFor(collecting,pending.body.id,['collecting']);
 assert.equal((await collecting.request('jobs/'+pending.body.id+'/diagnostics')).body.status,'not-sent');await collecting.request('jobs/'+pending.body.id,'DELETE');releaseCollection();
 let release;const api=await setup(t,{respond:({send})=>new Promise(resolve=>{release=()=>{send();resolve();};})});
 const start=await api.request('jobs','POST',api.target);await waitFor(api,start.body.id,['analyzing']);while(!release)await sleep(5);
 await api.request('jobs/'+start.body.id,'DELETE');const before=(await api.request('jobs/'+start.body.id+'/diagnostics')).body;assert.equal(before.status,'captured');
 release();await sleep(30);const after=(await api.request('jobs/'+start.body.id+'/diagnostics')).body;assert.deepEqual(after,before);const job=(await api.request('jobs/'+start.body.id)).body;assert.equal(job.status,'cancelled');assert.equal(job.modelVerification,undefined);assert.equal(job.report,undefined);
});

test('HTTP error JSON envelope is retained only in diagnostics with original safe error status',async t=>{
 const api=await setup(t,{respond:({send})=>send(null,401)}),start=await api.request('jobs','POST',api.target),job=await waitFor(api,start.body.id,['failed','completed']);
 assert.equal(job.error.code,'QWEN_AUTH_FAILED');const d=(await api.request('jobs/'+job.id+'/diagnostics')).body;
 assert.equal(d.validation.code,'QWEN_AUTH_FAILED');assert.equal(JSON.parse(d.response.content).error.message,'PRIVATE-UPSTREAM-DIAGNOSTIC');assert.equal(d.response.finishReason,null);assert(!JSON.stringify(d).includes('PRIVATE-API-KEY'));
});

test('effective candidate options appear in diagnostics and invalidate reuse only when the outgoing options change',async t=>{
 const api=await setup(t);
 const file=path.join(path.dirname(api.publicDir),'.env.local');
 const configure=(global,candidate)=>fs.writeFileSync(file,'QWEN_EXTRA_BODY_JSON='+JSON.stringify(global)+'\nQWEN_CANDIDATE_EXTRA_BODY_JSON='+JSON.stringify(candidate)+'\n');
 configure({chat_template_kwargs:{enable_thinking:true},top_p:0.9},{chat_template_kwargs:{enable_thinking:false}});
 const first=await api.request('jobs','POST',api.target);
 const completed=await waitFor(api,first.body.id,['completed','failed']);assert.equal(completed.status,'completed');
 const firstDiagnostic=(await api.request('jobs/'+first.body.id+'/diagnostics')).body;
 assert.deepEqual(api.received[0].body.chat_template_kwargs,{enable_thinking:false});
 assert.deepEqual(firstDiagnostic.request.parameters.chat_template_kwargs,{enable_thinking:false});assert.equal(firstDiagnostic.request.parameters.top_p,0.9);
 configure({chat_template_kwargs:{enable_thinking:false},top_p:0.9},{chat_template_kwargs:{enable_thinking:false}});
 const same=await api.request('jobs','POST',api.target);
 assert.equal(same.body.id,first.body.id,'a changed but overridden global value is the same effective request');
 configure({chat_template_kwargs:{enable_thinking:false},top_p:0.9},{chat_template_kwargs:{enable_thinking:true}});
 const changed=await api.request('jobs','POST',api.target);assert.notEqual(changed.body.id,first.body.id);
 assert.equal((await waitFor(api,changed.body.id,['completed','failed'])).status,'completed');
 const secondDiagnostic=(await api.request('jobs/'+changed.body.id+'/diagnostics')).body;
 assert.deepEqual(secondDiagnostic.request.parameters.chat_template_kwargs,{enable_thinking:true});
 assert.notEqual(secondDiagnostic.request.hash,firstDiagnostic.request.hash);
 assert.deepEqual((await api.request('jobs/'+first.body.id+'/diagnostics')).body.request,firstDiagnostic.request);
 assert.equal(api.received.length,2);
});
