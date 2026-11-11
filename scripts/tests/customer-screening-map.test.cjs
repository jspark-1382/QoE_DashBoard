const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
const map=load('lib/analyst/customer-screening-map.ts');
const {aggregateScreening}=load('lib/analyst/customer-screening.ts');

const testSource={
  schemaVersion:'customer-screening-v1',sourceRevision:'test',source:'MDT',dates:['2026-10-26','2026-10-27'],
  areas:{'adm:A':['가동',37.48,127.05],'adm:B':['나동',37.5,127.08]},
  thresholds:{poor:3,good:3.5,concentratedRate:.5,concentratedCount:10,minEvaluatedForRate:5,repeatDays:2,dropCount:3,dropRate:.1},
  customers:[
    {id:'a',number:'UE001',calls:[
      [0,36000,2.4,0,'adm:A','C1',37.48,127.05,'bye-cell','call-1'],
      [1,36000,2.0,1,'adm:A','C1',37.48,127.05,'gnss','call-2'],
      [1,42000,4.0,1,'adm:B','C2',null,null,'','call-3']
    ]},
    {id:'b',number:'UE002',calls:[
      [0,35000,2.8,0,'adm:A','C1',37.48,127.05,'bye-cell','call-4'],
      [1,38000,2.0,0,'adm:B','C2',37.5,127.08,'gnss','call-5'],
    ]},
  ],audit:{calls:5,poor:4,drops:2,locatedPoor:4,customers:2},
};
test('administrative polygons are real schema with matching revision and source ids',()=>{
  const raw=JSON.parse(fs.readFileSync('public/customer-screening-data/administrative-boundaries-v1.json'));
  const source=JSON.parse(fs.readFileSync('public/customer-screening-data/2026-10-26_2026-10-30.json'));
  assert(map.validScreeningBoundaries(raw,source.sourceRevision));
  assert.equal(raw.features.length,Object.keys(source.areas).length);
  assert(raw.features.every(x=>x.geometry.type==='MultiPolygon'&&x.geometry.coordinates.length>0));
  assert(!map.validScreeningBoundaries({...raw,sourceRevision:'wrong'},source.sourceRevision));
});
test('distinct affected customers and repeat days per area, all SIP Drop by area',()=>{
  const geo=map.buildScreeningGeography(testSource,'2026-10-26','2026-10-27','00:00','23:59');
  const a=geo.areas.find(x=>x.id==='adm:A');
  const b=geo.areas.find(x=>x.id==='adm:B');
  assert.deepEqual([a.customers,a.repeat,a.poorCalls,a.drops],[2,1,3,1]);
  assert.deepEqual([b.customers,b.repeat,b.poorCalls,b.drops],[1,0,1,1]);
  assert.equal(geo.unmappedPoorCalls,0);
  const scoped=aggregateScreening(testSource,'2026-10-26','2026-10-27','00:00','23:59',{areaId:'adm:A'});
  assert.equal(scoped.affected,a.customers);
  assert.equal(scoped.poor,a.poorCalls);
  assert.equal(scoped.rows.find(x=>x.id==='a').total,2);
});
test('BYE Cell coordinates never substituted with GNSS, but all poor by serving cell counted',()=>{
  const geo=map.buildScreeningGeography(testSource,'2026-10-26','2026-10-27','00:00','23:59');
  const site=geo.cells.find(x=>x.id==='C1');
  assert.deepEqual([site.lat,site.lon,site.customers,site.poorCalls,site.drops],[37.48,127.05,2,3,1]);
  assert.equal(geo.cells.find(x=>x.id==='C2'),undefined,'Cell with GNSS only has no confirmed base-station coordinate');
  assert.equal(geo.gnssPoorCalls,2);
  assert.equal(geo.gnss.length,2);
  assert.equal(map.metricLabel('customers'),'저품질 경험 고객');
});
test('real 5-day area summary independently reconciles per-region scoped customer rankings',()=>{
  const source=JSON.parse(fs.readFileSync('public/customer-screening-data/2026-10-26_2026-10-30.json'));
  const geo=map.buildScreeningGeography(source,source.dates[0],source.dates.at(-1),'00:00','23:59');
  const all=aggregateScreening(source,source.dates[0],source.dates.at(-1),'00:00','23:59');
  assert.equal(geo.areas.reduce((s,d)=>s+d.poorCalls,0)+geo.unmappedPoorCalls,all.poor);
  assert(geo.areas.length>=8);
  assert(geo.cells.length>5);
  assert(geo.gnssPoorCalls>0);
  const byArea=geo.areas.slice(0,4);
  for(const area of byArea){
    const scoped=aggregateScreening(source,source.dates[0],source.dates.at(-1),'00:00','23:59',{areaId:area.id});
    assert.equal(scoped.affected,area.customers,'customers '+area.label);
    assert.equal(scoped.poor,area.poorCalls,'poor calls '+area.label);
    assert.equal(scoped.repeat,area.repeat,'repeated dates '+area.label);
  }
});
