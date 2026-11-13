/* eslint-disable @typescript-eslint/no-require-imports -- Native Node server-only regression fixtures. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {captureRequest,captureResponse,diagnosticsSnapshot,redactSnapshot}=require('../qwen-candidate-diagnostics.cjs');
test('request snapshots are immutable copies and redact nested secrets without changing outbound request',()=>{
 const body={model:'m',messages:[{role:'system',content:'actual system'},{role:'user',content:'data'}],chat_template_kwargs:{enable_thinking:false},metadata:{api_key:'other-secret',authorization:'Bearer other-token'},max_tokens:500};
 const request=captureRequest(body,{apiKey:'PRIVATE-KEY'});assert.equal(request.redacted,true);assert.equal(request.parameters.metadata.api_key,'[REDACTED]');assert.equal(body.metadata.api_key,'other-secret');body.messages[0].content='changed';assert.equal(request.messages[0].content,'actual system');assert(Object.isFrozen(request.messages[0]));assert.match(request.hash,/^[a-f0-9]{64}$/);
});
test('failed final JSON and invalid outer envelope stay inspectable, with response secret masking',()=>{
 const raw=JSON.stringify({model:'m',choices:[{finish_reason:'stop',message:{content:'INVALID PRIVATE-KEY'}}],usage:{total_tokens:20}});
 const snapshot=captureResponse(raw,{apiKey:'PRIVATE-KEY'});assert.equal(snapshot.content,'INVALID [REDACTED]');assert.equal(snapshot.redacted,true);assert.deepEqual(snapshot.usage,{total_tokens:20});
 assert.equal(captureResponse('BROKEN OUTER',{apiKey:'key'}).content,'BROKEN OUTER');assert.equal(diagnosticsSnapshot({}).status,'unavailable');
});
test('bearer strings and oversized content are marked redacted; no reconstructed old snapshot',()=>{
 const r=redactSnapshot({content:'Bearer hidden-token'});assert(!r.value.content.includes('hidden-token'));assert.equal(r.redacted,true);
 const big=captureResponse('x'.repeat(2100000),{});assert(big.content.length<2100000);assert(big.redacted);
 const old=diagnosticsSnapshot({evidence:{transmission:[]},reused:true});assert.equal(old.status,'unavailable');assert.equal(old.request,undefined);assert.equal(old.reused,true);
});
test('live request and response snapshots mask the configured private service address',()=>{
 const config={apiKey:'PRIVATE-KEY',baseUrl:'http://private-service:8123/v1'};
 const request=captureRequest({model:'m',messages:[{role:'user',content:'echo '+config.baseUrl}]},config);
 const response=captureResponse(JSON.stringify({error:{message:'Unavailable '+config.baseUrl}}),config);
 assert(!JSON.stringify(request).includes(config.baseUrl));assert(!JSON.stringify(response).includes(config.baseUrl));assert.equal(request.redacted,true);assert.equal(response.redacted,true);
});
