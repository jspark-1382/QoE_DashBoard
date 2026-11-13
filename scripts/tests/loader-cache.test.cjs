/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Node scripts and the existing test harness require CommonJS imports. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load}=require('../analyst-ts-loader.cjs');
const {loadDataset,loadOverview,loadDay}=load('lib/analyst/data-loader.ts');

const dataset=(revision)=>({meta:{dates:['2026-10-30'],poorQoeThreshold:3,partitioned:true,revision},customers:[],days:[]});
const summary=(revision)=>({schemaVersion:'analyst-overview-v1',analyticsVersion:'overview-analytics-v1',source:'MDT',date:'2026-10-30',sourceRevision:revision,gridSizeM:60,calls:[],cells:[]});
const withFetch=async(implementation,run)=>{
  const original=global.fetch;
  global.fetch=implementation;
  try{return await run();}finally{global.fetch=original;}
};

test('already-derived large overviews retain source objects instead of duplicating every call',async()=>{
  const value={...summary('already-derived'),calls:[Object.freeze({id:'a',mos:4,qoe:4,sipCause:'A: Normal'})]};
  const source={...dataset('already-derived'),meta:{...dataset('already-derived').meta,qoeBasis:'rtcp-mos-v5'}};
  await withFetch(async()=>({ok:true,json:async()=>value}),async()=>{
    const actual=await loadOverview(source,'MDT','2026-10-30');
    assert.equal(actual,value);
    assert.equal(actual.calls,value.calls);
  });
});

test('an obsolete score copies only its own call and leaves original data untouched',async()=>{
  const good=Object.freeze({id:'a',mos:4,qoe:4,sipCause:'A: Normal'});
  const drop=Object.freeze({id:'b',mos:4,qoe:4,sipCause:'H: Drop'});
  const value={...summary('sparse-score-update'),calls:Object.freeze([good,drop])};
  const source={...dataset('sparse-score-update'),meta:{...dataset('sparse-score-update').meta,qoeBasis:'rtcp-mos-v5'}};
  await withFetch(async()=>({ok:true,json:async()=>value}),async()=>{
    const actual=await loadOverview(source,'MDT','2026-10-30');
    assert.equal(actual.calls[0],good);
    assert.notEqual(actual.calls[1],drop);
    assert.equal(actual.calls[1].qoe,1.5);
    assert.equal(drop.qoe,4);
  });
});

test('a repeated manifest read parses one response and keeps HTTP revalidation',async()=>{
  let requests=0,parses=0;
  const value=dataset('loader-cache-manifest');
  await withFetch(async(_url,options)=>{
    requests++;
    assert.equal(options.cache,'no-cache');
    return {ok:true,json:async()=>{parses++;return value;}};
  },async()=>{
    assert.equal(await loadDataset('MDT'),value);
    assert.equal(await loadDataset('MDT'),value);
  });
  assert.equal(requests,1);
  assert.equal(parses,1);
});

test('malformed manifests are rejected and retried instead of being cached',async()=>{
  let requests=0;
  const value=dataset('loader-cache-measured');
  await withFetch(async()=>{
    requests++;
    return {ok:true,json:async()=>requests===1?{}:value};
  },async()=>{
    await assert.rejects(loadDataset('실측'),/형식/);
    assert.equal(await loadDataset('실측'),value);
    assert.equal(await loadDataset('실측'),value);
  });
  assert.equal(requests,2);
});

test('validated overview cache reuses a revision but never crosses source revisions',async()=>{
  let requests=0;
  let revision='loader-cache-r1';
  await withFetch(async()=>{requests++;return {ok:true,json:async()=>summary(revision)};},async()=>{
    const one=await loadOverview(dataset('loader-cache-r1'),'MDT','2026-10-30');
    assert.equal(await loadOverview(dataset('loader-cache-r1'),'MDT','2026-10-30'),one);
    revision='loader-cache-r2';
    const two=await loadOverview(dataset('loader-cache-r2'),'MDT','2026-10-30');
    assert.notEqual(two,one);
    assert.equal(two.sourceRevision,'loader-cache-r2');
  });
  assert.equal(requests,2);
});

