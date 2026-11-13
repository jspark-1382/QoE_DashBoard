/* eslint-disable @typescript-eslint/no-require-imports -- The local Node test runner loads CommonJS. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
function load(){
 const filename=path.resolve(__dirname,'../../lib/analyst/customer-ai-analysis.ts');
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};
 vm.runInNewContext(code,{exports,AbortController,fetch,Headers,Response,setTimeout,clearTimeout,structuredClone,URL,console});
 return exports;
}
const target=id=>({kind:'customer',customerId:id,sourceRevision:'revision-1',scope:{dateStart:'2026-10-26',dateEnd:'2026-10-30',from:'00:00',to:'23:59'}});
const job=(id,t,status='queued')=>({id,target:t,status,createdAt:'2026-11-12T00:00:00Z',updatedAt:'2026-11-12T00:00:00Z',model:'test-qwen'});
const reply=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
test('changing customer while POST is pending never displays the old result and cancels its orphan job',async()=>{
 const {createAnalysisSession}=load(),seen=[],deleted=[];let releaseFirst;
 const session=createAnalysisSession({onJob:j=>seen.push(j),onError:e=>{throw e;},fetcher:async(url,init)=>{
  if(init?.method==='DELETE'){deleted.push(url);return reply(job('old',target('a'),'cancelled'));}
  const t=JSON.parse(init.body);
  if(t.customerId==='a')return new Promise(resolve=>{releaseFirst=()=>resolve(reply(job('old',t)));});
  return reply(job('new',t,'completed'));
 }});
 const first=session.start(target('a'));
 await session.start(target('b'));
 releaseFirst();await first;
 assert.deepEqual(seen.map(j=>j.id),['new']);
 assert.equal(deleted.length,1);assert.match(deleted[0],/\/old$/);
 session.dispose();
});
test('cancel during job creation also cancels a late accepted job without showing it',async()=>{
 const {createAnalysisSession}=load(),seen=[],deleted=[];let release;
 const session=createAnalysisSession({onJob:j=>seen.push(j),onError:e=>{throw e;},fetcher:async(url,init)=>{
  if(init?.method==='DELETE'){deleted.push(url);return reply(job('late',target('a'),'cancelled'));}
  return new Promise(resolve=>{release=()=>resolve(reply(job('late',target('a'))));});
 }});
 const pending=session.start(target('a'));await session.cancel();release();await pending;
 assert.equal(seen.length,0);assert.equal(deleted.length,1);session.dispose();
});
test('polling rejects a response belonging to another customer instead of reusing its report',async()=>{
 const {createAnalysisSession}=load(),seen=[];let finish;
 const failed=new Promise(resolve=>{finish=resolve;});
 const session=createAnalysisSession({pollMs:1,onJob:j=>seen.push(j),onError:e=>finish(e),fetcher:async(url,init)=>{
  if(init?.method==='POST')return reply(job('active',target('a'),'analyzing'));
  if(init?.method==='DELETE')return reply(job('active',target('a'),'cancelled'));
  return reply(job('active',target('b'),'completed'));
 }});
 await session.start(target('a'));
 const error=await failed;
 assert.equal(error.code,'TARGET_MISMATCH');assert.equal(seen.length,1);session.dispose();
});
test('a completed poll keeps the original scope even when the caller mutates its input',async()=>{
 const {createAnalysisSession}=load(),t=target('a'),seen=[];let finish;
 const done=new Promise(resolve=>{finish=resolve;});
 const session=createAnalysisSession({pollMs:1,onJob:j=>{seen.push(j);if(j.status==='completed')finish();},onError:e=>{throw e;},fetcher:async(url,init)=>{
  if(init?.method==='POST')return reply(job('active',JSON.parse(init.body),'collecting'));
  return reply(job('active',target('a'),'completed'));
 }});
 const started=session.start(t);t.scope.dateEnd='2026-11-01';await started;await done;
 assert.equal(seen.at(-1).target.scope.dateEnd,'2026-10-30');assert.equal(seen.length,2);session.dispose();
});
test('API errors are reported as failures and never become an empty success report',async()=>{
 const {createAnalysisSession}=load(),seen=[],errors=[],pending=[];
 const session=createAnalysisSession({onJob:j=>seen.push(j),onError:e=>errors.push(e),onPending:v=>pending.push(v),fetcher:async()=>new Response(JSON.stringify({error:'Qwen 설정이 필요합니다.',code:'NOT_CONFIGURED'}),{status:503})});
 await session.start(target('a'));
 assert.equal(errors[0].code,'NOT_CONFIGURED');assert.equal(seen.length,0);assert.equal(pending.at(-1),false);session.dispose();
});
