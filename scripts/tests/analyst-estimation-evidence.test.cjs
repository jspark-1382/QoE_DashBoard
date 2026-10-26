/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { load } = require('../analyst-ts-loader.cjs');
const { normalizeDay } = load('lib/analyst/data.ts');
const { estimateAdaptive } = load('lib/location-estimation/adaptive.ts');
const { estimationMethodLabel, estimationReason, estimationSummary } = load(
  'lib/analyst/estimation-evidence.ts',
);
const ds = { meta: {}, customers: [{ id: 'a' }] };
const stations = [
  [37, 127],
  [37.003, 127],
  [37, 127.004],
].map(([latitude, longitude], i) => ({
  latitude,
  longitude,
  baseStationId: `B${i}`,
  cellId: `C${i}`,
  frequency: 1800,
  isVirtual: false,
}));
function fixture(count) {
  const rows = Array.from({ length: Math.max(count, 1) }, (_, i) => {
    const raw = Array(22).fill(null);
    raw[0] = 3600 + i;
    raw[1] = `01:00:0${i}`;
    raw[10] = -90 - i;
    raw[16] = 1.8;
    raw[19] = 'call';
    raw[20] = 'ci';
    raw[21] = {
      gnss: false,
      baseStationId: `B${i}`,
      cellId: `C${i}`,
      frequency: 1800,
    };
    return raw;
  });
  return {
    date: '2026-01-01',
    customerId: 'a',
    baseStations: stations.slice(0, count),
    calls: [{ id: 'call', start: '01:00:00', end: '01:00:10', qoe: 1.8 }],
    samples: rows,
  };
}
for (const [count, method] of [
  [3, 'MULTILATERATION'],
  [2, 'WEIGHTED_2_SITE'],
  [1, 'CELL_SITE'],
  [0, 'INVALID'],
]) {
  const day = fixture(count),
    normalized = normalizeDay(ds, day, 'MDT');
  const rows = normalized.samples;
  const engine = estimateAdaptive(
    rows.map((s) => ({
      timestamp: s.timestamp,
      cellId: s.cellId,
      baseStationId: s.stationLat == null ? '' : s.baseStationId,
      frequency: s.frequency,
      rsrp: s.rsrp,
      rsrq: s.rsrq,
      sinr: s.sinr,
      streamId: 'call',
      sampleIndex: s.index,
      measuredLat: null,
      measuredLon: null,
    })),
    day.baseStations,
  );
  rows.forEach((s, i) => {
    const e = engine.positions[i];
    assert.equal(s.estimation.method, method);
    assert.equal(s.estimation.siteCount, count);
    for (const key of [
      'windowSec',
      'residualErrorM',
      'geometry',
      'jump',
      'warnings',
    ])
      assert.deepEqual(s.estimation[key], e[key]);
    assert.deepEqual(
      s.estimation.usedSites.map(
        ({ baseStationIds: _baseStationIds, ...site }) => site,
      ),
      e.usedSites,
    );
    s.estimation.usedSites.forEach((site) =>
      assert(
        site.baseStationIds.every((id) =>
          day.baseStations.some((b) => b.baseStationId === id),
        ),
      ),
    );
    assert.equal(s.lat, count >= 2 ? e.estimatedLat : null);
    assert.equal(s.lon, count >= 2 ? e.estimatedLon : null);
    assert.equal(s.qoe, 1.8);
  });
  assert.equal(normalized.calls[0].qoe, 1.8);
  assert.equal(
    estimationSummary(rows).unavailable,
    count < 2 ? rows.length : 0,
  );
  if (count < 2) assert.match(estimationReason(rows[0]), /고객 위치/);
}
const measured = fixture(3);
measured.samples[0][2] = 37.123;
measured.samples[0][3] = 127.456;
measured.samples[0][21].gnss = true;
const result = normalizeDay(ds, measured, 'MDT').samples[0];
assert.equal(result.lat, 37.123);
assert.equal(result.lon, 127.456);
assert.equal(result.locationSource, 'gnss');
assert.equal(result.estimation.method, 'MEASURED');
const single = fixture(1);
const row = single.samples[0];
row[2] = 37.1;
row[3] = 127.1;
row[21].gnss = true;
const allGnss = normalizeDay(ds, single, 'MDT').samples[0];
assert.equal(allGnss.estimation, undefined);
assert.equal(allGnss.lat, 37.1);
assert.equal(estimationMethodLabel('WEIGHTED_2_SITE'), '2개 기지국 가중중심');
assert.match(estimationMethodLabel('MULTILATERATION'), /다변측량/);
const indices = estimationSummary([
  {
    index: 77,
    lat: 37,
    lon: 127,
    locationSource: 'radio',
    estimation: { method: 'WEIGHTED_2_SITE' },
  },
]).radioIndices;
assert.deepEqual(indices, [77]);
console.log(
  'Estimation evidence: 3/2/1/0 sites, unchanged engine coordinates/QoE, GNSS priority, original indices passed',
);
