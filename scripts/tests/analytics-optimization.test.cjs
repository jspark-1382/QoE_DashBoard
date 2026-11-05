/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Node scripts and the existing test harness require CommonJS imports. */
const test=require('node:test');
const assert=require('node:assert/strict');
const {load}=require('../analyst-ts-loader.cjs');
const {getOverviewAnalytics}=load('lib/analyst/overview-analytics.ts');
const {getHourlyCalls,getOverviewSummary}=load('lib/analyst/overview.ts');
const call=(id,hour,qoe,extra={})=>({id,customerId:'customer',qoe,mos:qoe,
  startSecond:hour*3600,startTimestamp:`2026-10-30T${String(hour).padStart(2,'0')}:00:00+09:00`,
  gridIds:[],...extra});

test('hourly experience assigns each unique timestamp once while preserving exact MOS groups',()=>{
  const calls=[call('a',9,1),call('b',9,2),call('c',10,3.25),call('a',10,4)];
  const NativeDate=global.Date;
  let numericDates=0;
  class CountedDate extends NativeDate {
    constructor(...args){super(...args);if(args.length===1&&typeof args[0]==='number')numericDates++;}
  }
  let result;
  try {
    global.Date=CountedDate;
    result=getOverviewAnalytics(calls,'mos',3);
  } finally { global.Date=NativeDate; }
  assert(numericDates<=3,`Each unique call should need at most one local-hour conversion, got ${numericDates}`);
  assert.equal(result.total,3);
  assert.equal(result.average,(4+2+3.25)/3);
  assert.deepEqual(result.bands.map(item=>[item.id,item.count]),[['good',1],['fair',1],['poor',1]]);
  const affected=result.experience.find(item=>item.id==='affected');
  assert.deepEqual(affected.customerIds,['customer']);
  assert.equal(affected.hourly[9],1);
  assert.equal(affected.hourly[10],0);
});

test('hourly totals preserve last duplicate per hour rather than deduplicating across reporting hours',()=>{
  const calls=[call('same',9,1),call('same',10,2),call('same',9,4),
    call('unknown',9,null),call('zero',9,0),call('outside',25,1),
    call('invalid',NaN,1)];
  const hours=getHourlyCalls(calls,3);
  assert.deepEqual(hours[9],{hour:9,total:3,evaluated:2,poor:1});
  assert.deepEqual(hours[10],{hour:10,total:1,evaluated:1,poor:1});
  assert.equal(hours.reduce((n,item)=>n+item.total,0),4);
  assert.deepEqual(calls.map(item=>item.id),['same','same','same','unknown','zero','outside','invalid']);
});

test('experience reporting hours preserve timezone offsets and timestamps before the Unix epoch',()=>{
  const calls=[
    call('before-midnight',0,1,{customerId:'a',startTimestamp:'1969-12-31T14:59:59Z'}),
    call('midnight',0,1,{customerId:'b',startTimestamp:'1969-12-31T15:00:00Z'}),
    call('offset',0,1,{customerId:'c',startTimestamp:'2026-10-30T21:00:00-04:00'}),
  ];
  const affected=getOverviewAnalytics(calls,'mos',3).experience.find(item=>item.id==='affected');
  assert.equal(affected.hourly[23],1);
  assert.equal(affected.hourly[0],1);
  assert.equal(affected.hourly[10],1);
  assert.equal(affected.hourly.reduce((sum,count)=>sum+count,0),3);
});

test('summary keeps valid zeros, last duplicate values and distinct affected/located counts',()=>{
  const calls=[call('same',9,1),call('same',10,4),
    call('zero',9,0,{customerId:'other',gridIds:['a']}),
    call('missing',10,null),call('infinite',10,Infinity),call('negative',10,-1)];
  assert.deepEqual(getOverviewSummary(calls,3),{customers:2,total:5,evaluated:3,unscored:2,
    poor:2,poorRate:(2/3)*100,affectedCustomers:2,locatedPoor:1,unlocatedPoor:1});
});
