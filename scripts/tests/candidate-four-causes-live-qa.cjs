/* eslint-disable no-console, @typescript-eslint/no-require-imports -- One representative real generation and exact durable-history check. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {validateCandidateReport}=require('../qwen-candidate-client.cjs');
const directory=path.resolve('outputs/candidate-four-causes');fs.mkdirSync(directory,{recursive:true});
const origin=process.env.QOE_CAUSE_QA_ORIGIN||'http://127.0.0.1:3017';
const source=JSON.parse(fs.readFileSync('outputs/candidate-five-causes/candidate-03-job.json','utf8'));
const record={mode:'one-real-representative-four-cause-analysis',origin,status:'RUNNING',startedAt:new Date().toISOString(),newJobs:0};
const persist=()=>fs.writeFileSync(path.join(directory,'live-qa.json'),JSON.stringify(record,null,2));
async function api(route,body){const response=await fetch(origin+'/qoe/api/analysis/'+route,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});const value=await response.json();assert(response.ok,route+' '+JSON.stringify(value));return value;}
(async()=>{
 const before=await api('candidate-history',source.target);fs.writeFileSync(path.join(directory,'history-before.json'),JSON.stringify(before,null,2));
 let job;if(process.env.QOE_QA_RESUME_JOB){job=await api('jobs/'+process.env.QOE_QA_RESUME_JOB);record.resumedJob=job.id;}else{job=await api('jobs',{...source.target,rerun:true});record.newJobs=1;}
 record.jobId=job.id;persist();console.log('FOUR_CAUSE_MODEL_STARTED',job.id);
 const deadline=Date.now()+420000;while(['queued','collecting','analyzing'].includes(job.status)&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,1500));job=await api('jobs/'+job.id);record.phase=job.status;persist();}
 fs.writeFileSync(path.join(directory,'candidate-03-job.json'),JSON.stringify(job,null,2));
 const diagnostics=await api('jobs/'+job.id+'/diagnostics');fs.writeFileSync(path.join(directory,'candidate-03-diagnostics.json'),JSON.stringify(diagnostics,null,2));
 record.generationStatus=job.status;record.error=job.error;record.attempt=job.attempt;record.persistence=job.persistence;persist();
 assert.equal(job.status,'completed',JSON.stringify(job.error));assert.equal(job.persistence?.status,'saved');
 assert.deepEqual(job.evidence.versions,{...job.evidence.versions,evidence:'candidate-evidence-v6',prompt:'candidate-prompt-v9',sop:'candidate-sop-draft-v6'});
 assert.deepEqual(job.evidence.causeAssessments.map(row=>row.category),['coverage','uplink','interference','equipment']);
 assert(job.report.hypotheses.length>0);assert(job.report.hypotheses.every(row=>['coverage','uplink','interference','equipment'].includes(row.category)));assert(job.report.investigations.length>0);
 const final=diagnostics.attempts?.at(-1)??diagnostics;let raw=final.response.content.trim();const fence=raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);if(fence)raw=fence[1];
 const input=JSON.parse(final.request.messages.find(message=>message.role==='user').content);const validated=validateCandidateReport(JSON.parse(raw),{...job.evidence,modelInput:input});assert.deepEqual(validated,job.report);
 const history=await api('candidate-history',source.target);fs.writeFileSync(path.join(directory,'candidate-03-history.json'),JSON.stringify(history,null,2));assert.equal(history.limit,3);assert.deepEqual(history.jobs.map(row=>row.id),[job.id,...before.jobs.filter(row=>row.id!==job.id).map(row=>row.id)].slice(0,3));
 record.status='PASS';record.finishedAt=new Date().toISOString();record.categories=job.report.hypotheses.map(row=>row.category);record.history={count:history.jobs.length,limit:history.limit,latest:history.jobs[0]?.id,evictedIds:before.jobs.filter(row=>!history.jobs.some(saved=>saved.id===row.id)).map(row=>row.id)};record.exactRawResponseValidated=true;persist();console.log('FOUR_CAUSE_MODEL_PASS',JSON.stringify(record));
})().catch(error=>{record.status='FAIL';record.verificationError=error.message;persist();console.error('FOUR_CAUSE_MODEL_FAIL',error.message);process.exitCode=1;});
