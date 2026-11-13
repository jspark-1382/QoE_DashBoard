/* eslint-disable no-console, @typescript-eslint/no-require-imports -- One real analysis for three representative source-positive candidates. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const origin=process.env.QOE_CAUSE_QA_ORIGIN??'http://127.0.0.1:3017',directory=path.resolve(__dirname,'../../outputs/candidate-five-causes');
const core=JSON.parse(fs.readFileSync(path.join(directory,'core-audit.json'),'utf8'));
const requested=process.argv.find(value=>value.startsWith('--only=')),numbers=requested?requested.slice(7).split(',').map(Number):[3,23,55];
const record={schemaVersion:'candidate-five-cause-live-qa-v1',origin,startedAt:new Date().toISOString(),status:'running',rows:[]};
const file=path.join(directory,'live-qa'+(requested?'-selected':'')+'.json');
const persist=()=>fs.writeFileSync(file,JSON.stringify(record,null,2));
async function api(route,body){const response=await fetch(origin+'/qoe/api/analysis/'+route,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});const result=await response.json();if(!response.ok)throw Error(route+': '+JSON.stringify(result));return result;}
async function run(number){
 const target=core.rows.find(row=>row.number===number)?.target;assert(target);
 const row={number,status:'failed'},prefix=path.join(directory,'candidate-'+String(number).padStart(2,'0'));
 try{
  const before=await api('candidate-history',target);let job=await api('jobs',{...target,rerun:true});row.jobId=job.id;console.log('CAUSE_MODEL_START',number,job.id);
  const until=Date.now()+420000;
  while(['queued','collecting','analyzing'].includes(job.status)&&Date.now()<until){await new Promise(resolve=>setTimeout(resolve,1300));job=await api('jobs/'+job.id);}
  const diagnostics=await api('jobs/'+job.id+'/diagnostics');
  fs.writeFileSync(prefix+'-job.json',JSON.stringify(job,null,2));fs.writeFileSync(prefix+'-diagnostics.json',JSON.stringify(diagnostics,null,2));
  Object.assign(row,{status:job.status,error:job.error,modelVerification:job.modelVerification,attempt:job.attempt,persistence:job.persistence,causeAssessments:job.evidence?.causeAssessments?.map(a=>({category:a.category,status:a.status})),hypotheses:job.report?.hypotheses?.map(h=>({category:h.category,title:h.title,assessment:h.assessment,targetIds:h.targetIds})),investigations:job.report?.investigations?.map(i=>({title:i.title,targetIds:i.targetIds}))});
  assert.equal(job.status,'completed',JSON.stringify(job.error));assert.equal(job.evidence.versions.evidence,'candidate-evidence-v5');assert.equal(job.evidence.versions.prompt,'candidate-prompt-v8');
  assert.equal(job.persistence.status,'saved');assert.equal(job.evidence.causeAssessments.length,5);assert(job.report.hypotheses.length>0);assert(job.report.investigations.length>0);
  assert(!job.report.hypotheses.some(h=>h.category==='capacity'),'Unprovided load must remain insufficient');
  const history=await api('candidate-history',target);assert.equal(history.limit,3);assert.deepEqual(history.jobs.map(j=>j.id),[job.id,...before.jobs.filter(j=>j.id!==job.id).map(j=>j.id)].slice(0,3));
  fs.writeFileSync(prefix+'-history.json',JSON.stringify(history,null,2));row.history={count:history.jobs.length,limit:history.limit,latestSaved:history.jobs[0].id===job.id,evictedIds:before.jobs.filter(j=>!history.jobs.some(k=>k.id===j.id)).map(j=>j.id)};
 }catch(error){row.status='failed';row.verificationError=error.message;}
 record.rows.push(row);persist();console.log('CAUSE_MODEL_RESULT',JSON.stringify(row));
}
(async()=>{let next=0;await Promise.all(Array.from({length:Math.min(2,numbers.length)},async()=>{while(next<numbers.length)await run(numbers[next++]);}));record.finishedAt=new Date().toISOString();record.status=record.rows.every(row=>row.status==='completed')?'passed':'needs-fixes';persist();console.log('CAUSE_MODEL_FINISH',record.status);if(record.status!=='passed')process.exitCode=1;})().catch(error=>{record.status='failed';record.error=error.message;persist();console.error(error);process.exitCode=1;});
