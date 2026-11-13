/* eslint-disable @typescript-eslint/no-require-imports -- React server rendering tests retain semantic UI without a browser. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript'),
  React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { load } = require('../analyst-ts-loader.cjs');
function component(file) {
  const mod = { exports: {} };
  const code = ts.transpileModule(
    fs.readFileSync(file, 'utf8').split('import.meta').join('({env:{}})'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', {
    filename: file,
  })(
    (id) => {
      if (id.endsWith('.css'))
        return { default: new Proxy({}, { get: (_, key) => String(key) }) };
      if (!id.startsWith('.')) return require(id);
      const resolved = path.resolve(path.dirname(file), id);
      return fs.existsSync(resolved + '.tsx')
        ? component(resolved + '.tsx')
        : load(resolved);
    },
    mod,
    mod.exports,
  );
  return mod.exports;
}
const ui = component('components/analyst/candidate-ai-analysis.tsx');
const target = {
  kind: 'candidate',
  candidateId: 'candidate',
  sourceRevision: 'revision',
  scope: {
    dateStart: '2026-10-26',
    dateEnd: '2026-10-30',
    from: '00:00',
    to: '23:59',
  },
  candidateScope: {
    scopeKey: 'full',
    policy: 'strict-3-site-v1',
    analysisMode: 'all',
    locationMode: 'gps-mdt-rough-unvalidated-v1',
    modelId: 'dbscan',
  },
};
const baseJob = {
  id: 'job',
  target,
  status: 'analyzing',
  createdAt: '2026-11-12T00:00:00Z',
  updatedAt: '2026-11-12T00:00:01Z',
  model: 'qwen-test',
};
const entry = {
  target,
  job: baseJob,
  pending: false,
  error: '상태 조회 연결이 끊겼습니다.',
};
const noop = () => {};

test('status lookup errors show retry instead of a running spinner in summary and popup', () => {
  const summary = renderToStaticMarkup(
    React.createElement(ui.CandidateAiSummary, {
      entry,
      onOpen: noop,
      onStart: noop,
      onCancel: noop,
    }),
  );
  assert.equal(ui.candidateAiButtonLabel(entry), '다시 시도');
  assert.match(summary, /data-ai-state="status-error"/);
  assert.match(summary, /상태 조회 실패/);
  assert.match(summary, /다시 시도/);
  assert.doesNotMatch(summary, /class="cancel"|분석 중/);
  const dialog = renderToStaticMarkup(
    React.createElement(ui.CandidateAiDialog, {
      target,
      title: '후보 지역',
      entry,
      onClose: noop,
      onStart: noop,
      onCancel: noop,
    }),
  );
  assert.match(dialog, /<output>상태 조회 실패<\/output>/);
  assert.match(dialog, /다시 시도/);
  assert.doesNotMatch(dialog, /class="progress"|분석 취소/);
});

test('cluster settings remain Korean and collapsed inside the first stage after removing tabs', () => {
  const evidence = {
    candidate: {
      title: '후보 지역',
      algorithm: 'DBSCAN',
      parameters: {
        epsM: 100,
        minSamples: 2,
        minPoorCustomers: 3,
        minPoorDates: 2,
      },
      discoveryDates: [],
      validationDates: [],
    },
    limitations: [],
    summary: { customers: 2, totalCalls: 3, observedDays: 2, dropCalls: 0 },
    location: { gpsCalls: 2, roughCalls: 1 },
    comparison: {
      status: 'unavailable',
      conditions: '비교군 없음',
      limitations: [],
    },
    coverage: { sampledCalls: 0, radioCalls: 0, rtpCalls: 0 },
    mdtGrid: { description: '배경 자료 없음', measurementDates: [] },
    calls: [],
    members: [],
    facts: [],
    byDay: [],
    byCell: [],
    byHour: [],
    versions: { evidence: 'e1', prompt: 'p1' },
    sop: { version: 's1', templates: [] },
    fingerprint: 'fingerprint',
  };
  const html = renderToStaticMarkup(
    React.createElement(ui.CandidateAiDialog, {
      target,
      title: '후보 지역',
      entry: {
        target,
        job: { ...baseJob, evidence },
        pending: true,
        error: '',
      },
      onClose: noop,
      onStart: noop,
      onCancel: noop,
    }),
  );
  const settings = html.match(
    /<details class="versionInfo">([\s\S]*?)<\/details>/,
  )?.[1];
  assert.ok(settings);
  const main = settings.match(/<div class="fixedMeta">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(main);
  assert.doesNotMatch(html, /role="tablist"/);
  for (const label of [
    '이웃 거리 100m',
    '최소 이웃 2개',
    '최소 고객 3명',
    '최소 관측일 2일',
  ])
    assert.ok(main.includes(label));
  assert.doesNotMatch(main, /epsM|minSamples|minPoorCustomers|minPoorDates/);
  assert.match(html, /<details class="versionInfo">/);
  assert.match(html, /전체 군집 설정/);
});
