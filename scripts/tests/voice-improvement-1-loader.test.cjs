/* eslint-disable @typescript-eslint/no-require-imports -- Node test harness uses shared TypeScript loader. */
const test=require('node:test'),assert=require('node:assert/strict');const {load}=require('../analyst-ts-loader.cjs');
const {loadImprovementReport,loadImprovementIndex}=load('lib/analyst/voice-improvement-1/loader.ts');
const {validateVoiceImprovementReport}=load('lib/analyst/voice-improvement-1/validation.ts');
const {buildCoverage}=load('lib/analyst/voice-improvement-1/coverage.ts');const {DEFAULT_CANDIDATE_POLICY:policy,canonicalScopeJson}=load('lib/analyst/voice-improvement-1/scope.ts');
const scope={source:'MDT',sourceRevision:'rev',dateStart:'2026-10-26',dateEnd:'2026-10-26',from:'00:00',to:'23:59',metric:'mos',mode:'screening'};
const hash='a'.repeat(64),key='b'.repeat(20);
const report=()=>({schemaVersion:'voice-improvement-1-v1',sourceRevision:'rev',scope,policy,scopeKey:key,inputHash:hash,inventoryHash:hash,inputFiles:[{file:'manifest.json',sha256:hash}],availableDates:[scope.dateStart],discoveryDates:[scope.dateStart],validationDates:[],calls:[],decisions:[],coverage:buildCoverage([],[]),baselineSpatialCandidates:[],improvedSpatialCandidates:[],diagnostics:{},publicationReference:null});
const index=()=>({schemaVersion:'voice-improvement-1-index-v1',sourceRevision:'rev',availableDates:[scope.dateStart],entries:[{scopeKey:key,scope,policy,path:'rev/'+key+'/report.json',inputHash:hash,inventoryHash:hash,canonicalScope:canonicalScopeJson(scope,policy)}]});
function mockFetch(overrides={}){global.fetch=async(url,options)=>{if(options?.signal?.aborted)throw options.signal.reason;const body=String(url).endsWith('voice-1030.json')?{meta:{revision:'rev',dates:[scope.dateStart]}}:String(url).endsWith('index.json')?index():report();const value=overrides[String(url).split('/').at(-1)]??body;return {ok:true,status:200,json:async()=>value};};}
test('exact zero-result report loads; absent scope never falls back to another period',async()=>{
 mockFetch();assert.equal((await loadImprovementReport({...scope,hour:10,customerId:'a'},policy)).coverage.N,0);
 await assert.rejects(()=>loadImprovementReport({...scope,dateEnd:'2026-10-27'},policy),e=>['not-generated','missing-date'].includes(e.code));
});
test('load checks live manifest revision, report schema, scope, hashes and cancellation',async()=>{
 mockFetch({'voice-1030.json':{meta:{revision:'old',dates:[scope.dateStart]}}});await assert.rejects(()=>loadImprovementIndex(),e=>e.code==='revision-mismatch');
 for(const patch of [{schemaVersion:'old'},{scope:{...scope,from:'10:00'}},{inputHash:'c'.repeat(64)},{availableDates:[]}]){mockFetch({'report.json':{...report(),...patch}});await assert.rejects(()=>loadImprovementReport(scope,policy));}
 const c=new AbortController();mockFetch();c.abort();await assert.rejects(()=>loadImprovementReport(scope,policy,c.signal));
});
test('validation rejects duplicate calls, contradictory coverage and fake candidate membership',()=>{
 const good=report();assert.equal(validateVoiceImprovementReport(good,scope,policy).ok,true);
 const reordered={...good,coverage:Object.fromEntries(Object.entries(good.coverage).reverse())};assert.equal(validateVoiceImprovementReport(reordered,scope,policy).ok,true);
 assert.equal(validateVoiceImprovementReport({...good,coverage:{...good.coverage,N:5}},scope,policy).ok,false);
 assert.equal(validateVoiceImprovementReport({...good,improvedSpatialCandidates:[{id:'x',memberCallIds:['missing']}]},scope,policy).ok,false);
});
