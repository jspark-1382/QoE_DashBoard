/* eslint-disable no-console, @typescript-eslint/no-require-imports -- Explicit live Qwen integration check. */
// Opt in: node scripts/tests/candidate-actionable-live-qa.cjs
// Uses real local data and Qwen; saves successful results in the normal history.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict');
const {createQwenAnalysisHandler}=require('../qwen-analysis-api.cjs');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'outputs','candidate-actionable-live-qa.json');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const result={startedAt:new Date().toISOString(),status:'running',runs:[],checks:[]};
const persist=()=>fs.writeFileSync(out,JSON.stringify(result,null,2));
let handler,server,origin;
async function start(){
 handler=createQwenAnalysisHandler({root});
 server=http.createServer((req,res)=>{void handler(req,res).then(handled=>{if(!handled){res.writeHead(404);res.end();}});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 origin='http://127.0.0.1:'+server.address().port;
}
async function stop(){await handler?.close();if(server)await new Promise(resolve=>server.close(resolve));}
async function api(route,body){
 const response=await fetch(origin+'/qoe/api/analysis/'+route,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
 const value=await response.json();assert(response.ok,JSON.stringify(value));return value;
}
function summarize(job){
 const targets=new Map(job.evidence.analysisTargets.map(t=>[t.id,t]));
 return {id:job.id,candidateId:job.target.candidateId,status:job.status,persistence:job.persistence,model:job.model,modelVerification:job.modelVerification,
  summary:job.report?.summary,hypotheses:job.report?.hypotheses.map(h=>({...h,points:h.targetIds.map(id=>{const t=targets.get(id);return {id,pot:t?.mapPoints?.[0]?.pot,band:t?.band,metrics:t?.metrics?.filter(m=>['測定 수','측정 수','RSRP 평균','RSRP ≤-105 dBm'].includes(m.label))};})})),
  independentReview:job.evidence.independentReview,error:job.error};
}
async function run(target,label){
 const begin=Date.now();let job=await api('jobs',{...target,rerun:true});console.log('LIVE_START',label,job.id);
 const deadline=Date.now()+380000;
 while(['queued','collecting','analyzing'].includes(job.status)&&Date.now()<deadline){await delay(1300);job=await api('jobs/'+job.id);}
 const row={label,...(job.evidence?summarize(job):{id:job.id,status:job.status,error:job.error}),elapsedMs:Date.now()-begin};result.runs.push(row);persist();
 const diagnostics=await api('jobs/'+job.id+'/diagnostics');
 fs.writeFileSync(path.join(root,'outputs','candidate-actionable-'+label+'-job.json'),JSON.stringify(job,null,2));
 fs.writeFileSync(path.join(root,'outputs','candidate-actionable-'+label+'-diagnostics.json'),JSON.stringify(diagnostics,null,2));
 assert.equal(job.status,'completed',JSON.stringify(job.error));assert.equal(job.persistence?.status,'saved');assert(job.modelVerification?.responseModelVerified);
 assert.equal(diagnostics.validation?.status,'passed');
 assert(job.evidence.independentReview,'Independent evidence review exists');
 console.log('LIVE_DONE',label,JSON.stringify({id:job.id,status:job.status,saved:job.persistence?.status,categories:job.report.hypotheses.map(h=>h.category),points:job.report.hypotheses.flatMap(h=>h.targetIds).length,elapsedMs:row.elapsedMs}));
 return job;
}
(async()=>{
 await start();
 const index=JSON.parse(fs.readFileSync(path.join(root,'public','quality-improvement-mixed-full','index.json')));
 const entry=index.entries.find(e=>e.scope.dateStart==='2026-10-26'&&e.scope.dateEnd==='2026-10-30');assert(entry);
 const summary=JSON.parse(fs.readFileSync(path.join(root,'public','quality-improvement-mixed-full',entry.path)));
 const target=position=>({kind:'candidate',candidateId:summary.candidates[position-1].id,sourceRevision:index.sourceRevision,scope:{dateStart:entry.scope.dateStart,dateEnd:entry.scope.dateEnd,from:entry.scope.from,to:entry.scope.to},candidateScope:{scopeKey:entry.scopeKey,policy:entry.scope.policy,analysisMode:'all',locationMode:index.locationMode,modelId:'dbscan'}});
 const t23=target(23),jobs=[];
 if(process.env.QOE_QA_VERIFY_SAVED==='1'){
  await run(t23,'candidate23-current-validator');
  const saved=await api('candidate-history',t23);assert.equal(saved.jobs.length,3);
  const {validateCandidateReport}=require('../qwen-candidate-client.cjs');
  for(const [index,job] of saved.jobs.entries()){
   const diagnostics=await api('jobs/'+job.id+'/diagnostics');
   const modelInput=JSON.parse(diagnostics.request.messages.find(message=>message.role==='user').content);
   validateCandidateReport(job.report,{...job.evidence,modelInput});
   jobs.push(job);
   fs.writeFileSync(path.join(root,'outputs','candidate-actionable-candidate23-run'+(index+1)+'-job.json'),JSON.stringify(job,null,2));
   fs.writeFileSync(path.join(root,'outputs','candidate-actionable-candidate23-run'+(index+1)+'-diagnostics.json'),JSON.stringify(diagnostics,null,2));
  }
  result.checks.push('three-real-saved-reports-pass-final-validator');
 }
 // Live model output is nondeterministic. Retain every failed exchange and
 // verify failure retention; collect three successful reports within five runs.
 for(let attempt=1;attempt<=5&&jobs.length<3;attempt++){
  const before=await api('candidate-history',t23),label='candidate23-attempt'+attempt;
  try{
   const job=await run(t23,label);jobs.push(job);
   for(const suffix of ['job','diagnostics'])fs.copyFileSync(path.join(root,'outputs','candidate-actionable-'+label+'-'+suffix+'.json'),path.join(root,'outputs','candidate-actionable-candidate23-run'+jobs.length+'-'+suffix+'.json'));
  }catch(error){
   if(result.runs.at(-1)?.status!=='failed')throw error;
   const after=await api('candidate-history',t23);
   assert.deepEqual(after.jobs.map(job=>job.id),before.jobs.map(job=>job.id),'Failed model output must preserve successful history');
   result.checks.push('failed-output-preserved-successful-history');console.log('LIVE_REJECTED_OUTPUT_PRESERVED',label);persist();
  }
 }
 assert.equal(jobs.length,3,'Three successful reports must be collected within five runs');
 assert.equal(new Set(jobs.map(j=>j.id)).size,3,'Explicit reruns must create distinct analyses');
 let history=await api('candidate-history',t23);assert.equal(history.limit,3);assert.equal(history.jobs.length,3);
 assert.deepEqual(new Set(history.jobs.map(j=>j.id)),new Set(jobs.map(j=>j.id)));result.checks.push('three-distinct-live-results-saved');
 await stop();await start();
 history=await api('candidate-history',t23);assert.equal(history.jobs.length,3);
 for(const job of jobs){const restored=await api('jobs/'+job.id);assert.deepEqual(restored.report,job.report);assert.equal(restored.persistence.status,'saved');const diag=await api('jobs/'+job.id+'/diagnostics');assert.equal(diag.validation.status,'passed');}
 result.checks.push('history-and-diagnostics-survive-handler-restart');
 await run(target(12),'candidate12-run1');
 const isolated=await api('candidate-history',t23);assert.deepEqual(isolated.jobs.map(j=>j.id),history.jobs.map(j=>j.id));result.checks.push('other-candidate-does-not-change-history');
 result.status='passed';console.log('ACTIONABLE_LIVE_QA_PASS',JSON.stringify({runs:result.runs.length,checks:result.checks}));
})().catch(error=>{result.status='failed';result.error={message:error.message};console.error('ACTIONABLE_LIVE_QA_FAIL',error.message);process.exitCode=1;}).finally(async()=>{result.finishedAt=new Date().toISOString();persist();await stop();});
