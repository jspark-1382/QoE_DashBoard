/* eslint-disable no-console, @typescript-eslint/no-require-imports -- Explicit live prompt-edit transmission QA. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {createQwenAnalysisHandler}=require('../qwen-analysis-api.cjs');
const root=path.resolve(__dirname,'../..'),output=path.join(root,'outputs','candidate-prompt-live-qa.json');
const target=JSON.parse(fs.readFileSync(path.join(root,'outputs','candidate-actionable-candidate12-run1-job.json'),'utf8')).target;
const result={startedAt:new Date().toISOString(),status:'running',checks:[]};
const handler=createQwenAnalysisHandler({root});
const server=http.createServer((req,res)=>{void handler(req,res).then(handled=>{if(!handled){res.writeHead(404);res.end();}});});
let origin;
async function api(route,body){const response=await fetch(origin+'/qoe/api/analysis/'+route,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});const value=await response.json();assert(response.ok,JSON.stringify(value));return value;}
const save=()=>fs.writeFileSync(output,JSON.stringify(result,null,2));
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 const before=await api('candidate-history',target),draft=await api('candidate-prompt',target);
 assert.deepEqual(draft.target,target);assert(draft.system.length>100);assert(draft.user.length>100);assert(draft.fingerprint);JSON.parse(draft.user);
 result.checks.push('default-prompt-prepared-without-inference');
 const marker='QOE_PROMPT_EDIT_OK_20261113';
 const promptOverride={system:'당신은 프롬프트 전송 검증 보조자입니다. 사용자가 요청한 문구만 그대로 응답하세요. JSON이나 설명을 덧붙이지 마세요.',user:'사용자가 수정한 프롬프트 테스트입니다. 다음 문구만 정확히 답하세요: '+marker};
 let job=await api('jobs',{...target,rerun:true,promptOverride});result.jobId=job.id;save();
 const deadline=Date.now()+220000;
 while(['queued','collecting','analyzing'].includes(job.status)&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,1000));job=await api('jobs/'+job.id);}
 const diagnostics=await api('jobs/'+job.id+'/diagnostics');
 fs.writeFileSync(path.join(root,'outputs','candidate-prompt-live-diagnostics.json'),JSON.stringify(diagnostics,null,2));
 assert.equal(job.promptEdited,true);assert.equal(diagnostics.request.messages.length,2);
 assert.deepEqual(diagnostics.request.messages,[{role:'system',content:promptOverride.system},{role:'user',content:promptOverride.user}]);
 assert(diagnostics.response?.content?.includes(marker),'The real model must respond to the edited prompt');
 assert.equal(job.attempt?.attempt,1,'Prompt tests must not add a hidden correction request');
 assert.equal(job.status,'failed','Freeform test output must not become a validated analytical report');
 assert.equal(diagnostics.validation.status,'failed');
 const after=await api('candidate-history',target);assert.deepEqual(after.jobs.map(job=>job.id),before.jobs.map(job=>job.id));
 result.checks.push('edited-system-and-user-sent-exactly','actual-qwen-replied-to-user-marker','single-attempt-no-hidden-correction','freeform-response-preserved-with-validation-state','existing-analysis-history-preserved');
 result.response=diagnostics.response.content;result.validation=diagnostics.validation;result.promptHash=job.promptHash;result.status='passed';
 console.log('PROMPT_LIVE_QA_PASS',JSON.stringify({jobId:job.id,checks:result.checks,response:result.response}));
})().catch(error=>{result.status='failed';result.error=error.message;console.error('PROMPT_LIVE_QA_FAIL',error.message);process.exitCode=1;}).finally(async()=>{result.finishedAt=new Date().toISOString();save();await handler.close();await new Promise(resolve=>server.close(resolve));});
