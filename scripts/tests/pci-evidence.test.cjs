/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner loads the real TypeScript helper. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../analyst-ts-loader.cjs');
const { getPciEvidence, selectExactCallStations, buildCallPciRows } = load('lib/analyst/pci-evidence.ts');

const station = (overrides = {}) => ({
  baseStationId: 'RU-A', cellId: 'CELL-A', latitude: 37, longitude: 127,
  frequency: null, isVirtual: false, pci: 0, inventoryPciStatus: 'valid',
  inventorySource: '수도권_LTE_261104.xlsx', ...overrides,
});
const identity = { baseStationId: 'RU-A', cellId: 'CELL-A' };

test('registered PCI 0 is valid and observed PCI remains the original value', () => {
  const stations = [station()];
  const before = JSON.stringify(stations);
  const matched = getPciEvidence(stations, identity, 0);
  assert.equal(matched.comparison, 'match');
  assert.equal(matched.registeredPci, 0);
  assert.equal(matched.observedPci, 0);
  assert.deepEqual(matched.inventorySources, ['수도권_LTE_261104.xlsx']);
  const different = getPciEvidence(stations, identity, 12);
  assert.equal(different.comparison, 'mismatch');
  assert.equal(different.observedPci, 12);
  assert.equal(different.registeredPci, 0);
  assert.equal(JSON.stringify(stations), before);
});

test('RU and Cell must both match; another sector or reused PCI cannot supply registered evidence', () => {
  const stations = [station(), station({ baseStationId: 'RU-B', cellId: 'CELL-B', pci: 0 })];
  assert.equal(getPciEvidence(stations, { baseStationId: 'RU-A', cellId: 'CELL-B' }, 0).reason, 'unregistered');
  assert.equal(getPciEvidence(stations, { baseStationId: '', cellId: 'CELL-A' }, 0).reason, 'missing-identity');
  const selected = selectExactCallStations(stations, [identity, { baseStationId: 'RU-B', cellId: 'CELL-A' }]);
  assert.deepEqual(selected, [stations[0]]);
});

test('conflicting, missing, invalid or partially missing registration cannot be arbitrarily resolved', () => {
  for (const stations of [
    [station(), station({ pci: 42 })],
    [station({ pci: null, inventoryPciStatus: 'conflict', inventoryPciCandidates: [0, 42] })],
    [station(), station({ pci: null, inventoryPciStatus: 'missing' })],
    [station({ pci: 900, inventoryPciStatus: 'invalid' })],
  ]) {
    const evidence = getPciEvidence(stations, identity, 0);
    assert.equal(evidence.comparison, 'unknown');
    assert.equal(evidence.registeredPci, null);
  }
  const duplicate = getPciEvidence([station(), station()], identity, 0);
  assert.equal(duplicate.comparison, 'match');
  const conflict = getPciEvidence([station(), station({ pci: 42 })], identity, 0);
  assert.deepEqual(conflict.registeredCandidates, [0, 42]);
});

test('missing or invalid original PCI is unknown, and raw invalid values are preserved', () => {
  for (const original of [null, undefined, NaN, -1, 504, 1.5]) {
    const evidence = getPciEvidence([station()], identity, original);
    assert.equal(evidence.comparison, 'unknown');
    assert.equal(evidence.registeredPci, 0);
    assert.equal(evidence.observedPci, original ?? null);
  }
});

test('call summary groups exact sectors, exposes per-observation results and keeps unregistered rows', () => {
  const observations = [
    { ...identity, pci: 0 }, { ...identity, pci: 42 }, { ...identity, pci: null },
    { baseStationId: 'RU-A', cellId: 'CELL-B', pci: 0 },
  ];
  const before = JSON.stringify(observations);
  const rows = buildCallPciRows([station()], observations);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].observedPcis, [0, 42]);
  assert.equal(rows[0].matched, 1);
  assert.equal(rows[0].mismatched, 1);
  assert.equal(rows[0].unknown, 1);
  assert.equal(rows[0].comparison, 'mismatch');
  assert.equal(rows[1].comparison, 'unknown');
  assert.equal(rows[1].registeredPci, null);
  assert.equal(JSON.stringify(observations), before);
});

test('CDR-only BYE station shows registered PCI with no invented observation', () => {
  const rows = buildCallPciRows([], [], [station()]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].registeredPci, 0);
  assert.deepEqual(rows[0].observedPcis, []);
  assert.equal(rows[0].comparison, 'unknown');
  assert.equal(rows[0].reason, 'observed-missing');
  assert.equal(rows[0].observationCount, 0);
});

test('NR BYE PCI is valid without inventing an observation or matching an LTE sector', () => {
  const nr = station({ technology: 'NR', pci: 1007 });
  const [row] = buildCallPciRows([], [], [nr]);
  assert.equal(row.registeredPci, 1007);
  assert.equal(row.reason, 'observed-missing');
  assert.equal(row.comparison, 'unknown');
  assert.deepEqual(row.observedPcis, []);
  assert.equal(selectExactCallStations([nr], [identity]).length, 0);
  assert.equal(getPciEvidence([nr], { ...identity, technology: 'NR' }, 1007).comparison, 'match');
  assert.equal(getPciEvidence([nr], identity, 0).reason, 'unregistered');
});

test('mixed known and missing observations explain the unknown portion regardless of row order', () => {
  for (const pcis of [[0, null], [null, 0]]) {
    const [row] = buildCallPciRows([station()], pcis.map((pci) => ({ ...identity, pci })));
    assert.equal(row.comparison, 'unknown');
    assert.equal(row.reason, 'observed-missing');
    assert.equal(row.matched, 1);
    assert.equal(row.unknown, 1);
  }
});
