/* eslint-disable no-console, @typescript-eslint/no-require-imports -- Explicit complete real-data audit. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {createQwenAnalysisHandler}=require('../qwen-analysis-api.cjs');
const {collectCandidateEvidence}=require('../qwen-candidate-evidence.cjs');
const root=path.resolve(__dirname,'../..'),publicDir=path.join(root,'public'),directory=path.join(root,'outputs','candidate-full-audit');
fs.mkdirSync(directory,{recursive:true});
const index=JSON.parse(fs.readFileSync(path.join(publicDir,'quality-improvement-mixed-full/index.json')));
const entry=index.entries.find(e=>e.scope.dateStart==='2026-10-26'&&e.scope.dateEnd==='2026-10-30');assert(entry);
const summary=JSON.parse(fs.readFileSync(path.join(publicDir,'quality-improvement-mixed-full',entry.path)));
const dataIndex=JSON.parse(fs.readFileSync(path.join(publicDir,'voice-query-index.json')));
const targetFor=card=>({kind:'candidate',candidateId:card.id,sourceRevision:index.sourceRevision,scope:{dateStart:entry.scope.dateStart,dateEnd:entry.scope.dateEnd,from:entry.scope.from,to:entry.scope.to},candidateScope:{scopeKey:entry.scopeKey,policy:entry.scope.policy,analysisMode:'all',locationMode:index.locationMode,modelId:'dbscan'}});
const codeFingerprint=createHash('sha256').update(['qwen-candidate-client.cjs','qwen-candidate-evidence.cjs','qwen-candidate-findings.cjs','qwen-candidate-investigation-evidence.cjs','qwen-candidate-review.cjs','qwen-candidate-model-scope.cjs','qwen-candidate-sop.cjs','qwen-candidate-public-evidence.cjs'].map(file=>fs.readFileSync(path.join(root,'scripts',file),'utf8')).join('\n')).digest('hex');
const mode=process.argv.includes('--preflight')?'preflight':'live';
const concurrency=Math.min(4,Math.max(1,Number(process.env.QOE_AUDIT_CONCURRENCY)||2));
const requested=process.argv.find(value=>value.startsWith('--only='));
const chosen=requested?new Set(requested.slice(7).split(',').map(Number)):null;
const report={schemaVersion:'candidate-full-audit-v1',mode,startedAt:new Date().toISOString(),sourceRevision:index.sourceRevision,scope:entry.scope,totalCandidates:summary.candidates.length,codeFingerprint,status:'running',rows:[]};
const output=path.join(directory,mode+(chosen?'-selected':'')+'.json');
if(mode==='live'&&process.argv.includes('--resume')&&fs.existsSync(output)){
 const previous=JSON.parse(fs.readFileSync(output,'utf8'));
 assert.equal(previous.sourceRevision,report.sourceRevision);assert.deepEqual(previous.scope,report.scope);
 const archive=path.join(directory,'archive-'+new Date().toISOString().replace(/[^0-9]/g,''));fs.mkdirSync(archive,{recursive:true});
 for(const file of fs.readdirSync(directory).filter(file=>/^candidate-\d+-(?:job|diagnostics)\.json$/.test(file)))fs.copyFileSync(path.join(directory,file),path.join(archive,file));
 fs.copyFileSync(output,path.join(archive,'live.json'));
 report.previousRuns=[...(previous.previousRuns??[]),{startedAt:previous.startedAt,codeFingerprint:previous.codeFingerprint,counts:previous.counts,archive}];
 const {validateCandidateReport,CANDIDATE_PROMPT_VERSION}=require('../qwen-candidate-client.cjs');
 const {EVIDENCE_VERSION}=require('../qwen-candidate-evidence.cjs');
 const {publicCandidateEvidence}=require('../qwen-candidate-public-evidence.cjs');
 const history=require('../qwen-candidate-history.cjs').createCandidateHistoryStore(root);
 for(const row of previous.rows.filter(row=>row.status==='completed'||row.error?.code==='AUDIT_ERROR')){
  try{
   const prefix=path.join(directory,'candidate-'+String(row.number).padStart(2,'0'));
   const recovered=row.status!=='completed'?history.find(row.jobId):null;
   const job=recovered?.job??JSON.parse(fs.readFileSync(prefix+'-job.json')),diagnostics=recovered?.diagnostics??JSON.parse(fs.readFileSync(prefix+'-diagnostics.json'));
   if(job.status!=='completed'||job.id!==row.jobId||job.target.candidateId!==row.candidateId)continue;
   if(job.evidence?.versions?.evidence!==EVIDENCE_VERSION||job.evidence?.versions?.prompt!==CANDIDATE_PROMPT_VERSION||!job.report?.investigations?.length)continue;
   const modelInput=JSON.parse(diagnostics.request.messages.find(message=>message.role==='user').content);
   validateCandidateReport(job.report,{...job.evidence,modelInput});
   const compactJob={...job,evidence:publicCandidateEvidence(job.evidence,job.report,modelInput)};
   fs.writeFileSync(prefix+'-job.json',JSON.stringify(compactJob,null,2));fs.writeFileSync(prefix+'-diagnostics.json',JSON.stringify(diagnostics,null,2));
   report.rows.push({...row,status:'completed',error:undefined,revalidated:true,...(recovered?{transportRecoveredFromSavedJob:true,previousError:row.error,persistence:job.persistence,attempt:job.attempt,modelVerification:job.modelVerification}: {})});
  }catch{/* Changed verification rules require a real new run. */}
 }
}
const persist=()=>{report.counts={finished:report.rows.length,completed:report.rows.filter(row=>row.status==='completed').length,failed:report.rows.filter(row=>row.status!=='completed').length};fs.writeFileSync(output,JSON.stringify(report,null,2));};
const retained=new Set(report.rows.map(row=>row.number));
const priority=[23,9,12];
const order=summary.candidates.map((card,i)=>({card,number:i+1})).filter(row=>(!chosen||chosen.has(row.number))&&!retained.has(row.number)).sort((a,b)=>{
 const rank=number=>priority.includes(number)?priority.indexOf(number):priority.length+number;
 return rank(a.number)-rank(b.number);
});
let handler,server,origin,next=0;
async function api(route,body,method){
 for(let attempt=0;attempt<3;attempt++)try{
  const response=await fetch(origin+'/qoe/api/analysis/'+route,{headers:{Connection:'close',...(body?{'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:method?{method}:{}),signal:AbortSignal.timeout(60000)});
  const value=await response.json();if(!response.ok){const error=Error(value.error??'HTTP '+response.status);error.code=value.code??'HTTP_ERROR';throw error;}return value;
 }catch(error){
  const readOnly=!method&&(!body||route==='candidate-history');
  const transient=readOnly&&!error.code&&['TypeError','TimeoutError'].includes(error.name);
  if(!transient||attempt===2){error.auditRoute=route;throw error;}
  report.transportRetries??=[];report.transportRetries.push({route,attempt:attempt+1,cause:error.cause?.code??error.name});persist();
  await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
 }
}
async function run({card,number}){
 const started=Date.now(),target=targetFor(card),row={number,candidateId:card.id,status:'failed'};
 try{
  if(mode==='preflight'){
   const evidence=collectCandidateEvidence({publicDir,dbPath:path.resolve(root,dataIndex.database),sourceRevision:index.sourceRevision,target});
   Object.assign(row,{status:'completed',targets:evidence.analysisTargets.length,pots:evidence.mdtCoverage.measuredPots,inputCharacters:JSON.stringify(evidence.modelInput).length,modelDetails:evidence.modelInput.analysisTargets.length,rulePriorities:evidence.independentReview.priorities.length});
  }else{
   const beforeHistory=await api('candidate-history',target);
   let job=await api('jobs',{...target,rerun:true});row.jobId=job.id;console.log('AUDIT_START',number,job.id);
   const deadline=Date.now()+420000;
   while(['queued','collecting','analyzing'].includes(job.status)&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,1300));job=await api('jobs/'+job.id);}
   if(['queued','collecting','analyzing'].includes(job.status))job=await api('jobs/'+job.id,null,'DELETE');
   const diagnostics=await api('jobs/'+job.id+'/diagnostics'),prefix=path.join(directory,'candidate-'+String(number).padStart(2,'0'));
   fs.writeFileSync(prefix+'-job.json',JSON.stringify(job,null,2));fs.writeFileSync(prefix+'-diagnostics.json',JSON.stringify(diagnostics,null,2));
   Object.assign(row,{status:job.status,error:job.error,persistence:job.persistence,attempt:job.attempt,modelVerification:job.modelVerification,targets:job.evidence?.analysisTargets.length,pots:job.evidence?.mdtCoverage?.measuredPots,hypotheses:job.report?.hypotheses.map(h=>({category:h.category,title:h.title,targets:h.targetIds.length})),investigations:job.report?.investigations?.map(item=>({title:item.title,targets:item.targetIds.length,kinds:[...new Set(item.targetIds.map(id=>job.evidence.analysisTargets.find(target=>target.id===id)?.kind))]})),inputCharacters:diagnostics.request?.messages.find(m=>m.role==='user')?.content.length});
   if(job.status==='completed'&&job.persistence?.status!=='saved'){row.status='save-failed';row.error={code:'SAVE_FAILED',message:job.persistence?.message};}
   const afterHistory=await api('candidate-history',target);
   assert.equal(afterHistory.limit,3);assert(afterHistory.jobs.length<=3);assert.equal(new Set(afterHistory.jobs.map(item=>item.id)).size,afterHistory.jobs.length);
   if(job.status==='completed')assert.deepEqual(afterHistory.jobs.map(item=>item.id),[job.id,...beforeHistory.jobs.filter(item=>item.id!==job.id).map(item=>item.id)].slice(0,3),'Newest result and only the latest three must be retained in order');
   else assert.deepEqual(afterHistory.jobs.map(item=>item.id),beforeHistory.jobs.map(item=>item.id),'Rejected result must not evict a saved success');
   row.history={count:afterHistory.jobs.length,limit:afterHistory.limit,ids:afterHistory.jobs.map(item=>item.id),failedPreserved:job.status!=='completed'?true:undefined,...(job.status==='completed'?{evictedIds:beforeHistory.jobs.filter(item=>!afterHistory.jobs.some(saved=>saved.id===item.id)).map(item=>item.id)}:{})};
  }
 }catch(error){row.status='failed';row.error={code:error.code??'AUDIT_ERROR',message:error.message,...(error.cause?.code?{transportCode:error.cause.code}:{}),...(error.auditRoute?{route:error.auditRoute}:{})};}
 row.elapsedMs=Date.now()-started;report.rows.push(row);report.rows.sort((a,b)=>a.number-b.number);persist();console.log('AUDIT_RESULT',JSON.stringify(row));
}
async function startHandler(){
 handler=createQwenAnalysisHandler({root,maxRunning:concurrency,maxQueued:6,maxStored:8,jobTtlMs:2*60*60*1000});
 server=http.createServer((req,res)=>{void handler(req,res).then(handled=>{if(!handled){res.writeHead(404);res.end();}});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;report.origin=origin;persist();
}
async function closeHandler(){await handler?.close();if(server)await new Promise(resolve=>server.close(resolve));handler=null;server=null;}
async function verifyRestoredHistory(){
 await closeHandler();await startHandler();
 report.historyVerification={status:'running',afterHandlerRestart:true,candidates:[]};persist();
 for(const row of report.rows){
  const target=targetFor(summary.candidates[row.number-1]),history=await api('candidate-history',target);
  assert.equal(history.limit,3);assert(history.jobs.length<=3);assert.equal(new Set(history.jobs.map(job=>job.id)).size,history.jobs.length);
  for(const saved of history.jobs){assert.deepEqual(saved.target,target);assert.equal(saved.status,'completed');assert.equal(saved.persistence?.status,'saved');}
  const check={number:row.number,count:history.jobs.length,limit:3,ids:history.jobs.map(job=>job.id)};
  if(row.status==='completed'){
   const restored=await api('jobs/'+row.jobId),diagnostics=await api('jobs/'+row.jobId+'/diagnostics');
   assert(history.jobs.some(job=>job.id===row.jobId));assert.equal(restored.status,'completed');assert.equal(diagnostics.validation?.status,'passed');
   const original=JSON.parse(fs.readFileSync(path.join(directory,'candidate-'+String(row.number).padStart(2,'0')+'-job.json')));
   assert.deepEqual(restored.report,original.report);check.latestReportRestored=true;check.diagnosticsRestored=true;
  }
  report.historyVerification.candidates.push(check);persist();
 }
 report.historyVerification.status='passed';persist();
}
(async()=>{
 persist();
 if(mode==='live'){
  await startHandler();
 }
 const worker=async()=>{while(next<order.length){const item=order[next++];await run(item);}};
 await Promise.all(Array.from({length:mode==='preflight'?1:concurrency},worker));
 if(mode==='live')await verifyRestoredHistory();
 report.status=report.rows.every(row=>row.status==='completed')?'passed':'needs-fixes';
 if(report.status!=='passed')process.exitCode=1;
 console.log('AUDIT_FINISH',JSON.stringify({mode,status:report.status,total:report.rows.length,counts:report.counts}));
})().catch(error=>{report.status='failed';report.error=error.message;process.exitCode=1;console.error('AUDIT_ERROR',error.message);}).finally(async()=>{report.finishedAt=new Date().toISOString();persist();await closeHandler();});
