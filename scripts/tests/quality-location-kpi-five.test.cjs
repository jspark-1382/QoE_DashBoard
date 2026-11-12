// Numerical source regressions retain the original two-workbook cohort.
const {historicalRead,historicalJson,skipHistoricalSource}=require('./published-fixture.cjs');
if(skipHistoricalSource(__filename))return;
/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
const {buildQualityImprovementMetrics}=load('lib/analyst/quality-improvement-adapter.ts');
const {combineDateOverviews}=load('lib/analyst/date-range.ts');
const index=historicalJson('../../public/quality-improvement/index.json');
const dates=index.availableDates;
const overviews=dates.map(date=>JSON.parse(historicalRead('public/analyst-overview/MDT/'+date+'.json','utf8')));
const partitions=index.evidence.map(e=>JSON.parse(historicalRead('public/quality-improvement/'+e.path,'utf8')));
const allEvidence={revision:index.sourceRevision,policy:'strict-3-site-v1',
 censusComplete:partitions.every(p=>p.censusComplete),records:partitions.flatMap(p=>p.records)};
const scope=(dateStart,dateEnd,extra={})=>({dateStart,dateEnd,from:'00:00',to:'23:59',
 customerIds:[],...extra});

test('source evidence coverage of all grades remains 425, distinct from map KPI',()=>{
 const combined=combineDateOverviews(overviews);
 const metrics=buildQualityImprovementMetrics(combined,scope(dates[0],dates.at(-1)),allEvidence);
 assert.equal(metrics.evidenceStatus,'complete');
 assert.deepEqual([metrics.coverage.G,metrics.coverage.T,metrics.coverage.U],[425,0,425]);
 assert.equal(metrics.coverage.U,metrics.coverage.G+metrics.coverage.T);
 assert.equal(metrics.locationHourly.length,24);
 assert.equal(metrics.locationHourly.reduce((sum,value)=>sum+value,0),425);
 assert.equal(metrics.coverage.N,184232);
});
test('selected date, time and customer filters change the location KPI consistently',()=>{
 const date='2026-10-30';
 const evidence={revision:index.sourceRevision,policy:'strict-3-site-v1',
  censusComplete:true,records:partitions.at(-1).records};
 const overview=overviews.at(-1);
 const full=buildQualityImprovementMetrics(overview,scope(date,date),evidence);
 assert.equal(full.coverage.G,95);
 assert.equal(full.coverage.T,0);
 assert.equal(full.locationHourly.reduce((a,b)=>a+b,0),95);
 const filtered=buildQualityImprovementMetrics(overview,scope(date,date,{from:'10:00',to:'10:59'}),evidence);
 assert.equal(filtered.coverage.U,full.locationHourly[10]);
 assert.equal(filtered.locationHourly.reduce((a,b)=>a+b,0),filtered.coverage.U);
 const selectedCall=overview.calls.find(c=>c.mos!=null&&c.mos>=1&&c.mos<=5&&evidence.records.some(r=>r.callId===date+':'+c.id&&r.kind==='gnss'&&r.status==='accepted'));
 assert(selectedCall);
 const customer=buildQualityImprovementMetrics(overview,scope(date,date,{customerIds:[selectedCall.customerId]}),evidence);
 assert(customer.coverage.U>0&&customer.coverage.U<=full.coverage.U);
 assert.equal(customer.locationHourly.reduce((a,b)=>a+b,0),customer.coverage.U);
});
test('visual layout adds a fifth card only to improvement 2, with truthful evidence fallback',()=>{
 const ui=historicalRead('components/analyst/quality-proposal-four.tsx','utf8');
 const css=historicalRead('components/analyst/quality-proposal-four.module.css','utf8');
 assert(ui.includes("data-five={improvementTwo?'true':undefined}"));
 assert(ui.includes("...(improvementTwo?[{name:selectedBand==='good'"));
 assert(ui.includes("mappedLocation?n(mappedLocation.U)+'건':'—'"));
 assert(!ui.includes("sub:'GPS + 삼각 측량 근사 합계'"));
 assert(ui.includes('삼각 측량 근사 ${n(mappedLocation.T)}건'));
 assert(ui.includes('mappedLocation.G'));
 assert(ui.includes('mappedLocation.T'));
 assert(ui.includes('locationRate:mappedLocationRate'));
 assert(ui.includes('locationRateLabel:mappedLocationRateLabel'));
 assert(ui.includes('entry.locationRateLabel} {entry.locationRate'));
 assert(!ui.includes('data:mappedLocation?.hourly'));
 assert(css.includes('.kpis[data-five="true"]{grid-template-columns:repeat(5'));
 assert(css.includes('@media(max-width:900px){.kpis[data-five="true"]'));
});
