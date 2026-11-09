/* eslint-disable @typescript-eslint/no-require-imports -- Node test harness uses shared TypeScript loader. */
const test=require('node:test'),assert=require('node:assert/strict');const {load}=require('../analyst-ts-loader.cjs');
const {buildCustomerExperience,candidateCustomerCalls}=load('lib/analyst/voice-improvement-1/customer-metrics.ts');
const call=(id,date,mos,time='09:00:00',customerId='c')=>({callId:date+':'+id,rawCallId:id,customerId,date,mos,startedAt:time?date+'T'+time+'+09:00':null});
test('repeat calls, ordered consecutive calls and consecutive calendar dates are distinct',()=>{
 const calls=[call('a','2026-10-26',2),call('b','2026-10-26',4,'10:00:00'),call('c','2026-10-28',2)];
 const [r]=buildCustomerExperience(calls,['2026-10-26','2026-10-27','2026-10-28']);assert.equal(r.repeatCalls,true);assert.equal(r.consecutiveCalls,false);assert.equal(r.maxConsecutivePoorDates,1);assert.equal(r.poorDateCount,2);
 assert.equal(buildCustomerExperience([calls[0],{...calls[1],mos:null},calls[2]],['2026-10-26','2026-10-27','2026-10-28'])[0].consecutiveCalls,false);
 assert.equal(buildCustomerExperience([calls[0],call('missing','2026-10-28',2,null)],['2026-10-26','2026-10-28'])[0].consecutiveCalls,null);
 const missing=buildCustomerExperience([calls[0],calls[2]],['2026-10-26','2026-10-28'])[0];assert.equal(missing.maxConsecutivePoorDates,null);assert(missing.indeterminateReasons.includes('missing-date-partition'));
});
test('candidate related customer period retains normal/unscored calls with precise membership and stable aliases',()=>{
 const calls=[call('a','2026-10-26',2),call('b','2026-10-26',4,'10:00:00'),call('a','2026-10-28',null),call('x','2026-10-26',2,'09:00:00','z')];
 const candidate={memberCallIds:[calls[0].callId],nearbyPoints:[{callId:calls[0].callId,customerId:'c',role:'discovery-member'}]};
 const result=candidateCustomerCalls(calls,candidate);assert.equal(result.length,1);assert.equal(result[0].calls.length,3);assert.equal(result[0].calls.filter(c=>c.isMember).length,1);assert.equal(result[0].alias,'A');
 assert.deepEqual(candidateCustomerCalls(calls,{memberCallIds:['missing'],nearbyPoints:[]}),[]);
});
