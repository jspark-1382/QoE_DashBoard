const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
const {buildCustomerRoute,haversineMeters}=load('lib/analyst/customer-screening-route.ts');
const row=(d,t,q,drop,cell,lat,lon,evidence,end)=>[
  d,t,q,drop,'adm:test',cell,lat,lon,evidence,'call-'+d+'-'+t,end
];
const testData={
  dates:['2026-10-26','2026-10-27'],cellSites:{A:[37.5,127],B:[37.5005,127.0005]},
  customers:[{id:'a',number:'UE-001',calls:[
    row(0,36000,2.1,0,'A',37.5,127,'bye-cell',36040),
    row(0,36600,4.1,0,'B',37.5004,127.0004,'gnss',36630),
    row(0,37200,3.1,0,'B',37.5005,127.0006,'gnss',37220),
    row(1,38000,2.4,0,'A',null,null,'',38050),
    row(1,39000,null,1,'UNKNOWN',null,null,'',39050),
  ]}],
};
test('Selected customer displays all calls with BYE time order and strict GNSS/site provenance',()=>{
  const r=buildCustomerRoute(testData,'a',testData.dates[0],testData.dates[1],'00:00','23:59');
  assert(r);
  assert.equal(r.totalCalls,5);
  assert.equal(r.observations.length,4);
  assert.equal(r.unlocatedCalls,1);
  assert.equal(r.gnssCount,2);assert.equal(r.cellReferenceCount,2);
  assert.equal(r.observations[0].time,'10:00:40');
  assert.equal(r.observations[1].evidence,'gnss');
  assert.deepEqual([r.observations[1].lat,r.observations[1].lon],[37.5004,127.0004]);
  assert.deepEqual([r.observations[3].lat,r.observations[3].lon],[37.5,127]);
  assert.equal(r.sites.find(s=>s.cell==='B').gnssServed,2);
  assert.deepEqual(r.segments.map(s=>s.kind),['reference-order','gnss-observed-link']);
  assert.equal(r.segments.some(s=>r.observations[s.from].day!==r.observations[s.to].day),false);
});
test('Only same-day plausible time gaps connect; unsupported GPS motion not invented',()=>{
  const d={...testData,customers:[{id:'speed',number:'UE-speed',calls:[
    row(0,36000,2,0,'A',37.5,127,'gnss',36001),
    row(0,36060,2,0,'B',37.8,127.4,'gnss',36061),
    row(1,36000,2,0,'A',37.5002,127.0002,'gnss',36005),
  ]}]};
  const r=buildCustomerRoute(d,'speed',d.dates[0],d.dates[1],'00:00','23:59');
  assert.equal(r.segments.length,0);
  assert(r.skippedLongGaps>=2);
  assert(haversineMeters({lat:37.5,lon:127},{lat:37.8,lon:127.4})>40000);
});
test('Changing day and time filters updates observation sequence without linking different dates',()=>{
  const day=buildCustomerRoute(testData,'a','2026-10-27','2026-10-27','10:30','10:40');
  assert.equal(day.totalCalls,1);
  assert.equal(day.observations[0].cell,'A');
  assert.equal(day.segments.length,0);
  const dayChoice=buildCustomerRoute(testData,'a',testData.dates[0],testData.dates[1],'00:00','23:59','2026-10-26');
  assert.equal(dayChoice.totalCalls,3);
  assert(dayChoice.segments.every(s=>s.kind==='gnss-observed-link'||s.kind==='reference-order'));
  assert.equal(buildCustomerRoute(testData,'nonexistent',testData.dates[0],testData.dates[1],'00:00','23:59'),null);
});
test('All-calls route source has BYE-time/site provenance, preserves existing KPI reconciliation',()=>{
  const payload=JSON.parse(fs.readFileSync('public/customer-screening-data/2026-10-26_2026-10-30.json'));
  assert(Object.keys(payload.cellSites).length>100);
  const lead=payload.customers.find(c=>c.number==='605243761');
  assert(lead);
  assert.equal(lead.calls.length,30);
  assert(lead.calls.some(c=>c[10]!=null));
  const route=buildCustomerRoute(payload,lead.id,payload.dates[0],payload.dates.at(-1),'00:00','23:59');
  assert.equal(route.totalCalls,30);
  assert(route.observations.length>=20);
  assert(route.observations.some(p=>p.quality==='good'));
  assert(route.observations.some(p=>p.quality==='poor'));
  assert.equal(route.gnssCount+route.cellReferenceCount+route.unlocatedCalls,route.totalCalls);
  assert.equal(payload.audit.calls,184232);
  assert.equal(payload.audit.poor,1580);
  assert.equal(payload.audit.drops,257);
});
