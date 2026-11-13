const {test}=require('node:test'),assert=require('node:assert/strict');
const {load}=require('../analyst-ts-loader.cjs');
test('summary client uses only the query API, with scope and revision pinned',async()=>{
 const {voiceQuery}=load('lib/analyst/server-query.ts');
 const before=global.fetch;let request;
 global.fetch=async(url,options)=>{request={url,options};return {ok:true,json:async()=>({sourceRevision:'rev',grades:{evaluated:100}})};};
 try{
  const value=await voiceQuery('summary',{sourceRevision:'rev',scope:{dateStart:'2026-10-26',dateEnd:'2026-10-30',from:'00:00',to:'23:59'}});
  assert.equal(request.url,'/qoe/api/voice/query');assert.equal(request.options.method,'POST');
  assert.equal(JSON.parse(request.options.body).op,'summary');assert.equal(value.grades.evaluated,100);
 }finally{global.fetch=before;}
});
test('query revision mismatch rejects rather than using stale or bulk data',async()=>{
 const {voiceQuery}=load('lib/analyst/server-query.ts');let requests=0;const before=global.fetch;
 global.fetch=async()=>{requests++;return {ok:true,json:async()=>({sourceRevision:'other'})}};
 try{await assert.rejects(voiceQuery('summary',{sourceRevision:'rev'}),/자료|버전/);assert.equal(requests,1);}
 finally{global.fetch=before;}
});
test('query API error remains visible without fallback to the global manifest',async()=>{
 const {voiceQuery}=load('lib/analyst/server-query.ts');const before=global.fetch;const urls=[];
 global.fetch=async url=>{urls.push(url);return {ok:false,status:503,json:async()=>({error:'집계 자료 준비 중'})}};
 try{await assert.rejects(voiceQuery('summary',{}),/집계 자료 준비 중/);assert.deepEqual(urls,['/qoe/api/voice/query']);}
 finally{global.fetch=before;}
});
test('optional station geometry uses its own scoped request and reuses loaded results',async()=>{
 const {loadVoiceMapStations}=load('lib/analyst/server-query.ts');const before=global.fetch,requests=[];
 global.fetch=async(url,options)=>{requests.push({url,query:JSON.parse(options.body)});return {ok:true,json:async()=>({sourceRevision:'station-rev',stations:[],locations:[],stationCount:0})};};
 const args={sourceRevision:'station-rev',scope:{dateStart:'2026-10-26',dateEnd:'2026-10-30',from:'00:00',to:'23:59'}};
 try{
  assert.equal(requests.length,0,'importing a station loader must not start a request');
  await loadVoiceMapStations(args);await loadVoiceMapStations(args);
  assert.equal(requests.length,1);assert.equal(requests[0].query.op,'map-stations');
  assert.deepEqual(requests[0].query.scope,args.scope);
  await loadVoiceMapStations({...args,scope:{...args.scope,evidence:'gnss'}});
  assert.equal(requests.length,2,'a different location filter must not reuse previous stations');
 }finally{global.fetch=before;}
});
