import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const output = ts.transpileModule(
  fs.readFileSync('lib/analyst/contract-picker.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText;
const mod = { exports: {} };
vm.runInNewContext(output, { module: mod, exports: mod.exports });
const { contractPage } = mod.exports;
const customers = Array.from({ length: 61 }, (_, i) => ({
  id: `c${i}`,
  sourceContractId: String(i).padStart(5, '0'),
  displayName: `고객${i}`,
  dates: ['a', 'b'],
  sampleCount: 999,
}));
const days = customers.map((c, i) => ({
  customerId: c.id,
  date: 'a',
  sampleCount: i,
  callCount: i,
  gnssSampleCount: i === 0 ? 0 : i === 1 ? undefined : 2,
}));
days.push({ customerId: 'c0', date: 'b', sampleCount: 9, gnssSampleCount: 5 });
const dataset = { customers, days };
assert.equal(contractPage(dataset, 'a', '', false, 0, 25).total, 61);
assert.equal(
  contractPage(dataset, 'a', '00001', false, 0, 25).rows[0].customer
    .sourceContractId,
  '00001',
);
assert.equal(contractPage(dataset, 'a', '0000', false, 0, 25).total, 10);
const zero = contractPage(dataset, 'a', '', true, 0, 25);
assert.equal(zero.total, 1);
assert.equal(zero.rows[0].sampleCount, 0);
assert.equal(zero.rows[0].callCount, 0);
assert.equal(contractPage(dataset, 'b', '', true, 0, 25).total, 0);
assert.equal(
  contractPage(dataset, 'b', '', false, 0, 25).rows[0].sampleCount,
  9,
);
assert.equal(contractPage(dataset, 'a', '', false, 2, 25).rows.length, 11);
assert.equal(contractPage(dataset, 'a', '', false, 999, 50).page, 1);
assert.equal(contractPage(dataset, 'missing', '', false, 4, 25).page, 0);
const shell = fs.readFileSync(
  'components/analyst/analyst-dashboard.tsx',
  'utf8',
);
assert.match(shell, /<ContractPicker/);
assert.match(shell, /getContractId\(customer\)\s*\?\?\s*customer.displayName/);
assert.match(shell, /if \(!searchOpen && customer\)/);
assert.match(shell, /aria-label="계약번호 복사"/);
const overview = fs.readFileSync(
  'components/analyst/quality-overview.tsx',
  'utf8',
);
assert.match(
  overview,
  /onClick=\{\(\) => onAnalyze\(call\)\}[\s\S]*?통화 열기[\s\S]*?\{call.contractId \?\? '계약번호 미제공'\}/,
);
console.log(
  'Contract picker metadata, dates, leading zeros, pagination and wiring passed',
);
