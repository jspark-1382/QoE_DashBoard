const {test}=require('node:test'),assert=require('node:assert/strict');
const {load}=require('../analyst-ts-loader.cjs');
const fs=require('node:fs'),path=require('node:path');
const api=load('lib/analyst/quality-improvement-candidates.ts');
const models=load('lib/analyst/quality-model-alternatives.ts');
const scopeFor=revision=>({sourceRevision:revision,dateStart:'2026-10-26',dateEnd:'2026-10-26',from:'00:00',to:'23:59',policy:'strict-3-site-v1'});
const fixture=scope=>({index:{schemaVersion:'quality-improvement-index-v1',sourceRevision:scope.sourceRevision,
  entries:[{scope,path:scope.sourceRevision+'/summary.json'}],evidence:[]},
 summary:{schemaVersion:'quality-candidate-summary-v1',scope,scopeKey:scope.sourceRevision,candidates:[],discoveryDates:[scope.dateStart],validationDates:[],auditReference:'audit',observationPath:'observations.json'}});
const response=value=>({ok:true,status:200,json:async()=>value});

test('same candidate scope shares one request and reuses validated summary on reopen',async()=>{
 const scope=scopeFor('candidate-cache-reopen'),data=fixture(scope),urls=[];
 global.fetch=async url=>{urls.push(String(url));return response(String(url).endsWith('index.json')?data.index:data.summary);};
 const [first,peer]=await Promise.all([api.loadQualityCandidateSummary(scope,undefined,'all'),api.loadQualityCandidateSummary({...scope},undefined,'all')]);
 assert.equal(first,peer);assert.equal(await api.loadQualityCandidateSummary({...scope},undefined,'all'),first);
 assert.equal(urls.length,2,'one index plus one summary, not one pair per consumer');
});
test('one aborted candidate consumer cannot cancel another mounted consumer',async()=>{
 const scope=scopeFor('candidate-cache-abort'),data=fixture(scope),caller=new AbortController();let release,indexSignal;
 const ready=new Promise(resolve=>{release=resolve;});
 global.fetch=async(url,options)=>{if(String(url).endsWith('index.json')){indexSignal=options.signal;await ready;return response(data.index);}return response(data.summary);};
 const stopped=api.loadQualityCandidateSummary(scope,caller.signal,'all');
 const survivor=api.loadQualityCandidateSummary({...scope},undefined,'all');
 caller.abort();await assert.rejects(stopped,error=>error.name==='AbortError');
 release();assert.equal(await survivor,data.summary);assert.equal(indexSignal.aborted,false);
});
test('invalid summaries are rejected and never retained as successful cache entries',async()=>{
 const scope=scopeFor('candidate-cache-invalid'),data=fixture(scope);let summaries=0;
 global.fetch=async url=>response(String(url).endsWith('index.json')?data.index:(++summaries===1?{...data.summary,schemaVersion:'wrong'}:data.summary));
 await assert.rejects(()=>api.loadQualityCandidateSummary(scope,undefined,'all'),error=>error.code==='invalid-data');
 assert.equal(await api.loadQualityCandidateSummary(scope,undefined,'all'),data.summary);assert.equal(summaries,2);
});
test('new source revision cannot reuse previous candidate artifacts',async()=>{
 let data=fixture(scopeFor('candidate-cache-source-one')),requests=0;
 global.fetch=async url=>{requests++;return response(String(url).endsWith('index.json')?data.index:data.summary);};
 await api.loadQualityCandidateSummary(data.summary.scope,undefined,'all');
 data=fixture(scopeFor('candidate-cache-source-two'));
 assert.equal((await api.loadQualityCandidateSummary(data.summary.scope,undefined,'all')).scope.sourceRevision,'candidate-cache-source-two');
 assert.equal(requests,4);
});
test('switching among all five alternative models reuses the complete validated report without changing memberships',async()=>{
 const scope=scopeFor('candidate-cache-models');
 const member={callId:'original-call',customerId:'original-customer',date:scope.dateStart,mos:2,kind:'gnss',lat:37.5,lon:127};
 const candidates=[{id:'original-candidate',lat:37.5,lon:127,radiusM:100,poorCalls:1,poorCustomers:1,members:[member],validationPoints:[]}];
 const report={schemaVersion:'quality-alternative-models-v1',sourceRevision:scope.sourceRevision,scope,scopeKey:'models',analysisMode:'all',discoveryDates:[scope.dateStart],validationDates:[],models:Object.fromEntries(['hdbscan','st_dbscan','adaptive_kde','spatial_scan','bayesian'].map(id=>[id,{status:'computed',candidates}]))};
 const index={schemaVersion:'quality-model-index-v1',sourceRevision:scope.sourceRevision,entries:[{scope,scopeKey:'models',path:'models.json'}]};let requests=0;
 global.fetch=async url=>{requests++;return response(String(url).endsWith('index.json')?index:report);};
 for(const id of Object.keys(report.models)){
  const value=await models.loadAlternativeModelReport({...scope},undefined,'all');
  assert.deepEqual(value.models[id].candidates[0].members,[member]);
 }
 assert.equal(requests,2,'one index and one original five-model report across all selections');
});

test('published mixed-source DBSCAN and all five model memberships survive cached loading exactly',{
 skip:!fs.existsSync('public/quality-improvement-mixed-full/index.json')||!fs.existsSync('public/quality-models-mixed-full/index.json')?'Private published candidate artifacts are not installed':false,
},async()=>{
 const baselineIndex=JSON.parse(fs.readFileSync('public/quality-improvement-mixed-full/index.json','utf8'));
 const scope=baselineIndex.entries.find(entry=>entry.scope.dateStart==='2026-10-26'&&entry.scope.dateEnd==='2026-10-30'&&entry.scope.from==='00:00'&&entry.scope.to==='23:59').scope;
 const modelIndex=JSON.parse(fs.readFileSync('public/quality-models-mixed-full/index.json','utf8'));
 const modelPath=modelIndex.entries.find(entry=>JSON.stringify(entry.scope)===JSON.stringify(scope)).path;
 const original=JSON.parse(fs.readFileSync(path.join('public/quality-models-mixed-full',modelPath),'utf8'));
 let requests=0;
 global.fetch=async url=>{requests++;return response(JSON.parse(fs.readFileSync(path.join('public',String(url).replace(/^\/qoe\//,'')),'utf8')));};
 const summary=await api.loadQualityCandidateSummary(scope,undefined,'all','mixed');
 const originalSummary=JSON.parse(fs.readFileSync(path.join('public/quality-improvement-mixed-full',baselineIndex.entries.find(entry=>JSON.stringify(entry.scope)===JSON.stringify(scope)).path),'utf8'));
 assert.deepEqual(summary,originalSummary);
 for(const id of Object.keys(original.models)){
  const report=await models.loadAlternativeModelReport({...scope},undefined,'all','mixed');
  assert.deepEqual(report.models[id],original.models[id]);
 }
 assert.equal(requests,4,'one DBSCAN index/summary and one shared five-model index/report');
});
