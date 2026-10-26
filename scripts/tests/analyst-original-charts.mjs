import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const temporary = [];
async function loadComponent(name) {
  const source = `components/analyst/${name}.tsx`;
  assert.equal(
    await fs.access(source).then(
      () => true,
      () => false,
    ),
    true,
    `${name} chart must be implemented`,
  );
  const code = ts
    .transpileModule(await fs.readFile(source, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    })
    .outputText.replace(
      /import styles from ['"]\.\/[^'"]+\.module\.css['"];?/,
      'const styles = new Proxy({}, { get: (_, key) => key });',
    );
  const path = new URL(`./.${name}-fixture.mjs`, import.meta.url);
  temporary.push(path);
  await fs.writeFile(path, code);
  return import(path.href);
}
function descendants(node) {
  if (!node || typeof node !== 'object') return [];
  return [
    node,
    ...React.Children.toArray(node.props?.children).flatMap(descendants),
  ];
}
const mos = {
  metric: 'mos',
  threshold: 3.5,
  total: 102,
  evaluated: 100,
  unscored: 2,
  average: 4.01,
  outOfRange: 0,
  bands: [
    { id: 'good', label: '양호', count: 72, percent: 72, color: '#23a86e' },
    { id: 'fair', label: '보통', count: 24, percent: 24, color: '#f1c847' },
    { id: 'poor', label: '불량', count: 4, percent: 4, color: '#e16868' },
  ],
  bins: Array.from({ length: 20 }, (_, index) => ({
    from: index / 4,
    to: (index + 1) / 4,
    count: index === 19 ? 72 : index === 14 ? 24 : index === 12 ? 4 : 0,
    color: index < 14 ? '#e16868' : index < 16 ? '#f1c847' : '#23a86e',
    band: index < 14 ? 'poor' : index < 16 ? 'fair' : 'good',
  })),
  experience: [
    {
      id: 'affected',
      label: '저품질 경험 계약',
      count: 4,
      total: 20,
      percent: 20,
      customerIds: ['a', 'b', 'c', 'd'],
      hourly: Array.from({ length: 24 }, (_, hour) =>
        hour === 8 ? 3 : hour === 9 ? 1 : 0,
      ),
    },
    {
      id: 'repeat',
      label: '반복 불량 계약',
      count: 0,
      total: 20,
      percent: 0,
      customerIds: [],
      hourly: Array(24).fill(0),
    },
    {
      id: 'consecutive',
      label: '연속 불량 계약',
      count: null,
      total: 20,
      percent: null,
      customerIds: [],
      hourly: null,
    },
  ],
  termination: { count: null, rate: null, unknown: 102 },
};

