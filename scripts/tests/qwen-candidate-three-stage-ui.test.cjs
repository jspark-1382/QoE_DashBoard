/* eslint-disable @typescript-eslint/no-require-imports -- Real React server rendering covers candidate stage contracts. */
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
const {
  target,
  fixture,
  diagnostics,
} = require('./fixtures/candidate-targeted-ui.cjs');
const noop = () => {};
const render = (entry) =>
  renderToStaticMarkup(
    React.createElement(ui.CandidateAiDialog, {
      target,
      title: '선택한 후보 제목',
      entry,
      onClose: noop,
      onStart: noop,
      onCancel: noop,
    }),
  );
test('three stages prioritize source targets, explicit measurement dates, distributions and missing metrics', () => {
  const html = render(fixture());
  assert.deepEqual(
    [...html.matchAll(/data-analysis-stage="(\d)"/g)].map((m) => m[1]),
    ['1', '2', '3'],
  );
  const stage1 = html
    .split('data-analysis-stage="1"')[1]
    .split('data-analysis-stage="2"')[0];
  assert.match(stage1, /38507_77751/);
  assert.match(stage1, /9563/);
  assert.match(html, /268/);
  assert.match(html, /48.51/);
  assert.match(html, /미확보/);
  assert.match(html, /배경 MDT 측정일/);
  assert.match(html, /2026-11-03/);
  assert.match(html, /통화 분석 기간/);
  assert.match(html, /2026-10-26/);
  assert.match(html, /실제 POT 위치/);
  assert.match(html, /선택한 후보 제목/);
  assert.match(html, /1 \/ 5쪽/);
});
test('each action keeps exact target SOP and call membership with no cohort fallback', () => {
  const html = render(fixture());
  const cards = [
    ...html.matchAll(
      /<article[^>]*data-target-action="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g,
    ),
  ];
  assert.equal(cards.length, 2);
  assert.equal(cards[0][1], 'TG_MDT');
  assert.match(cards[0][2], /MDT_REVIEW 즉시 확인/);
  assert.doesNotMatch(cards[0][2], /\/source\/|SIP_REVIEW 즉시 확인|UNLINKED/);
  assert.equal(cards[1][1], 'TG_END');
  assert.match(cards[1][2], /\/source\/drop-only/);
  assert.doesNotMatch(
    cards[1][2],
    /\/source\/radio-only|MDT_REVIEW 즉시 확인|UNLINKED/,
  );
  assert.match(cards[0][2], /2026-11-03/);
  assert.match(cards[0][2], /900\(B8\)/);
});
test('zero hypotheses preserve all observed targets and linked investigation steps', () => {
  const entry = fixture();
  entry.job.report.hypotheses = [];
  entry.job.report.sop = [];
  const html = render(entry);
  assert.match(html, /확정할 원인 가설 없음/);
  assert.match(html, /data-target-action="TG_MDT"/);
  assert.match(html, /268/);
  assert.match(html, /MDT_REVIEW 즉시 확인/);
  assert.doesNotMatch(html, /재분석 필요|UNLINKED 즉시 확인/);
});
test('no targets give specific source acquisition next step without invented action', () => {
  const entry = fixture();
  entry.job.evidence.analysisTargets = [];
  entry.job.report.investigations = [];
  entry.job.evidence.sop.templates = [];
  entry.job.report.hypotheses = [];
  entry.job.report.sop = [];
  const html = render(entry);
  assert.match(html, /동일 POT·대역·측정일/);
  assert.doesNotMatch(html, /data-target-action=/);
});
test('legacy report remains visibly stale and cannot invent target mappings', () => {
  const entry = fixture();
  entry.job.evidence.versions.prompt = 'candidate-prompt-v2';
  delete entry.job.evidence.analysisTargets;
  const html = render(entry);
  assert.match(html, /이전 형식/);
  assert.match(html, /재분석/);
  assert.doesNotMatch(html, /data-target-action=/);
});
test('inspector is collapsed auxiliary content without source snapshots in default main flow', () => {
  const html = render(fixture());
  const disclosure = html.match(/<details\b[^>]*data-summary-disclosure="ai"[^>]*>/);
  assert.ok(disclosure);
  assert.doesNotMatch(disclosure[0], /\bopen(?:=|\s|>)/);
  assert.match(html, /<summary>AI 입력·응답<\/summary>/);
  assert.doesNotMatch(html, /ACTUAL SYSTEM|role="tablist"/);
});
test('inspector faithfully displays actual system and raw failed response', () => {
  const inspector = component(
    'components/analyst/candidate-analysis-inspector.tsx',
  );
  for (const tab of ['system', 'user', 'data', 'response']) {
    const html = renderToStaticMarkup(
      React.createElement(inspector.CandidateDiagnosticsContent, {
        diagnostics,
        tab,
      }),
    );
    if (tab === 'system') assert.match(html, /ACTUAL SYSTEM/);
    if (tab === 'user') assert.match(html, /ACTUAL USER/);
    if (tab === 'data') {
      assert.match(html, /268/);
      assert.match(html, /원본 좌표/);
    }
    if (tab === 'response') {
      assert.match(html, /INVALID RAW RESPONSE/);
      assert.match(html, /검증 실패/);
      assert.match(html, /대상 ID 불일치/);
    }
  }
});

