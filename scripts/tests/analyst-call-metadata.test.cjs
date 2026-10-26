/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('../analyst-ts-loader.cjs');
const { normalizeDay } = load('lib/analyst/data.ts');

const dataset = { meta: {}, customers: [{ id: 'customer', sourceContractId: '00001234' }] };
const sourceDay = (calls, samples = []) => ({
  key: 'customer:2026-09-15', customerId: 'customer', date: '2026-09-15',
  sampleCount: samples.length, calls, samples,
});
const sourceCall = (updates = {}) => ({
  id: 'cdr', start: '09:00:00', end: '09:00:02', qoe: null,
  mdtCount: 0, radioCount: 0, hasMdt: false, ...updates,
});

test('CDR cells retain leading zeroes without creating samples, locations, or a QoE score', () => {
  const result = normalizeDay(dataset, sourceDay([sourceCall({
    startCellId: '000123456789', endCellId: '000987654321',
  })]), 'MDT');
  const call = result.calls[0];
  assert.equal(call.startCellId, '000123456789');
  assert.equal(call.endCellId, '000987654321');
  assert.equal(call.contractId, '00001234');
  assert.equal(call.hasMdt, false);
  assert.equal(call.mdtCount, 0);
  assert.equal(call.validEventCount, 0);
  assert.equal(call.locationSource, 'unavailable');
  assert.equal(call.qoe, null);
  assert.deepEqual(call.sampleIndices, []);
  assert.deepEqual(result.samples, []);
  assert.deepEqual(result.baseStations, []);
});

test('older published calls default unavailable CDR cells to empty strings', () => {
  const call = normalizeDay(dataset, sourceDay([sourceCall()]), 'MDT').calls[0];
  assert.equal(call.startCellId, '');
  assert.equal(call.endCellId, '');
});

test('GNSS-free MDT remains MDT and never supplies the missing CDR cell IDs', () => {
  const raw = Array(22).fill(null);
  Object.assign(raw, {
    0: 32401, 1: '09:00:01', 10: -95, 12: 0, 16: 2.5, 19: 'mdt',
    21: { gnss: false, cellId: 'OBSERVED-CELL', baseStationId: 'OBSERVED-STATION' },
  });
  const call = normalizeDay(dataset, sourceDay([sourceCall({
    id: 'mdt', qoe: 2.5, mdtCount: 1, radioCount: 1, hasMdt: true,
  })], [raw]), 'MDT').calls[0];
  assert.equal(call.startCellId, '');
  assert.equal(call.endCellId, '');
  assert.equal(call.hasMdt, true);
  assert.equal(call.mdtCount, 1);
  assert.equal(call.gnssCount, 0);
  assert.equal(call.qoe, 2.5);
  assert.deepEqual(call.sampleIndices, [0]);
});

for (const { name, fields, seconds } of [
  {
    name: 'clock-only overnight calls count the interval across midnight',
    fields: { start: '23:59:50', end: '00:00:10' }, seconds: 20,
  },
  {
    name: 'full timestamps preserve exact durations longer than one day',
    fields: {
      start: '23:59:50', end: '00:00:10',
      startTimestamp: '2026-09-15T23:59:50+09:00',
      endTimestamp: '2026-09-18T00:00:10+09:00',
    }, seconds: 172820,
  },
  {
    name: 'invalid timestamps fall back to clock-based overnight duration',
    fields: {
      start: '23:59:50', end: '00:00:10',
      startTimestamp: 'invalid', endTimestamp: '2026-09-16T00:00:10+09:00',
    }, seconds: 20,
  },
  {
    name: 'reversed timestamps fall back to clock-based duration',
    fields: {
      start: '23:59:50', end: '00:00:10',
      startTimestamp: '2026-09-17T23:59:50+09:00',
      endTimestamp: '2026-09-16T00:00:10+09:00',
    }, seconds: 20,
  },
]) {
  test(name, () => {
    const call = normalizeDay(dataset, sourceDay([sourceCall(fields)]), 'MDT').calls[0];
    assert.equal(call.durationSeconds, seconds);
    assert.equal(call.startSecond, 86390);
    assert.equal(call.endSecond, 10);
    assert.equal(call.qoe, null);
    assert.equal(call.hasMdt, false);
    assert.equal(call.locationSource, 'unavailable');
  });
}
