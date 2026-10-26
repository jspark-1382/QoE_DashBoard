import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import React from 'react';
import { createRequire } from 'node:module';
const { load } = createRequire(import.meta.url)('../analyst-ts-loader.cjs');
const evidenceHelper = load('lib/analyst/estimation-evidence.ts');
globalThis.__analystEstimationEvidence = evidenceHelper;
import { renderToStaticMarkup } from 'react-dom/server';
const helperFile = new URL('./.analyst-map-helper.mjs', import.meta.url);
await fs.writeFile(
  helperFile,
  ts.transpileModule(await fs.readFile('lib/analyst/map.ts', 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
);
let code = ts.transpileModule(
  (
    await fs.readFile('components/analyst/contract-workspace.tsx', 'utf8')
  ).replace(
    /import\s+\{[^}]+\}\s+from ['"]\.\.\/\.\.\/lib\/analyst\/estimation-evidence['"];?/s,
    'const {estimationReason, estimationSummary} = globalThis.__analystEstimationEvidence;',
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
code = code.replace('../../lib/analyst/map', './.analyst-map-helper.mjs');
code = code.replace(
  /import\s+\{[^}]+\}\s+from ['"]\.\.\/\.\.\/lib\/analyst\/data['"];?/s,
  'const isPoorCall=(q,t)=>q!==null&&q<t;',
);
code = code.replace(
  /import\s+\{[^}]+\}\s+from ['"]\.\/analyst-map['"];?/s,
  'const AnalystMap=({threshold})=>React.createElement("span",{"data-map-threshold":threshold});',
);
code = code
  .replace(
    /import\s+\{[^}]+\}\s+from ['"]\.\/radio-timeline['"];?/s,
    'const RadioTimeline=()=>null;',
  )
  .replace(
    /import\s+\{[^}]+\}\s+from ['"]\.\/observation-details['"];?/s,
    'const ObservationDetails=()=>null;',
  )
  .replace(
    /import styles from ['"]\.\/contract-workspace.module.css['"];?/,
    'const styles={};',
  );
const file = new URL('./.analyst-provenance-test.mjs', import.meta.url);
await fs.writeFile(file, code);
try {
  const { ContractWorkspace } = await import(file.href);
  const render = (metadata) => {
    const raw = Array(21).fill(null);
    if (metadata !== undefined) raw.push(metadata);
    const day = {
      source: '실측',
      customerId: '16dfccc2cbb5',
      date: '2026-08-21',
      calls: [],
      samples: [
        {
          index: 0,
          callId: 'a',
          inCallWindow: true,
          locationSource: 'measured',
          raw,
        },
      ],
      baseStations: [],
    };
    return renderToStaticMarkup(
      React.createElement(ContractWorkspace, {
        day,
        callId: null,
        sampleIndex: null,
        threshold: 3.1,
        onSelectCall: () => {},
        onSelectSample: () => {},
      }),
    );
  };
  assert.match(render(undefined), /GNSS 확보율[^]*?<b>미제공<\/b>/);
  assert.match(render({ gnss: false }), /GNSS 확보율[^]*?<b>0\.0%<\/b>/);
  assert.match(
    render({ locationSource: 'radio' }),
    /GNSS 확보율[^]*?<b>0\.0%<\/b>/,
  );
  assert.match(
    render({ gnssUtmkx: null, gnssUtmky: null }),
    /GNSS 확보율[^]*?<b>0\.0%<\/b>/,
  );
  assert.match(render({ gnss: false }), /data-map-threshold="3.1"/);
  const automatic = renderToStaticMarkup(
    React.createElement(ContractWorkspace, {
      day: {
        source: 'MDT',
        customerId: 'a',
        date: '2026-01-01',
        calls: [
          {
            id: 'c',
            qoe: 1,
            start: '01:00',
            end: '01:01',
            startSecond: 0,
            endSecond: 60,
            sampleIndices: [77],
          },
        ],
        samples: [
          {
            index: 77,
            callId: 'c',
            lat: 37,
            lon: 127,
            locationSource: 'radio',
            inCallWindow: true,
            raw: [],
            baseStationId: 'B',
            cellId: 'C',
            estimation: { method: 'WEIGHTED_2_SITE' },
          },
        ],
        baseStations: [],
      },
      callId: 'c',
      sampleIndex: 77,
      threshold: 2.5,
      onSelectCall: () => {},
      onSelectSample: () => {},
    }),
  );
  assert(automatic.includes('자동 위치 추정'));
  assert(automatic.includes('2개 기지국 가중중심 1건'));
  assert(automatic.includes('무선 추정 시점으로 이동 (1건)'));
  assert(automatic.includes('추정 근거 보기'));
  assert.match(automatic, /<table[^>]*aria-label="계약 통화 목록"/);
  assert.match(automatic, /aria-label="MDT 관측 여부"/);
  assert.match(automatic, /<details[^>]*aria-label="지도 옵션"[^>]*>/);
  assert.doesNotMatch(
    automatic,
    /<details[^>]*aria-label="지도 옵션"[^>]*open/,
  );
  assert.doesNotMatch(
    automatic,
    /균형 보기|지도 중심|근거 중심|관측 근거 펼치기/,
  );
  const cdr = renderToStaticMarkup(
    React.createElement(ContractWorkspace, {
      day: {
        source: 'MDT',
        customerId: 'synthetic',
        date: '2026-01-01',
        samples: [],
        baseStations: [],
        calls: [
          {
            id: 'cdr',
            start: '23:59:50',
            end: '00:00:10',
            startSecond: 86390,
            endSecond: 10,
            qoe: null,
            hasMdt: false,
            mdtCount: 0,
            sampleIndices: [],
            startCellId: '001234',
            endCellId: '005678',
          },
        ],
      },
      callId: 'cdr',
      sampleIndex: null,
      threshold: 2.5,
      onSelectCall: () => {},
      onSelectSample: () => {},
    }),
  );
  assert.match(cdr, /CDR만 · MDT 없음/);
  assert.match(cdr, /Cell-ID 001234/);
  assert.match(cdr, /Cell-ID 005678/);
  assert.match(cdr, /Cell 위치 미제공/);
  assert.match(
    cdr,
    /<td>00:20<\/td>/,
    'Clock-only overnight calls show elapsed time',
  );
  assert.doesNotMatch(
    cdr,
    /data-map-threshold/,
    'No arbitrary map/trajectory for unmapped CDR cells',
  );
  console.log(
    'Contract GNSS provenance unknown/known-zero and map threshold tests passed',
  );
} finally {
  await fs.unlink(file);
  await fs.unlink(helperFile);
}
