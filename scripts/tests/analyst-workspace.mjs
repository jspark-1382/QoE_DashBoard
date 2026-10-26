import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const helperFile = new URL('./.analyst-navigation-helper.mjs', import.meta.url);
await fs.writeFile(
  helperFile,
  ts.transpileModule(
    await fs.readFile('lib/analyst/timeline-navigation.ts', 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
);
const source = (
  await fs.readFile('components/analyst/radio-timeline.tsx', 'utf8')
).replace(
  '../../lib/analyst/timeline-navigation',
  './.analyst-navigation-helper.mjs',
);
const compiled = ts.transpileModule(
  source.replace(
    /import styles from ['"]\.\/[^'"]+\.module\.css['"];?/,
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
const zoomFile = new URL('./.analyst-timeline-zoom-test.mjs', import.meta.url);
await fs.writeFile(
  zoomFile,
  compiled.replace('useState(null)', '[60, () => {}]'),
);

try {
  const { RadioTimeline } = await import(file.href);
  const { RadioTimeline: ZoomTimeline } = await import(zoomFile.href);
  const zoomSamples = [0, 10, 100].map((second, i) => ({
    index: [19, 40, 81][i],
    second,
    time: `t${second}`,
    callId: 'a',
    rsrp: -100,
    rsrq: -12,
    sinr: 3,
  }));
  const zoomHtml = renderToStaticMarkup(
    React.createElement(ZoomTimeline, {
      samples: zoomSamples,
      selectedIndex: 40,
      onSelectSample: () => {},
    }),
  );
  assert.match(
    zoomHtml,
    /max="2"/,
    'Full-call slider must reach observation outside zoom window',
  );
  assert.match(zoomHtml, /t10 · 2\/3/, 'Position is relative to whole call');
  assert.doesNotMatch(
    zoomHtml,
    /<button disabled="">다음 관측/,
    'Next sample outside chart window remains reachable',
  );
  const selections = [];
  const tree = ZoomTimeline({
    samples: zoomSamples,
    selectedIndex: 40,
    onSelectSample: (index) => selections.push(index),
  });
  const elements = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    elements.push(node);
    walk(node.props?.children);
  };
  walk(tree);
  elements
    .find(
      (node) => node.type === 'button' && node.props.children === '다음 관측',
    )
    .props.onClick();
  elements
    .find((node) => node.props?.['aria-label']?.startsWith('RSRP ('))
    .props.onKeyDown({ key: 'ArrowRight', preventDefault() {} });
  elements
    .find((node) => node.props?.['aria-label'] === '관측 시점 선택')
    .props.onChange({ target: { value: '2' } });
  assert.deepEqual(
    selections,
    [81, 81, 81],
    'Next button, ArrowRight and full-call slider emit the same original index beyond zoom',
  );
  // Reproduce the browser's SVG viewport mapping at a wide/short chart size.
  // Default xMidYMid meet inserts horizontal gutters, so chart points and the
  // full-button hit test disagree unless the SVG fills its viewport.
  selections.length = 0;
  elements.length = 0;
  walk(
    ZoomTimeline({
      samples: [0, 10, 20, 30, 40, 50, 60].map((second, position) => ({
        ...zoomSamples[0],
        second,
        index: [19, 40, 81, 120, 141, 182, 199][position],
      })),
      selectedIndex: 120,
      onSelectSample: (index) => selections.push(index),
    }),
  );
  for (const label of ['RSRP (', 'SINR (']) {
    const chart = elements.find((node) =>
      node.props?.['aria-label']?.startsWith(label),
    );
    const svg = chart.props.children;
    const width = 1000,
      height = 54,
      left = 25;
    const scale = Math.min(width / 760, height / 80);
    for (const viewX of [42, 158.66666666666666, 392, 742]) {
      const renderedX =
        svg.props.preserveAspectRatio === 'none'
          ? (viewX * width) / 760
          : (width - 760 * scale) / 2 + viewX * scale;
      chart.props.onClick({
        clientX: left + renderedX,
        currentTarget: {
          getBoundingClientRect: () => ({ left, width, height }),
        },
      });
    }
  }
  assert.deepEqual(
    selections,
    [19, 40, 120, 199, 19, 40, 120, 199],
    'Clicking rendered chart points at wide aspect ratios must select their original indices',
  );
  const recentred = renderToStaticMarkup(
    React.createElement(ZoomTimeline, {
      samples: zoomSamples,
      selectedIndex: 81,
      onSelectSample: () => {},
    }),
  );
  assert.match(recentred, /t100 · 3\/3/);
  assert.match(
    recentred,
    /1개 이벤트/,
    'Following selection recenters the chart window',
  );
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
  const tools = html.match(
    /<details\b[^>]*><summary>시간축 도구<\/summary>[\s\S]*?<\/details>/,
  )?.[0];
  assert(
    tools,
    'Secondary investigation controls are grouped in closed timeline tools',
  );
  assert.doesNotMatch(
    tools.slice(0, tools.indexOf('>') + 1),
    /\bopen(?:\s|=|>)/,
  );
  const primary = html.replace(tools, '');
  assert.match(primary, /RSRP \(dBm\)/);
  assert.match(primary, /SINR \(dB\)/);
  assert.doesNotMatch(
    primary,
    /RSRQ|시간축 표시 범위|다음 조건 관측|다음 Cell 변경|다음 30초/,
  );
  assert.match(primary, /이전 관측/);
  assert.match(primary, /12:00:04 · 3\/3/);
  assert.match(primary, /다음 관측/);
  assert.equal((primary.match(/<svg\b/g) || []).length, 2);
  assert.match(html, /dBm/);
  assert.match(html, /SINR/);
  assert.match(html, /시간축 표시 범위/);
  assert.match(html, /전체 시간으로 복원/);
  assert.match(html, /다음 조건 관측/);
  assert.match(html, /다음 Cell 변경/);
  assert.match(html, /다음 30초 초과 공백/);
  assert.match(html, /원인 판정 아님/);
  assert.match(html, /value="2"/);
  assert.doesNotMatch(html, /MOS/);
  const measured = renderToStaticMarkup(
    React.createElement(RadioTimeline, {
      samples: samples.map((sample) => ({ ...sample, mos: 3.5 })),
      selectedIndex: 0,
      onSelectSample() {},
    }),
  );
  const measuredTools = measured.match(
    /<details\b[^>]*><summary>시간축 도구<\/summary>[\s\S]*?<\/details>/,
  )?.[0];
  assert.match(measuredTools, /MOS/);
  assert.doesNotMatch(measured.replace(measuredTools, ''), /MOS/);
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
  await fs.unlink(zoomFile);
  await fs.unlink(helperFile);
}
