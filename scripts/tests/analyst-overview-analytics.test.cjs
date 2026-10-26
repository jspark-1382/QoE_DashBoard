/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const { load } = require('../analyst-ts-loader.cjs');
const analyticsFile = 'lib/analyst/overview-analytics.ts';
const api = fs.existsSync(analyticsFile) ? load(analyticsFile) : {};
const { normalizeDay } = load('lib/analyst/data.ts');
const { buildOverview, appendOverview } = load('lib/analyst/overview.ts');
const call = (id, qoe, updates = {}) => ({
  id,
  customerId: 'a',
  contractId: '001',
  start: '09:00:00',
  end: '09:01:00',
  startSecond: 32400,
  startTimestamp: '2026-09-15T09:00:00+09:00',
  qoe,
  locationSource: 'unavailable',
  gridIds: [],
  site: '',
  ...updates,
});
const at = (id, qoe, hour, minute = 0, customerId = 'a') =>
  call(id, qoe, {
    customerId,
    startSecond: hour * 3600 + minute * 60,
    startTimestamp: `2026-09-15T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+09:00`,
  });
const group = (result, id) => result.experience.find((g) => g.id === id);
test('analytics exports aggregation and metric projection for real calls', () => {
  assert.equal(typeof api.getOverviewAnalytics, 'function');
  assert.equal(typeof api.projectOverviewMetric, 'function');
  assert.equal(typeof api.getScoreBand, 'function');
});
test('unique calls retain finite QoE including zero and outside-domain scores in the mean', () => {
  const a = call('a', 0),
    result = api.getOverviewAnalytics(
      [
        a,
        a,
        call('b', 2.5),
        call('c', 5),
        call('d', 6),
        call('e', -1),
        call('f', null),
        call('g', NaN),
        call('h', Infinity),
      ],
      'qoe',
      2.5,
    );
  assert.equal(result.total, 8);
  assert.equal(result.evaluated, 5);
  assert.equal(result.unscored, 3);
  assert.equal(result.average, 2.5);
  assert.equal(result.outOfRange, 2);
  assert.deepEqual(
    result.bands.map((b) => [b.id, b.count, b.percent]),
    [
      ['good', 3, 60],
      ['poor', 2, 40],
    ],
  );
  assert.equal(result.bins.length, 20);
  assert.equal(result.bins[0].count, 1);
  assert.equal(result.bins[10].count, 1);
  assert.equal(result.bins[19].count, 1);
  assert.equal(
    result.bins.reduce((sum, b) => sum + b.count, 0),
    3,
  );
  assert.equal(api.getScoreBand(2.5, 'qoe', 2.5), 'good');
  assert.equal(api.getScoreBand(2.4, 'qoe', 2.5), 'poor');
});
test('MOS validates 1..5 and uses 3.5/4 boundaries regardless of QoE threshold', () => {
  const result = api.getOverviewAnalytics(
    [0, 0.99, 1, 3.49, 3.5, 4, 5, 5.01, null, NaN].map((mos, i) =>
      call(String(i), 1, { mos }),
    ),
    'mos',
    2.5,
  );
  assert.equal(result.threshold, 3.5);
  assert.equal(result.total, 10);
  assert.equal(result.evaluated, 5);
  assert.equal(result.unscored, 5);
  assert.equal(result.outOfRange, 3);
  assert(Math.abs(result.average - 3.398) < 1e-12);
  assert.deepEqual(
    result.bands.map((b) => [b.id, b.count, b.percent]),
    [
      ['good', 2, 40],
      ['fair', 1, 20],
      ['poor', 2, 40],
    ],
  );
  assert.equal(api.getScoreBand(3.5, 'mos', 0), 'fair');
  assert.equal(api.getScoreBand(4, 'mos', 0), 'good');
});
test('projection clones calls and cells, sanitizes selected MOS, and preserves source QoE', () => {
  const original = {
    schemaVersion: 'analyst-overview-v1',
    source: '실측',
    date: '2026-09-15',
    gridSizeM: 60,
    calls: [call('a', 0, { mos: 4.2 }), call('b', 2, { mos: 0 })],
    cells: [{ id: 'grid', callIds: ['a'], lat: 37, lon: 127, label: 'grid' }],
  };
  const snapshot = structuredClone(original),
    view = api.projectOverviewMetric(original, 'mos');
  assert.deepEqual(
    view.calls.map((c) => c.qoe),
    [4.2, null],
  );
  assert.deepEqual(
    view.calls.map((c) => c.mos),
    [4.2, 0],
  );
  view.calls[0].gridIds.push('new');
  view.cells[0].callIds.push('b');
  assert.deepEqual(original, snapshot);
  assert.equal(api.getOverviewAnalytics(original.calls, 'qoe', 2.5).average, 1);
});
test('empty and entirely unevaluated scopes expose unavailable percentages and means', () => {
  for (const calls of [[], [call('a', null)]]) {
    const result = api.getOverviewAnalytics(calls, 'qoe', 2.5);
    assert.equal(result.average, null);
    assert(result.bands.every((b) => b.percent === null));
    assert.equal(result.termination.count, null);
    assert.equal(result.termination.rate, null);
    assert.equal(result.termination.unknown, calls.length);
    assert(
      result.experience.every((g) => g.percent === null && g.hourly === null),
    );
  }
});
test('experience orders full timestamps rather than IDs and unknown scores break poor runs', () => {
  const result = api.getOverviewAnalytics(
    [
      at('z', 1, 9, 0),
      at('a', 1, 9, 20),
      at('m', 4, 9, 10),
      at('c', 1, 10, 20, 'b'),
      at('b', 1, 10, 0, 'b'),
      at('d', 1, 11, 0, 'c'),
      at('e', null, 11, 10, 'c'),
      at('f', 1, 11, 20, 'c'),
      at('normal', 4, 12, 0, 'd'),
    ],
    'qoe',
    2.5,
  );
  assert.deepEqual(group(result, 'affected').customerIds, ['a', 'b', 'c']);
  assert.deepEqual(group(result, 'repeat').customerIds, ['a', 'b', 'c']);
  assert.deepEqual(group(result, 'consecutive').customerIds, ['b']);
  assert.equal(group(result, 'consecutive').count, 1);
  assert.equal(group(result, 'consecutive').percent, 25);
});
test('ambiguous or missing chronology withholds consecutive rather than publishing partial counts', () => {
  for (const bad of [undefined, 'invalid', '2026-09-15T09:00:00+09:00']) {
    const result = api.getOverviewAnalytics(
      [
        at('known-1', 1, 10, 0, 'b'),
        at('known-2', 1, 10, 1, 'b'),
        at('a', 1, 9),
        call('b', 1, { startTimestamp: bad }),
      ],
      'qoe',
      2.5,
    );
    assert.equal(group(result, 'repeat').count, 2);
    assert.equal(group(result, 'consecutive').count, null);
    assert.equal(group(result, 'consecutive').percent, null);
    assert.equal(group(result, 'consecutive').hourly, null);
    assert.deepEqual(group(result, 'consecutive').customerIds, []);
  }
});
test('hourly experience independently qualifies customers within each hour, never fabricating cumulative trends', () => {
  const result = api.getOverviewAnalytics(
    [
      at('a', 1, 9),
      at('b', 1, 10),
      at('c', 1, 10, 10),
      at('d', 1, 9, 20, 'b'),
      at('e', 1, 11, 0, 'b'),
    ],
    'qoe',
    2.5,
  );
  assert.equal(group(result, 'affected').hourly[9], 2);
  assert.equal(group(result, 'affected').hourly[10], 1);
  assert.equal(group(result, 'repeat').hourly[9], 0);
  assert.equal(group(result, 'repeat').hourly[10], 1);
  assert.equal(group(result, 'repeat').hourly[11], 0);
  assert.equal(group(result, 'consecutive').hourly[10], 1);
  assert.equal(group(result, 'consecutive').count, 2);
});
test('chronological runs cross midnight using full dates rather than clock-only order', () => {
  const result = api.getOverviewAnalytics(
    [
      call('late-poor', 1, { startTimestamp: '2026-09-15T23:59:00+09:00' }),
      call('early-poor', 1, { startTimestamp: '2026-09-16T00:01:00+09:00' }),
      call('previous-normal', 4, {
        startTimestamp: '2026-09-15T00:02:00+09:00',
      }),
    ],
    'qoe',
    2.5,
  );
  assert.equal(group(result, 'consecutive').count, 1);
  assert.equal(group(result, 'repeat').hourly[0], 0);
  assert.equal(group(result, 'affected').hourly[23], 1);
});
test('missing chronology never supplies a fake midnight hourly trend', () => {
  const result = api.getOverviewAnalytics(
    [
      call('unknown', 1, {
        start: 'invalid',
        startSecond: 0,
        startTimestamp: undefined,
      }),
    ],
    'qoe',
    2.5,
  );
  assert.equal(group(result, 'affected').count, 1);
  assert.equal(group(result, 'affected').hourly, null);
});
const dataset = {
  meta: { dates: ['2026-09-15'], poorQoeThreshold: 2.5 },
  customers: [{ id: 'a' }],
};
const detail = (calls, date = '2026-09-15') => ({
  key: 'a:day',
  customerId: 'a',
  date,
  samples: [],
  sampleCount: 0,
  calls,
});
test('overview carries normalized full timestamps, MOS and raw termination without guessing a classification', () => {
  const original = detail([
    {
      id: 'a',
      start: '09:00:00',
      end: '09:01:00',
      qoe: 2,
      mos: 4,
      startTimestamp: '2026-09-16T09:00:00+09:00',
      endType: 'opaque',
      sipCause: '200',
      q850Cause: '16',
      fc: '0',
    },
  ]);
  const result = buildOverview(dataset, [original], '실측', original.date);
  assert.equal(result.analyticsVersion, 'overview-analytics-v1');
  assert.equal(
    Date.parse(result.calls[0].startTimestamp),
    Date.parse('2026-09-16T09:00:00+09:00'),
  );
  assert.equal(result.calls[0].mos, 4);
  assert.equal(result.calls[0].endType, 'opaque');
  assert.equal(result.calls[0].sipCause, '200');
  assert.equal(result.calls[0].q850Cause, '16');
  assert.equal(result.calls[0].fc, '0');
  assert.equal(
    api.getOverviewAnalytics(result.calls, 'mos', 2.5).termination.unknown,
    1,
  );
  const day = normalizeDay(dataset, original, '실측'),
    appended = { ...result, calls: [], cells: [] };
  appendOverview(appended, day);
  assert.deepEqual(appended.calls, result.calls);
});
test('legacy valid day and clocks establish chronology, explicit invalid timestamp and bad dates remain unknown', () => {
  const calls = [
    { id: 'legacy', start: '9:01:02', end: '09:02:00', qoe: 1 },
    {
      id: 'bad',
      start: '09:00:00',
      end: '09:01:00',
      qoe: 1,
      startTimestamp: 'invalid',
    },
    { id: 'bad-clock', start: '25:00:00', end: '', qoe: 1 },
  ];
  const day = normalizeDay(dataset, detail(calls), '실측');
  assert.equal(
    Date.parse(day.calls[0].startTimestamp),
    Date.parse('2026-09-15T09:01:02+09:00'),
  );
  assert.equal(day.calls[1].startTimestamp, undefined);
  assert.equal(day.calls[2].startTimestamp, undefined);
  assert.equal(
    normalizeDay(dataset, detail(calls, '2026-02-30'), '실측').calls[0]
      .startTimestamp,
    undefined,
  );
});
test('sample-derived legacy calls retain full callMeta chronology rather than discarding metadata', () => {
  const raw = Array(22).fill(null);
  Object.assign(raw, { 0: 32400, 1: '09:00:00', 16: 1, 19: 'from-sample' });
  const source = {
    ...detail([]),
    samples: [raw],
    sampleCount: 1,
    callMeta: {
      'from-sample': {
        start: '09:00:00',
        end: '09:00:01',
        startTimestamp: '2026-09-16T09:00:00+09:00',
      },
    },
  };
  const result = normalizeDay(dataset, source, '실측');
  assert.equal(
    Date.parse(result.calls[0].startTimestamp),
    Date.parse('2026-09-16T09:00:00+09:00'),
  );
});
test('published overview builder writes the analytics contract and fields from source inputs without mutating them', () => {
  const path = require('node:path'),
    vm = require('node:vm');
  const { createRequire } = require('node:module');
  const fixtureParent = path.resolve('outputs/analyst-ui');
  fs.mkdirSync(fixtureParent, { recursive: true });
  const fixtureRoot = fs.mkdtempSync(
    path.join(fixtureParent, 'overview-contract-'),
  );
  const script = path.resolve('scripts/build-analyst-overview.cjs');
  const source = {
    ...dataset,
    days: [
      detail([
        {
          id: 'a',
          start: '09:00:00',
          end: '09:01:00',
          qoe: 2,
          mos: 4,
          endType: 'unknown-code',
        },
      ]),
    ],
  };
  const input = JSON.stringify(source);
  try {
    fs.mkdirSync(path.join(fixtureRoot, 'public'));
    const inputPath = path.join(fixtureRoot, 'public', 'executive-data.json');
    fs.writeFileSync(inputPath, input);
    vm.runInNewContext(
      fs.readFileSync(script, 'utf8'),
      {
        require: createRequire(script),
        __dirname: path.join(fixtureRoot, 'scripts'),
        process: { argv: ['node', script, 'measured'] },
        console: { log() {} },
      },
      { filename: script },
    );
    const result = JSON.parse(
      fs.readFileSync(
        path.join(
          fixtureRoot,
          'public',
          'analyst-overview',
          'measured',
          '2026-09-15.json',
        ),
        'utf8',
      ),
    );
    assert.equal(result.analyticsVersion, 'overview-analytics-v1');
    assert.equal(result.calls[0].mos, 4);
    assert.equal(result.calls[0].startTimestamp, '2026-09-15T09:00:00+09:00');
    assert.equal(result.calls[0].endType, 'unknown-code');
    assert.equal(fs.readFileSync(inputPath, 'utf8'), input);
  } finally {
    assert.equal(path.dirname(path.resolve(fixtureRoot)), fixtureParent);
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
