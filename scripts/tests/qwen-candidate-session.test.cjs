/* eslint-disable @typescript-eslint/no-require-imports -- Native Node tests exercise browser-independent session behavior. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {load}=require('../analyst-ts-loader.cjs');
function subject({history=false}={}){
 const filename=path.resolve('lib/analyst/candidate-ai-analysis.ts'),mod={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInThisContext('(function(require,module,exports){'+code+'\n})',{filename})(id=>id.startsWith('.')?load(path.resolve(path.dirname(filename),id)):require(id),mod,mod.exports);
 // Existing session scenarios use a server with no saved reports; history-specific tests supply their own endpoint.
 if(!history){const original=mod.exports.createCandidateAnalysisManager;mod.exports.createCandidateAnalysisManager=options=>original({...options,fetcher:async(url,init)=>url.endsWith('/candidate-history')?reply({target:JSON.parse(init.body),jobs:[],limit:3}):options.fetcher(url,init)});}
 return mod.exports;
}
const target=(id,scopeKey='full')=>({kind:'candidate',candidateId:id,sourceRevision:'revision',scope:{dateStart:'2026-10-26',dateEnd:'2026-10-30',from:'00:00',to:'23:59'},candidateScope:{scopeKey,policy:'strict-3-site-v1',analysisMode:'all',locationMode:'gps-mdt-rough-unvalidated-v1',modelId:'dbscan'}});
const job=(id,t,status='queued')=>({id,target:t,status,createdAt:'2026-11-12T00:00:00Z',updatedAt:'2026-11-12T00:00:01Z',model:'test',...(status==='completed'?{evidence:{schemaVersion:'qwen-candidate-evidence-v2',analysisTargets:[{id:'MDT_a',kind:'mdt-grid',allowedCauseCategories:['coverage','interference'],metrics:[{label:'RSRP ≤-105 dBm',value:12.5,unit:'%'}],sopIds:['SCOPE_CHECK'],evidenceIds:['T01']}],fingerprint:'evidence-'+id,causeAssessments:['capacity','interference','coverage','mobility','equipment'].map(category=>({category,status:'insufficient',reason:'원인 자료 미확보',nextCheck:'원본 기록 대조',missingEvidence:['추가 원본'],targetIds:[],evidenceIds:[]})),versions:{evidence:'candidate-evidence-v7',prompt:'candidate-prompt-v10',sop:'candidate-sop-draft-v7'},sop:{version:'candidate-sop-draft-v7',templates:[{id:'SCOPE_CHECK',targetKind:'members',checkNow:['범위를 확인합니다.'],conditionalActions:[{when:'구간이 다르면',action:'조사 구간을 분리합니다.'}],verifyAfter:['독립 관측을 대조합니다.']}]}},report:{summary:{observed:'관측',priority:'점검',missing:'추가 근거'},investigations:[{title:'조사 대상',reason:'실제 원본 관측',nextCheck:'동일 대상 측정 대조',targetIds:['MDT_a'],evidenceIds:['T01']}],hypotheses:[{category:'coverage',targetIds:['MDT_a'],supportingEvidenceIds:['T01'],sopIds:['SCOPE_CHECK']}],sop:[{sopId:'SCOPE_CHECK'}]}}:{})});
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const until=async predicate=>{for(let i=0;i<100&&!predicate();i++)await new Promise(resolve=>setTimeout(resolve,1));assert(predicate());};

test('explicit prompt send bypasses loaded history and preserves the exact draft outside the target',async()=>{
 const api=subject({history:true}),t=target('edited-history');let latest;const requests=[];
 const manager=api.createCandidateAnalysisManager({onChange:state=>{latest=state;},fetcher:async(url,init)=>{
  if(url.endsWith('/candidate-history'))return reply({target:t,jobs:[job('saved',t,'completed')],limit:3});
  requests.push(JSON.parse(init.body));return reply({...job('edited',t,'completed'),promptEdited:true});
 }});
 await manager.loadHistory(t);assert.equal(latest.get(api.candidateAnalysisTargetKey(t)).job.id,'saved');
 const draft={system:' custom system\n',user:' custom user\n'};await manager.start(t,{promptOverride:draft});
 assert.deepEqual(requests,[{...t,rerun:true,promptOverride:draft}]);assert.deepEqual(latest.get(api.candidateAnalysisTargetKey(t)).target,t);assert.equal(latest.get(api.candidateAnalysisTargetKey(t)).job.id,'edited');manager.dispose();
});

test('prompt drafts are prepared through the typed endpoint with cancellable request options',async()=>{
 const api=subject(),t=target('draft'),controller=new AbortController();let sent;
 const draft=await api.fetchCandidatePromptDraft(t,async(url,init)=>{sent={url,init};return reply({target:t,system:'default system',user:'{}',fingerprint:'server-evidence'});},{signal:controller.signal});
 assert.equal(sent.url,'/qoe/api/analysis/candidate-prompt');assert.equal(sent.init.method,'POST');assert.equal(sent.init.signal,controller.signal);assert.deepEqual(JSON.parse(sent.init.body),t);assert.deepEqual(draft,{target:t,system:'default system',user:'{}',fingerprint:'server-evidence'});
});

test('active prompt sends deduplicate exact drafts while an edited draft starts independent work',async()=>{
 const api=subject(),t=target('active-edits');let latest;const requests=[],releases=[];
 const manager=api.createCandidateAnalysisManager({onChange:state=>{latest=state;},fetcher:async(_url,init)=>{
  requests.push(JSON.parse(init.body));const id='draft-'+requests.length;
  return new Promise(resolve=>{releases.push(()=>resolve(reply({...job(id,t,'completed'),promptEdited:true})));});
 }});
 try{
  const first={system:'system',user:'first'},second={system:'system',user:'second'};
  const starting=manager.start(t,{promptOverride:first});await until(()=>requests.length===1);
  await manager.start(t,{promptOverride:{...first}});assert.equal(requests.length,1);
  const changed=manager.start(t,{promptOverride:second});assert.equal(requests.length,2);
  releases[1]();await changed;releases[0]();await starting;
  assert.equal(latest.get(api.candidateAnalysisTargetKey(t)).job.id,'draft-2');assert.deepEqual(requests.map(row=>row.promptOverride),[first,second]);
 }finally{for(const release of releases)release();manager.dispose();}
});

test('each candidate keeps its late response without replacing the other candidate',async()=>{
 const {createCandidateAnalysisManager,candidateAnalysisTargetKey}=subject();let releaseA,latest;
 const manager=createCandidateAnalysisManager({onChange:state=>{latest=state;},fetcher:async(_url,init)=>{
  const t=JSON.parse(init.body);if(t.candidateId==='a')return new Promise(resolve=>{releaseA=()=>resolve(reply(job('a',t,'completed')));});
  return reply(job('b',t,'completed'));
 }});
 const a=manager.start(target('a'));await manager.start(target('b'));releaseA();await a;
 assert.equal(latest.get(candidateAnalysisTargetKey(target('a'))).job.id,'a');
 assert.equal(latest.get(candidateAnalysisTargetKey(target('b'))).job.id,'b');assert.equal(latest.size,2);manager.dispose();
});

test('double clicks and completed reopening reuse the same target without another inference request',async()=>{
 const {createCandidateAnalysisManager}=subject();let release,requests=0;
 const manager=createCandidateAnalysisManager({onChange(){},fetcher:async(_url,init)=>{requests++;return new Promise(resolve=>{release=()=>resolve(reply(job('one',JSON.parse(init.body),'completed')));});}});
 const first=manager.start(target('a'));await until(()=>release);await manager.start(target('a'));assert.equal(requests,1);
 release();await first;await manager.start(target('a'));assert.equal(requests,1);manager.dispose();
});

test('cancelling before POST acceptance cancels a late job and never publishes its result',async()=>{
 const {createCandidateAnalysisManager,candidateAnalysisTargetKey}=subject();let release,latest;const deleted=[];
 const manager=createCandidateAnalysisManager({onChange:state=>{latest=state;},fetcher:async(url,init)=>{
  if(init.method==='DELETE'){deleted.push(url);return reply(job('late',target('a'),'cancelled'));}
  return new Promise(resolve=>{release=()=>resolve(reply(job('late',JSON.parse(init.body),'analyzing')));});
 }});
 const first=manager.start(target('a'));await until(()=>release);await manager.cancel(target('a'));release();await first;
 assert.equal(latest.get(candidateAnalysisTargetKey(target('a'))).job,null);assert.equal(deleted.length,1);manager.dispose();
});

test('a target mismatch and an empty completed response are rejected',async()=>{
 const {createCandidateAnalysisManager,candidateAnalysisTargetKey}=subject();let latest;
 const manager=createCandidateAnalysisManager({onChange:state=>{latest=state;},fetcher:async()=>reply(job('wrong',target('other'),'completed'))});
 await manager.start(target('a'));assert.match(latest.get(candidateAnalysisTargetKey(target('a'))).error,/일치하지/);assert.equal(latest.get(candidateAnalysisTargetKey(target('a'))).job,null);manager.dispose();
 const empty=createCandidateAnalysisManager({onChange:state=>{latest=state;},fetcher:async()=>reply({...job('empty',target('a'),'queued'),status:'completed'})});
 await empty.start(target('a'));assert.match(latest.get(candidateAnalysisTargetKey(target('a'))).error,/근거 또는 보고서/);empty.dispose();
});

test('failed AI keeps collected evidence and never turns failure into completion',async()=>{
 const {createCandidateAnalysisManager,candidateAnalysisTargetKey}=subject();let latest,finish;const done=new Promise(resolve=>{finish=resolve;});
 const manager=createCandidateAnalysisManager({pollMs:1,onChange:state=>{latest=state;if([...state.values()].some(entry=>entry.job?.status==='failed'))finish();},fetcher:async(_url,init)=>{
  if(init.method==='POST')return reply(job('failure',target('a'),'analyzing'));
  return reply({...job('failure',target('a'),'failed'),evidence:{fingerprint:'kept'},error:{code:'QWEN_RESPONSE',message:'응답 검증 실패'}});
 }});
 await manager.start(target('a'));await done;const entry=latest.get(candidateAnalysisTargetKey(target('a')));
 assert.equal(entry.job.status,'failed');assert.equal(entry.job.evidence.fingerprint,'kept');assert.equal(entry.pending,false);manager.dispose();
});

test('completed cache survives workspace remount and condition changes require reanalysis even with new candidate IDs',async()=>{
 const api=subject();let latest,requests=0;
 const fetcher=async(_url,init)=>{requests++;return reply(job('cached',JSON.parse(init.body),'completed'));};
 const first=api.createCandidateAnalysisManager({onChange:state=>{latest=state;},fetcher});await first.start(target('a'));first.dispose();
 const remounted=api.createCandidateAnalysisManager({onChange:state=>{latest=state;},fetcher});remounted.restore();
 assert.equal(latest.get(api.candidateAnalysisTargetKey(target('a'))).job.status,'completed');
 await remounted.start(target('a'));assert.equal(requests,1);
 assert.equal(api.hasPreviousCandidateCondition(target('new-id','changed-scope')),true);
 assert.notEqual(api.candidateAnalysisTargetKey(target('a')),api.candidateAnalysisTargetKey(target('a','changed-scope')));
 remounted.dispose();
});

test('candidate and model identity, scope and policy all participate in the target key',()=>{
 const {candidateAnalysisTargetKey}=subject(),a=target('same');
 for(const changed of [{...a,candidateId:'other'},{...a,sourceRevision:'new'},{...a,scope:{...a.scope,from:'01:00'}},{...a,candidateScope:{...a.candidateScope,modelId:'bayesian'}},{...a,candidateScope:{...a.candidateScope,policy:'new'}}])assert.notEqual(candidateAnalysisTargetKey(a),candidateAnalysisTargetKey(changed));
});

test('failed status polling becomes retryable and resumes the existing job without duplicate inference',async()=>{
 const api=subject();let latest,finish;const failed=new Promise(resolve=>{finish=resolve;});let posts=0,gets=0,inferences=0;
 const t=target('resume'),active={...job('same-job',t,'analyzing'),evidence:{fingerprint:'collected'}};
 const manager=api.createCandidateAnalysisManager({pollMs:1,onChange:state=>{latest=state;if([...state.values()].some(entry=>entry.error))finish();},fetcher:async(_url,init)=>{
  if(init.method==='POST'){posts++;if(posts===1)inferences++;return reply(active);}
  gets++;if(gets<=3)throw Error('temporary connection loss');return reply(job('same-job',t,'completed'));
 }});
 await manager.start(t);await failed;
 const entry=latest.get(api.candidateAnalysisTargetKey(t));
 assert.equal(entry.job.status,'analyzing');assert.equal(entry.job.evidence.fingerprint,'collected');assert.equal(entry.pending,false);
 assert.equal(api.isCandidateAnalysisBusy(entry),false);assert.equal(api.candidateAnalysisDisplayState(entry),'status-error');
 const resumed=manager.start(t);await manager.start(t);await resumed;
 await new Promise(resolve=>setTimeout(resolve,10));
 const completed=latest.get(api.candidateAnalysisTargetKey(t));
 assert.equal(completed.job.status,'completed');assert.equal(completed.error,'');assert.equal(posts,2);assert.equal(inferences,1);
 manager.dispose();
});

test('a transient status connection failure retries the accepted job without another POST',async()=>{
 const api=subject(),t=target('transient-poll');let latest,posts=0,gets=0;const urls=[];
 const manager=api.createCandidateAnalysisManager({pollMs:1,onChange:state=>{latest=state;},fetcher:async(url,init)=>{
  if(init.method==='POST'){posts++;return reply(job('accepted',t,'analyzing'));}
  gets++;urls.push(url);if(gets===1)throw Error('temporary connection loss');return reply(job('accepted',t,'completed'));
 }});
 try{await manager.start(t);await until(()=>latest.get(api.candidateAnalysisTargetKey(t))?.job?.status==='completed');assert.equal(posts,1);assert.equal(gets,2);assert(urls.every(url=>url.endsWith('/jobs/accepted')));assert.equal(latest.get(api.candidateAnalysisTargetKey(t)).error,'');}finally{manager.dispose();}
});

test('three consecutive status connection failures stop and a manual resume resets the retry budget',async()=>{
 const api=subject(),t=target('bounded-poll');let latest,posts=0,gets=0;
 const manager=api.createCandidateAnalysisManager({pollMs:1,onChange:state=>{latest=state;},fetcher:async(_url,init)=>{
  if(init.method==='POST'){posts++;return reply(job('accepted',t,'analyzing'));}
  gets++;if(gets<=4)throw Error('connection loss');return reply(job('accepted',t,'completed'));
 }});
 try{
  await manager.start(t);await until(()=>!!latest.get(api.candidateAnalysisTargetKey(t))?.error);await new Promise(resolve=>setTimeout(resolve,15));
  let entry=latest.get(api.candidateAnalysisTargetKey(t));assert.equal(posts,1);assert.equal(gets,3);assert.equal(entry.pending,false);assert.equal(api.isCandidateAnalysisBusy(entry),false);assert.equal(entry.job.id,'accepted');
  await manager.start(t);await until(()=>latest.get(api.candidateAnalysisTargetKey(t))?.job?.status==='completed');entry=latest.get(api.candidateAnalysisTargetKey(t));assert.equal(posts,2);assert.equal(gets,5);assert.equal(entry.error,'');
 }finally{manager.dispose();}
});

test('a successful active status read resets consecutive connection failures',async()=>{
 const api=subject(),t=target('reset-poll');let latest,posts=0,gets=0;
 const manager=api.createCandidateAnalysisManager({pollMs:1,onChange:state=>{latest=state;},fetcher:async(_url,init)=>{
  if(init.method==='POST'){posts++;return reply(job('accepted',t,'analyzing'));}
  gets++;if([1,2,4,5].includes(gets))throw Error('connection loss');return reply(job('accepted',t,gets===6?'completed':'analyzing'));
 }});
 try{await manager.start(t);await until(()=>latest.get(api.candidateAnalysisTargetKey(t))?.job?.status==='completed');assert.equal(posts,1);assert.equal(gets,6);assert.equal(latest.get(api.candidateAnalysisTargetKey(t)).error,'');}finally{manager.dispose();}
});

test('a status target or job mismatch is surfaced immediately without connection retries',async()=>{
 const api=subject(),t=target('mismatched-poll');let latest,posts=0,gets=0;
 const manager=api.createCandidateAnalysisManager({pollMs:1,onChange:state=>{latest=state;},fetcher:async(_url,init)=>{
  if(init.method==='POST'){posts++;return reply(job('accepted',t,'analyzing'));}
  gets++;return reply(job('different-job',t,'completed'));
 }});
 try{await manager.start(t);await until(()=>!!latest.get(api.candidateAnalysisTargetKey(t))?.error);await new Promise(resolve=>setTimeout(resolve,10));assert.equal(posts,1);assert.equal(gets,1);assert.match(latest.get(api.candidateAnalysisTargetKey(t)).error,/일치하지/);}finally{manager.dispose();}
});

test('expired status returns to retry and a new job is created only once after 404',async()=>{
 const api=subject();let latest,finish;const failed=new Promise(resolve=>{finish=resolve;});let posts=0;
 const t=target('expired');
 const manager=api.createCandidateAnalysisManager({pollMs:1,onChange:state=>{latest=state;if([...state.values()].some(entry=>entry.error))finish();},fetcher:async(_url,init)=>{
  if(init.method==='POST'){posts++;return reply(job(posts===1?'expired-job':'new-job',t,posts===1?'analyzing':'completed'));}
  return reply({error:'분석 결과가 만료되었습니다.',code:'ANALYSIS_JOB_NOT_FOUND'},404);
 }});
 await manager.start(t);await failed;const entry=latest.get(api.candidateAnalysisTargetKey(t));
 assert.equal(api.isCandidateAnalysisBusy(entry),false);assert.equal(api.candidateAnalysisDisplayState(entry),'status-error');
 assert.match(entry.error,/만료/);
 const retried=manager.start(t);await manager.start(t);await retried;
 assert.equal(posts,2);assert.equal(latest.get(api.candidateAnalysisTargetKey(t)).job.id,'new-job');manager.dispose();
});

test('legacy and malformed completed reports do not block fresh analysis or restore from cache',async()=>{
 const api=subject(),t=target('legacy');let latest,requests=0;
 const old=job('old',t,'completed');old.evidence.versions.prompt='candidate-prompt-v1';
 const manager=api.createCandidateAnalysisManager({onChange:state=>{latest=state;},fetcher:async()=>reply(++requests===1?old:job('fresh',t,'completed'))});
 await manager.start(t);assert.equal(api.isCurrentCandidateAnalysisJob(latest.get(api.candidateAnalysisTargetKey(t)).job),false);
 const legacyRemount=api.createCandidateAnalysisManager({onChange:state=>{latest=state;},fetcher:async()=>reply(old)});
 legacyRemount.restore();assert.equal(latest.has(api.candidateAnalysisTargetKey(t)),false);legacyRemount.dispose();
 await manager.start(t);assert.equal(requests,2);assert.equal(latest.get(api.candidateAnalysisTargetKey(t)).job.id,'fresh');
 manager.dispose();
 const invalid=job('invalid',target('broken'),'completed');invalid.report.hypotheses[0].sopIds=[];
 const bad=api.createCandidateAnalysisManager({onChange:state=>{latest=state;},fetcher:async()=>reply(invalid)});
 await bad.start(target('broken'));bad.dispose();
 const remounted=api.createCandidateAnalysisManager({onChange:state=>{latest=state;},fetcher:async()=>reply(invalid)});
 remounted.restore();assert.equal(latest.has(api.candidateAnalysisTargetKey(target('broken'))),false);remounted.dispose();
});
test('current completed job requires matching versions and exact unique hypothesis linkage',()=>{
 const api=subject(),current=job('current',target('valid'),'completed');
 assert.equal(api.isCurrentCandidateAnalysisJob(current),true);
 for(const change of [
  j=>{delete j.report.hypotheses[0].category;},j=>{j.report.hypotheses[0].category='invented';},j=>{j.report.hypotheses[0].category='equipment';},
  j=>{j.evidence.versions.sop='candidate-sop-draft-v1';},j=>{j.evidence.sop.version='old';},
  j=>{j.report.hypotheses[0].sopIds=['UNKNOWN'];},j=>{j.report.hypotheses[0].sopIds=['SCOPE_CHECK','SCOPE_CHECK'];},
  j=>{j.report.sop=[];},j=>{j.report.sop.push({sopId:'UNREFERENCED'});},j=>{delete j.evidence.sop.templates[0].conditionalActions;},
 ]){
  const altered=structuredClone(current);change(altered);assert.equal(api.isCurrentCandidateAnalysisJob(altered),false);
 }
 assert.equal(api.isCurrentCandidateAnalysisJob(null),false);assert.equal(api.isCurrentCandidateAnalysisJob(undefined),false);
});

test('current history accepts three target-specific procedures when every selected target is connected',()=>{
 const {isCurrentCandidateAnalysisJob}=subject(),value=job('three-procedures',target('three-procedures'),'completed'),template=value.evidence.sop.templates[0];
 value.evidence.analysisTargets=[];value.evidence.sop.templates=[];value.report.hypotheses[0].targetIds=[];value.report.hypotheses[0].sopIds=[];value.report.sop=[];
 for(const suffix of ['a','b','c']){
  const id='MDT_'+suffix,sopId='SCOPE_'+suffix;
  value.evidence.analysisTargets.push({id,kind:'mdt-grid',allowedCauseCategories:['coverage'],metrics:[{label:'RSRP ≤-105 dBm',value:12.5,unit:'%'}],sopIds:[sopId],evidenceIds:['T_'+suffix]});value.evidence.sop.templates.push({...template,id:sopId});value.report.hypotheses[0].targetIds.push(id);value.report.hypotheses[0].sopIds.push(sopId);value.report.sop.push({sopId});
 }
 value.report.investigations=[{title:'조사 대상',reason:'실제 원본 관측',nextCheck:'동일 대상 측정 대조',targetIds:value.report.hypotheses[0].targetIds,evidenceIds:value.evidence.analysisTargets.flatMap(target=>target.evidenceIds)}];
 assert.equal(isCurrentCandidateAnalysisJob(value),true);
 value.report.hypotheses[0].sopIds.push('UNRELATED');assert.equal(isCurrentCandidateAnalysisJob(value),false);
});

test('current cache rejects a selected target with no linked procedure and zero-only MDT coverage',()=>{
 const {isCurrentCandidateAnalysisJob}=subject(),valid=job('guards',target('guards'),'completed');
 assert.equal(isCurrentCandidateAnalysisJob(valid),true);
 const disconnected=structuredClone(valid);
 disconnected.evidence.analysisTargets.push({id:'MDT_b',kind:'mdt-grid',metrics:[{label:'RSRP ≤-105 dBm',value:0,unit:'%'}],sopIds:['OTHER'],evidenceIds:['T02']});
 disconnected.report.hypotheses[0].targetIds.push('MDT_b');
 assert.equal(isCurrentCandidateAnalysisJob(disconnected),false);
 const zeros=structuredClone(valid);zeros.evidence.analysisTargets[0].metrics=[{label:'RSRP ≤-105 dBm',value:0,unit:'%'},{label:'RSRP ≤-110 dBm',value:0,unit:'%'}];
 assert.equal(isCurrentCandidateAnalysisJob(zeros),false);
 zeros.evidence.analysisTargets.push({id:'MDT_b',kind:'mdt-grid',metrics:[{label:'RSRP ≤-105 dBm',value:5,unit:'%'}],sopIds:['SCOPE_CHECK'],evidenceIds:['T02']});
 zeros.report.hypotheses[0].targetIds.push('MDT_b');
 assert.equal(isCurrentCandidateAnalysisJob(zeros),true,'a shared SOP covers both the weak target and its zero-percent comparison');
});

test('history restores saved reports without inference, allows selection and explicit reruns while retaining prior results',async()=>{
 const api=subject({history:true}),t=target('history');let latest,posts=0;
 const old={...job('old',t,'completed'),persistence:{status:'saved',savedAt:'2026-11-12T00:00:01Z'}};
 const fresh={...job('fresh',t,'completed'),updatedAt:'2026-11-12T00:01:01Z',persistence:{status:'saved',savedAt:'2026-11-12T00:01:01Z'}};
 const manager=api.createCandidateAnalysisManager({onChange:state=>{latest=state;},fetcher:async(url,init)=>{
  if(url.endsWith('/candidate-history'))return reply({target:t,jobs:[old],limit:3});
  posts++;assert.equal(JSON.parse(init.body).rerun,true);return reply(fresh);
 }});
 await manager.loadHistory(t);let entry=latest.get(api.candidateAnalysisTargetKey(t));
 assert.equal(posts,0);assert.equal(entry.job.id,'old');assert.deepEqual(entry.history.map(j=>j.id),['old']);
 await manager.start(t);assert.equal(posts,0);
 await manager.start(t,{rerun:true});entry=latest.get(api.candidateAnalysisTargetKey(t));assert.equal(posts,1);assert.equal(entry.job.id,'fresh');assert.deepEqual(entry.history.map(j=>j.id),['fresh','old']);
 manager.selectSaved(t,'old');assert.equal(latest.get(api.candidateAnalysisTargetKey(t)).job.id,'old');manager.dispose();
});

test('late history never replaces a new analysis or a saved result selected by the user',async()=>{
 const api=subject({history:true}),t=target('late-history');let latest,release;
 const manager=api.createCandidateAnalysisManager({onChange:state=>{latest=state;},fetcher:async(url)=>{
  if(url.endsWith('/candidate-history'))return new Promise(resolve=>{release=()=>resolve(reply({target:t,jobs:[job('old',t,'completed')],limit:3}));});
  return reply({...job('new',t,'completed'),updatedAt:'2026-11-13T00:00:00Z'});
 }});
 const loading=manager.loadHistory(t);await manager.start(t,{rerun:true});release();await loading;
 assert.equal(latest.get(api.candidateAnalysisTargetKey(t)).job.id,'new');assert.deepEqual(latest.get(api.candidateAnalysisTargetKey(t)).history.map(j=>j.id),['new','old']);manager.dispose();
});

test('disposing a candidate workspace leaves accepted and late jobs running for durable completion',async()=>{
 const api=subject();let release;const deleted=[];
 const manager=api.createCandidateAnalysisManager({onChange(){},fetcher:async(url,init)=>{
  if(init.method==='DELETE'){deleted.push(url);return reply(job('ongoing',target('background'),'cancelled'));}
  return new Promise(resolve=>{release=()=>resolve(reply(job('ongoing',target('background'),'analyzing')));});
 }});
 const starting=manager.start(target('background'));await until(()=>release);manager.dispose();release();await starting;assert.equal(deleted.length,0);
});

test('history target mismatch reports an error without restoring another candidate',async()=>{
 const api=subject({history:true}),t=target('history-target');let latest;
 const manager=api.createCandidateAnalysisManager({onChange:state=>{latest=state;},fetcher:async()=>reply({target:target('other'),jobs:[job('other',target('other'),'completed')],limit:3})});
 await manager.loadHistory(t);const entry=latest.get(api.candidateAnalysisTargetKey(t));assert.equal(entry.job,null);assert.match(entry.historyError,/일치하지/);assert.equal(entry.historyLoading,false);manager.dispose();
});

test('normal start waits for an in-flight history read and restores saved output without a Qwen request',async()=>{
 const api=subject({history:true}),t=target('restore-on-start');let latest,release,posts=0,reads=0;
 const manager=api.createCandidateAnalysisManager({onChange:state=>{latest=state;},fetcher:async(url)=>{
  if(url.endsWith('/candidate-history')){reads++;return new Promise(resolve=>{release=()=>resolve(reply({target:t,jobs:[job('saved',t,'completed')],limit:3}));});}
  posts++;return reply(job('unwanted',t,'completed'));
 }});
 const loading=manager.loadHistory(t),starting=manager.start(t);await manager.start(t);assert.equal(posts,0);assert.equal(reads,1);
 release();await loading;await starting;assert.equal(posts,0);assert.equal(latest.get(api.candidateAnalysisTargetKey(t)).job.id,'saved');manager.dispose();
});

test('a cancelled late POST cannot cancel the deduplicated job claimed by a replacement start',async()=>{
 const api=subject(),t=target('replace-cancelled-post');let latest,release,posts=0,deletes=0;
 const manager=api.createCandidateAnalysisManager({pollMs:10000,onChange:state=>{latest=state;},fetcher:async(_url,init)=>{
  if(init.method==='DELETE'){deletes++;return reply(job('shared',t,'cancelled'));}
  posts++;if(posts===1)return new Promise(resolve=>{release=()=>resolve(reply(job('shared',t,'analyzing')));});
  return reply(job('shared',t,'analyzing'));
 }});
 try{const first=manager.start(t);await until(()=>release);await manager.cancel(t);await manager.start(t);release();await first;
  assert.equal(latest.get(api.candidateAnalysisTargetKey(t)).job.id,'shared');assert.equal(deletes,0);
 }finally{manager.dispose();}
});

test('replacement start waits for an accepted job cancellation before requesting new work',async()=>{
 const api=subject(),t=target('wait-cancel');let latest,release,posts=0;
 const manager=api.createCandidateAnalysisManager({pollMs:10000,onChange:state=>{latest=state;},fetcher:async(_url,init)=>{
  if(init.method==='DELETE')return new Promise(resolve=>{release=()=>resolve(reply(job('first',t,'cancelled')));});
  posts++;return reply(job(posts===1?'first':'replacement',t,'analyzing'));
 }});
 try{await manager.start(t);const cancelling=manager.cancel(t);await until(()=>release);const replacement=manager.start(t);
  assert.equal(posts,1);release();await cancelling;await replacement;assert.equal(posts,2);assert.equal(latest.get(api.candidateAnalysisTargetKey(t)).job.id,'replacement');
 }finally{manager.dispose();}
});

test('historical conditions remain reviewable but cannot suppress a fresh analysis request',async()=>{
 const api=subject({history:true}),t=target('changed-history');let latest,posts=0;
 const old={...job('old-conditions',t,'completed'),currentConditionsMatch:false};
 const manager=api.createCandidateAnalysisManager({onChange:state=>{latest=state;},fetcher:async(url)=>{
  if(url.endsWith('/candidate-history'))return reply({target:t,jobs:[old],limit:3});
  posts++;return reply(job('current-conditions',t,'completed'));
 }});
 await manager.loadHistory(t);assert.equal(posts,0);assert.equal(latest.get(api.candidateAnalysisTargetKey(t)).job.id,'old-conditions');
 assert.equal(api.isCurrentCandidateAnalysisJob(old),false);await manager.start(t);assert.equal(posts,1);assert.equal(latest.get(api.candidateAnalysisTargetKey(t)).job.id,'current-conditions');manager.dispose();
});




