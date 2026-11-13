// Numerical source regressions retain the original two-workbook cohort.
const {historicalRead,historicalJson,skipHistoricalSource}=require('./published-fixture.cjs');
if(skipHistoricalSource(__filename))return;
/* Coarse 3-site data is shown in the EXISTING 3-site tab, not a new page. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
const {overlayThreeSiteRough}=load('lib/analyst/three-site-rough.ts');
const {buildImprovedView}=load('lib/analyst/improved-overview.ts');
const read=(name)=>JSON.parse(historicalRead(name,'utf8'));
const dates=['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30'];

test('five actual date partitions expose GNSS-free 3-site search-zone candidates',()=>{
 let roughCount=0,poorCount=0;
 for(const date of dates){
  const original=read('public/analyst-overview/MDT/'+date+'.json');
  const dataset=read('public/three-site-rough/'+date+'.json');
  const after=overlayThreeSiteRough(original,dataset,true);
  const byOriginal=new Map(original.callLocations.map(point=>[point.callId,point]));
  const points=after.callLocations.filter(point=>point.positionQuality==='three-site-rough');
  assert.equal(points.length,dataset.points.length,'one rough point for each eligible unique call');
  roughCount+=points.length;
  for(const point of points){
    if(point.mos!=null&&point.mos<3)poorCount++;
    assert(point.evidence==='estimated');
    assert(point.estimationMethod==='THREE_SITE_RSRP_CENTROID');
    assert(point.usedSiteCount>=3);
    assert(point.usedStations.length>=3);
    assert(point.roughSearchRadiusM>=600 && point.roughSearchRadiusM<=5000);
    assert.equal(point.modelUncertaintyM,null,'no invented positioning accuracy');
    const prev=byOriginal.get(point.callId);
    assert(prev?.evidence!=='gnss');
    if(prev?.evidence==='bye-cell'){
      assert.equal(point.byeCellId,prev.byeCellId);
      assert.equal(point.byeStationLat,prev.lat);
      assert.equal(point.byeStationLon,prev.lon);
    }
  }
  for(const previous of original.callLocations.filter(point=>point.evidence==='gnss')){
   assert.deepEqual(after.callLocations.find(point=>point.callId===previous.callId),previous,
     'GNSS measured coordinates must never change');
  }
  const filtered=buildImprovedView(after,{
    from:'00:00',to:'23:59',hour:null,districtId:null,evidence:'estimated',band:'poor'
  });
  assert.equal(filtered.locations.filter(p=>p.positionQuality==='three-site-rough').length,
   points.filter(p=>p.mos!=null&&p.mos<3).length);
  assert.deepEqual(overlayThreeSiteRough(original,dataset,false),original,
   'BYE-only filter must preserve old BYE site reference');
  assert.deepEqual(overlayThreeSiteRough(original,{...dataset,sourceRevision:'stale'},true),original);
  assert.equal(original.calls.length,after.calls.length);
 }
 assert.equal(roughCount,300);
 assert.equal(poorCount,106);
});

test('wrong site count must be rejected rather than shown',()=>{
 const date='2026-10-30';
 const original=read('public/analyst-overview/MDT/'+date+'.json');
 const source=read('public/three-site-rough/'+date+'.json');
 const invalid={...source,points:source.points.map(x=>({...x,usedSiteCount:2}))};
 const out=overlayThreeSiteRough(original,invalid,true);
 assert.equal(out.callLocations.length,original.callLocations.length);
});
