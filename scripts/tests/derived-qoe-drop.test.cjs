// Historical source assertions use the preserved original cohort; current sources have a separate census test.
const {historicalRead,historicalJson,skipHistoricalSource}=require('./published-fixture.cjs');
if(skipHistoricalSource(__filename))return;
/* eslint-disable no-restricted-syntax */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
const {deriveCallQoe,SIP_DROP_QOE_PENALTY}=load('lib/analyst/derived-qoe.ts');
const {onlyDropCalls}=load('lib/analyst/sip-drop-overview.ts');
const {calculateProposalGrades}=load('lib/analyst/quality-proposal-metrics.ts');
const {buildFourthHourly,fourthBandCalls}=load('lib/analyst/quality-proposal-four.ts');
const {getOverviewAnalytics}=load('lib/analyst/overview-analytics.ts');
const {loadOverview}=load('lib/analyst/data-loader.ts');
const raw=JSON.parse(historicalRead('public/analyst-overview/MDT/2026-10-30.json','utf8'));
test('the initial QoE rule uses only the original MOS(v5) and SIP CDR 11.REASON',()=>{
  assert.equal(SIP_DROP_QOE_PENALTY,2.5);
  for(const reason of ['H: Drop','H : Drop/V : Rx_RTP_middle_Loss','C^H^J^K','B: Drop']){
    assert.equal(deriveCallQoe(5,reason),2.5);
    assert.equal(deriveCallQoe(2,reason),-0.5);
    assert.equal(deriveCallQoe(1,reason),-1.5);
  }
  assert.equal(deriveCallQoe(4.8,'A: Normal'),4.8);
  assert.equal(deriveCallQoe(4.8,'K: No_RTP'),4.8);
  assert.equal(deriveCallQoe(null,'H: Drop'),null);
  assert.equal(deriveCallQoe(0,'H: Drop'),null);
  assert.equal(deriveCallQoe(5.01,'H: Drop'),null);
  assert.equal(deriveCallQoe(Number.NaN,'H: Drop'),null);
});
test('real 2026-10-30 Drop has no good or fair QoE, while raw CDR stays unchanged',()=>{
  const original=raw.calls.map(c=>[c.id,c.mos,c.qoe]);
  const dropped=onlyDropCalls(raw);
  assert.equal(dropped.calls.length,53);
  const grades=calculateProposalGrades(dropped,'00:00','23:59');
  assert.equal(grades.evaluated,45);
  assert.equal(grades.unavailable,8);
  assert.deepEqual(grades.bands.map(x=>x.count),[45,0,0]);
  assert.equal(fourthBandCalls(dropped.calls,'good').length,0);
  assert.equal(fourthBandCalls(dropped.calls,'fair').length,0);
  const hourly=buildFourthHourly(dropped,'00:00','23:59');
  assert.equal(hourly.reduce((sum,h)=>sum+h.poor,0),45);
  const adjusted=raw.calls.map(c=>({...c,qoe:deriveCallQoe(c.mos,c.sipCause)}));
  const all=calculateProposalGrades({...raw,calls:adjusted},'00:00','23:59');
  assert.deepEqual(all.bands.map(x=>x.count),[325,439,25924]);
  const analytics=getOverviewAnalytics(adjusted,'qoe',3);
  assert.deepEqual(analytics.bands.map(x=>x.count),[25924,439,325]);
  assert.deepEqual(raw.calls.map(c=>[c.id,c.mos,c.qoe]),original,'raw source cannot be altered');
});
test('the first data load derives QoE from immutable MOS rather than relying on old alias',async()=>{
  const fetchBefore=global.fetch;
  const source=raw.calls.find(c=>c.mos>=3.5&&deriveCallQoe(c.mos,c.sipCause)<3);
  assert(source,'must include a real previously-good Drop');
  const dataset={meta:{revision:raw.sourceRevision,dates:[raw.date],partitioned:true,qoeBasis:'rtcp-mos-v5'},customers:[],days:[]};
  global.fetch=async()=>({ok:true,status:200,json:async()=>raw});
  try{
    const data=await loadOverview(dataset,'MDT',raw.date);
    const actual=data.calls.find(c=>c.id===source.id);
    assert(actual);
    assert.equal(actual.mos,source.mos);
    assert.equal(actual.qoe,source.mos-2.5);
    assert.equal(raw.calls.find(c=>c.id===source.id).qoe,source.qoe);
    assert.deepEqual(calculateProposalGrades(onlyDropCalls(data),'00:00','23:59').bands.map(x=>x.count),[45,0,0]);
  }finally{global.fetch=fetchBefore;}
});