test('missing diagnostic captures are explicit and never reconstructed from current evidence', () => {
  const inspector = component(
    'components/analyst/candidate-analysis-inspector.tsx',
  );
  const renderContent = (status) =>
    renderToStaticMarkup(
      React.createElement(inspector.CandidateDiagnosticsContent, {
        diagnostics: {
          schemaVersion: 'candidate-analysis-diagnostics-v1',
          status,
          transmission: [],
          reused: false,
        },
        tab: 'system',
      }),
    );
  assert.match(
    renderContent('unavailable'),
    /실제 전송 사본이 보관되지 않았습니다/,
  );
  assert.match(renderContent('not-sent'), /아직 모델에 전송되지 않았습니다/);
  assert.doesNotMatch(renderContent('unavailable'), /ACTUAL SYSTEM|서버 제목/);
});
test('raw diagnostic markup is rendered as text', () => {
  const inspector = component(
    'components/analyst/candidate-analysis-inspector.tsx',
  );
  const snapshot = structuredClone(diagnostics);
  snapshot.response.content = '<script>window.bad=true</script>';
  const html = renderToStaticMarkup(
    React.createElement(inspector.CandidateDiagnosticsContent, {
      diagnostics: snapshot,
      tab: 'response',
    }),
  );
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('twelve observed targets keep one default action detail open with accessible controls', () => {
  const entry = fixture();
  const source = entry.job.evidence.analysisTargets[0];
  for (let index = 2; index < 12; index++)
    entry.job.evidence.analysisTargets.push({
      ...structuredClone(source),
      id: 'TG_EXTRA_' + index,
      title: '추가 POT ' + index,
    });
  entry.job.report.hypotheses = [];
  entry.job.report.sop = [];
  const html = render(entry);
  const cards = [
    ...html.matchAll(
      /<article[^>]*data-target-action="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g,
    ),
  ];
  assert.equal(cards.length, 12);
  assert.equal(
    cards.filter((card) => card[2].includes('aria-expanded="true"')).length,
    1,
  );
  assert.equal(
    cards.filter((card) => card[2].includes('aria-expanded="false"')).length,
    11,
  );
  const first = cards[0][2];
  assert.match(first, /aria-expanded="true"[^>]*aria-controls="([^"]+)"/);
  const controlledId = first.match(/aria-controls="([^"]+)"/)[1];
  assert.ok(first.includes('id="' + controlledId + '"'));
  assert.match(first, /data-target-action-details="TG_MDT"/);
  assert.doesNotMatch(first, /<div[^>]*hidden=""/);
  assert.match(first, /MDT_REVIEW 즉시 확인/);
  assert.match(first, /MDT_REVIEW 조건부 개선/);
  assert.match(first, /MDT_REVIEW 변경 후 검증/);
  const second = cards[1][2];
  assert.match(second, /data-target-action-details="TG_END"[^>]*hidden=""/);
  assert.match(second, /SIP_REVIEW 즉시 확인/);
  for (const card of cards) {
    assert.match(card[2], /원인 확정 전/);
    assert.match(card[2], /aria-controls=/);
  }
});

