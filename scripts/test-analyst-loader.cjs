/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { load } = require('./analyst-ts-loader.cjs');
const { normalizeDay, timeToSecond } = load('lib/analyst/data.ts');
const ds = {
  meta: { dates: ['2026-01-01'], poorQoeThreshold: 2.5, revision: 'r1' },
  customers: [],
  days: [],
};
const station = (baseStationId, latitude, longitude, cellId = '') => ({
  baseStationId,
  cellId,
  latitude,
  longitude,
  frequency: null,
  isVirtual: false,
});
const raw = (second, id, meta = {}, lat = null, lon = null) => [
  second,
  `01:00:${String(second - 3600).padStart(2, '0')}`,
  lat,
  lon,
  'site',
  '',
  '',
  '',
  'LTE',
  0,
  -90,
  -10,
  10,
  null,
  null,
  null,
  1,
  '',
  '',
  id,
  '1',
  {
    timestamp: `2026-01-01T01:00:${String(second - 3600).padStart(2, '0')}+09:00`,
    inCallWindow: true,
    ...meta,
  },
];
const day = (samples, baseStations = []) => ({
  key: 'a:d',
  customerId: 'a',
  date: '2026-01-01',
  sampleCount: samples.length,
  samples,
  baseStations,
  calls: [
    { id: 'c', start: '01:00:00', end: '01:00:09', qoe: 1 },
    { id: 'other', start: '01:00:10', end: '01:00:19', qoe: null },
  ],
});
assert.equal(timeToSecond('12:34'), 45240);
assert.equal(timeToSecond('12:34:00.5'), 45240.5);
let d = normalizeDay(ds, day([raw(3600, 'c', { gnss: true }, 0, 0)]), 'MDT');
assert.equal(d.samples[0].lat, null);
d = normalizeDay(
  ds,
  day(
    [
      raw(3600, 'c', { gnss: true }, 37, 127),
      raw(3601, 'c', { baseStationId: 'A' }),
    ],
    [station('A', 37, 127)],
  ),
  'MDT',
);
assert.equal(d.samples[0].lat, 37);
assert.equal(d.samples[0].lon, 127);
assert.equal(d.samples[1].lat, null);
d = normalizeDay(
  ds,
  day(
    [
      raw(3600, 'c', { baseStationId: 'A', baseStationMatched: false }),
      raw(3601, 'c', { baseStationId: 'B' }),
    ],
    [station('A', 37, 127), station('B', 37.001, 127.001)],
  ),
  'MDT',
);
assert(d.samples.every((s) => s.lat == null));
assert.equal(d.samples[0].stationLat, null);
d = normalizeDay(
  ds,
  day(
    [raw(3600, 'c', { baseStationId: 'A' })],
    [station('A', 37, 127), station('A', 38, 128)],
  ),
  'MDT',
);
assert.equal(d.samples[0].stationLat, null);
d = normalizeDay(
  ds,
  day(
    [
      raw(3600, 'c', { baseStationId: 'A' }),
      raw(3610, 'other', { baseStationId: 'B' }),
    ],
    [station('A', 37, 127), station('B', 37.001, 127.001)],
  ),
  'MDT',
);
assert(d.samples.every((s) => s.lat == null));
d = normalizeDay(
  ds,
  day([raw(3599, 'c'), raw(3600, 'c'), raw(3610, 'c')]),
  'MDT',
);
assert.equal(d.samples.length, 1);
assert.equal(d.calls.length, 2);
console.log(
  'PASS analyst source coordinates, ambiguous/unmatched masters, single-site guard, call boundaries and time input',
);
(async () => {
  const { loadDay, loadOverview } = load('lib/analyst/data-loader.ts');
  const original = global.fetch;
  try {
    const requests = [];
    global.fetch = async (url) => {
      requests.push(url);
      return { ok: false, status: 404 };
    };
    await assert.rejects(
      () =>
        loadOverview(
          { ...ds, meta: { ...ds.meta, partitioned: true } },
          'MDT',
          '2026-01-01',
        ),
      /build-analyst-overview/,
    );
    assert.equal(requests.length, 1);
    const overview = await loadOverview(ds, '실측', '2026-01-01');
    assert.equal(overview.calls.length, 0);
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        schemaVersion: 'analyst-overview-v1',
        source: 'MDT',
        date: '2026-01-01',
        sourceRevision: 'old',
      }),
    });
    await assert.rejects(() => loadOverview(ds, 'MDT', '2026-01-01'), /버전/);
    // An unversioned inline source may have been regenerated while an old summary remains.
    const freshDay = day([]);
    freshDay.calls[0].qoe = 4;
    const unversioned = {
      ...ds,
      meta: { ...ds.meta, revision: undefined },
      days: [freshDay],
    };
    let staleSummaryFetches = 0;
    global.fetch = async () => {
      staleSummaryFetches++;
      return {
        ok: true,
        json: async () => ({
          schemaVersion: 'analyst-overview-v1',
          source: '실측',
          date: '2026-01-01',
          gridSizeM: 60,
          cells: [],
          calls: [{ id: 'a:c', qoe: 1 }],
        }),
      };
    };
    const freshOverview = await loadOverview(unversioned, '실측', '2026-01-01');
    assert.equal(
      freshOverview.calls.find((call) => call.rawCallId === 'c')?.qoe,
      4,
    );
    assert.equal(
      staleSummaryFetches,
      0,
      'Unversioned inline sources must be summarized from current records',
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() => loadDay(ds, day([]), 'MDT', controller.signal), {
      name: 'AbortError',
    });
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ ...day([]), customerId: 'wrong' }),
    });
    await assert.rejects(
      () => loadDay(ds, { ...day([]), dataPath: 'detail.json' }, 'MDT'),
      /일치/,
    );
    console.log(
      'PASS analyst loader single overview request, inline fallback, revision, abort and identity checks',
    );
  } finally {
    global.fetch = original;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
