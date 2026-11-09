/* eslint-disable @typescript-eslint/no-require-imports -- Shared Node test harness. */
const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('../analyst-ts-loader.cjs');
const api=load('lib/analyst/quality-improvement-candidates.ts');
const scope={sourceRevision:'rev',dateStart:'2026-10-26',dateEnd:'2026-10-26',from:'00:00',to:'23:59',policy:'strict-3-site-v1'};
const call={id:'mdt-a:call-1',customerId:'mdt-a',start:'10:00:00',startSecond:36000,mos:2,startTimestamp:'2026-10-26T10:00:00+09:00'};
const overview={date:scope.dateStart,sourceRevision:'rev',calls:[call]};
const evidence={revision:'rev',policy:scope.policy,censusComplete:false,records:[{callId:'2026-10-26:'+call.id,mdtLinkStatus:'unique',status:'accepted',kind:'gnss',lat:37.5,lon:127}]};
test('zero candidates retain independent scope observations with strict evidence and filters',()=>{
 assert.equal(api.buildQualityScopeObservationPoints(overview,scope,evidence).length,1);
 for(const patch of [{status:'excluded'},{kind:undefined},{kind:'reviewed-radio',reasons:['three-site-rough']},{mdtLinkStatus:'none'}])assert.equal(api.buildQualityScopeObservationPoints(overview,scope,{...evidence,records:[{...evidence.records[0],...patch}]}).length,0);
 assert.equal(api.buildQualityScopeObservationPoints(overview,{...scope,from:'11:00'},evidence).length,0);
 assert.equal(api.buildQualityScopeObservationPoints(overview,{...scope,customerIds:['other']},evidence).length,0);
 assert.equal(api.buildQualityScopeObservationPoints(overview,scope,{...evidence,revision:'old'}).length,0);
});
test('exact scope loader uses small summaries, distinguishes missing scope and stale revision',async()=>{
 const requests=[];const summary={schemaVersion:'quality-candidate-summary-v1',scope,scopeKey:'key',candidates:[],discoveryDates:[scope.dateStart],validationDates:[],auditReference:'audit',observationPath:'rev/key/observations.json'};
 const index={schemaVersion:'quality-improvement-index-v1',sourceRevision:'rev',entries:[{scope,path:'rev/key/summary.json'}],evidence:[]};
 global.fetch=async url=>{requests.push(String(url));return{ok:true,status:200,json:async()=>String(url).endsWith('index.json')?index:summary}};
 assert.equal((await api.loadQualityCandidateSummary(scope)).candidates.length,0);
 assert.equal(requests.some(u=>u.endsWith('report.json')),false);
 await assert.rejects(()=>api.loadQualityCandidateSummary({...scope,from:'09:00'}),e=>e.code==='not-generated');
 index.sourceRevision='old';await assert.rejects(()=>api.loadQualityCandidateSummary(scope),e=>e.code==='revision-mismatch');
});
test('candidate detail rejects validation dates leaking into discovery membership',()=>{
 const summary={scope,scopeKey:'key',candidates:[{id:'x',detailPath:'rev/key/x.json'}],discoveryDates:['2026-10-26'],validationDates:['2026-10-27']};
 const detail={schemaVersion:'quality-candidate-detail-v1',scopeKey:'key',scope,candidate:{id:'x',memberCallIds:['2026-10-27:mdt-a:call-1'],nearbyPoints:[]},calls:[{date:'2026-10-27',callId:'2026-10-27:mdt-a:call-1'}]};
 assert.equal(api.validateQualityCandidateDetail(summary,detail,'x'),false);
});
test('investigation marks only discovery members while retaining validation customers',()=>{
 const detail={candidate:{id:'x',memberCallIds:['2026-10-26:mdt-a:call-1'],nearbyPoints:[{callId:'2026-10-27:mdt-b:call-2',role:'validation-new'}]},calls:[{callId:'2026-10-26:mdt-a:call-1',customerId:'mdt-a'},{callId:'2026-10-27:mdt-b:call-2',customerId:'mdt-b'}]};
 const selection=api.buildQualityCandidateInvestigation(detail,overview);
 assert.deepEqual(selection.callIds,[call.id]);assert.deepEqual(selection.customerIds,['mdt-a','mdt-b']);
});

test('investigation rank retains unranked range-review candidates',()=>{
 assert.equal(api.qualityCandidateRankLabel({rank:null}),'범위 검토');assert.equal(api.qualityCandidateRankLabel({rank:1}),'1');
});
