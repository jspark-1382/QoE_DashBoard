/* eslint-disable @typescript-eslint/no-require-imports -- Real Chrome CDP integration QA. */
/*
 * Run only after the final local build and server restart:
 *   node scripts/tests/candidate-ai-selected-browser-qa.cjs
 * QOE_QA_ORIGIN defaults to http://127.0.0.1:3001.
 *
 * Makes one UI analysis request. Additional job POSTs are blocked, never retried.
 * Expectations come from the completed API report, not a fixed cause/POT fixture.
 * Total work budget is four minutes, including a reserved cleanup interval.
 * QOE_QA_REPLAY_VERIFIED=1 replays the saved completed job/diagnostics in CDP only.
 * Replay blocks every model POST from reaching the server and writes separate replay artifacts.
 */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const started=Date.now(),deadline=started+240000,workDeadline=deadline-20000;
const origin=process.env.QOE_QA_ORIGIN||'http://127.0.0.1:3001';
const candidateId=process.env.QOE_QA_CANDIDATE_ID||'spatial-74cf136978399144';
const candidateNumber=process.env.QOE_QA_CANDIDATE_NUMBER||'23';
const chromeBin='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url=origin+'/qoe/?variant=improvement2&dateStart=2026-10-26&dateEnd=2026-10-30&from=00%3A00&to=23%3A59&distributionMode=mos&evidence=all&mapMode=improvement';
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'qoe-ai-selected-qa-'));
const outputDir=path.resolve('outputs');
const replay=process.env.QOE_QA_REPLAY_VERIFIED==='1',artifactPrefix=replay?'candidate-ai-selected-replay':'candidate-ai-selected';
const summaryPath=path.join(outputDir,artifactPrefix+'-qa.json');
const replayJobPath=path.resolve(process.env.QOE_QA_REPLAY_JOB||path.join(outputDir,'candidate-ai-selected-verified-job.json')),replayDiagnosticsPath=path.resolve(process.env.QOE_QA_REPLAY_DIAGNOSTICS||path.join(outputDir,'candidate-ai-selected-verified-diagnostics.json'));
const expectedPrompt=process.env.QOE_QA_EXPECTED_PROMPT||'candidate-prompt-v5';
const replayJob=replay?JSON.parse(fs.readFileSync(replayJobPath,'utf8')):null,replayDiagnostics=replay?JSON.parse(fs.readFileSync(replayDiagnosticsPath,'utf8')):null;
const fileHash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const replaySource=replay?{jobId:replayJob.id,requestHash:replayDiagnostics.request?.hash,jobHash:fileHash(replayJobPath),diagnosticsHash:fileHash(replayDiagnosticsPath)}:null;
if(replay){assert.equal(replayJob.status,'completed');assert.equal(replayJob.target?.candidateId,candidateId);assert.equal(replayDiagnostics.validation?.status,'passed');}
const results={origin,candidateId,mode:replay?'recorded-response-replay':'live-qwen',replaySource,startedAt:new Date(started).toISOString(),status:'RUNNING',checks:[],layouts:[],screenshots:[],runtimeErrors:[],consoleErrors:[],network:[],pendingSamples:0};
const pending=new Map(),postRequests=new Set(),responseTasks=new Set(),ownedJobs=new Set();
let chrome,ws,nextId=0,postAttempts=0,jobPosts=0,blockedPosts=0,forwardedJobPosts=0,lastObserved=null,lastJob=null,diagnostics=null,postFailure=null,finished=false;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const categories=new Set(['capacity','interference','coverage','mobility','equipment']);
fs.mkdirSync(outputDir,{recursive:true});

