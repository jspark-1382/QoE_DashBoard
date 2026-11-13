/* eslint-disable no-console, @typescript-eslint/no-require-imports -- Read-only recovery of accepted audit jobs; never starts inference. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {validateCandidateReport}=require('../qwen-candidate-client.cjs');
const {createCandidateHistoryStore}=require('../qwen-candidate-history.cjs');
const root=path.resolve(__dirname,'../..'),directory=path.join(root,'outputs','candidate-full-audit'),manifest=path.join(directory,'live.json'),output=path.join(directory,'recovery.json');
const history=createCandidateHistoryStore(root),result={startedAt:new Date().toISOString(),status:'running',rows:[]};
const captured=new Set(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const persist=()=>fs.writeFileSync(output,JSON.stringify(result,null,2));
async function api(origin,route){let error;for(let i=0;i<3;i++)try{const response=await fetch(origin+'/qoe/api/analysis/'+route,{signal:AbortSignal.timeout(20000)});assert(response.ok,'HTTP '+response.status);return await response.json();}catch(e){error=e;await sleep(400);}throw error;}
async function recover(row,origin){
 let job,diagnostics;
 try{job=await api(origin,'jobs/'+row.jobId);if(['queued','collecting','analyzing'].includes(job.status))return false;diagnostics=await api(origin,'jobs/'+row.jobId+'/diagnostics');}
 catch{const saved=history.find(row.jobId);if(!saved)return false;job=saved.job;diagnostics=saved.diagnostics;}
 assert.equal(job.id,row.jobId);assert.equal(job.target.candidateId,row.candidateId);
 if(job.status==='completed'){
  const modelInput=JSON.parse(diagnostics.request.messages.find(message=>message.role==='user').content);
  validateCandidateReport(job.report,{...job.evidence,modelInput});assert.equal(job.persistence.status,'saved');
 }
 const prefix=path.join(directory,'candidate-'+String(row.number).padStart(2,'0')+'-recovered');
 fs.writeFileSync(prefix+'-job.json',JSON.stringify(job,null,2));fs.writeFileSync(prefix+'-diagnostics.json',JSON.stringify(diagnostics,null,2));
 result.rows.push({number:row.number,candidateId:row.candidateId,jobId:job.id,status:job.status,error:job.error,persistence:job.persistence,attempt:job.attempt,modelVerification:job.modelVerification,previousError:row.error,hypotheses:job.report?.hypotheses.map(h=>({category:h.category,title:h.title,targets:h.targetIds.length})),recoveredFromAcceptedJob:true});
 captured.add(row.jobId);persist();console.log('AUDIT_RECOVERED',row.number,job.status,job.id);return true;
}
(async()=>{
 if(process.argv.includes('--merge')){
  const live=JSON.parse(fs.readFileSync(manifest)),recovery=JSON.parse(fs.readFileSync(output));
  for(const row of recovery.rows){const index=live.rows.findIndex(item=>item.jobId===row.jobId&&item.status!=='completed');if(index<0)continue;live.rows[index]={...live.rows[index],...row};const prefix='candidate-'+String(row.number).padStart(2,'0');for(const part of ['job','diagnostics'])fs.copyFileSync(path.join(directory,prefix+'-recovered-'+part+'.json'),path.join(directory,prefix+'-'+part+'.json'));}
  live.counts={finished:live.rows.length,completed:live.rows.filter(row=>row.status==='completed').length,failed:live.rows.filter(row=>row.status!=='completed').length};live.status=live.rows.length===live.totalCandidates&&live.counts.failed===0?'passed':'needs-fixes';fs.writeFileSync(manifest,JSON.stringify(live,null,2));console.log('AUDIT_RECOVERY_MERGED',JSON.stringify({status:live.status,counts:live.counts}));return;
 }
 persist();const deadline=Date.now()+2*60*60*1000;let unavailable=0;
 while(Date.now()<deadline){
  const live=JSON.parse(fs.readFileSync(manifest)),url=new URL(live.origin);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.protocol,'http:');
  for(const row of live.rows.filter(row=>row.error?.code==='AUDIT_ERROR'&&row.jobId&&!captured.has(row.jobId)))await recover(row,live.origin);
  const pending=live.rows.filter(row=>row.error?.code==='AUDIT_ERROR'&&row.jobId&&!captured.has(row.jobId));
  if(live.status!=='running'&&!pending.length)break;
  try{await api(live.origin,'config');unavailable=0;}catch{unavailable++;if(unavailable>=3)break;}
  await sleep(4000);
 }
 result.status='complete';
})().catch(error=>{result.status='failed';result.error=error.message;console.error('AUDIT_RECOVERY_ERROR',error.message);process.exitCode=1;}).finally(()=>{if(!process.argv.includes('--merge')){result.finishedAt=new Date().toISOString();persist();}});