try {
  const { QualityDistribution } = await loadComponent('quality-distribution');
  const { CustomerExperience } = await loadComponent('customer-experience');
  let bandSelection = 'unchanged';
  const distributionTree = QualityDistribution({
    analytics: mos,
    selectedBand: 'fair',
    onBandSelect: (value) => {
      bandSelection = value;
    },
  });
  const html = renderToStaticMarkup(distributionTree);
  assert.match(html, /MOS 점수 분포/);
  assert.match(html, /미평가 2/);
  assert.match(html, /width:72%/);
  assert.match(html, /width:24%/);
  assert.match(html, /width:4%/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /5\.00.*72통화/);
  const distributionNodes = descendants(distributionTree);
  const fairButton = distributionNodes.find(
    (node) =>
      node.type === 'button' && node.props['data-composition-band'] === 'fair',
  );
  fairButton.props.onClick();
  assert.equal(
    bandSelection,
    null,
    'clicking selected band removes only that investigation condition',
  );
  const lastBin = distributionNodes.find(
    (node) => node.type === 'button' && node.props['data-bin-from'] === 4.75,
  );
  lastBin.props.onClick();
  assert.equal(
    bandSelection,
    'good',
    'histogram native buttons select their actual band',
  );
  assert.equal(
    distributionNodes.filter(
      (node) =>
        node.type === 'button' && node.props['data-bin-from'] !== undefined,
    ).length,
    20,
  );

  const qoe = {
    ...mos,
    metric: 'qoe',
    threshold: 2.5,
    bands: [
      { ...mos.bands[0], label: '기준 이상', count: 96, percent: 96 },
      { ...mos.bands[2], label: '저품질' },
    ],
    bins: mos.bins.map((bin, index) => ({
      ...bin,
      count: index === 0 ? 4 : index === 19 ? 96 : 0,
      band: bin.from < 2.5 ? 'poor' : 'good',
      color: bin.from < 2.5 ? '#e16868' : '#23a86e',
    })),
  };
  const qoeHTML = renderToStaticMarkup(
    React.createElement(QualityDistribution, {
      analytics: qoe,
      selectedBand: null,
      onBandSelect() {},
    }),
  );
  assert.match(qoeHTML, /QoE 점수 분포/);
  assert.match(qoeHTML, /2\.5/);
  assert.doesNotMatch(qoeHTML, /MOS|보통|3\.5 이상 4\.0 미만|#f1c847/);
  assert.match(qoeHTML, /QoE 0\.00 이상 0\.25 미만, 4통화, 저품질/);
  const empty = {
    ...mos,
    total: 0,
    evaluated: 0,
    unscored: 0,
    average: null,
    bands: mos.bands.map((band) => ({ ...band, count: 0, percent: null })),
    bins: mos.bins.map((bin) => ({ ...bin, count: 0 })),
  };
  assert.match(
    renderToStaticMarkup(
      React.createElement(QualityDistribution, {
        analytics: empty,
        selectedBand: null,
        onBandSelect() {},
      }),
    ),
    /평가 가능한 통화 없음/,
  );
  const missingHTML = renderToStaticMarkup(
    React.createElement(QualityDistribution, {
      analytics: { ...empty, total: 5, unscored: 5 },
      selectedBand: null,
      onBandSelect() {},
    }),
  );
  assert.match(missingHTML, /미평가 5통화/);
  assert.doesNotMatch(missingHTML, /0\.0%/);

  let groupSelection = 'unchanged';
  const experienceTree = CustomerExperience({
    analytics: mos,
    selectedGroup: 'affected',
    onGroupSelect: (value) => {
      groupSelection = value;
    },
  });
  const experienceHTML = renderToStaticMarkup(experienceTree);
  assert.match(experienceHTML, /고객 체감 품질/);
  assert.match(experienceHTML, /0계약/);
  assert.match(experienceHTML, /0\.0%/);
  assert.match(experienceHTML, /미제공/);
  assert.doesNotMatch(experienceHTML, /전일|대비|▲|▼/);
  const experienceNodes = descendants(experienceTree);
  const affected = experienceNodes.find(
    (node) =>
      node.type === 'button' &&
      node.props['data-experience-group'] === 'affected',
  );
  affected.props.onClick();
  assert.equal(groupSelection, null);
  const repeat = experienceNodes.find(
    (node) =>
      node.type === 'button' &&
      node.props['data-experience-group'] === 'repeat',
  );
  repeat.props.onClick();
  assert.equal(groupSelection, 'repeat');
  const unknown = experienceNodes.find(
    (node) =>
      node.type === 'button' &&
      node.props['data-experience-group'] === 'consecutive',
  );
  assert.equal(unknown.props.disabled, true);
  assert.equal(
    descendants(unknown).filter(
      (node) => node.type === 'svg' && node.props['data-hourly-series'],
    ).length,
    0,
    'unknown chronology must never create a fake series',
  );
  const series = experienceNodes.find(
    (node) =>
      node.type === 'svg' && node.props['data-hourly-series'] === 'affected',
  );
  assert.equal(
    descendants(series).filter((node) => node.type === 'rect').length,
    24,
  );
  assert.match(renderToStaticMarkup(series), /08시.*3계약/);
  assert.match(renderToStaticMarkup(series), /09시.*1계약/);
  assert.match(experienceHTML, /시간 내/);
  console.log(
    'Original charts SSR: metric bands, exact percentages, accessible scoped toggles, empty/zero/unknown and actual hourly series passed',
  );
} finally {
  await Promise.all(temporary.map((path) => fs.unlink(path).catch(() => {})));
}
