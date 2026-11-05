/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Node scripts and the existing test harness require CommonJS imports. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load}=require('../analyst-ts-loader.cjs');
const {SharedRequestCache}=load('lib/analyst/request-cache.ts');
const deferred=()=>{
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
};

test('completed values use LRU eviction and expire at a fixed TTL',async()=>{
  let now=0,calls=0;
  const cache=new SharedRequestCache(2,10,()=>now);
  const read=key=>cache.get(key,async()=>({key,sequence:++calls}));
  const a=await read('a');
  await read('b');
  assert.equal(await read('a'),a);
  await read('c');
  assert.equal(await read('a'),a,'touching a keeps it ahead of b');
  await read('b');
  assert.equal(calls,4,'only the evicted key is fetched again');
  now=10;
  assert.notEqual(await read('a'),a,'cache access never extends freshness');
  assert.equal(calls,5);
});

test('failures are not cached and a pre-aborted caller never starts a loader',async()=>{
  const cache=new SharedRequestCache(2,100,()=>0);
  let calls=0;
  const read=signal=>cache.get('key',async()=>{calls++;if(calls===1)throw new Error('retry');return 4;},signal);
  await assert.rejects(read(),/retry/);
  assert.equal(await read(),4);
  const controller=new AbortController();
  controller.abort();
  await assert.rejects(read(controller.signal),{name:'AbortError'});
  assert.equal(calls,2);
});

test('all cancelled callers abort their shared work, and a fresh caller can retry immediately',async()=>{
  const cache=new SharedRequestCache(2,100,()=>0);
  const old=deferred();
  let upstreamSignal,calls=0;
  const loader=signal=>{calls++;upstreamSignal=signal;return old.promise;};
  const one=new AbortController(),two=new AbortController();
  const first=cache.get('key',loader,one.signal);
  const second=cache.get('key',loader,two.signal);
  await Promise.resolve();
  assert.equal(calls,1);
  one.abort();
  assert.equal(upstreamSignal.aborted,false);
  two.abort();
  assert.equal(upstreamSignal.aborted,true);
  await Promise.all([assert.rejects(first,{name:'AbortError'}),assert.rejects(second,{name:'AbortError'})]);
  assert.equal(await cache.get('key',async()=>7),7);
  // Even a loader that ignores cancellation cannot overwrite a newer value.
  old.resolve(99);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(await cache.get('key',async()=>8),7);
});

test('cache hits still respect an abort arriving before promise delivery',async()=>{
  const cache=new SharedRequestCache(1,100,()=>0);
  await cache.get('key',async()=>1);
  const controller=new AbortController();
  const pending=cache.get('key',async()=>2,controller.signal);
  controller.abort(new Error('caller left'));
  await assert.rejects(pending,/caller left/);
});
