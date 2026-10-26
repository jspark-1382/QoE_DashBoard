const assert = require('node:assert/strict');
const test = require('node:test');
const { load } = require('../analyst-ts-loader.cjs');
const api = load('lib/analyst/map.ts');

test('numeric legend describes the exact color boundary, units, and absent measurements', () => {
  assert.equal(typeof api.getMetricLegend, 'function');
  for (const [metric, limit, unit] of [
    ['rsrp', -105, 'dBm'],
    ['rsrq', -15, 'dB'],
    ['sinr', 3, 'dB'],
    ['qoe', 3.2, ''],
  ]) {
    const legend = api.getMetricLegend(metric, 3.2);
    const poor = legend.find((entry) => entry.kind === 'poor');
    const other = legend.find((entry) => entry.kind === 'other');
    const absent = legend.find((entry) => entry.kind === 'missing');
    assert.equal(poor.color, api.metricColor(limit - 0.01, metric, 3.2));
    assert.equal(other.color, api.metricColor(limit, metric, 3.2));
    assert.match(poor.label, /</);
    assert(poor.label.includes(String(limit).replace('-', '−')));
    assert(other.label.includes('≥'));
    if (unit) assert(poor.label.includes(unit));
    assert.equal(absent.color, api.metricColor(null, metric, 3.2));
    assert.equal(absent.color, api.metricColor(NaN, metric, 3.2));
    assert.match(absent.label, /미제공/);
  }
  // SINR chart investigation at 0dB is distinct from the existing map color at 3dB.
  assert.equal(
    api.metricColor(1, 'sinr'),
    api.getMetricLegend('sinr')[0].color,
  );
});

test('overview legend exposes the discrete percentage steps used by the map', () => {
  assert.equal(typeof api.getOverviewRateLegend, 'function');
  assert.equal(typeof api.overviewRateColor, 'function');
  const legend = api.getOverviewRateLegend();
  assert.equal(legend.length, 4);
  for (const [value, entry] of [
    [null, 0],
    [0, 0],
    [0.01, 1],
    [9.99, 1],
    [10, 2],
    [24.99, 2],
    [25, 3],
    [100, 3],
  ])
    assert.equal(api.overviewRateColor(value), legend[entry].color);
  assert.match(legend[0].label, /평가 불가/);
  assert.match(legend[1].label, /10/);
  assert.match(legend[2].label, /25/);
});

test('estimation map evidence belongs only to the selected non-GNSS observation', () => {
  assert.equal(typeof api.getSelectedEstimationSites, 'function');
  const site = {
    siteId: 'one',
    latitude: 37.48,
    longitude: 127.05,
    estimatedDistanceM: 300,
  };
  const samples = [
    {
      index: 7,
      locationSource: 'radio',
      estimation: {
        usedSites: [site, { ...site, siteId: 'bad', latitude: NaN }],
      },
    },
    {
      index: 12,
      locationSource: 'radio',
      estimation: { usedSites: [{ ...site, siteId: 'other' }] },
    },
    { index: 18, locationSource: 'gnss', estimation: { usedSites: [site] } },
    {
      index: 23,
      locationSource: 'unavailable',
      estimation: { usedSites: [site] },
    },
  ];
  assert.deepEqual(api.getSelectedEstimationSites(samples, 7, false), []);
  assert.deepEqual(
    api.getSelectedEstimationSites(samples, 7, true).map((s) => s.siteId),
    ['one'],
  );
  assert.deepEqual(
    api.getSelectedEstimationSites(samples, 12, true).map((s) => s.siteId),
    ['other'],
  );
  assert.deepEqual(api.getSelectedEstimationSites(samples, 18, true), []);
  assert.equal(
    api.getSelectedEstimationSites(samples, 23, true).length,
    1,
    'site evidence can explain why no customer point was made',
  );
  assert.deepEqual(api.getSelectedEstimationSites(samples, null, true), []);
});
