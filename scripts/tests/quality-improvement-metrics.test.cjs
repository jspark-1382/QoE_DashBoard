/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
test('improvement metrics retain original KPI population and unknown sparse coverage',()=>{
 assert.ok(fs.existsSync('lib/analyst/quality-improvement-adapter.ts'),'improvement metrics adapter exists');
 const {buildQualityImprovementMetrics}=load('lib/analyst/quality-improvement-adapter.ts');
 const {parseQualityComparisonState}=load('lib/analyst/quality-comparison-state.ts');
 const state=parseQualityComparisonState('?customer=a&customer=b&selectedHour=10',['2026-10-30']).state;
 const calls=[{id:'a1',customerId:'a',mos:2,startSecond:36000,startTimestamp:'2026-10-30T10:00:00'},{id:'a2',customerId:'a',mos:4,startSecond:40000,startTimestamp:'2026-10-30T11:06:40'},{id:'b1',customerId:'b',mos:null,startSecond:36000},{id:'c1',customerId:'c',mos:1,startSecond:36000}];
 const overview={date:'2026-10-30',calls,cells:[],callLocations:[]};
 const result=buildQualityImprovementMetrics(overview,state,{revision:'r',policy:'strict',censusComplete:false,records:[{callId:'a1',mdtLinkStatus:'unique',status:'accepted',kind:'gnss'}]});
 assert.deepEqual([result.grades.evaluated,result.grades.unavailable,result.grades.mean,result.grades.bands[0].count],[2,1,3,1]);
 assert.deepEqual([result.coverage.N,result.coverage.M,result.coverage.D,result.coverage.G,result.coverage.T,result.coverage.U,result.coverage.mdtUnknown],[3,2,1,1,0,1,2]);
 assert.equal(buildQualityImprovementMetrics(overview,state,null).evidenceStatus,'unavailable');
 const complete=buildQualityImprovementMetrics(overview,state,{revision:'r',policy:'strict',censusComplete:true,records:[]});
 assert.equal(complete.coverage.mdtUnknown,0);
 const alias=buildQualityImprovementMetrics(overview,state,{revision:'r',policy:'strict',censusComplete:false,records:[{callId:'2026-10-30:a1',mdtLinkStatus:'unique',status:'accepted',kind:'gnss'}]});
 assert.equal(alias.coverage.G,1);
 const mismatch=buildQualityImprovementMetrics({...overview,sourceRevision:'new'},state,{revision:'old',policy:'strict',censusComplete:true,records:[]});
 assert.equal(mismatch.evidenceStatus,'revision-mismatch');assert.equal(mismatch.coverage.mdtUnknown,3);
});
test('a day without customer calls is still an available partition and normal calls break consecutive poor calls',()=>{
 const {buildQualityImprovementMetrics}=load('lib/analyst/quality-improvement-adapter.ts');
 const {parseQualityComparisonState}=load('lib/analyst/quality-comparison-state.ts');
 const dates=['2026-10-26','2026-10-27','2026-10-28'];
 const state=parseQualityComparisonState('?dateStart=2026-10-26&dateEnd=2026-10-28&customer=a',dates).state;
 const calls=[{id:'p1',customerId:'a',mos:2,startSecond:3600,startTimestamp:'2026-10-26T01:00:00Z'},{id:'normal',customerId:'a',mos:4,startSecond:7200,startTimestamp:'2026-10-26T02:00:00Z'},{id:'p2',customerId:'a',mos:2,startSecond:3600,startTimestamp:'2026-10-28T01:00:00Z'}];
 const customer=buildQualityImprovementMetrics({date:'2026-10-26 ~ 2026-10-28',calls,cells:[]},state,null).customers[0];
 assert.equal(customer.repeatCalls,true);assert.equal(customer.consecutiveCalls,false);
 assert.equal(customer.poorDateCount,2);assert.equal(customer.maxConsecutivePoorDates,1);
 assert.deepEqual(customer.indeterminateReasons,[]);
});