test('invalid overview responses are never saved as a successful cache entry',async()=>{
  let requests=0;
  const ds=dataset('loader-cache-invalid');
  await withFetch(async()=>{
    requests++;
    return {ok:true,json:async()=>summary(requests===1?'wrong-revision':ds.meta.revision)};
  },async()=>{
    await assert.rejects(loadOverview(ds,'MDT','2026-10-30'),/버전/);
    const good=await loadOverview(ds,'MDT','2026-10-30');
    assert.equal(await loadOverview(ds,'MDT','2026-10-30'),good);
  });
  assert.equal(requests,2);
});

test('revisiting the full five-day range reuses all five validated partitions',async()=>{
  let requests=0;
  const ds=dataset('loader-cache-five-days');
  const dates=['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30'];
  await withFetch(async url=>{
    requests++;
    const date=url.match(/(\d{4}-\d{2}-\d{2})\.json$/)[1];
    return {ok:true,json:async()=>({...summary(ds.meta.revision),date})};
  },async()=>{
    const first=await Promise.all(dates.map(date=>loadOverview(ds,'MDT',date)));
    const second=await Promise.all(dates.map(date=>loadOverview(ds,'MDT',date)));
    assert(first.every((entry,index)=>entry===second[index]));
  });
  assert.equal(requests,5);
});

test('partition detail is fetched and normalized once per dataset identity',async()=>{
  let requests=0;
  const ds=dataset('loader-cache-detail');
  const entry={key:'a:2026-10-30',customerId:'a',date:'2026-10-30',sampleCount:0,samples:[],dataPath:'cache-detail.json'};
  const detail={...entry,calls:[{id:'call',start:'10:00:00',end:'10:00:01',qoe:4}]};
  await withFetch(async()=>{requests++;return {ok:true,json:async()=>detail};},async()=>{
    const one=await loadDay(ds,entry,'MDT');
    assert.equal(await loadDay(ds,entry,'MDT'),one);
    const otherDataset={...ds,customers:[{id:'a',sourceContractId:'000123',dates:['2026-10-30']}]};
    const other=await loadDay(otherDataset,entry,'MDT');
    assert.notEqual(other,one);
    assert.equal(other.contractId,'000123');
  });
  assert.equal(requests,2);
});

test('wrong customer detail never enters the normalized result cache',async()=>{
  let requests=0;
  const ds=dataset('loader-cache-wrong-customer');
  const entry={key:'a:2026-10-30',customerId:'a',date:'2026-10-30',sampleCount:0,samples:[],dataPath:'retry-detail.json'};
  await withFetch(async()=>{
    requests++;
    return {ok:true,json:async()=>({...entry,customerId:requests===1?'wrong':'a'})};
  },async()=>{
    await assert.rejects(loadDay(ds,entry,'MDT'),/일치/);
    const valid=await loadDay(ds,entry,'MDT');
    assert.equal(await loadDay(ds,entry,'MDT'),valid);
  });
  assert.equal(requests,2);
});

test('one aborted consumer does not cancel a shared overview needed by another',async()=>{
  let requests=0,complete;
  const ds=dataset('loader-cache-abort');
  await withFetch((_url,{signal})=>{
    requests++;
    return new Promise((resolve,reject)=>{
      signal?.addEventListener('abort',()=>reject(signal.reason),{once:true});
      complete=()=>resolve({ok:true,json:async()=>summary(ds.meta.revision)});
    });
  },async()=>{
    const firstController=new AbortController();
    const first=loadOverview(ds,'MDT','2026-10-30',firstController.signal);
    const second=loadOverview(ds,'MDT','2026-10-30');
    firstController.abort();
    await assert.rejects(first,{name:'AbortError'});
    complete();
    assert.equal((await second).sourceRevision,ds.meta.revision);
  });
  assert.equal(requests,1);
});
