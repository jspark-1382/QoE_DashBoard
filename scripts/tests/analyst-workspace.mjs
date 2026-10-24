import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const source = await fs.readFile(
  'components/analyst/radio-timeline.tsx',
  'utf8',
);
const compiled = ts.transpileModule(
  source.replace(
    "import styles from './contract-workspace.module.css';",
    'const styles = {};',
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const file = new URL('./.analyst-timeline-test.mjs', import.meta.url);
await fs.writeFile(file, compiled);
try {
  const { RadioTimeline } = await import(file.href);
  const samples = [0, 1, 2].map((index) => ({
    index,
    second: index * 2,
    time: `12:00:0${index * 2}`,
    rsrp: index === 1 ? null : -100,
    rsrq: -12,
    sinr: 0,
  }));
  const html = renderToStaticMarkup(
    React.createElement(RadioTimeline, {
      samples,
      selectedIndex: 2,
      onSelectSample: () => {},
    }),
  );
  assert.match(html, /RSRP/);
  assert.match(html, /dBm/);
  assert.match(html, /SINR/);
  assert.match(html, /value="2"/);
  assert.doesNotMatch(html, /MOS/);
  // A missing middle RSRP event must produce two isolated path moves, never a line across it.
  assert.match(html, /d="M42\.00,40\.80 /);
  assert.match(html, /d="M742\.00,40\.80 /);
  const empty = renderToStaticMarkup(
    React.createElement(RadioTimeline, {
      samples: [],
      selectedIndex: null,
      onSelectSample: () => {},
    }),
  );
  assert.match(empty, /관측 이벤트가 없습니다/);
  assert.match(empty, /aria-label="선택 통화 무선 시간축"/);
  const longGap = renderToStaticMarkup(
    React.createElement(RadioTimeline, {
      samples: [samples[0], { ...samples[2], second: 60 }],
      selectedIndex: 0,
      onSelectSample: () => {},
    }),
  );
  assert.doesNotMatch(longGap, /d="M[^"]+L/);
  console.log(
    'Analyst timeline native-unit, missing-gap, and empty-state tests passed',
  );
} finally {
  await fs.unlink(file);
}
