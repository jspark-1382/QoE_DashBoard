/* eslint-disable @typescript-eslint/no-require-imports -- The local Node preview and workers load this CommonJS module. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {createQwenAnalysisHandler}=require('../qwen-analysis-api.cjs');
const target={kind:'customer',customerId:'customer-a',scope:{dateStart:'2026-10-26',dateEnd:'2026-10-30',from:'00:00',to:'23:59'},sourceRevision:'fixture-v1'};
const report={summary:'관측 패턴의 추가 검증이 필요합니다.',hypotheses:[{title:'품질 저하 반복',assessment:'supported',reason:'기간 중 저품질이 관측됐습니다.',evidenceIds:['E01']}],checks:[{action:'통화 상세 확인',reason:'무선과 RTP 근거를 비교합니다.',evidenceIds:['E01']}],limitations:['BYE 위치만으로 저하 위치를 특정할 수 없습니다.']};
function evidence(input){return {schemaVersion:'qwen-evidence-v1',sourceRevision:'fixture-v1',target:input,generatedAt:new Date().toISOString(),summary:{totalCalls:10,evaluatedCalls:8,poorCalls:2,poorRate:25,rawMosEvaluatedCalls:8,rawMosPoorCalls:1,meanMos:4,meanQoe:3.8,dropCalls:1,observedDays:2,poorDays:1},byDay:[],byCell:[],facts:[{id:'E01',title:'전체 통계',detail:'평가 8건, 저품질 2건',severity:'attention'}],calls:[],coverage:{locationCalls:5,radioCalls:0,rtpCalls:0,sampledCalls:0,fullPopulation:true,detailsPolicy:'미확인'},limitations:['무선 근거 누락'],modelInput:{summary:{totalCalls:10,evaluatedCalls:8,poorCalls:2},facts:[{id:'E01',detail:'평가 8건, 저품질 2건'}]}};}
async function listen(t,handler){const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));return 'http://127.0.0.1:'+server.address().port;}
async function setup(t,options={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qwen-api-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'public'),{recursive:true});fs.mkdirSync(path.join(root,'outputs','voice-query-data'),{recursive:true});
 const database=path.join(root,'outputs','voice-query-data','fixture.sqlite');
 if(options.realWorker){
  const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(database);
  db.exec("CREATE TABLE meta(key TEXT PRIMARY KEY,json TEXT); CREATE TABLE calls(id TEXT PRIMARY KEY,raw_id TEXT,customer_id TEXT,date TEXT,start_second REAL,mos REAL,qoe REAL,is_drop INTEGER,cell TEXT,area TEXT,end_second REAL,json TEXT); CREATE TABLE locations(call_id TEXT,kind TEXT,evidence TEXT,PRIMARY KEY(call_id,kind)); CREATE TABLE days(customer_id TEXT,date TEXT,json TEXT,PRIMARY KEY(customer_id,date));");
  db.prepare('INSERT INTO meta VALUES (?,?)').run('dataset',JSON.stringify({revision:'fixture-v1',qoeBasis:'rtcp-mos-v5'}));
  const insert=db.prepare('INSERT INTO calls VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  insert.run('customer-a:poor','poor','customer-a','2026-10-26',0,2,2,0,'CELL-X','area',10,'{}');
  insert.run('customer-a:missing-drop','missing-drop','customer-a','2026-10-26',86399.5,null,null,1,'CELL-X','area',86400,'{}');
  insert.run('other:poor','poor','other','2026-10-26',0,1,1,0,'CELL-X','area',10,'{}');
  db.close();
 }else fs.writeFileSync(database,'fixture');
 fs.writeFileSync(path.join(root,'public','voice-query-index.json'),JSON.stringify({schemaVersion:'voice-query-index-v1',databaseSchema:'voice-query-db-v1',sourceRevision:'fixture-v1',database:'outputs/voice-query-data/fixture.sqlite'}));
 fs.writeFileSync(path.join(root,'public','voice-1030.json'),JSON.stringify({meta:{revision:'fixture-v1'}}));
 let received=0;
 const upstream=await listen(t,async(req,res)=>{received++;if(options.wait)return;let body='';for await(const chunk of req)body+=chunk;if(options.inspect)options.inspect(JSON.parse(body));res.writeHead(options.status??200,{'Content-Type':'application/json'});res.end(JSON.stringify(options.response??{choices:[{finish_reason:'stop',message:{content:JSON.stringify(report)}}]}));});
 if(!options.unconfigured)fs.writeFileSync(path.join(root,'.env'),'QWEN_BASE_URL='+upstream+'/v1\nQWEN_MODEL=test-model\nQWEN_API_KEY=do-not-leak\n');
 const handler=createQwenAnalysisHandler({root,env:{},collectEvidence:options.realWorker?undefined:(options.collectEvidence??(async({target:input})=>evidence(input))),maxRunning:options.maxRunning??2,maxQueued:options.maxQueued??4});
 t.after(()=>handler.close());
 const base=await listen(t,(req,res)=>{void handler(req,res).then(handled=>{if(!handled){res.writeHead(404);res.end();}});});
 async function request(route,method='GET',body){const options={method,headers:{'Content-Type':'application/json'}};if(body!==undefined&&method!=='GET'&&method!=='HEAD')options.body=JSON.stringify(body);const response=await fetch(base+'/qoe/api/analysis/'+route,options);return {status:response.status,body:await response.json()};}
 return {root,request,base,received:()=>received};
}
async function waitFor(api,id,desired){for(let i=0;i<100;i++){const result=await api.request('jobs/'+id);if(desired.includes(result.body.status))return result.body;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('job did not settle');}

test('jobs return quickly, pin target and expose verified report without model payload or credentials',async t=>{
 const api=await setup(t,{inspect:body=>{assert.equal(body.model,'test-model');assert.ok(!JSON.stringify(body).includes('customer-a'));assert.ok(!JSON.stringify(body).includes('do-not-leak'));}});
 const config=await api.request('config');assert.deepEqual(config.body,{configured:true,model:'test-model',missing:[]});
 const started=await api.request('jobs','POST',target);assert.equal(started.status,202);assert.deepEqual(started.body.target,target);
 const job=await waitFor(api,started.body.id,['completed','failed']);assert.equal(job.status,'completed');assert.deepEqual(job.report,report);assert.deepEqual(job.target,target);
 assert.ok(job.evidence.summary.totalCalls===10);assert.equal(job.evidence.modelInput,undefined);assert.ok(!JSON.stringify(job).includes('do-not-leak'));assert.equal(api.received(),1);
});
test('unconfigured and stale source reject before contacting model',async t=>{
 const missing=await setup(t,{unconfigured:true});const m=await missing.request('jobs','POST',target);assert.equal(m.status,503);assert.equal(m.body.code,'QWEN_NOT_CONFIGURED');assert.equal(missing.received(),0);
 const stale=await setup(t);const s=await stale.request('jobs','POST',{...target,sourceRevision:'old'});assert.equal(s.status,409);assert.equal(s.body.code,'STALE_REVISION');assert.equal(stale.received(),0);
});
test('queued/running cancellation stays cancelled and shutdown does not publish late results',async t=>{
 let finish;const api=await setup(t,{maxRunning:1,collectEvidence:()=>new Promise(resolve=>{finish=()=>resolve(evidence(target));})});
 const first=await api.request('jobs','POST',target);await waitFor(api,first.body.id,['collecting']);
 const second=await api.request('jobs','POST',target);assert.equal(second.body.status,'queued');
 const stopped=await api.request('jobs/'+second.body.id,'DELETE');assert.equal(stopped.body.status,'cancelled');
 const running=await api.request('jobs/'+first.body.id,'DELETE');assert.equal(running.body.status,'cancelled');finish();
 const again=await waitFor(api,first.body.id,['cancelled']);assert.equal(again.status,'cancelled');assert.equal(api.received(),0);
});
test('model failure retains deterministic evidence but cannot become completed',async t=>{
 const api=await setup(t,{status:401,response:{error:'credential diagnostic should be hidden'}});const started=await api.request('jobs','POST',target);
 const job=await waitFor(api,started.body.id,['failed','completed']);assert.equal(job.status,'failed');assert.equal(job.error.code,'QWEN_AUTH_FAILED');assert.equal(job.evidence.summary.poorCalls,2);assert.equal(job.report,undefined);assert.ok(!JSON.stringify(job).includes('credential diagnostic'));
});
test('cross-origin, malformed target, oversized input and unknown job are rejected',async t=>{
 const api=await setup(t);
 const forbidden=await fetch(api.base+'/qoe/api/analysis/jobs',{method:'POST',headers:{Origin:'https://unrelated.example','Content-Type':'application/json'},body:JSON.stringify(target)});assert.equal(forbidden.status,403);
 assert.equal((await api.request('jobs','POST',{...target,customerId:''})).status,400);
 assert.equal((await api.request('jobs','POST',{...target,padding:'x'.repeat(17000)})).status,413);
 assert.equal((await api.request('jobs/00000000-0000-4000-8000-000000000000')).status,404);
 assert.equal(api.received(),0);
});
test('production worker reads entire scoped SQLite population without modifying database or sending identity',async t=>{
 const {createHash}=require('node:crypto');
 const api=await setup(t,{realWorker:true,inspect:body=>{const prompt=JSON.parse(body.messages[1].content);assert.equal(prompt.summary.totalCalls,2);assert.equal(prompt.summary.dropCalls,1);assert.equal(prompt.summary.evaluatedCalls,1);assert.equal(prompt.summary.poorCalls,1);assert.ok(!JSON.stringify(body).includes('customer-a'));}});
 const file=path.join(api.root,'outputs','voice-query-data','fixture.sqlite'),digest=()=>createHash('sha256').update(fs.readFileSync(file)).digest('hex'),before=digest();
 const started=await api.request('jobs','POST',target),job=await waitFor(api,started.body.id,['completed','failed']);
 assert.equal(job.status,'completed');assert.equal(job.evidence.summary.totalCalls,2);assert.equal(job.evidence.summary.dropCalls,1);assert.equal(job.evidence.calls.length,2);assert.equal(job.evidence.modelInput,undefined);assert.equal(digest(),before);
});

test('queue capacity rejects excess work without starting upstream requests',async t=>{
 const api=await setup(t,{maxRunning:1,maxQueued:1,collectEvidence:({signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});})});
 const first=await api.request('jobs','POST',target);assert.equal(first.status,202);await waitFor(api,first.body.id,['collecting']);
 assert.equal((await api.request('jobs','POST',target)).status,202);
 const over=await api.request('jobs','POST',target);assert.equal(over.status,429);assert.equal(over.body.code,'ANALYSIS_QUEUE_FULL');
});
