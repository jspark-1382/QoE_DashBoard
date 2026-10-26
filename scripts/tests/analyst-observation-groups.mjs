import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const file = new URL('./.observation-groups-test.mjs', import.meta.url);
try {
  const source = (
    await fs.readFile('components/analyst/observation-details.tsx', 'utf8')
  ).replace(
    "import styles from './contract-workspace.module.css';",
    'const styles={};',
  );
  await fs.writeFile(
    file,
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.React,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
  );
  const { ObservationDetails } = await import(file.href);
  const sample = {
    index: 37,
    lat: null,
    lon: null,
    time: '12:00:01',
    locationSource: 'radio',
    accuracyM: 500,
    rsrp: -110,
    rsrq: -12,
    sinr: -2,
    raw: [123, 456],
    cellId: 'cell-A',
  };
  const html = renderToStaticMarkup(
    React.createElement(ObservationDetails, {
      sample,
      call: { contractId: 'original-contract' },
      samples: [sample],
      source: 'MDT',
    }),
  );
  assert.match(html, /모델 불확실성 추정/);
  assert.match(html, /<summary>위치 근거<\/summary>/);
  assert.match(html, /<summary>기지국·망 정보<\/summary>/);
  assert.match(html, /원본·종료 코드/);
  assert.match(html, /original-contract/);
  assert.match(html, /37/);
  const gnss = renderToStaticMarkup(
    React.createElement(ObservationDetails, {
      sample: { ...sample, locationSource: 'gnss' },
      call: null,
      samples: [sample],
      source: 'MDT',
    }),
  );
  assert.match(gnss, /정확도 정보 없음/);
  console.log(
    'Observation primary evidence, grouped original comparison and GNSS unknown tests passed',
  );
} finally {
  await fs.rm(file, { force: true });
}
