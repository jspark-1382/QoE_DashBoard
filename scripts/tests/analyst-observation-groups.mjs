import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import React from 'react';
import { createRequire } from 'node:module';
const { load } = createRequire(import.meta.url)('../analyst-ts-loader.cjs');
const evidenceHelper = load('lib/analyst/estimation-evidence.ts');
globalThis.__analystEstimationEvidence = evidenceHelper;
import { renderToStaticMarkup } from 'react-dom/server';
const file = new URL('./.observation-groups-test.mjs', import.meta.url);
try {
  const source = (
    await fs.readFile('components/analyst/observation-details.tsx', 'utf8')
  )
    .replace(
      /import\s+\{[^}]+\}\s+from ['"]\.\.\/\.\.\/lib\/analyst\/estimation-evidence['"];?/s,
      'const {estimationReason, estimationMethodLabel} = globalThis.__analystEstimationEvidence;',
    )
    .replace(
      /import styles from ['"]\.\/[^'"]+\.module\.css['"];?/,
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
    pci: 101,
    baseStationId: 'base-original',
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
  const evidence = {
    method: 'WEIGHTED_2_SITE',
    siteCount: 2,
    windowSec: 10,
    residualErrorM: 12,
    geometry: 0,
    jump: false,
    warnings: ['미보정 거리모델'],
    usedSites: [
      {
        siteId: 'SITE_001',
        baseStationIds: ['base-A'],
        cellIds: ['cell-A'],
        latitude: 37,
        longitude: 127,
        rsrp: -100,
        deltaTimeSec: 2,
        estimatedDistanceM: 123,
        residualM: 12,
      },
    ],
  };
  const evidenceHtml = renderToStaticMarkup(
    React.createElement(ObservationDetails, {
      sample: { ...sample, lat: 37, lon: 127, estimation: evidence },
      call: null,
      samples: [sample],
      source: 'MDT',
    }),
  );
  // A long estimator block or hidden original radio identifiers breaks the
  // compact, immediately inspectable observation contract.
  const primaryContent = (markup) => {
    let depth = 0;
    return markup
      .split(/(<\/?details\b[^>]*>)/)
      .filter((part) => {
        if (part.startsWith('<details')) {
          depth++;
          return false;
        }
        if (part.startsWith('</details')) {
          depth--;
          return false;
        }
        return depth === 0;
      })
      .join('');
  };
  const primary = primaryContent(evidenceHtml);
  assert(
    !primary.includes('거리 모델 잔차'),
    'Estimator diagnostics are closed initially',
  );
  for (const text of [
    '12:00:01',
    'RSRP',
    '-110 dBm',
    'RSRQ',
    '-12 dB',
    'SINR',
    '-2 dB',
    'PCI',
    '101',
    'cell-A',
    'base-original',
  ])
    assert(primary.includes(text), `${text} remains directly visible`);
  assert.match(primary, /<progress[^>]*value="1"[^>]*max="1"/);
  assert(
    ![...evidenceHtml.matchAll(/<details\b([^>]*)>/g)].some((match) =>
      /\bopen(?:\s|=|$)/.test(match[1]),
    ),
  );
  for (const source of ['gnss', 'measured', 'radio', 'unavailable']) {
    const rendered = renderToStaticMarkup(
      React.createElement(ObservationDetails, {
        sample: { ...sample, locationSource: source },
        call: null,
        samples: [sample],
        source: 'MDT',
      }),
    );
    const content = primaryContent(rendered);
    assert(
      content.includes(
        {
          gnss: 'GNSS 관측',
          measured: '제공 좌표',
          radio: '무선 추정',
          unavailable: '위치 근거 없음',
        }[source],
      ),
    );
  }
  for (const text of [
    '2개 기지국 가중중심',
    'base-A',
    'cell-A',
    '미보정 거리모델',
    '거리 모델 잔차',
    '위치 정확도 % 아님',
  ])
    assert(evidenceHtml.includes(text));
  assert(!evidenceHtml.includes('다변측량'));
  const diagnosticFixtures = [
    {
      method: 'CELL_SITE',
      siteCount: 1,
      locationSource: 'unavailable',
      warning: '단일 Site 좌표를 임시 위치로 사용 · 방향 미식별',
      expected: '기지국 1개 근거의 임시 좌표는 고객 위치에서 제외합니다.',
    },
    {
      method: 'MEASURED',
      siteCount: 0,
      locationSource: 'gnss',
      warning: '측정(GNSS) 좌표 우선 · 보정 오프셋 약 ±250m',
      expected: 'GNSS 측정 정확도 미확인',
    },
  ];
  for (const fixture of diagnosticFixtures) {
    const diagnostics = {
      ...evidence,
      method: fixture.method,
      siteCount: fixture.siteCount,
      warnings: [fixture.warning],
    };
    const snapshot = JSON.stringify(diagnostics);
    const rendered = renderToStaticMarkup(
      React.createElement(ObservationDetails, {
        sample: {
          ...sample,
          locationSource: fixture.locationSource,
          estimation: diagnostics,
        },
        call: null,
        samples: [sample],
        source: 'MDT',
      }),
    );
    const visible = rendered.replace(
      /<details[^>]*><summary>엔진 원본 진단[^<]*<\/summary>[\s\S]*?<\/details>/g,
      '',
    );
    assert(visible.includes(fixture.expected));
    assert(!visible.includes(fixture.warning));
    assert.match(rendered, /<details[^>]*><summary>엔진 원본 진단/);
    assert(rendered.includes(fixture.warning));
    assert.equal(JSON.stringify(diagnostics), snapshot);
    if (fixture.method === 'MEASURED')
      assert(visible.includes('모델 가정 ±250m'));
  }

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
  const missingRadio = renderToStaticMarkup(
    React.createElement(ObservationDetails, {
      sample: { ...sample, rsrp: null, sinr: null },
      call: null,
      samples: [{ ...sample, rsrp: null, sinr: null }],
      source: 'MDT',
    }),
  );
  assert.equal((missingRadio.match(/0\/0건/g) || []).length, 3);
  assert.doesNotMatch(
    missingRadio,
    /<progress\b/,
    'Missing denominators never become a measured zero-rate bar',
  );
  const empty = renderToStaticMarkup(
    React.createElement(ObservationDetails, {
      sample: null,
      call: null,
      samples: [],
      source: 'MDT',
    }),
  );
  assert.match(empty, /이 통화에 관측 이벤트가 없습니다/);
  assert.doesNotMatch(empty, /<progress\b/);
  console.log(
    'Observation primary evidence, grouped original comparison and GNSS unknown tests passed',
  );
} finally {
  await fs.rm(file, { force: true });
}
