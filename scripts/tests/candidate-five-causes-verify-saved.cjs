/* eslint-disable no-console, @typescript-eslint/no-require-imports -- Verify real model captures and durable history; no inference or history mutations. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {validateCandidateReport}=require('../qwen-candidate-client.cjs');
const directory=path.resolve(__dirname,'../../outputs/candidate-five-causes'),origin=process.env.QOE_CAUSE_QA_ORIGIN??'http://127.0.0.1:3001';
const result={schemaVersion:'candidate-five-causes-saved-verification-v1',verifiedAt:new Date().toISOString(),origin,status:'running',modelCalls:0,rows:[]};
const output=path.join(directory,'saved-verification.json');
const selected=process.argv.find(value=>value.startsWith('--only=')),numbers=selected?selected.slice(7).split(',').map(Number):[3,23,55];
(async()=>{
 for(const number of numbers){
  const prefix=path.join(directory,'candidate-'+String(number).padStart(2,'0')),job=JSON.parse(fs.readFileSync(prefix+'-job.json','utf8')),diagnostics=JSON.parse(fs.readFileSync(prefix+'-diagnostics.json','utf8'));
  assert.equal(job.status,'completed');assert.equal(job.persistence.status,'saved');assert.equal(job.evidence.versions.prompt,'candidate-prompt-v8');assert.equal(job.evidence.causeAssessments.length,5);assert(job.report.hypotheses.length>0);
  const final=diagnostics.attempts?.at(-1)??diagnostics;let raw=final.response.content.trim();const fence=raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);if(fence)raw=fence[1];
  const input=JSON.parse(final.request.messages.find(message=>message.role==='user').content),validated=validateCandidateReport(JSON.parse(raw),{...job.evidence,modelInput:input});
  assert.deepEqual(validated,job.report,'The exact original model response must validate and reproduce the saved source-linked report');
  const response=await fetch(origin+'/qoe/api/analysis/candidate-history',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(job.target),signal:AbortSignal.timeout(20000)});const history=await response.json();assert.equal(response.status,200);assert.equal(history.limit,3);assert(history.jobs.length<=3);assert.equal(new Set(history.jobs.map(row=>row.id)).size,history.jobs.length);assert.equal(history.jobs[0].id,job.id);assert.deepEqual(history.jobs[0].report,job.report);
  const restored=await(await fetch(origin+'/qoe/api/analysis/jobs/'+job.id+'/diagnostics',{signal:AbortSignal.timeout(20000)})).json();assert.equal(restored.validation.status,'passed');assert.deepEqual(restored.response,diagnostics.response);
  result.rows.push({number,jobId:job.id,categories:job.report.hypotheses.map(row=>row.category),exactOriginalResponseValidated:true,historyCount:history.jobs.length,historyLimit:history.limit,latestReportRestored:true,diagnosticsRestored:true,originalResponseHash:createHash('sha256').update(final.response.content).digest('hex')});
 }
 result.status='passed';fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(error=>{result.status='failed';result.error=error.message;fs.writeFileSync(output,JSON.stringify(result,null,2));console.error(error);process.exitCode=1;});
