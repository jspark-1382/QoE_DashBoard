const {test,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {createQueryLane}=require('../voice-query-lane.cjs');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
fs.mkdirSync('outputs/query-lane-tests',{recursive:true});
const fixture=fs.mkdtempSync(path.resolve('outputs/query-lane-tests/fixture-'));
const workerPath=path.join(fixture,'worker.cjs');
fs.writeFileSync(workerPath,`const {parentPort,workerData}=require('node:worker_threads');const fs=require('node:fs');
parentPort.on('message',({id,query})=>{fs.appendFileSync(workerData.log,query.marker+'\\n');
if(query.delay)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,query.delay);
parentPort.postMessage({id,result:JSON.stringify({sourceRevision:'fixture',marker:query.marker})});});
parentPort.postMessage({ready:true});`);
let sequence=0;const lanes=[];
function lane(){const log=path.join(fixture,'log-'+(++sequence));const value=createQueryLane({workerPath,workerData:{log}});lanes.push(value);return {value,log};}
after(async()=>{await Promise.all(lanes.map(value=>value.close()));fs.rmSync(fixture,{recursive:true,force:true});});
test('cancelled waiting queries never execute, while the active original query completes',async()=>{
  const {value,log}=lane();await value.ready;
  const active=value.run({marker:'active',delay:120});
  const controller=new AbortController();
  const canceled=value.run({marker:'discarded',delay:120},controller.signal);
  const rejection=assert.rejects(canceled,error=>error.status===499);
  await wait(10);controller.abort();await rejection;
  const next=value.run({marker:'next'});await Promise.all([active,next]);
  assert.deepEqual(fs.readFileSync(log,'utf8').trim().split('\n'),['active','next']);
});
test('independent lanes keep interactive work responsive during a heavy map query',async()=>{
  const heavy=lane(),interactive=lane();await Promise.all([heavy.value.ready,interactive.value.ready]);
  let finished=false;const active=heavy.value.run({marker:'map',delay:500}).then(()=>{finished=true;});
  const result=JSON.parse(await interactive.value.run({marker:'meta'}));
  assert.equal(result.marker,'meta');assert.equal(finished,false);await active;
});
test('aborting active work releases the caller immediately and keeps the worker reusable',async()=>{
  const {value}=lane();await value.ready;const controller=new AbortController();
  const query=value.run({marker:'active',delay:100},controller.signal);
  const rejection=assert.rejects(query,error=>error.status===499);await wait(10);controller.abort();await rejection;
  assert.equal(JSON.parse(await value.run({marker:'still-alive'})).marker,'still-alive');
});
test('closing a lane rejects every queued request without leaving promises pending',async()=>{
  const {value}=lane();await value.ready;
  const one=value.run({marker:'one',delay:300}),two=value.run({marker:'two'});
  const checks=[assert.rejects(one,error=>error.status===503),assert.rejects(two,error=>error.status===503)];
  await wait(10);await value.close();await Promise.all(checks);
});
