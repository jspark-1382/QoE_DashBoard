import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
const file = new URL('./.timeline-navigation-test.mjs', import.meta.url);
try {
  const source = await fs.readFile(
    'lib/analyst/timeline-navigation.ts',
    'utf8',
  );
  await fs.writeFile(
    file,
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
  );
  const { nextObservation, clampWindow } = await import(file.href);
  const samples = [
    { index: 19, second: 0, callId: 'a', cellId: 'x', rsrp: -100, sinr: 3 },
    { index: 40, second: 10, callId: 'a', cellId: 'y', rsrp: -106, sinr: null },
    { index: 81, second: 50, callId: 'a', cellId: 'z', rsrp: null, sinr: -1 },
    { index: 100, second: 51, callId: 'b', cellId: 'q', rsrp: -120, sinr: -2 },
  ];
  assert.equal(nextObservation(samples, 19, 'condition'), 40);
  assert.equal(nextObservation(samples, 19, 'cell'), 40);
  assert.equal(nextObservation(samples, 40, 'gap'), 81);
  assert.equal(nextObservation(samples, 81, 'condition'), null);
  assert.equal(
    nextObservation(samples, 40, 'cell'),
    null,
    'Do not infer cell transitions across observation gaps',
  );
  assert.deepEqual(
    clampWindow(
      samples.filter((s) => s.callId === 'a'),
      81,
      20,
    ),
    [30, 50],
  );
  assert.deepEqual(clampWindow([], null, 20), [0, 0]);
  assert.deepEqual(clampWindow(samples.slice(0, 3), 19, 20), [0, 20]);
  assert.deepEqual(clampWindow(samples.slice(0, 3), 40, null), [0, 50]);
  assert.equal(
    nextObservation([{ ...samples[0], cellId: '' }, samples[1]], 19, 'cell'),
    null,
  );
  assert.equal(nextObservation(samples, null, 'condition'), null);
  const midnight = [
    {
      ...samples[0],
      second: 86399,
      timestamp: Date.parse('2026-10-25T23:59:59+09:00'),
    },
    {
      ...samples[1],
      second: 10,
      timestamp: Date.parse('2026-10-26T00:00:10+09:00'),
    },
  ];
  assert.equal(nextObservation(midnight, 19, 'condition'), 40);
  assert.equal(nextObservation(midnight, 19, 'cell'), 40);
  assert.equal(nextObservation(midnight, 19, 'gap'), null);
  assert.equal(
    clampWindow(midnight, 40, 60)[1] - clampWindow(midnight, 40, 60)[0],
    11,
  );
  console.log(
    'Timeline original-index, call-boundary, gap and zoom-clamping tests passed',
  );
} finally {
  await fs.rm(file, { force: true });
}
