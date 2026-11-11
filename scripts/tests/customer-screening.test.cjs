const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
const {aggregateScreening,buildCustomerClusters,validScreeningSource}=load('lib/analyst/customer-screening.ts');
const {callScore,isDrop}=require('../build-customer-screening.cjs');
const dates=['2026-10-26','2026-10-27'];
const row=(day,second,qoe,drop,area='adm:1',lat=37.5,lon=127,ev='gnss')=>
  [day,second,qoe,drop,area,'BYE1',lat,lon,ev,'call-1'];
const src={
  schemaVersion:'customer-screening-v1',sourceRevision:'test123',source:'MDT',
  dates,areas:{'adm:1':['개포동',37.5,127]},
  thresholds:{poor:3,good:3.5,concentratedRate:.5,concentratedCount:10,minEvaluatedForRate:5,repeatDays:2,dropCount:3,dropRate:.1},
  customers:[
    {id:'a',number:'UE001',calls:[row(0,36000,2.3,0),row(1,36000,2.4,0),row(1,39000,4.5,0)]},
    {id:'b',number:'UE002',calls:[row(0,36000,null,1,'adm:1',37.5,127,'bye-cell')]},
    {id:'c',number:'UE003',calls:[row(0,36000,null,1),row(0,37000,null,1),row(1,36000,null,1)]},
    {id:'d',number:'UE004',calls:[row(0,36000,2.1,0),row(0,40000,2.1,0),row(1,36000,3.7,0),row(1,40000,3.8,0),row(1,50000,4.2,0)]}
  ],audit:{calls:12,poor:4,drops:4,locatedPoor:4,customers:4}
};
test('SIP 11.REASON Drop H^, ^H and H: Drop adjust only valid MOS(v5)',()=>{
  assert.equal(isDrop('H: Drop'),true);
  assert.equal(isDrop('C^H^J^K'),true);
  assert.equal(isDrop('C^H'),true);
  assert.equal(callScore({mos:4.5,sipCause:'H: Drop'}),2);
  assert.equal(callScore({mos:null,sipCause:'H: Drop'}),null);
  assert.equal(callScore({mos:4.5,sipCause:'A: Normal'}),4.5);
});
test('unique customer KPIs, repeat by different date, unscored Drop and denominator',()=>{
  assert.equal(validScreeningSource(src),true);
  const r=aggregateScreening(src,dates[0],dates[1],'00:00','23:59');
  assert.equal(r.total,4);assert.equal(r.affected,2);assert.equal(r.repeat,1);
  assert.equal(r.dropHeavy,1);assert.equal(r.concentrated,0); // 2/3 불량은 평가 5건 미만이므로 집중 고객에서 제외
  assert.equal(r.rows.find(x=>x.id==='a').poorRate,2/3);
  assert.equal(r.rows.find(x=>x.id==='b').eligible,0);
  assert.equal(r.rows.find(x=>x.id==='c').drop,3);
  assert.equal(r.rows.find(x=>x.id==='d').group,'temporary');
  assert.equal(r.locationRepeat,1);
});
test('exact day/time filtering, no call across day boundary',()=>{
  const r=aggregateScreening(src,dates[1],dates[1],'11:00','11:59');
  assert.equal(r.total,1);assert.equal(r.calls,1);assert.equal(r.affected,0);
});
test('map counts unique customers, BYE site reference omitted in GNSS mode',()=>{
  const r=aggregateScreening(src,dates[0],dates[1],'00:00','23:59');
  const clusters=buildCustomerClusters(r.rows,'poor','all');
  assert.equal(clusters[0].customerCount,2);
  assert.equal(clusters[0].callCount,4);
  assert.equal(buildCustomerClusters(r.rows,'poor','gnss')[0].customerCount,2);
});
test('generated 5-day source provenance, audit totals and no fabricated customers',()=>{
  const p='public/customer-screening-data/2026-10-26_2026-10-30.json';
  assert.ok(fs.existsSync(p));
  const source=JSON.parse(fs.readFileSync(p,'utf8'));
  assert.equal(validScreeningSource(source),true);
  assert.equal(source.customers.length,source.audit.customers);
  const report=aggregateScreening(source,source.dates[0],source.dates.at(-1),'00:00','23:59');
  assert.equal(report.calls,source.audit.calls);assert.equal(report.poor,source.audit.poor);
  assert.equal(report.drop,source.audit.drops);
  assert.equal(report.total,source.audit.customers);
});
