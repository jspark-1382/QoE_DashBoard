/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
const {combineDateOverviews}=load('lib/analyst/date-range.ts');
const {scopeOverviewToCustomers}=load('lib/analyst/customer-overview-scope.ts');
const {overlayThreeSiteRough}=load('lib/analyst/three-site-rough.ts');
const {buildImprovedView,summarizeMappedLocationEvidence}=load('lib/analyst/improved-overview.ts');

const dates=[26,27,28,29,30].map(n=>'2026-10-'+n);
const parts=dates.map(date=>JSON.parse(fs.readFileSync('public/analyst-overview/MDT/'+date+'.json','utf8')));
const raw=combineDateOverviews(parts);
const rough=dates.map(date=>JSON.parse(fs.readFileSync('public/three-site-rough/'+date+'.json','utf8')));
const displayed=overlayThreeSiteRough(raw,{...rough[0],date:raw.date,points:rough.flatMap(d=>d.points)},true);
const scope=(extra={})=>({from:'00:00',to:'23:59',hour:null,districtId:null,evidence:'all',band:'poor',...extra});
const build=(overview=displayed,s=scope())=>buildImprovedView(overview,s);

test('real five-day poor QoE map has exactly 131 GPS and 106 approximate sites, not 425 all-grade GPS',()=>{
 const map=build();
 const kpi=summarizeMappedLocationEvidence(map);
 assert.deepEqual([kpi.G,kpi.T,kpi.U],[131,106,237]);
 assert.equal(kpi.U,kpi.G+kpi.T);
 assert.equal(kpi.hourly.reduce((sum,n)=>sum+n,0),237);
 assert.equal(map.locations.filter(x=>x.evidence==='gnss').length,kpi.G);
 assert.equal(map.locations.filter(x=>x.evidence==='estimated').length,kpi.T);
 assert.equal(map.locations.filter(x=>x.evidence==='bye-cell').length,1154);
});

test('filtered map and KPI share location evidence, including time, GPS-only and QoE grade',()=>{
 const all=summarizeMappedLocationEvidence(build());
 const time=summarizeMappedLocationEvidence(build(displayed,scope({from:'10:00',to:'10:59'})));
 assert.deepEqual([time.G,time.T,time.U],[11,13,24]);
 assert.equal(time.U,all.hourly[10]);
 const gps=summarizeMappedLocationEvidence(build(displayed,scope({evidence:'gnss'})));
 assert.deepEqual([gps.G,gps.T,gps.U],[131,0,131]);
 const radio=summarizeMappedLocationEvidence(build(displayed,scope({evidence:'estimated'})));
 assert.deepEqual([radio.G,radio.T,radio.U],[0,106,106]);
 const bye=summarizeMappedLocationEvidence(build(displayed,scope({evidence:'bye-cell'})));
 assert.deepEqual([bye.G,bye.T,bye.U],[0,0,0]);
 const good=summarizeMappedLocationEvidence(build(displayed,scope({band:'good'})));
 assert.deepEqual([good.G,good.T,good.U],[286,150,436]);
 const first=build().locations.find(x=>x.evidence==='gnss');
 assert(first,'expected at least one GPS call');
 const selected=displayed.calls.find(c=>c.id===first.callId);
 assert(selected);
 const selectedOverview=scopeOverviewToCustomers(displayed,[selected.customerId]);
 const single=summarizeMappedLocationEvidence(build(selectedOverview));
 assert(single.U>0 && single.U<=all.U);
 assert.equal(single.hourly.reduce((sum,n)=>sum+n,0),single.U);
});

test('duplicate locations can never inflate evidence count, and GPS takes priority',()=>{
 const original=build();
 const known=original.locations.find(x=>x.evidence==='gnss');
 assert(known);
 const copy={...original,locations:[...original.locations,{...known,evidence:'estimated'},known]};
 const expected=summarizeMappedLocationEvidence(original);
 assert.deepEqual(summarizeMappedLocationEvidence(copy),expected);
});

test('improvement2 fifth card uses map-derived KPI; no old all-grade 425 figure',()=>{
 const ui=fs.readFileSync('components/analyst/quality-proposal-four.tsx','utf8');
 assert(ui.includes('summarizeMappedLocationEvidence(geographicModel)'));
 assert(ui.includes("'저품질통화 (위치활용)'"));
 assert(ui.includes("mappedLocation?n(mappedLocation.U)+'건':'—'"));
 assert(!ui.includes("sub:'GPS + 삼각 측량 근사 합계'"));
 assert(ui.includes('GPS ${n(mappedLocation.G)}건'));
 assert(ui.includes('mappedLocation.G'));
 assert(ui.includes('mappedLocation.T'));
 assert(ui.includes('locationRate:mappedLocationRate'));
 assert(ui.includes('locationRateLabel:mappedLocationRateLabel'));
 assert(ui.includes('entry.locationRateLabel} {entry.locationRate'));
 assert(!ui.includes('data:mappedLocation?.hourly'));
 assert(!ui.includes('locationCoverage.U'));
});
