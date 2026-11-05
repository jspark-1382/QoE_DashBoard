/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../analyst-ts-loader.cjs');

const { buildImprovedView, buildOriginalCallLink } = load('lib/analyst/improved-overview.ts');
const root = path.resolve(__dirname, '../..');
const date = '2026-10-30';
const dataPath = path.join(root, 'public/analyst-overview/MDT/2026-10-30.json');
const source = fs.readFileSync(path.join(root, 'components/analyst/analyst-dashboard.tsx'), 'utf8');
const original = fs.readFileSync(path.join(root, 'components/analyst/quality-overview.tsx'), 'utf8');

test('old quality overview is preserved and explicitly named 기존안', () => {
  assert(source.includes('QualityTopNav'));
  const shared=fs.readFileSync(path.join(root,'components/analyst/quality-top-nav.tsx'),'utf8');
  assert(shared.includes('>기존안</Link>'));
  assert(shared.includes('품질 현황'));
  assert(!source.includes('overview-proposal-1'));
  assert(!source.includes('overview-proposal-2'));
  assert(!source.includes('overview-proposal-3'));
  assert.ok(fs.existsSync(path.join(root, 'app/overview-improved/page.tsx')));
  assert.ok(!original.includes('ImprovedQualityOverview'), 'existing overview remains isolated');
});

test('new overview uses the same real 10/30 CDR and keeps missing MOS outside poor denominator', () => {
  const overview = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const full = buildImprovedView(overview, {
    from:'00:00',to:'23:59',hour:null,districtId:null,evidence:'all',
  });
  assert(full.validRange);
  assert.equal(full.globalSummary.total, 37731);
  assert.equal(full.globalSummary.evaluated, 26688);
  assert.equal(full.globalSummary.unscored, 11043);
  assert.equal(full.globalSummary.poor, 288);
  assert(full.meanMos >= 1 && full.meanMos <= 5);
  assert.equal(full.hourly.length,24);
  assert.equal(full.hourly.reduce((n,row)=>n+row.total,0),37731);
  assert.equal(full.hourly.reduce((n,row)=>n+row.evaluated,0),26688);
  assert.equal(full.hourly.reduce((n,row)=>n+row.poor,0),288);
  assert.equal(full.locatedPoorCalls,overview.callLocations.filter(p=>p.mos!=null&&p.mos<3).length);
  assert.equal(full.locations.length,full.locatedPoorCalls);
  assert.equal(full.regions.length,new Set(full.locations.map(p=>p.areaId)).size);
  assert.equal(new Set(full.focusedCalls.map(c=>c.id)).size,full.focusedCalls.length,
    'a call crossing administrative boundaries must appear once in the list');
  assert.equal(full.mapCells.reduce((n,row)=>n+row.gnssCalls+row.estimatedCalls+row.byeCellCalls,0),
    full.locations.length,'position evidence is preserved in each region');
});

test('GNSS versus estimates and dong selection scope only occurrence markers, not nationwide CDR KPIs', () => {
  const overview = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const base = {from:'00:00',to:'23:59',hour:null,districtId:null,evidence:'all'};
  const all = buildImprovedView(overview,base);
  const gnss = buildImprovedView(overview,{...base,evidence:'gnss'});
  const radio = buildImprovedView(overview,{...base,evidence:'estimated'});
  assert.equal(gnss.locatedPoorCalls,all.locations.filter(p=>p.evidence==='gnss').length);
  assert.equal(radio.locatedPoorCalls,all.locations.filter(p=>p.evidence==='estimated').length);
  const bye=buildImprovedView(overview,{...base,evidence:'bye-cell'});
  assert.equal(bye.locatedPoorCalls,all.locations.filter(p=>p.evidence==='bye-cell').length);
  assert(bye.locations.every(point=>point.positionQuality==='bye-cell-site'));
  const fair=buildImprovedView(overview,{...base,band:'fair'});
  const good=buildImprovedView(overview,{...base,band:'good'});
  assert.equal(fair.locations.length,overview.callLocations.filter(p=>p.mos!=null&&p.mos>=3&&p.mos<3.5).length);
  assert.equal(good.locations.length,overview.callLocations.filter(p=>p.mos!=null&&p.mos>=3.5).length);
  assert(fair.locations.every(point=>point.mos>=3&&point.mos<3.5));
  assert(good.locations.every(point=>point.mos>=3.5));
  assert.equal(good.globalSummary.poor,all.globalSummary.poor);

  assert.equal(gnss.globalSummary.total,all.globalSummary.total);
  assert(gnss.locations.every(point=>point.evidence==='gnss'));
  assert(radio.locations.every(point=>point.evidence==='estimated'));
  const gaepo1 = all.regions.find(region=>region.id==='adm:11230680');
  assert(gaepo1,'Gaepo 1-dong should be present');
  const selected = buildImprovedView(overview,{...base,districtId:gaepo1.id});
  assert.equal(selected.locations.length,all.locations.filter(p=>p.areaId===gaepo1.id).length);
  assert(selected.locations.every(point=>point.areaId===gaepo1.id));
  assert.equal(selected.globalSummary.poor,288,'region filtering must not corrupt overall CDR stats');
  assert(selected.focusedCalls.length <= selected.locations.length);
});

test('hour and date range filter the map and update the corresponding hourly series', () => {
  const overview = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const base = {from:'00:00',to:'23:59',hour:null,districtId:null,evidence:'all'};
  const all = buildImprovedView(overview,base);
  const chosen = all.hourly.find(row=>row.poor>0);
  assert(chosen);
  const hour = buildImprovedView(overview,{...base,hour:chosen.hour});
  assert(hour.locations.every(point=>
    Math.floor((overview.calls.find(call=>call.id===point.callId)?.startSecond ?? -1)/3600)===chosen.hour));
  assert.equal(hour.globalSummary.total,all.globalSummary.total,
    'hour investigation changes linked map, not whole-scope summary');
  const oneHour = buildImprovedView(overview,{
    ...base,from:String(chosen.hour).padStart(2,'0')+':00',
    to:String(chosen.hour).padStart(2,'0')+':59',
  });
  assert.equal(oneHour.globalSummary.poor,chosen.poor);
  assert.equal(oneHour.hourly.reduce((sum,bin)=>sum+bin.poor,0),chosen.poor);
  const invalid = buildImprovedView(overview,{...base,from:'23:00',to:'09:00'});
  assert.equal(invalid.validRange,false);
  assert.equal(invalid.globalSummary.total,0);
});

test('call drilldown generates same original selected customer/call identity', () => {
  const overview = JSON.parse(fs.readFileSync(dataPath,'utf8'));
  const withLocation = overview.calls.find(call=>call.gridIds.length>0);
  assert(withLocation);
  const href = buildOriginalCallLink(withLocation,date);
  const query = new URLSearchParams(href.slice(href.indexOf('?')+1));
  assert.equal(query.get('source'),'MDT');
  assert.equal(query.get('view'),'contract');
  assert.equal(query.get('date'),date);
  assert.equal(query.get('customer'),withLocation.customerId);
  assert.equal(query.get('call'),withLocation.rawCallId);
});
