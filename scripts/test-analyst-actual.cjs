/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'),
  fs = require('node:fs');
const { load } = require('./analyst-ts-loader.cjs');
const { getOverviewSummary, getOverviewCells } = load(
  'lib/analyst/overview.ts',
);
const d = JSON.parse(fs.readFileSync('public/mdt-data.json'));
const v = JSON.parse(
  fs.readFileSync(`public/analyst-overview/MDT/${d.meta.dates[0]}.json`),
);
assert.equal(v.sourceRevision, d.meta.revision);
assert.equal(v.calls.length, 25548);
assert.equal(new Set(v.calls.map((c) => c.id)).size, v.calls.length);
assert.equal(v.cells.length, 7864);
const summary = getOverviewSummary(v.calls, d.meta.poorQoeThreshold);
assert.equal(summary.evaluated, 23085);
assert.equal(summary.unscored, 2463);
assert.equal(summary.poor, 2583);
assert.equal(summary.locatedPoor + summary.unlocatedPoor, summary.poor);
for (const cell of getOverviewCells(v, v.calls, 2.5)) {
  assert.equal(new Set(cell.callIds).size, cell.callIds.length);
  assert(cell.poor <= cell.evaluated);
  assert(cell.evaluated <= cell.total);
}
for (const c of v.calls) {
  assert.equal(c.rawCallId, c.id.slice(c.customerId.length + 1));
  assert.equal(typeof c.contractId, 'string');
}
console.log(
  'PASS actual MDT source revision, 25548 independent calls, 2463 unscored, unique grids and denominator reconciliation',
);
