/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { load } = require('./analyst-ts-loader.cjs');
module.exports = { load };
if (require.main === module) {
  const { normalizeDay, isPoorCall } = load('lib/analyst/data.ts');
  const { buildOverview, getOverviewSummary, getOverviewCells } = load(
    'lib/analyst/overview.ts',
  );
  const ds = {
    meta: { dates: ['2026-01-01'], poorQoeThreshold: 2.5 },
    customers: [{ id: 'a', sourceContractId: '00123' }],
    days: [],
  };
  const raw = [
    3600,
    '01:00:00',
    37,
    127,
    'site',
    '',
    '',
    '',
    'LTE',
    0,
    0,
    0,
    0,
    null,
    null,
    null,
    0,
    '',
    '',
    'c',
    '1',
    { gnss: false, inCallWindow: true },
  ];
  const day = {
    key: 'a:d',
    customerId: 'a',
    date: '2026-01-01',
    sampleCount: 1,
    samples: [raw],
    calls: [
      { id: 'c', start: '01:00:00', end: '01:00:01', qoe: 0 },
      { id: 'empty', start: '02:00:00', end: '02:00:01', qoe: null },
    ],
  };
  let n = normalizeDay(ds, day, 'MDT');
  assert.equal(n.calls.length, 2);
  assert.equal(n.contractId, '00123');
  assert.equal(n.samples[0].rsrp, 0);
  assert.equal(n.samples[0].lat, null);
  assert.equal(n.samples[0].locationSource, 'unavailable');
  assert(isPoorCall(0));
  assert(!isPoorCall(2.5));
  assert(!isPoorCall(null));
  n = normalizeDay(ds, day, '실측');
  assert.equal(n.samples[0].locationSource, 'unavailable');
  const measured = { ...day, samples: [raw.slice(0, 21), raw.slice(0, 21)] };
  const ov = buildOverview(ds, [measured], '실측', day.date);
  assert.equal(ov.calls.length, 2);
  assert.equal(ov.cells[0].callIds.length, 1);
  assert.equal(getOverviewSummary(ov.calls, 2.5).unscored, 1);
  assert.equal(getOverviewCells(ov, ov.calls, 2.5)[0].evaluated, 1);
  console.log(
    'PASS analyst normalization, missing calls, zeros, location provenance and unique grid denominator',
  );
}