function clean(value){
 if(Array.isArray(value))return value.map(clean);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,/(?:api[_-]?key|authorization|password|secret|cookie|access[_-]?token|refresh[_-]?token)/i.test(key)?'[REDACTED]':clean(item)]));
 return typeof value==='string'?value.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,'Bearer [REDACTED]'):value;
}
function persist(){
 results.elapsedMs=Date.now()-started;results.jobPosts=jobPosts;results.postAttempts=postAttempts;results.blockedPosts=blockedPosts;results.forwardedJobPosts=forwardedJobPosts;
 fs.writeFileSync(summaryPath,JSON.stringify(clean(results),null,2));
}
function phase(name){results.phase=name;persist();console.log('AI_SELECTED_QA_PHASE',name);}
function check(name,details={}){results.checks.push({check:name,...details});persist();}
function fail(message,code='QA_ASSERTION'){const error=Error(message);error.code=code;return error;}
async function until(fn,label,maxMs=40000){
 const end=Math.min(workDeadline,Date.now()+maxMs);let lastError;
 while(Date.now()<end){
  try{const result=await fn();if(result)return result;}catch(error){lastError=error;}
  await sleep(200);
 }
 const error=fail('Timeout: '+label+(lastError?' ('+lastError.message+')':''),'QA_TIMEOUT');
 throw error;
}
function cdp(method,params={}){
 if(ws?.readyState!==WebSocket.OPEN)return Promise.reject(fail('Chrome CDP is not connected','QA_CDP_CLOSED'));
 const id=++nextId;
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pending.delete(id);reject(fail('CDP timeout '+method,'QA_CDP_TIMEOUT'));},Math.max(100,Math.min(15000,deadline-Date.now())));
  pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
 });
}
async function evaluate(expression){
 const response=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
 if(response.exceptionDetails)throw fail('Browser evaluation: '+JSON.stringify(response.exceptionDetails),'QA_BROWSER_EVALUATION');
 return response.result?.value;
}
const run=(fn,...args)=>evaluate('('+fn.toString()+')('+args.map(value=>JSON.stringify(value)).join(',')+')');
async function api(route,init={}){
 if(replay){
  if(init.method&&init.method!=='GET')throw fail('Replay cannot mutate an original job','QA_REPLAY_WRITE_BLOCKED');
  const base='/qoe/api/analysis/jobs/'+encodeURIComponent(replayJob.id);
  if(route===base)return structuredClone(replayJob);
  if(route===base+'/diagnostics')return structuredClone(replayDiagnostics);
  throw fail('Unrecognized replay API route','QA_REPLAY_ROUTE_BLOCKED');
 }
 const response=await fetch(origin+route,{...init,cache:'no-store',signal:AbortSignal.timeout(Math.max(100,Math.min(10000,deadline-Date.now())))});
 const body=await response.json();
 if(!response.ok)throw fail(body.error?.message||body.message||('HTTP '+response.status),body.error?.code||body.code||'QA_HTTP_'+response.status);
 return body;
}
function observedDom(){
 const dialog=document.querySelector('dialog[open]'),workspace=dialog?.querySelector('[aria-label="AI 선정 원인과 조사 대상"]');
 const analysis=workspace?.querySelector('[aria-label="AI 선정 대상 분석"]');
 const nodes=[...workspace?.querySelectorAll('[data-cause-category]')??[]];
 const select=workspace?.querySelector('select[aria-label="AI 선정 조사 대상"]');
 return {
  dialog:!!dialog,workspace:!!workspace,title:dialog?.querySelector('h2')?.textContent?.trim(),
  candidate:workspace?.querySelector('[data-candidate-pot-map]')?.getAttribute('data-candidate-pot-map'),
  findings:Number(workspace?.getAttribute('data-ai-finding-count')??0),
  categories:nodes.map(node=>({category:node.getAttribute('data-cause-category'),button:node.tagName==='BUTTON',pressed:node.getAttribute('aria-pressed'),findingId:node.getAttribute('data-finding-id')})),
  selectedTarget:analysis?.getAttribute('data-selected-target')??'',selectedPot:analysis?.getAttribute('data-selected-pot')??'',selectedBand:analysis?.getAttribute('data-selected-band')??'',
  stages:[...analysis?.querySelectorAll('[data-pot-stage]')??[]].map(node=>({number:node.getAttribute('data-pot-stage'),text:node.textContent.trim()})),
  selectedMarkers:[...workspace?.querySelectorAll('[data-pot-selected="true"]')??[]].map(node=>node.getAttribute('data-pot-id')),
  options:[...select?.options??[]].map(option=>({value:option.value,label:option.textContent.trim()})),selectedOption:select?.value,
  backgroundPots:workspace?.querySelectorAll('[data-pot-selectable="false"]').length??0,
  inspector:!!dialog?.querySelector('aside[aria-label="AI 입력·응답 확인"]'),
  alerts:[...dialog?.querySelectorAll('[role="alert"]')??[]].map(node=>node.textContent.trim()),
  stateText:analysis?.textContent?.trim().slice(0,500)??''
 };
}
async function snapshot(){lastObserved=await run(observedDom);return lastObserved;}
async function pointerClick(point){
 await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y});
 await cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
 await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
}
function queueResponse(task){
 responseTasks.add(task);void task.catch(error=>{results.networkError=clean(error.message);}).finally(()=>responseTasks.delete(task));
}
async function trackJobResponse(requestId){
 const raw=await cdp('Network.getResponseBody',{requestId});
 const body=JSON.parse(raw.base64Encoded?Buffer.from(raw.body,'base64').toString('utf8'):raw.body);
 if(typeof body.id==='string'&&body.target?.candidateId===candidateId){lastJob=body;if(body.reused!==true)ownedJobs.add(body.id);results.jobId=body.id;}
 else postFailure={code:body.error?.code||body.code||'QA_JOB_NOT_ACCEPTED',message:body.error?.message||body.message||'No candidate job returned',body:clean(body)};
}
async function connect(){
 assert(fs.existsSync(chromeBin),'Chrome executable must be available');
 chrome=spawn(chromeBin,['--headless=new','--window-size=1920,1080','--disable-gpu','--disable-extensions','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
 const portFile=path.join(profile,'DevToolsActivePort');
 const port=await until(()=>fs.existsSync(portFile)?Number(fs.readFileSync(portFile,'utf8').split(/\r?\n/)[0]):null,'isolated Chrome port',20000);
 const page=await until(async()=>{const pages=await(await fetch('http://127.0.0.1:'+port+'/json',{signal:AbortSignal.timeout(3000)})).json();return pages.find(item=>item.type==='page');},'isolated Chrome page',10000);
 ws=new WebSocket(page.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(fail('CDP connection timeout','QA_CDP_TIMEOUT')),10000);
  ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
  ws.addEventListener('error',error=>{clearTimeout(timer);reject(error);},{once:true});
 });
 ws.addEventListener('message',event=>{
  const packet=JSON.parse(event.data.toString());
  if(packet.id&&pending.has(packet.id)){
   const request=pending.get(packet.id);pending.delete(packet.id);clearTimeout(request.timer);
   if(packet.error)request.reject(fail(JSON.stringify(packet.error),'QA_CDP_ERROR'));else request.resolve(packet.result);
  }else if(packet.method==='Runtime.exceptionThrown'){
   const error=packet.params.exceptionDetails;results.runtimeErrors.push({text:error.text,description:error.exception?.description?.slice(0,1000)});
  }else if(packet.method==='Runtime.consoleAPICalled'&&packet.params.type==='error'){
   results.consoleErrors.push(packet.params.args.map(arg=>arg.value??arg.description??'').join(' ').slice(0,500));
  }else if(packet.method==='Fetch.requestPaused'){
   const {requestId,request}=packet.params;
   if(replay){
    const route=new URL(request.url).pathname,base='/qoe/api/analysis/jobs/'+encodeURIComponent(replayJob.id);
    let value,status=200;
    if(request.method==='POST'&&route==='/qoe/api/analysis/candidate-history'){
     value={target:replayJob.target,jobs:postAttempts?[replayJob]:[],limit:3};
    }else if(request.method==='POST'&&route==='/qoe/api/analysis/jobs'){
     postAttempts++;
     if(postAttempts>1){blockedPosts++;queueResponse(cdp('Fetch.failRequest',{requestId,errorReason:'Aborted'}));return;}
     value=replayJob;status=202;lastJob=structuredClone(replayJob);ownedJobs.add(replayJob.id);results.jobId=replayJob.id;
    }else if(request.method==='GET'&&route===base)value=replayJob;
    else if(request.method==='GET'&&route===base+'/diagnostics')value=replayDiagnostics;
    else{queueResponse(cdp('Fetch.failRequest',{requestId,errorReason:'Aborted'}));return;}
    queueResponse(cdp('Fetch.fulfillRequest',{requestId,responseCode:status,responseHeaders:[{name:'Content-Type',value:'application/json; charset=utf-8'},{name:'Cache-Control',value:'no-store'}],body:Buffer.from(JSON.stringify(value),'utf8').toString('base64')}));
    return;
   }
   if(request.method==='POST'&&request.url===origin+'/qoe/api/analysis/jobs'){
    postAttempts++;
    if(postAttempts>1){blockedPosts++;queueResponse(cdp('Fetch.failRequest',{requestId,errorReason:'Aborted'}));}
    else{forwardedJobPosts++;queueResponse(cdp('Fetch.continueRequest',{requestId}));}
   }else queueResponse(cdp('Fetch.continueRequest',{requestId}));
  }else if(packet.method==='Network.requestWillBeSent'){
   const {requestId,request}=packet.params;
   if(request.method==='POST'&&request.url===origin+'/qoe/api/analysis/jobs'){jobPosts++;postRequests.add(requestId);}
  }else if(packet.method==='Network.responseReceived'){
   const response=packet.params.response;
   if(response.url.includes('/qoe/api/analysis/'))results.network.push({path:new URL(response.url).pathname,status:response.status});
  }else if(packet.method==='Network.loadingFinished'&&postRequests.has(packet.params.requestId)){
   queueResponse(trackJobResponse(packet.params.requestId));
  }
 });
 await cdp('Runtime.enable');await cdp('Network.enable');await cdp('Page.enable');
 await cdp('Fetch.enable',{patterns:[{urlPattern:origin+'/qoe/api/analysis/'+(replay?'*':'jobs'),requestStage:'Request'}]});
 await cdp('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
 await cdp('Page.navigate',{url});
}
async function beginAnalysis(){
 const row=await until(()=>run((id,number)=>{
  const marker=document.querySelector('[data-candidate-id="'+id+'"]');
  const button=[...document.querySelectorAll('button[aria-label="후보 지역 '+number+' AI 분석"]')].find(node=>node.getBoundingClientRect().width>0);
  return marker&&button?{candidate:marker.getAttribute('data-candidate-id'),text:button.parentElement.textContent.trim()}:null;
 },candidateId,candidateNumber),'candidate row',50000);
 check('actual-candidate-row',row);
 assert.equal(await run(number=>{
  const button=[...document.querySelectorAll('button[aria-label="후보 지역 '+number+' AI 분석"]')].find(node=>node.getBoundingClientRect().width>0);
  if(!button)return false;button.scrollIntoView({block:'center'});button.click();return true;
 },candidateNumber),true,'click the candidate AI button once');
 if(!replay){
  const immediate=await snapshot();
  assert.equal(immediate.categories.length,0,'pending must not fabricate cause categories');
  assert.equal(immediate.stages.length,0,'pending must not fabricate problem/cause/actions');
  results.pendingSamples++;
 }
 await until(()=>lastJob||postFailure,'single analysis job acceptance',30000);
 if(postFailure)throw fail(postFailure.message,postFailure.code);
 if(!replay&&lastJob.reused===true)throw fail('An existing candidate job was reused and has been left unchanged; no new inference was requested','QA_EXISTING_JOB_REUSED');
 assert.equal(ownedJobs.size,1,'only one new job belongs to this test');
 check(replay?'one-recorded-verified-job':'one-fresh-job',{jobId:lastJob.id,status:lastJob.status});
}
async function awaitCompletion(){
 let lastStatus='';
 while(Date.now()<workDeadline-25000){
  // Read DOM before the status so a result arriving between polls cannot be mistaken for a pending view.
  const state=await snapshot();
  lastJob=await api('/qoe/api/analysis/jobs/'+encodeURIComponent(lastJob.id));
  if(lastJob.status!==lastStatus){lastStatus=lastJob.status;results.jobStatus=lastStatus;phase('job-'+lastStatus);}
  if(['queued','collecting','analyzing'].includes(lastJob.status)){
   assert.equal(state.categories.length,0,'active job cannot show client-generated categories');
   assert.equal(state.stages.length,0,'active job cannot show client-generated analysis stages');
   results.pendingSamples++;await sleep(900);continue;
  }
  if(lastJob.status!=='completed')throw fail(lastJob.error?.message||('Model ended with '+lastJob.status),lastJob.error?.code||'QA_JOB_'+lastJob.status.toUpperCase());
  diagnostics=await api('/qoe/api/analysis/jobs/'+encodeURIComponent(lastJob.id)+'/diagnostics');
  assert.equal(lastJob.evidence?.versions?.prompt,expectedPrompt);
  assert.equal(lastJob.evidence?.versions?.sop,'candidate-sop-draft-v4');
  assert.equal(lastJob.evidence?.schemaVersion,'qwen-candidate-evidence-v2');
  assert.equal(diagnostics.validation?.status,'passed','actual model response must pass server validation');
  results.exchange={requestParameters:diagnostics.request?.parameters,usage:diagnostics.response?.usage,finishReason:diagnostics.response?.finishReason};
  if(process.env.QOE_QA_REQUIRE_NONTHINKING==='1')assert.equal(diagnostics.request?.parameters?.chat_template_kwargs?.enable_thinking,false,'actual candidate request must carry the configured non-thinking override');
  assert.equal(diagnostics.reused===true,false,'diagnostics must belong to this new model request');
  assert(lastJob.report&&Array.isArray(lastJob.report.hypotheses),'completed response needs actual report hypotheses');
  check(replay?'recorded-qwen-completion-preserved':'actual-qwen-completed',{durationMs:lastJob.modelVerification?.durationMs,modelVerified:lastJob.modelVerification?.responseModelVerified,pendingSamples:results.pendingSamples,hypotheses:lastJob.report.hypotheses.map(row=>({category:row.category,assessment:row.assessment,targetIds:row.targetIds,sopIds:row.sopIds}))});
  return;
 }
 throw fail('Qwen did not complete within the four-minute QA budget; no retry was made','QA_MODEL_TIMEOUT');
}
const compactText=text=>text.replace(/\s+/g,' ').trim();
function selectedFindings(){
 return lastJob.report.hypotheses.filter(row=>row.assessment==='supported'||row.assessment==='possible');
}
function expectedTarget(hypothesis,targetId=hypothesis.targetIds[0]){
 const target=lastJob.evidence.analysisTargets.find(item=>item.id===targetId);assert(target,'model target must exist in API evidence');
 const point=target.mapPoints?.[0];
 return {target,pot:point?.pot??'',band:point?(target.band??point.band??'top1'):''};
}
async function verifySelected(hypothesis,targetId){
 const expected=expectedTarget(hypothesis,targetId);
 const state=await until(async()=>{
  const observed=await snapshot();
  return observed.selectedTarget===expected.target.id&&observed.selectedPot===expected.pot&&observed.selectedBand===expected.band&&(!expected.pot||observed.selectedMarkers.includes(expected.pot))?observed:null;
 },'selected model target '+expected.target.id,12000);
 assert.deepEqual(state.stages.map(stage=>stage.number),['1','2','3']);
 assert(compactText(state.stages[0].text).includes(compactText(hypothesis.title)),'problem must display the actual model hypothesis');
 assert(compactText(state.stages[1].text).includes(compactText(hypothesis.reason)),'cause must display the actual model reason');
 const allowed=lastJob.evidence.sop.templates.filter(template=>hypothesis.sopIds.includes(template.id)&&expected.target.sopIds.includes(template.id));
 assert(allowed.length,'every target must have an actual selected procedure');
 assert(allowed.some(template=>template.checkNow.some(text=>compactText(state.stages[2].text).includes(compactText(text)))),'stage 3 must include the linked SOP check');
 assert(allowed.some(template=>template.conditionalActions.some(action=>compactText(state.stages[2].text).includes(compactText(action.action)))),'stage 3 must include the linked conditional action');
 if(!expected.pot)assert.equal(state.selectedMarkers.length,0,'a location-free cause must not select an arbitrary POT');
 return {state,target:expected.target,pot:expected.pot,band:expected.band};
}
async function selectFinding(index){
 assert.equal(await run(index=>{
  const buttons=[...document.querySelectorAll('dialog[open] [data-cause-category]')].filter(node=>node.tagName==='BUTTON');
  if(!buttons[index])return false;buttons[index].click();return true;
 },index),true,'model-selected cause button exists');
}
async function selectTargetOption(index){
 assert.equal(await run(index=>{
  const select=document.querySelector('dialog[open] select[aria-label="AI 선정 조사 대상"]');
  if(!select?.options[index])return false;select.value=select.options[index].value;select.dispatchEvent(new Event('change',{bubbles:true}));return true;
 },index),true,'model-selected target option exists');
}
async function verifyModelSelection(){
 const hypotheses=selectedFindings();
 for(const row of lastJob.report.hypotheses)assert(categories.has(row.category),'actual response must carry a known category');
 const state=await until(async()=>{
  const current=await snapshot();
  return current.workspace&&current.findings===hypotheses.length&&current.categories.length===hypotheses.length?current:null;
 },'UI reflects only completed model selections',15000);
 assert.deepEqual(state.categories.map(row=>row.category),hypotheses.map(row=>row.category),'category order and count must exactly match supported/possible model hypotheses');
 assert.equal(state.candidate,candidateId);
 results.branch=hypotheses.length?'selected-causes':'valid-empty-selection';
 results.expected=hypotheses.map(row=>({category:row.category,assessment:row.assessment,targets:row.targetIds.map(id=>{const value=expectedTarget(row,id);return {id,pot:value.pot,band:value.band};})}));
 if(!hypotheses.length){
  assert.equal(state.stages.length,0);assert.equal(state.selectedPot,'');assert.equal(state.selectedMarkers.length,0);
  check('no-model-selection-shows-no-fabricated-cause');
  return;
 }
 const automatic=await verifySelected(hypotheses[0]);
 check('first-model-target-auto-selected',{category:hypotheses[0].category,targetId:automatic.target.id,pot:automatic.pot,band:automatic.band});
 if(hypotheses.length===1){
  assert.equal(state.categories.filter(item=>item.button).length,0,'one selected cause must not force a manual category tab');
  check('single-selection-needs-no-category-click');
 }else{
  assert.equal(state.categories.filter(item=>item.button).length,hypotheses.length);
  for(let index=0;index<hypotheses.length;index++){
   await selectFinding(index);const current=await verifySelected(hypotheses[index]);
   assert.equal(current.state.categories.filter(item=>item.pressed==='true').length,1);
   assert.equal(current.state.categories[index].pressed,'true');
   check('actual-selected-cause-switch',{index,category:hypotheses[index].category,targetId:current.target.id,pot:current.pot,band:current.band});
  }
 }
 const totalTargets=hypotheses.reduce((count,row)=>count+row.targetIds.length,0);
 if(totalTargets>1){
  assert.equal((await snapshot()).options.length,totalTargets,'target selector contains only targets explicitly selected by the model');
  let option=0;
  for(const hypothesis of hypotheses)for(const id of hypothesis.targetIds){
   await selectTargetOption(option++);const current=await verifySelected(hypothesis,id);
   check('actual-selected-target-switch',{category:hypothesis.category,targetId:id,pot:current.pot,band:current.band});
  }
  await selectTargetOption(0);
 }else if(hypotheses.length>1)await selectFinding(0);
 await verifySelected(hypotheses[0]);
 const background=await run(()=>{
  const map=document.querySelector('dialog[open] [aria-label="조사 후보 POT·기지국 지도"]'),bounds=map?.getBoundingClientRect();
  if(!bounds)return null;
  for(const node of map.querySelectorAll('[data-pot-selectable="false"]')){
   const rect=node.getBoundingClientRect();
   for(const fraction of [[0.5,0.5],[0.35,0.35],[0.65,0.65]]){
    const x=rect.left+rect.width*fraction[0],y=rect.top+rect.height*fraction[1];
    if(x<=bounds.left+10||x>=bounds.right-10||y<=bounds.top+10||y>=bounds.bottom-10)continue;
    if(document.elementFromPoint(x,y)?.closest('[data-pot-id]')===node)return {x,y,pot:node.getAttribute('data-pot-id')};
   }
  }
  return null;
 });
 assert(background,'a visible, unselected background POT must be available to test');
 const before=await snapshot();await pointerClick(background);
 await run(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await sleep(250);
 const after=await snapshot();
 assert.equal(after.selectedTarget,before.selectedTarget,'background POT click cannot change the AI-selected target');
 assert.equal(after.selectedPot,before.selectedPot);assert.equal(after.selectedBand,before.selectedBand);
 assert.deepEqual(after.categories,before.categories);assert.deepEqual(after.stages,before.stages);
 check('unselected-background-pot-does-not-create-or-change-cause',{clickedPot:background.pot,selectedTarget:after.selectedTarget});
}
async function inspectActualExchange(){
 const beforePosts=postAttempts;
 assert.equal(await run(()=>{
  const button=[...document.querySelectorAll('dialog[open] header button')].find(node=>node.textContent.trim()==='AI 입력·응답 확인');
  if(!button)return false;button.click();return true;
 }),true);
 await until(()=>run(()=>document.querySelectorAll('dialog[open] [aria-label="AI 실행 기록 구분"] [role="tab"]').length===4),'four actual-exchange inspector tabs',10000);
 assert(diagnostics.request?.messages?.length,'diagnostics must retain actual sent messages');
 const displayedParameters=await run(()=>{
  const inspector=document.querySelector('dialog[open] aside[aria-label="AI 입력·응답 확인"]');
  const details=[...inspector?.querySelectorAll('details')??[]].find(node=>node.querySelector('summary')?.textContent.trim()==='전송 옵션·사본 식별값');
  if(!details)return null;details.open=true;return details.querySelector('pre')?.textContent;
 });
 assert(displayedParameters,'inspector must expose actual request options');
 assert.deepEqual(JSON.parse(displayedParameters),diagnostics.request.parameters);
 check('inspector-actual-request-options',{parameters:diagnostics.request.parameters});
 for(const [role,label] of [['system','System'],['user','User'],['data','전송 데이터'],['response','응답·검증']]){
  assert.equal(await run(label=>{
   const button=[...document.querySelectorAll('dialog[open] [role="tab"]')].find(node=>node.textContent.trim()===label);
   if(!button)return false;button.click();return true;
  },label),true);
  const pane=await until(()=>run(label=>{
   const active=[...document.querySelectorAll('dialog[open] [role="tab"]')].find(node=>node.textContent.trim()===label);
   const panel=document.querySelector('dialog[open] [role="tabpanel"]');
   return active?.getAttribute('aria-selected')==='true'&&panel?.querySelector('pre')?{text:panel.textContent,raw:[...panel.querySelectorAll('pre')].map(node=>({label:node.getAttribute('aria-label'),text:node.textContent}))}:null;
  },label),'actual '+label+' inspector content',8000);
  if(role==='system'||role==='user'){
   const expected=diagnostics.request.messages.filter(message=>message.role===role).map(message=>message.content);
   assert(expected.length);
   assert.deepEqual(pane.raw.filter(item=>item.label===role+' 실제 전송 원문').map(item=>item.text),expected,'inspector must display captured '+role+' content, not reconstructed prose');
   if(role==='system')for(const category of categories)assert(expected.join('\n').includes(category),'actual System must define the category contract');
   if(role==='user'){
    const input=JSON.parse(expected[0]);
    assert(expected[0].includes(expectedPrompt),'actual User input must use the expected prompt version');
    assert(Array.isArray(input.analysisTargets)&&input.analysisTargets.length>0,'actual User input must include analysis targets');
    check('actual-user-targets',{count:input.analysisTargets.length,hasSharedTargetRules:!!input.targetRules,neighbourLinks:input.neighbourLinks?.length??0});
   }
  }else if(role==='data'){
   const raw=pane.raw.find(item=>item.label==='전송 자료 집계 원문');
   assert(raw);assert.deepEqual(JSON.parse(raw.text),diagnostics.transmission);
  }else{
   assert.equal(diagnostics.validation.status,'passed');
   const raw=pane.raw.find(item=>item.label==='모델 실제 응답 원문');assert(raw);
   assert.equal(raw.text,diagnostics.response?.content,'response tab must contain the captured actual model output');
   let finalText=raw.text.trim();const fenced=finalText.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);if(fenced)finalText=fenced[1];
   const rawReport=JSON.parse(finalText);
   assert.deepEqual(rawReport.hypotheses,lastJob.report.hypotheses,'validated UI hypotheses must match the actual model output');
   assert(rawReport.hypotheses.every(row=>categories.has(row.category)));
  }
  check('inspector-actual-tab',{label,characters:pane.raw.reduce((count,item)=>count+item.text.length,0)});
 }
 assert.equal(postAttempts,beforePosts,'read-only inspector must not create another model request');
 await run(()=>[...document.querySelectorAll('dialog[open] header button')].find(node=>node.textContent.trim()==='AI 입력·응답 확인')?.click());
 await until(async()=>!(await snapshot()).inspector,'inspector close',5000);
}
async function capture(width,height,suffix){
 await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
 await run(()=>{
  const dialog=document.querySelector('dialog[open]');if(dialog?.children[1])dialog.children[1].scrollTop=0;
  const panel=dialog?.querySelector('[aria-label="AI 선정 대상 분석"]');if(panel)panel.scrollTop=0;
 });
 await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:40,y:30});
 await sleep(550);
 const layout=await run(()=>{
  const rectangle=node=>{
   if(!node)return null;const rect=node.getBoundingClientRect();
   return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,right:rect.right,bottom:rect.bottom,clientWidth:node.clientWidth,scrollWidth:node.scrollWidth,clientHeight:node.clientHeight,scrollHeight:node.scrollHeight};
  };
  const dialog=document.querySelector('dialog[open]'),workspace=dialog?.querySelector('[aria-label="AI 선정 원인과 조사 대상"]');
  return {viewport:{width:innerWidth,height:innerHeight},dialog:rectangle(dialog),map:rectangle(workspace?.querySelector('[aria-label="조사 후보 지도 패널"]')),mapViewport:rectangle(workspace?.querySelector('[aria-label="조사 후보 POT·기지국 지도"]')),selectedPots:[...workspace?.querySelectorAll('[data-pot-selected="true"]')??[]].map(node=>({pot:node.getAttribute('data-pot-id'),...rectangle(node)})),analysis:rectangle(workspace?.querySelector('[aria-label="AI 선정 대상 분석"]')),stages:[...workspace?.querySelectorAll('[data-pot-stage]')??[]].map(node=>({number:node.getAttribute('data-pot-stage'),...rectangle(node)}))};
 });
 results.layouts.push(layout);
 // Capture before layout assertions, preserving a useful view even if an assertion fails.
 for(const format of ['png','jpeg']){
  const shot=await cdp('Page.captureScreenshot',{format,...(format==='jpeg'?{quality:85}:{}),captureBeyondViewport:false,fromSurface:true});
  const filename=path.join(outputDir,artifactPrefix+'-'+suffix+'.'+(format==='jpeg'?'jpg':'png'));
  fs.writeFileSync(filename,Buffer.from(shot.data,'base64'));results.screenshots.push(filename);
 }
 assert.equal(layout.viewport.width,width);assert.equal(layout.viewport.height,height);
 assert(layout.dialog&&layout.map&&layout.analysis,'both analysis panels must be visible');
 assert(layout.dialog.x>=0&&layout.dialog.right<=width+1&&layout.dialog.bottom<=height+1,'dialog fits viewport');
 assert(layout.map.right<=layout.analysis.x+1,'investigation map stays left of the selected explanation');
 assert(layout.map.height>250&&layout.analysis.height>250,'both panels retain usable height');
 assert(layout.map.scrollWidth<=layout.map.clientWidth+1&&layout.analysis.scrollWidth<=layout.analysis.clientWidth+1,'panels do not overflow horizontally');
 if(layout.stages.length)assert(layout.stages.some(stage=>stage.number==='3'),'the confirmation/actions step remains in the scrollable report');
 if(layout.selectedPots.length){
  const bounds=layout.mapViewport;assert(bounds,'map viewport must exist for selected POT visibility');
  for(const pot of layout.selectedPots){
   assert(pot.width>0&&pot.height>0,'selected POT polygon has visible bounds');
   assert(pot.x>=bounds.x-1&&pot.y>=bounds.y-1&&pot.right<=bounds.right+1&&pot.bottom<=bounds.bottom+1,'selected POT polygon remains inside the map viewport after resizing');
   const center={x:pot.x+pot.width/2,y:pot.y+pot.height/2};
   assert(center.x>=bounds.x&&center.x<=bounds.right&&center.y>=bounds.y&&center.y<=bounds.bottom,'selected POT center remains visible');
  }
 }
 check('viewport-capture',{width,height,selectedPots:layout.selectedPots,mapViewport:layout.mapViewport});
}
async function saveFailure(error){
 results.status='FAIL';results.error={code:error.code||'QA_ASSERTION',message:clean(error.message),stack:clean(error.stack)};
 results.lastObserved=lastObserved;
 if(lastJob?.id){
  try{lastJob=await api('/qoe/api/analysis/jobs/'+encodeURIComponent(lastJob.id));}catch{}
  try{diagnostics=await api('/qoe/api/analysis/jobs/'+encodeURIComponent(lastJob.id)+'/diagnostics');}catch{}
 }
 const file=path.join(outputDir,artifactPrefix+'-failure-diagnostics.json');
 fs.writeFileSync(file,JSON.stringify(clean({error:results.error,job:lastJob?{id:lastJob.id,status:lastJob.status,error:lastJob.error,report:lastJob.report,versions:lastJob.evidence?.versions}:null,diagnostics,postFailure,lastObserved}),null,2));
 results.failureDiagnostics=file;
 if(ws?.readyState===WebSocket.OPEN){
  for(const format of ['png','jpeg'])try{
   const shot=await cdp('Page.captureScreenshot',{format,...(format==='jpeg'?{quality:85}:{}),captureBeyondViewport:false});
   const filename=path.join(outputDir,artifactPrefix+'-failure.'+(format==='jpeg'?'jpg':'png'));
   fs.writeFileSync(filename,Buffer.from(shot.data,'base64'));results.screenshots.push(filename);
  }catch{}
 }
 console.error('AI_SELECTED_QA_FAIL',JSON.stringify({code:results.error.code,message:results.error.message,diagnostics:file}));
 process.exitCode=1;
}
(async()=>{
 phase('opening-isolated-browser');await connect();
 phase(replay?'opening-recorded-model-result':'requesting-single-model-analysis');await beginAnalysis();
 phase(replay?'validating-preserved-completion':'waiting-for-actual-qwen-completion');await awaitCompletion();
 phase('matching-report-to-selected-ui');await verifyModelSelection();
 await capture(1920,1080,'1920x1080');
 phase('checking-actual-prompt-and-response');await inspectActualExchange();
 await capture(1366,768,'1366x768');
 assert.equal(blockedPosts,0,'the UI must not attempt automatic model retries');
 assert.equal(postAttempts,1,'exactly one model job request');
 assert.equal(jobPosts,1,'exactly one UI analysis POST was observed');
 assert.equal(forwardedJobPosts,replay?0:1,'replay must never forward a model request');
 if(replay){assert.equal(fileHash(replayJobPath),replaySource.jobHash);assert.equal(fileHash(replayDiagnosticsPath),replaySource.diagnosticsHash);}
 assert.equal(results.runtimeErrors.length,0,'no browser runtime exception');
 results.status='PASS';results.phase='complete';finished=true;
 console.log('AI_SELECTED_QA_PASS',JSON.stringify({mode:results.mode,forwardedJobPosts,jobId:lastJob.id,branch:results.branch,expected:results.expected,checks:results.checks.length,screenshots:results.screenshots}));
})().catch(saveFailure).finally(async()=>{
 // Only this isolated run's unfinished job is eligible for cancellation.
 for(const id of ownedJobs){
  if(replay)continue;
  if(finished||lastJob?.id===id&&(lastJob.reused===true||!['queued','collecting','analyzing'].includes(lastJob.status)))continue;
  try{await api('/qoe/api/analysis/jobs/'+encodeURIComponent(id),{method:'DELETE'});results.cancelledOwnJob=id;}catch(error){results.cleanupError=clean(error.message);}
 }
 persist();
 try{ws?.close();}catch{}
 for(const request of pending.values()){clearTimeout(request.timer);request.reject(fail('QA Chrome closed','QA_CDP_CLOSED'));}
 pending.clear();
 if(chrome?.pid)try{execFileSync('taskkill.exe',['/PID',String(chrome.pid),'/T','/F'],{stdio:'ignore',timeout:4000});}catch{}
 await sleep(200);
 try{const resolvedProfile=path.resolve(profile);assert.equal(path.dirname(resolvedProfile),path.resolve(os.tmpdir()));assert(path.basename(resolvedProfile).startsWith('qoe-ai-selected-qa-'));fs.rmSync(resolvedProfile,{recursive:true,force:true,maxRetries:3,retryDelay:200});}catch{results.retainedTempProfile=true;persist();}
});
