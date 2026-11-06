/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load } = require('../analyst-ts-loader.cjs');
const helper = fs.existsSync('lib/analyst/customer-overview-scope.ts') ? load('lib/analyst/customer-overview-scope.ts') : {};
const { buildImprovedView } = load('lib/analyst/improved-overview.ts');
const { calculateProposalGrades } = load('lib/analyst/quality-proposal-metrics.ts');
const { buildFourthHourly } = load('lib/analyst/quality-proposal-four.ts');
const { getOverviewAnalytics } = load('lib/analyst/overview-analytics.ts');
const { onlyDropCalls } = load('lib/analyst/sip-drop-overview.ts');
function fixture() {
  const calls = [
    ['c1:poor','c1',2.1,'A: Normal'], ['c1:unlocated','c1',2.5,'B: Drop'],
    ['c1:good','c1',4.2,'A: Normal'], ['c2:poor','c2',2.2,'B: Drop'],
    ['c2:missing','c2',null,'A: Normal'], ['c3:poor','c3',1.5,'A: Normal'],
  ].map(([id,customerId,mos,sipCause])=>({id,rawCallId:id,customerId,contractId:'000'+customerId,
    start:'10:00:00',end:'10:01:00',startSecond:36000,mos,qoe:mos,sipCause,
    locationSource:'unavailable',gridIds:['dong'],site:''}));
  return {schemaVersion:'analyst-overview-v1',source:'MDT',date:'2026-10-30',sourceRevision:'unchanged',gridSizeM:60,
    calls,cells:[{id:'dong',lat:37.5,lon:127,label:'지역',callIds:calls.map(c=>c.id)}],
    administrativeDongs:[{id:'dong',label:'지역',lat:37.5,lon:127,coordinates:[]}],
    callLocations:calls.filter(c=>!['c1:unlocated','c2:missing'].includes(c.id)).map(c=>({
      callId:c.id,areaId:'dong',lat:37.5,lon:127,evidence:'gnss',start:c.start,mos:c.mos}))};
}
test('multiple customer IDs scope the call union, each location and cell membership without mutating input',()=>{
  assert.equal(typeof helper.scopeOverviewToCustomers,'function');
  const source=fixture(), before=structuredClone(source);
  const scoped=helper.scopeOverviewToCustomers(source,['c1','c2','c1']);
  assert.deepEqual(scoped.calls.map(c=>c.id),source.calls.filter(c=>c.customerId!=='c3').map(c=>c.id));
  assert.deepEqual(scoped.callLocations.map(p=>p.callId),['c1:poor','c1:good','c2:poor']);
  assert.deepEqual(scoped.cells[0].callIds,scoped.calls.map(c=>c.id));
  assert.equal(scoped.administrativeDongs,source.administrativeDongs);
  assert.equal(scoped.sourceRevision,'unchanged');
  assert.deepEqual(source,before);
});
test('all-customer reset preserves the source while unknown selected IDs remain explicitly empty',()=>{
  const source=fixture();
  assert.equal(helper.scopeOverviewToCustomers(source,[]),source);
  const empty=helper.scopeOverviewToCustomers(source,['missing']);
  assert.deepEqual(empty.calls,[]);assert.deepEqual(empty.callLocations,[]);
  assert.ok(empty.cells.every(c=>!c.callIds.length));
  assert.equal(helper.scopeOverviewToCustomers(null,['c1']),null);
});
test('selected overview drives KPI, chart, map, ranking and Drop calls from the same population',()=>{
  const scoped=helper.scopeOverviewToCustomers(fixture(),['c1','c2']);
  const grades=calculateProposalGrades(scoped,'00:00','23:59');
  assert.equal(grades.evaluated,4);assert.equal(grades.unavailable,1);assert.equal(grades.bands[0].count,3);
  const hourly=buildFourthHourly(scoped,'00:00','23:59');
  assert.equal(hourly[10].total,5);assert.equal(hourly[10].poor,3);
  const analytics=getOverviewAnalytics(scoped.calls,'mos',3);
  assert.deepEqual(new Set(analytics.experience.find(x=>x.id==='affected').customerIds),new Set(['c1','c2']));
  const model=buildImprovedView(scoped,{from:'00:00',to:'23:59',hour:null,districtId:null,evidence:'all'});
  assert.equal(model.globalSummary.total,5);assert.equal(model.locatedPoorCalls,2);
  assert.deepEqual(new Set(model.focusedCalls.map(c=>c.customerId)),new Set(['c1','c2']));
  assert.equal(model.regions[0].customerCount,2);
  const drop=onlyDropCalls(scoped);
  assert.deepEqual(drop.calls.map(c=>c.id),['c1:unlocated','c2:poor']);
  assert.deepEqual(drop.callLocations.map(p=>p.callId),['c2:poor']);
  const narrowed=buildImprovedView(scoped,{from:'00:00',to:'23:59',hour:10,districtId:'dong',evidence:'gnss',customerIds:new Set(['c2'])});
  assert.deepEqual(narrowed.focusedCalls.map(c=>c.id),['c2:poor']);
});
test('a selected unlocated customer contributes to totals even when no map position exists',()=>{
  const source=fixture();source.callLocations=[];
  const scoped=helper.scopeOverviewToCustomers(source,['c1']);
  const model=buildImprovedView(scoped,{from:'00:00',to:'23:59',hour:null,districtId:null,evidence:'all'});
  assert.equal(model.globalSummary.total,3);assert.equal(model.locatedPoorCalls,0);assert.deepEqual(model.regions,[]);
});
