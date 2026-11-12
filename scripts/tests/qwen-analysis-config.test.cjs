/* eslint-disable @typescript-eslint/no-require-imports -- The local Node preview and workers load this CommonJS module. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {loadQwenConfig,publicConfig}=require('../qwen-analysis-config.cjs');
const {analyzeWithQwen,checkConnection,validateReport}=require('../qwen-analysis-client.cjs');

function temp(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'qwen-config-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
async function server(t,handler){const s=http.createServer(handler);await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{s.closeAllConnections();s.close(resolve);}));return 'http://127.0.0.1:'+s.address().port+'/v1';}
const report={summary:'반복 저품질 관측은 확인되지만 원인은 추가 확인이 필요합니다.',hypotheses:[{title:'무선 품질 확인',assessment:'possible',reason:'제공 근거만으로 무선 원인을 확정할 수 없습니다.',evidenceIds:['E01']}],checks:[{action:'저품질 통화의 MDT와 RTP 확인',reason:'누락 근거를 확인합니다.',evidenceIds:['E01']}],limitations:['BYE 위치는 저하 순간 위치가 아닙니다.']};
const evidence={facts:[{id:'E01',title:'전체 범위 통계',detail:'평가 통화 10건, 저품질 2건'}],modelInput:{summary:{totalCalls:10,poorCalls:2},facts:[{id:'E01',detail:'평가 통화 10건, 저품질 2건'}]}};
function reply(res,status,body){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));}

test('env precedence and reload are server-only and preserve optional auth',t=>{
 const root=temp(t);
 fs.writeFileSync(path.join(root,'.env'),'QWEN_BASE_URL=http://127.0.0.1:8000/v1/\nQWEN_MODEL=file-model\nQWEN_API_KEY=private-token\nQWEN_TIMEOUT_MS=30000\n');
 fs.writeFileSync(path.join(root,'.env.local'),'QWEN_MODEL=local-model\n');
 const first=loadQwenConfig(root,{QWEN_MODEL:'process-model'});
 assert.equal(first.model,'process-model');assert.equal(first.baseUrl,'http://127.0.0.1:8000/v1');assert.equal(first.apiKey,'private-token');
 assert.deepEqual(publicConfig(first),{configured:true,model:'process-model',missing:[]});
 assert.ok(!JSON.stringify(publicConfig(first)).includes('private-token'));
 fs.writeFileSync(path.join(root,'.env.local'),'QWEN_MODEL=changed-model\n');
 assert.equal(loadQwenConfig(root,{}).model,'changed-model');
});
test('missing config is actionable and forbidden extras cannot replace prompt or destination',t=>{
 const root=temp(t);assert.deepEqual(publicConfig(loadQwenConfig(root,{})),{configured:false,model:'',missing:['QWEN_BASE_URL','QWEN_MODEL']});
 for(const value of ['{"messages":[]}','{"model":"injected"}','{"stream":true}','{"tools":[]}']){
  assert.throws(()=>loadQwenConfig(root,{QWEN_EXTRA_BODY_JSON:value}),e=>e.code==='QWEN_CONFIG_INVALID');
 }
 assert.throws(()=>loadQwenConfig(root,{QWEN_BASE_URL:'https://user:secret@host/v1'}),e=>e.code==='QWEN_CONFIG_INVALID'&&!e.message.includes('secret'));
 assert.throws(()=>loadQwenConfig(root,{QWEN_TIMEOUT_MS:'abc'}),e=>e.code==='QWEN_CONFIG_INVALID');
});
test('real OpenAI-compatible HTTP sends only sanitized evidence and returns validated final content',async t=>{
 let request;
 const baseUrl=await server(t,async(req,res)=>{let raw='';for await(const c of req)raw+=c;request={url:req.url,headers:req.headers,body:JSON.parse(raw)};reply(res,200,{choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(report),reasoning_content:'private chain'}}]});});
 const config=loadQwenConfig(temp(t),{QWEN_BASE_URL:baseUrl,QWEN_MODEL:'Qwen-test',QWEN_API_KEY:'test-secret',QWEN_EXTRA_BODY_JSON:'{"chat_template_kwargs":{"enable_thinking":false}}'});
 const result=await analyzeWithQwen(config,{...evidence,target:{customerId:'PRIVATE-CUSTOMER'},calls:[{id:'PRIVATE-CALL'}]},new AbortController().signal);
 assert.deepEqual(result,report);assert.equal(request.url,'/v1/chat/completions');assert.equal(request.headers.authorization,'Bearer test-secret');
 assert.equal(request.body.model,'Qwen-test');assert.equal(request.body.stream,false);assert.equal(request.body.max_tokens,4096);
 assert.deepEqual(request.body.chat_template_kwargs,{enable_thinking:false});assert.equal(request.body.response_format,undefined);
 const payload=JSON.stringify(request.body);assert.ok(!payload.includes('PRIVATE-CUSTOMER'));assert.ok(!payload.includes('PRIVATE-CALL'));assert.ok(!payload.includes('test-secret'));
});
test('unknown evidence references, invented quantities, empty reasoning-only and truncated responses fail explicitly',async t=>{
 const variants=[
  [{...report,hypotheses:[{...report.hypotheses[0],evidenceIds:['E999']}]},'stop','QWEN_INVALID_REPORT'],
  [{...report,summary:'저품질 999건이 관측됐습니다.'},'stop','QWEN_UNSUPPORTED_NUMBER'],
  [null,'stop','QWEN_EMPTY_RESPONSE'],
  [report,'length','QWEN_TRUNCATED_RESPONSE'],
  ['not-json','stop','QWEN_INVALID_JSON']
 ];
 for(const [value,finish,code] of variants){
  const baseUrl=await server(t,(_req,res)=>reply(res,200,{choices:[{finish_reason:finish,message:{content:value===null?null:typeof value==='string'?value:JSON.stringify(value),reasoning:'hidden reasoning'}}]}));
  const config=loadQwenConfig(temp(t),{QWEN_BASE_URL:baseUrl,QWEN_MODEL:'test'});
  await assert.rejects(()=>analyzeWithQwen(config,evidence,new AbortController().signal),e=>e.code===code);
 }
});
test('quantities attached to units, decimals, signs and exponents cannot bypass evidence validation',()=>{
 for(const reason of [
  '지터가 999ms로 관측됐습니다.',
  'RSRP는 -999dBm로 낮았습니다.',
  '오류율은 .999%입니다.',
  '지터가 9.99e2ms로 관측됐습니다.',
  '지터가 9.99E+2ms로 관측됐습니다.',
  'RSRP는 −9.99e2dBm로 낮았습니다.',
  '지터999ms로 관측됐습니다.',
  '지터가 ９９９ms로 관측됐습니다.'
 ]){
  const result={...report,hypotheses:[{...report.hypotheses[0],reason}]};
  assert.throws(()=>validateReport(result,evidence),error=>error.code==='QWEN_UNSUPPORTED_NUMBER',reason);
 }
});
test('equivalent evidence numbers keep their value across units and scientific notation',()=>{
 const supported={...evidence,modelInput:{...evidence.modelInput,metrics:{rsrp:-110.5,jitter:0.5,bytes:1024},facts:[{id:'E01',detail:'오류율 2e1%와 변동 2.5e-3ms가 관측됐습니다.'}]}};
 const result={...report,hypotheses:[{...report.hypotheses[0],reason:'RSRP −110.5dBm, 지터 .5ms, 수집량 1,024bytes, 오류율 20%, 변동 0.0025ms 근거를 확인합니다.'}]};
 assert.deepEqual(validateReport(result,supported),result);
});
test('binary minus keeps known operands positive in arithmetic and ranges',()=>{
 const supported={...evidence,modelInput:{...evidence.modelInput,summary:{totalCalls:818,evaluatedCalls:814,unevaluatedCalls:4},rates:[4.1,5.6]}};
 for(const summary of [
  '미평가 4건(818-814)의 미평가 사유 확인',
  '미평가 4건(818 -814)의 미평가 사유 확인',
  '미평가 4건(818 - 814)의 미평가 사유 확인',
  '미평가 4건(818\t-\t814)의 미평가 사유 확인',
  '미평가 4건(818−814)의 미평가 사유 확인',
  '셀별 비율 4.1-5.6%를 확인합니다.',
  '셀별 비율 4.1 −5.6%를 확인합니다.'
 ]){
  const result={...report,summary};
  assert.deepEqual(validateReport(result,supported),result,summary);
 }
});
test('unary negatives and exponent signs cannot borrow a positive evidence value',()=>{
 const supported={...evidence,modelInput:{...evidence.modelInput,metrics:{total:818,evaluated:814,small:0.001}}};
 for(const summary of [
  'RSRP -814dBm를 확인합니다.',
  'RSRP −814dBm를 확인합니다.',
  '음수 피연산자 818--814를 확인합니다.',
  '음수 피연산자 818 - -814를 확인합니다.',
  '818\n-814dBm를 확인합니다.',
  '818\r\n\t-814dBm를 확인합니다.',
  '818\u2028-814dBm를 확인합니다.',
  'RSRP -8.14e2dBm를 확인합니다.',
  '미확인 수치 818-999ms를 확인합니다.'
 ])assert.throws(()=>validateReport({...report,summary},supported),error=>error.code==='QWEN_UNSUPPORTED_NUMBER',summary);
 const scientific={...report,summary:'변동 1e-3ms를 확인합니다.'};
 assert.deepEqual(validateReport(scientific,supported),scientific);
});
test('ISO date separators expose date components without authorizing negative measurements',()=>{
 const supported={...evidence,modelInput:{...evidence.modelInput,scope:{dateStart:'2026-10-26',dateEnd:'2026-10-30'}}};
 for(const summary of ['2026-10-26~2026-10-30의 관측입니다.','2026년 10월 26일부터 30일까지의 관측입니다.']){
  const result={...report,summary};
  assert.deepEqual(validateReport(result,supported),result,summary);
 }
 assert.throws(()=>validateReport({...report,summary:'RSRP -26dBm를 확인합니다.'},supported),error=>error.code==='QWEN_UNSUPPORTED_NUMBER');
});
test('known evidence IDs and Cell aliases do not become numeric facts',()=>{
 const aliased={...evidence,modelInput:{...evidence.modelInput,byCell:[{cell:'대표 Cell 07',totalCalls:10,poorCalls:2}]}};
 const supported={...report,hypotheses:[{...report.hypotheses[0],reason:'E01에 연결된 대표 Cell 07의 관측 패턴을 확인합니다.'}]};
 assert.deepEqual(validateReport(supported,aliased),supported);
 const fabricated={...report,hypotheses:[{...report.hypotheses[0],reason:'저품질 7건이 관측됐습니다.'}]};
 assert.throws(()=>validateReport(fabricated,aliased),error=>error.code==='QWEN_UNSUPPORTED_NUMBER');
});
test('auth failures never expose upstream bodies and no auth key means no Authorization header',async t=>{
 let authorization;
 const baseUrl=await server(t,(req,res)=>{authorization=req.headers.authorization;reply(res,401,{error:{message:'private-upstream-address secret credential'}});});
 const config=loadQwenConfig(temp(t),{QWEN_BASE_URL:baseUrl,QWEN_MODEL:'test'});
 await assert.rejects(()=>analyzeWithQwen(config,evidence,new AbortController().signal),e=>e.code==='QWEN_AUTH_FAILED'&&!e.message.includes('private-upstream'));
 assert.equal(authorization,undefined);
});
test('configured model must exist in /models and connection errors are distinct',async t=>{
 const baseUrl=await server(t,(_req,res)=>reply(res,200,{data:[{id:'served-model'}]}));
 const config=loadQwenConfig(temp(t),{QWEN_BASE_URL:baseUrl,QWEN_MODEL:'wrong-model'});
 await assert.rejects(()=>checkConnection(config,new AbortController().signal),e=>e.code==='QWEN_MODEL_NOT_FOUND');
 assert.equal((await checkConnection({...config,model:'served-model'},new AbortController().signal)).ok,true);
});
test('timeout and explicit cancel abort pending HTTP without a successful report',async t=>{
 const baseUrl=await server(t,(_req,_res)=>{});
 const config={...loadQwenConfig(temp(t),{QWEN_BASE_URL:baseUrl,QWEN_MODEL:'test'}),timeoutMs:30};
 await assert.rejects(()=>analyzeWithQwen(config,evidence,new AbortController().signal),e=>e.code==='QWEN_TIMEOUT');
 const controller=new AbortController();const pending=analyzeWithQwen({...config,timeoutMs:30000},evidence,controller.signal);controller.abort();
 await assert.rejects(()=>pending,e=>e.code==='ANALYSIS_CANCELLED');
});
