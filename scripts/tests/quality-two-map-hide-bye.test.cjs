// Numerical source regressions retain the original two-workbook cohort.
const {historicalRead,historicalJson,skipHistoricalSource}=require('./published-fixture.cjs');
if(skipHistoricalSource(__filename))return;
/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
const {combineDateOverviews}=load('lib/analyst/date-range.ts');
const {overlayThreeSiteRough}=load('lib/analyst/three-site-rough.ts');
const {buildImprovedView,mapWithoutByeCellEvidence,summarizeMappedLocationEvidence}=load('lib/analyst/improved-overview.ts');

const dates=[26,27,28,29,30].map(n=>'2026-10-'+n);
const overviews=dates.map(date=>JSON.parse(historicalRead('public/analyst-overview/MDT/'+date+'.json','utf8')));
const rough=dates.map(date=>JSON.parse(historicalRead('public/three-site-rough/'+date+'.json','utf8')));
const raw=combineDateOverviews(overviews);
const base=overlayThreeSiteRough(raw,{...rough[0],date:raw.date,points:rough.flatMap(day=>day.points)},true);
const scoped=(evidence='all',band='poor')=>buildImprovedView(base,{from:'00:00',to:'23:59',hour:null,districtId:null,evidence,band});

test('improvement2 map hides BYE pins but preserves GPS 131 and triangulation 106 markers',()=>{
 const model=scoped();
 const originalBye=model.locations.filter(p=>p.evidence==='bye-cell').length;
 assert.equal(originalBye,1154);
 const visible=mapWithoutByeCellEvidence(model);
 assert.deepEqual([
  visible.locations.length,
  visible.locations.filter(p=>p.evidence==='gnss').length,
  visible.locations.filter(p=>p.evidence==='estimated').length
 ],[237,131,106]);
 assert(visible.locations.every(p=>p.evidence!=='bye-cell'));
 assert.equal(model.locations.length,1391,'source model must retain all BYE evidence for call details');
 assert.equal(originalBye,1154,'source model must remain unchanged');
 assert.equal(summarizeMappedLocationEvidence(model).U,visible.locations.length);
});

test('district map fill and tooltips no longer derive from BYE station proxy data',()=>{
 const display=mapWithoutByeCellEvidence(scoped());
 const ids=new Set(display.locations.map(p=>p.callId));
 assert(display.mapCells.length>0);
 assert(display.mapCells.every(c=>c.byeCellCalls===0&&c.total===c.callIds.length&&
   c.callIds.every(id=>ids.has(id))&&c.total===c.gnssCalls+c.estimatedCalls));
 assert.equal(display.mapCells.reduce((sum,c)=>sum+c.total,0),237);
 const byeOnly=mapWithoutByeCellEvidence(scoped('bye-cell'));
 assert.equal(byeOnly.locations.length,0);
 assert.equal(byeOnly.mapCells.length,0);
 const gpsOnly=mapWithoutByeCellEvidence(scoped('gnss'));
 assert.equal(gpsOnly.locations.length,131);
 const triOnly=mapWithoutByeCellEvidence(scoped('estimated'));
 assert.equal(triOnly.locations.length,106);
});

test('BYE filter/button/legend is not rendered in improvement2 but original CDR detail remains intact',()=>{
 const main=historicalRead('components/analyst/quality-proposal-four.tsx','utf8');
 const map=historicalRead('components/analyst/analyst-map.tsx','utf8');
 assert(main.includes("{!improvementTwo&&<button aria-pressed={evidence==='bye-cell'}"));
 assert(main.includes("{!improvementTwo&&<div><span className={styles.byeCellDot}/>"));
 assert(main.includes("setEvidence(improvementTwo&&s.evidence==='bye-cell'?'all':s.evidence)"));
 assert(main.includes('mapWithoutByeCellEvidence(geographicModel)'));
 assert(main.includes('callLocations={mapEvidence?.locations??[]}'));
 assert(main.includes('cells={mapEvidence?.mapCells??[]}'));
 assert(main.includes('hideByeSiteMarkers={improvementTwo}'));
 assert(map.includes('if(showStations&&!hideByeSiteMarkers&&point.byeRuId'));
 assert(map.includes('if(showStations&&callLocations.length===1)'));
 assert(map.includes('hideByeSiteMarkers,'));
 assert(main.includes("selectedLocation.evidence==='bye-cell'"),'CDR detail preserves BYE site evidence');
});
