/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../analyst-ts-loader.cjs');

const { buildImprovedView } = load('lib/analyst/improved-overview.ts');
const base = { from:'00:00', to:'23:59', hour:null, districtId:null, evidence:'all' };

function fixture() {
  const rows = [
    ['a-gnss', 'customer-a', 9, 2.1, 'area-a', 'gnss'],
    ['a-estimated', 'customer-a', 9, 2.2, 'area-a', 'estimated'],
    ['a-bye', 'customer-b', 10, 2.3, 'area-a', 'bye-cell'],
    ['b-gnss', 'customer-a', 9, 2.4, 'area-b', 'gnss'],
    ['b-estimated', 'customer-b', 10, 2.5, 'area-b', 'estimated'],
    ['b-bye', 'customer-b', 9, 2.6, 'area-b', 'bye-cell'],
    ['a-fair', 'customer-a', 9, 3.2, 'area-a', 'gnss'],
    ['b-fair', 'customer-a', 9, 3.3, 'area-b', 'estimated'],
    ['a-good', 'customer-a', 9, 4.2, 'area-a', 'bye-cell'],
    ['b-good', 'customer-b', 9, 4.3, 'area-b', 'gnss'],
    ['a-unscored', 'customer-a', 9, null, 'area-a', 'gnss'],
    ['a-unlocated', 'customer-a', 9, 2.8, null, null],
  ];
  return {
    schemaVersion:'analyst-overview-v1', source:'MDT', date:'2026-10-30', gridSizeM:60,
    spatialUnit:'administrative-dong', cells:[],
    administrativeDongs:[
      { id:'area-a', label:'A district', lat:37.5, lon:127, coordinates:[] },
      { id:'area-b', label:'B district', lat:37.6, lon:127.1, coordinates:[] },
    ],
    calls:rows.map(([id, customerId, hour, mos, areaId, evidence]) => ({
      id, rawCallId:id, customerId, contractId:null,
      start:`${hour}:00:00`, end:`${hour}:01:00`, startSecond:hour * 3600,
      mos, qoe:mos !== null && mos < 3 ? 4.8 : 1,
      locationSource:evidence === 'gnss' ? 'gnss' : evidence === 'estimated' ? 'radio' : evidence === 'bye-cell' ? 'station' : 'unavailable',
      gridIds:areaId ? [areaId] : [],
      spatialEvidence:evidence ?? 'unavailable', site:areaId ?? 'unknown',
    })),
    callLocations:rows.filter((row) => row[4]).map(([callId, , hour, mos, areaId, evidence]) => ({
      callId, areaId, lat:areaId === 'area-a' ? 37.5 : 37.6,
      lon:areaId === 'area-a' ? 127 : 127.1, evidence, start:`${hour}:00:00`, mos,
    })),
  };
}

test('district caption counts its mapped calls while both district rankings remain available', () => {
  const overview = fixture();
  const original = structuredClone(overview);
  const all = buildImprovedView(overview, base);
  const focused = buildImprovedView(overview, { ...base, districtId:'area-a' });

  assert.equal(all.locatedPoorCalls, 6);
  assert.equal(focused.locatedPoorCalls, 3, 'caption must count only the selected district');
  assert.deepEqual(focused.locations.map((point) => point.callId), ['a-gnss', 'a-estimated', 'a-bye']);
  assert.equal(focused.focusedCalls.length, 3);
  assert.equal(focused.markerByCall.size, 3);
  assert.deepEqual(focused.regions.map((region) => [region.id, region.poorCalls]), [
    ['area-a', 3], ['area-b', 3],
  ]);
  assert.deepEqual(focused.mapCells.map((cell) => [cell.id, cell.total, cell.callIds]), [
    ['area-a', 3, ['a-gnss', 'a-estimated', 'a-bye']],
    ['area-b', 3, ['b-gnss', 'b-estimated', 'b-bye']],
  ]);
  assert.deepEqual(focused.globalSummary, all.globalSummary);
  assert.deepEqual(overview, original, 'building a focused view must not mutate its input');
});

test('focused caption respects evidence, hour, time, customer and selected MOS grade', () => {
  const overview = fixture();
  const cases = [
    { scope:{ evidence:'gnss' }, ids:['a-gnss'], regions:[['area-a', 1], ['area-b', 1]] },
    { scope:{ evidence:'estimated' }, ids:['a-estimated'], regions:[['area-a', 1], ['area-b', 1]] },
    { scope:{ evidence:'bye-cell' }, ids:['a-bye'], regions:[['area-a', 1], ['area-b', 1]] },
    { scope:{ hour:9 }, ids:['a-gnss', 'a-estimated'], regions:[['area-a', 2], ['area-b', 2]] },
    { scope:{ from:'10:00', to:'10:59' }, ids:['a-bye'], regions:[['area-a', 1], ['area-b', 1]] },
    { scope:{ customerIds:new Set(['customer-a']) }, ids:['a-gnss', 'a-estimated'], regions:[['area-a', 2], ['area-b', 1]] },
    { scope:{ hour:9, customerIds:new Set(['customer-b']) }, ids:[], regions:[['area-b', 1]] },
    { scope:{ band:'fair' }, ids:['a-fair'], regions:[['area-a', 1], ['area-b', 1]] },
    { scope:{ band:'good' }, ids:['a-good'], regions:[['area-a', 1], ['area-b', 1]] },
    { scope:{ districtId:'unknown' }, ids:[], regions:[['area-a', 3], ['area-b', 3]] },
  ];
  for (const { scope, ids, regions } of cases) {
    const view = buildImprovedView(overview, { ...base, districtId:'area-a', ...scope });
    const label = JSON.stringify({ ...scope, customerIds:scope.customerIds && [...scope.customerIds] });
    assert.equal(view.locatedPoorCalls, ids.length, label);
    assert.deepEqual(view.locations.map((point) => point.callId), ids, label);
    assert.deepEqual(view.focusedCalls.map((call) => call.id), ids, label);
    assert.deepEqual(view.regions.map((region) => [region.id, region.poorCalls]), regions, label);
    assert.deepEqual(view.mapCells.map((cell) => [cell.id, cell.total]), regions, label);
  }
});

test('duplicate location rows count once in the focused caption and district rankings', () => {
  const overview = fixture();
  overview.callLocations.push({ ...overview.callLocations[0] });
  const focused = buildImprovedView(overview, { ...base, districtId:'area-a' });

  assert.equal(focused.locations.length, 4, 'location evidence is preserved');
  assert.equal(focused.locatedPoorCalls, 3, 'caption counts distinct calls, not rows');
  assert.equal(focused.focusedCalls.length, 3);
  assert.equal(focused.markerByCall.size, 3);
  assert.deepEqual(focused.regions.map((region) => [region.id, region.poorCalls]), [
    ['area-a', 3], ['area-b', 3],
  ]);
  assert.deepEqual(focused.mapCells[0].callIds, ['a-gnss', 'a-estimated', 'a-bye']);
});