test('MDT primary metrics stay compact while full thresholds, PHR and weight basis remain collapsed', () => {
  const targetUi = component(
    'components/analyst/candidate-analysis-targets.tsx',
  );
  const selected = fixture().job.evidence.analysisTargets[0];
  selected.metrics.push(
    { label: 'RSRP ≤-110 dBm', value: 20.5224, unit: '%' },
    { label: 'RSRP ≤-85 dBm', value: 99, unit: '%' },
    { label: 'RSRP MeanSumCnt 평균 (Y, P와 별도)', value: -97, unit: 'dBm' },
    { label: 'rsrp 집계 가중치 (원본 측정 수)', value: 268, unit: '측정' },
  );
  const html = renderToStaticMarkup(
    React.createElement(targetUi.CandidateTargetDetails, {
      targets: [selected],
      selectedId: selected.id,
      onSelect: noop,
      callPeriod: '2026-10-26 ~ 2026-10-30',
    }),
  );
  const primary = html.match(
    /<dl[^>]*aria-label="주요 측정값"[^>]*>([\s\S]*?)<\/dl>/,
  )?.[1];
  assert.ok(primary);
  assert.equal([...primary.matchAll(/<dt>/g)].length, 5);
  for (const label of [
    '측정 수',
    'RSRP 평균',
    'RSRQ 평균',
    'RSRP ≤ -105',
    'RSRP ≤-110',
  ])
    assert.ok(primary.includes(label), label);
  assert.doesNotMatch(primary, /PHR|MeanSumCnt|집계 가중치|≤-85/);
  const full = html.match(
    /<details[^>]*><summary>모든 측정값·집계 기준<\/summary>([\s\S]*?)<\/details>/,
  )?.[1];
  assert.ok(full);
  assert.match(full, /PHR 平均|PHR 평균/);
  assert.match(full, /미확보/);
  assert.match(full, /MeanSumCnt/);
  assert.match(full, /집계 가중치/);
  assert.match(full, /≤-85/);
  assert.doesNotMatch(html, /<details[^>]*open=/);
  const source = renderToStaticMarkup(
    React.createElement(targetUi.TargetSource, { target: selected }),
  );
  assert.match(source, /268/);
  assert.doesNotMatch(source, /집계 가중치/);
});
test('termination primary metrics show original major cause fields while other originals remain collapsed', () => {
  const targetUi = component(
    'components/analyst/candidate-analysis-targets.tsx',
  );
  const selected = fixture().job.evidence.analysisTargets[1];
  selected.metrics.push(
    { label: 'fcRaw', value: '9563' },
    { label: 'byeReasonRaw', value: '102^RTP timeout' },
    { label: 'reasonRaw', value: 'H : Drop/V : Rx_RTP_middle_Loss' },
    { label: 'releaseCauseRaw', value: '0: Tx Bye' },
    { label: 'secondaryReleaseCause1Raw', value: 'vendor-secondary' },
    { label: 'callDirectionRaw', value: 'MO' },
  );
  const html = renderToStaticMarkup(
    React.createElement(targetUi.CandidateTargetDetails, {
      targets: [selected],
      selectedId: selected.id,
      onSelect: noop,
      callPeriod: '2026-10-26 ~ 2026-10-30',
    }),
  );
  const primary = html.match(
    /<dl[^>]*aria-label="주요 측정값"[^>]*>([\s\S]*?)<\/dl>/,
  )?.[1];
  assert.ok(primary);
  for (const label of [
    'FC',
    'BYE',
    'REASON',
    'Release Cause',
    '9563',
    '102^RTP timeout',
    '0: Tx Bye',
  ])
    assert.ok(primary.includes(label), label);
  assert.doesNotMatch(primary, /vendor-secondary|MO/);
  const full = html.match(
    /<details[^>]*><summary>모든 측정값·집계 기준<\/summary>([\s\S]*?)<\/details>/,
  )?.[1];
  assert.ok(full);
  assert.match(full, /vendor-secondary/);
  assert.match(full, /MO/);
  assert.doesNotMatch(html, /<details[^>]*open=/);
});

