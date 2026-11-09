/* eslint-disable @typescript-eslint/no-require-imports -- Node test harness uses shared TypeScript loader. */
const test=require('node:test'),assert=require('node:assert/strict');const {load}=require('../analyst-ts-loader.cjs');
const {selectCandidateEvidence}=load('lib/analyst/voice-improvement-1/evidence.ts');
const call={date:'2026-10-26',callId:'2026-10-26:c:r',rawCallId:'r',customerId:'c',sourceRevision:'rev',sourceFile:'overview.json',startedAt:'2026-10-26T09:00:00+09:00',endedAt:'2026-10-26T09:01:00+09:00',mos:2,mdtLinkStatus:'unique'};
const gnss={callId:'c:r',lat:37.5,lon:127,evidence:'gnss',referenceBasis:'direct-gnss',observedAt:'2026-10-26T09:00:59+09:00',cdrEndAt:call.endedAt};
test('GNSS wins; old/future/unlinked/BYE/rough evidence cannot create a representative',()=>{
 assert.equal(selectCandidateEvidence(call,gnss,null).kind,'gnss');
 for(const patch of [{evidence:'bye-cell'},{evidence:'estimated',positionQuality:'three-site-rough'},{observedAt:'2026-10-26T08:00:00+09:00'},{observedAt:'2026-10-26T09:01:02+09:00'},{callId:'other'}]) assert.equal(selectCandidateEvidence(call,{...gnss,...patch},null).status,'excluded');
});
test('radio acceptance needs replayable diagnostics, not a review accepted flag',()=>{
 const sample={callId:'r',timestamp:Date.parse('2026-10-26T09:00:59+09:00'),lat:37.5,lon:127,locationSource:'radio',accuracyM:500,confidence:70,estimation:{review:{accepted:true}}};
 assert.equal(selectCandidateEvidence(call,null,{customerId:'c',date:call.date,source:'MDT',samples:[sample]}).status,'excluded');
});
function radio(extra={}){
 const sites=[1,2,3].map((n)=>({siteId:'s'+n,latitude:37.5+n*.01,longitude:127,estimatedDistanceM:400,deltaTimeSec:10,cellIds:['cell'+n],baseStationIds:['base'+n],residualM:20}));
 return {callId:'r',index:0,timestamp:Date.parse('2026-10-26T09:00:59+09:00'),lat:37.5,lon:127,locationSource:'radio',accuracyM:1500,confidence:40,
  estimation:{method:'MULTILATERATION',siteCount:3,windowSec:30,usedSites:sites,residualErrorM:800,geometry:.10,jump:false,warnings:[],candidateLat:37.5,candidateLon:127,...extra}};
}
test('strict radio boundary diagnostics replay; saturation duplicate sites, NaN and movement fail',()=>{
 const choose=(sample)=>selectCandidateEvidence(call,null,{customerId:'c',date:call.date,source:'MDT',samples:[sample]});
 assert.equal(choose(radio()).status,'accepted');
 for(const e of [{geometry:.099},{siteCount:2},{windowSec:31},{usedSites:radio().estimation.usedSites.map(s=>({...s,siteId:'same'}))},{usedSites:radio().estimation.usedSites.map(s=>({...s,estimatedDistanceM:1500}))},{jump:true},{residualErrorM:801}]) assert.equal(choose(radio(e)).status,'excluded');
 const sample=radio();sample.gnssReference={lat:36,lon:126,movementRadiusM:100};assert.equal(choose(sample).status,'excluded');
});
