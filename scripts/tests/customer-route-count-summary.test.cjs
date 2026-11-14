/* eslint-disable @typescript-eslint/no-require-imports -- Existing TypeScript test loader uses CommonJS. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load}=require('../analyst-ts-loader.cjs');
const {buildCustomerRoute,customerRouteCountSummary}=load('lib/analyst/customer-screening-route.ts');
const row=(day,second,cell,lat=null,lon=null,evidence='')=>
  [day,second,4.2,0,'area',cell,lat,lon,evidence,'',second+30];
const source={dates:['2026-10-26','2026-10-27'],cellSites:{KNOWN:[37.5,127]},customers:[{
  id:'customer',number:'00123',calls:[
    row(0,36000,'GPS',37.5,127,'gnss'),
    row(0,36600,'DIRECT',37.51,127.01,'bye-cell'),
    row(0,37200,'KNOWN'),
    row(0,37800,'UNKNOWN'),
    row(0,38400,''),
    row(0,39000,'INVALID',0,0,'gnss'),
    row(0,39600,'',37.52,127.02,'gnss'),
    row(1,36000,'UNKNOWN'),
  ],
}]};

test('map omissions distinguish unmatched Cell coordinates from absent Cell IDs without rejecting valid GPS',()=>{
  const before=JSON.stringify(source);
  const route=buildCustomerRoute(source,'customer',source.dates[0],source.dates[0],'00:00','23:59');
  assert.deepEqual([route.totalCalls,route.observations.length,route.unlocatedCalls],[7,4,3]);
  assert.deepEqual([route.cellCoordinateUnmatchedCalls,route.missingCellIdCalls],[2,1]);
  assert.equal(route.totalCalls,route.observations.length+route.cellCoordinateUnmatchedCalls+route.missingCellIdCalls);
  assert.deepEqual([route.gnssCount,route.cellReferenceCount],[2,2]);
  assert.equal(route.observations.find(p=>p.cell==='KNOWN').evidence,'bye-cell');
  assert.equal(route.observations.find(p=>p.evidence==='gnss'&&!p.cell).lat,37.52);
  assert.equal(JSON.stringify(source),before);
});

test('map summary counts follow the selected day and time, including an empty selected interval',()=>{
  const day=buildCustomerRoute(source,'customer',source.dates[0],source.dates[1],'00:00','23:59',source.dates[1]);
  assert.deepEqual([day.totalCalls,day.observations.length,day.cellCoordinateUnmatchedCalls,day.missingCellIdCalls],[1,0,1,0]);
  const empty=buildCustomerRoute(source,'customer',source.dates[0],source.dates[1],'01:00','02:00');
  assert.deepEqual([empty.totalCalls,empty.observations.length,empty.unlocatedCalls,empty.cellCoordinateUnmatchedCalls,empty.missingCellIdCalls],[0,0,0,0,0]);
});

test('bottom summary explains total, mapped and unmatched populations and retains location provenance',()=>{
  assert.equal(typeof customerRouteCountSummary,'function');
  const route=buildCustomerRoute(source,'customer',source.dates[0],source.dates[0],'00:00','23:59');
  const text=customerRouteCountSummary(route);
  for(const value of ['선택 00123','전체 통화 7건','지도 표시 4건','Cell 좌표 미매칭 2건','Cell ID 미제공 1건','GPS 2건 / BYE Cell 참고 2건','실제 이동경로 아님'])assert(text.includes(value),value);
  const day=buildCustomerRoute(source,'customer',source.dates[1],source.dates[1],'00:00','23:59');
  assert(!customerRouteCountSummary(day).includes('Cell ID 미제공'));
  const legacy={...route};delete legacy.cellCoordinateUnmatchedCalls;delete legacy.missingCellIdCalls;
  assert(customerRouteCountSummary(legacy).includes('지도 미표시 3건'));
  assert(!customerRouteCountSummary(legacy).includes('Cell 좌표 미매칭'));
});
