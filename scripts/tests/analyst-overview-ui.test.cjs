const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const modulePath = '../../lib/analyst/overview-ui.ts';
const output = ts.transpileModule(
  fs.readFileSync(require('node:path').join(__dirname, modulePath), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText;
const mod = { exports: {} };
vm.runInNewContext(output, { module: mod, exports: mod.exports });
const { getAreaLabels, getHourlyDisplay } = mod.exports;
test('area aliases derive from full inventory, preserve supplied names and survive filtered ordering', () => {
  const labels = getAreaLabels([
    { id: 'grid60:2:1', label: 'grid60:2:1' },
    { id: 'grid60:1:1', label: '' },
    { id: 'named', label: '강남대로' },
  ]);
  assert.equal(labels.get('grid60:1:1'), '조사구역 1');
  assert.equal(labels.get('grid60:2:1'), '조사구역 2');
  assert.equal(labels.get('named'), '강남대로');
});
test('hourly rate uses evaluated denominator and distinguishes zero from unavailable', () => {
  assert.equal(
    getHourlyDisplay({ poor: 1, evaluated: 4, total: 5 }, 'rate').value,
    25,
  );
  assert.equal(
    getHourlyDisplay({ poor: 0, evaluated: 0, total: 1 }, 'rate').label,
    '평가 불가',
  );
  assert.equal(
    getHourlyDisplay({ poor: 0, evaluated: 2, total: 2 }, 'rate').label,
    '0.0%',
  );
  assert.equal(
    getHourlyDisplay({ poor: 0, evaluated: 0, total: 0 }, 'count').context,
    '통화 없음',
  );
});
