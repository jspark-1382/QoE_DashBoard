/* eslint-disable @typescript-eslint/no-require-imports -- Exercise TypeScript helpers and real SSR components. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../analyst-ts-loader.cjs');
const helperPath = path.resolve('lib/analyst/quality-customer-picker.ts');
const helper = fs.existsSync(helperPath) ? load(helperPath) : {};
const call = (customerId, id, overrides = {}) => ({
  id: customerId + ':' + id, rawCallId: id, customerId, contractId: null,
  start: '10:00:00', end: '10:01:00', startSecond: 36000,
  qoe: null, mos: null, locationSource: 'unavailable', gridIds: [], site: '',
  ...overrides,
});
const dataset = {
  meta: { dates: ['2026-10-28', '2026-10-29', '2026-10-30'], poorQoeThreshold: 3 },
  customers: [
    { id: 'c1', sourceContractId: '0000123', displayName: '계약 0000123', dates: [], sampleCount: 999 },
    { id: 'c2', displayName: '계약 익명', dates: [], sampleCount: 0 },
    { id: 'mdt-hidden-hash', displayName: 'mdt-hidden-hash', dates: [], sampleCount: 0 },
    { id: 'outside', sourceContractId: '9999999', displayName: '범위 밖', dates: [], sampleCount: 0 },
  ],
  days: [{ customerId: 'c1', date: '2026-10-28', sourceContractId: 'out-of-scope-id', dataPath: 'never-load.json' }],
};
const overview = {
  schemaVersion: 'analyst-overview-v1', source: 'MDT', date: '2026-10-29 ~ 2026-10-30',
  gridSizeM: 60, cells: [],
  calls: [
    call('c1', 'old', { contractId: '0000123', mos: 2.5, startTimestamp: '2026-10-29T10:50:00+09:00', start: '10:50:00', startSecond: 39000 }),
    call('c1', 'recent', { contractId: '0000456', mos: 2.9, startTimestamp: '2026-10-30T10:00:00+09:00' }),
    call('c1', 'invalid', { mos: 0, startSecond: 36001 }),
    call('c1', 'late', { mos: 1, start: '11:00:00', startSecond: 39600 }),
    call('c2', 'single', { contractId: 'UE00', mos: 2.7, startSecond: 39599.9, start: '10:59:59' }),
    call('mdt-hidden-hash', 'unlocated', { mos: null }),
    call('outside', 'outside', { mos: 1, startSecond: 35999 }),
  ],
  callLocations: [
    { callId: 'c1:old', lat: 37, lon: 127, evidence: 'gnss' },
    { callId: 'c1:old', lat: 37, lon: 127, evidence: 'gnss' },
    { callId: 'c1:recent', lat: 37.1, lon: 127.1, evidence: 'estimated' },
    { callId: 'c2:single', lat: NaN, lon: 127, evidence: 'gnss' },
    { callId: 'outside:outside', lat: 37, lon: 127, evidence: 'bye-cell' },
  ],
};

test('scoped customer aggregation retains all CDR customers and distinct located calls', () => {
  assert.equal(typeof helper.buildQualityCustomerRows, 'function', 'customer aggregation is implemented');
  const rows = helper.buildQualityCustomerRows(dataset, overview, '10:00', '10:59');
  assert.deepEqual(rows.map(r => [r.customerId, r.totalCalls, r.poorCalls, r.locatedCalls, r.unlocatedCalls]), [
    ['c1', 3, 2, 2, 1], ['c2', 1, 1, 0, 1], ['mdt-hidden-hash', 1, 0, 0, 1],
  ]);
  assert.deepEqual(helper.buildQualityCustomerRows(dataset, overview, '20:00', '08:00'), []);
  assert.deepEqual(helper.buildQualityCustomerRows(dataset, overview, 'bad', '10:00'), []);
});

test('customer numbers stay raw strings, aliases remain searchable, and hashes never become numbers', () => {
  const rows = helper.buildQualityCustomerRows(dataset, overview, '10:00', '10:59');
  assert.equal(rows[0].sourceContractId, '0000123');
  assert.deepEqual(rows[0].contractIds, ['0000123', '0000456']);
  assert.equal(rows[2].sourceContractId, null);
  assert.deepEqual(rows[2].contractIds, []);
  for (const [query, expected] of [
    ['0000123', ['c1']], ['00456', ['c1']], [' ue00 ', ['c2']],
    ['mdt-hidden-hash', []], ['out-of-scope-id', []], ['0000', ['c1']],
  ]) assert.deepEqual(helper.qualityCustomerPage(rows, query, 'all', 0).rows.map(r => r.customerId), expected);
});

test('poor filters mean at least one or two valid MOS<3 calls and order stays stable', () => {
  const rows = helper.buildQualityCustomerRows(dataset, overview, '10:00', '10:59');
  assert.deepEqual(helper.qualityCustomerPage(rows, '', 'poor', 0).rows.map(r => r.customerId), ['c1', 'c2']);
  assert.deepEqual(helper.qualityCustomerPage(rows, '', 'repeat', 0).rows.map(r => r.customerId), ['c1']);
  const values = [null, undefined, NaN, Infinity, 0, -1, 5.1, 1, 2.999, 3, 5];
  const raw = { ...overview, calls: values.map((mos, i) => call('mos', String(i), { mos })) };
  assert.equal(helper.buildQualityCustomerRows(dataset, raw, '00:00', '23:59')[0].poorCalls, 2);
  const tied = { ...overview, calls: [call('z', '1'), call('a', '2')] };
  assert.deepEqual(helper.buildQualityCustomerRows(dataset, tied, '00:00', '23:59').map(r => r.customerId), ['a', 'z']);
});

test('pagination clamps to real 25-row pages and empty searches never show stale rows', () => {
  const many = { ...overview, calls: Array.from({ length: 51 }, (_, i) => call(String(i).padStart(2, '0'), 'c', { contractId: '00' + i })) };
  const rows = helper.buildQualityCustomerRows(dataset, many, '00:00', '23:59');
  const first = helper.qualityCustomerPage(rows, '', 'all', 0);
  assert.equal(first.rows.length, 25);
  assert.deepEqual([first.page, first.pages, first.total], [0, 3, 51]);
  const last = helper.qualityCustomerPage(rows, '', 'all', 99);
  assert.deepEqual([last.page, last.rows.length, last.rows[0].customerId], [2, 1, '50']);
  const empty = helper.qualityCustomerPage(rows, 'unmatched', 'all', 2);
  assert.deepEqual([empty.rows, empty.total, empty.page, empty.pages], [[], 0, 0, 0]);
});

test('recent analysis link keeps the source date, original call id and stable subsecond clock order', () => {
  const row = helper.buildQualityCustomerRows(dataset, overview, '10:00', '10:59')[0];
  assert.equal(row.latestCall.rawCallId, 'recent');
  assert.equal(row.latestDate, '2026-10-30');
  assert.equal(row.href, '/?source=MDT&view=contract&date=2026-10-30&customer=c1&call=recent');
  const sameSecond = { ...overview, calls: [
    call('c', 'a', { startTimestamp: '2026-10-30T10:00:00.100000+09:00' }),
    call('c', 'z', { startTimestamp: '2026-10-30T10:00:00.900000+09:00' }),
  ] };
  assert.equal(helper.buildQualityCustomerRows(dataset, sameSecond, '10:00', '10:59')[0].latestCall.rawCallId, 'z');
  sameSecond.calls.reverse();
  assert.equal(helper.buildQualityCustomerRows(dataset, sameSecond, '10:00', '10:59')[0].latestCall.rawCallId, 'z');
  const clockOnly = { ...overview, date: '2026-10-30', calls: [
    call('c', 'b'), call('c', 'a'), call('c', 'later', { startSecond: 36001, start: '10:00:01' }),
  ] };
  assert.equal(helper.buildQualityCustomerRows(dataset, clockOnly, '10:00', '10:59')[0].latestCall.rawCallId, 'later');
});

test('aggregation reads manifest metadata only and never requires customer detail partitions', () => {
  const guarded = { ...dataset, days: [{ customerId: 'new', date: '2026-10-30', sourceContractId: '0000999',
    get samples() { throw Error('detail samples must not be read'); },
    get calls() { throw Error('detail calls must not be read'); },
    get dataPath() { throw Error('detail path must not be read'); },
  }] };
  const rows = helper.buildQualityCustomerRows(guarded, { ...overview, calls: [call('new', 'c')] }, '00:00', '23:59');
  assert.equal(rows[0].sourceContractId, '0000999');
  assert.deepEqual(helper.buildQualityCustomerRows(null, null, '00:00', '23:59'), []);
});

const React = require('react');
const vm = require('node:vm');
const ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');
function pickerComponent(relative = 'components/analyst/quality-customer-picker.tsx', captureDialog, hooks) {
  const file = path.resolve(relative);
  if (!fs.existsSync(file)) return () => null;
  const mod = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: file })(
    id => {
      if (id === 'react' && hooks) return hooks;
      if (id === 'react/jsx-runtime' && captureDialog) {
        const runtime = require(id);
        const observe = create => (type, props, ...rest) => {
          if (type === 'dialog') captureDialog(props);
          return create(type, props, ...rest);
        };
        return { ...runtime, jsx: observe(runtime.jsx), jsxs: observe(runtime.jsxs) };
      }
      return id.endsWith('.module.css') ? {} : id === './document-link'
        ? { default: pickerComponent(path.join(path.dirname(file), 'document-link.tsx')) }
        : id.startsWith('.') ? load(path.resolve(path.dirname(file), id)) : require(id);
    }, mod, mod.exports,
  );
  return mod.exports.QualityCustomerPicker ?? mod.exports.default;
}
const QualityCustomerPicker = pickerComponent();
const render = (overrides = {}) => renderToStaticMarkup(React.createElement(QualityCustomerPicker, {
  dataset, overview, from: '10:00', to: '10:59', selectedCustomerIds: [], onApplyCustomerIds() {}, ...overrides,
}));

test('actual customer picker renders the accessible native drawer and raw identities with scoped counters', () => {
  const html = render();
  assert.match(html, /서비스 고객번호 검색/);
  assert.match(html, /<button[^>]*>고객 찾기<\/button>/);
  assert.match(html, /<button[^>]*>고객 목록<\/button>/);
  assert.match(html, /<dialog[^>]*aria-labelledby="[^"]+"[^>]*aria-modal="true"/);
  assert.match(html, /고객 목록 닫기/);
  assert.match(html, /MDT · 2026-10-29 ~ 2026-10-30/);
  assert.match(html, /10:00 – 10:59/);
  assert.match(html, /지도 상세 필터와 독립/);
  assert.match(html, /0000123/);
  assert.match(html, /UE00/);
  assert.match(html, /고객번호 미제공/);
  assert.match(html, /불량 1건 이상/);
  assert.match(html, /반복 불량 2건 이상/);
  assert.match(html, /통화 3건/);
  assert.match(html, /불량 2건/);
  assert.match(html, /위치 0건/);
  assert.match(html, /최근 통화/);
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 3);
  assert.match(html, /전체 고객 조회/);
  assert.doesNotMatch(html, /고객 선택은 전체 통화 KPI를 바꾸지 않습니다/);
  assert.doesNotMatch(html, /9999999|out-of-scope-id|>mdt-hidden-hash</);
  assert.equal((html.match(/data-customer-id=/g) ?? []).length, 3);
  assert.doesNotMatch(html, /<dialog[^>]*\sopen(?:="")?/);
});

test('loading disables both launcher buttons and input; empty periods offer a clear empty result', () => {
  const html = render({ dataset: null, overview: null });
  assert.match(html, /<input[^>]*aria-label="서비스 고객번호 검색"[^>]*disabled=""/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>고객 찾기<\/button>/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>고객 목록<\/button>/);
  assert.equal((html.match(/data-customer-id=/g) ?? []).length, 0);
  const empty = render({ from: '20:00', to: '08:00' });
  assert.match(empty, /조건에 맞는 고객이 없습니다/);
  assert.match(empty, /0 \/ 0 페이지/);
});

test('actual list renders at most 25 customers with reachable paging for all remaining rows', () => {
  const many = { ...overview, calls: Array.from({ length: 51 }, (_, i) => call('c' + i, 'c', { contractId: 'NUM' + i })) };
  const html = render({ overview: many });
  assert.equal((html.match(/data-customer-id=/g) ?? []).length, 25);
  assert.match(html, /51명/);
  assert.match(html, /1 \/ 3 페이지/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>이전<\/button>/);
  assert.match(html, /<button(?![^>]*disabled)[^>]*>다음<\/button>/);
});

test('selected customer source link follows existing document navigation under the QoE base path', () => {
  const row = helper.buildQualityCustomerRows(dataset, overview, '10:00', '10:59')[0];
  const DocumentLink = pickerComponent('components/analyst/document-link.tsx');
  const html = renderToStaticMarkup(React.createElement(DocumentLink, { href: row.href }, '고객·통화 분석 열기'));
  assert.equal(html, '<a href="/qoe/?source=MDT&amp;view=contract&amp;date=2026-10-30&amp;customer=c1&amp;call=recent">고객·통화 분석 열기</a>');
});

test('first Escape is captured before the search input can clear itself and closes the drawer', () => {
  let dialogProps;
  const Picker = pickerComponent('components/analyst/quality-customer-picker.tsx', props => { dialogProps = props; });
  renderToStaticMarkup(React.createElement(Picker, { dataset, overview, from: '10:00', to: '10:59', selectedCustomerIds: [], onApplyCustomerIds() {} }));
  assert.equal(typeof dialogProps.onKeyDownCapture, 'function', 'Escape must be handled during dialog capture');
  const nativeDialog = { open: true, close() { this.open = false; } };
  dialogProps.ref.current = nativeDialog;
  let prevented = 0, stopped = 0;
  const event = key => ({ key, preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
  dialogProps.onKeyDownCapture(event('a'));
  assert.equal(nativeDialog.open, true, 'ordinary search keys keep the drawer open');
  assert.deepEqual([prevented, stopped], [0, 0]);
  dialogProps.onKeyDownCapture(event('Escape'));
  assert.equal(nativeDialog.open, false, 'the first Escape explicitly closes the native dialog');
  assert.deepEqual([prevented, stopped], [1, 1], 'search clearing and parent Escape handlers must not consume it');
});

test('selection aggregates multiple customers once and retains identities with no in-window calls', () => {
  const rows = helper.buildQualityCustomerRows(dataset, overview, '10:00', '10:59');
  const summary = helper.summarizeQualityCustomerSelection(rows, ['c1', 'c2', 'c1', 'outside', '']);
  assert.deepEqual(summary.customerIds, ['c1', 'c2', 'outside']);
  assert.deepEqual([summary.count, summary.totalCalls, summary.poorCalls, summary.locatedCalls, summary.unlocatedCalls, summary.withoutCalls],
    [3, 4, 3, 2, 2, 1]);
  const emptyWindow = helper.summarizeQualityCustomerSelection([], summary.customerIds);
  assert.deepEqual([emptyWindow.customerIds, emptyWindow.totalCalls, emptyWindow.withoutCalls], [['c1', 'c2', 'outside'], 0, 3]);
  assert.deepEqual(helper.qualityCustomerSelectionIds(['0000123', '0000123', '', '  ']), ['0000123']);
});

test('current-page selection adds/removes just the visible customers while preserving other pages', () => {
  let ids = helper.updateQualityCustomerSelection(['other-page'], ['c1', 'c2', 'c1'], true);
  assert.deepEqual(ids, ['other-page', 'c1', 'c2']);
  ids = helper.updateQualityCustomerSelection(ids, ['c1', 'c2'], false);
  assert.deepEqual(ids, ['other-page']);
  assert.deepEqual(helper.updateQualityCustomerSelection(ids, [''], true), ['other-page']);
});

// Drive the real component event handlers through a minimal synchronous hook host.
// This checks user flows across rerenders without a browser or a DOM implementation.
function pickerHarness(overrides = {}) {
  const states = [], refs = [];
  let stateIndex = 0, refIndex = 0;
  const hooks = {
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
    },
    useRef(initial) { const index = refIndex++; return refs[index] ??= { current: initial }; },
    useMemo: callback => callback(), useCallback: callback => callback, useId: () => 'test-picker', useEffect() {},
  };
  const Picker = pickerComponent('components/analyst/quality-customer-picker.tsx', undefined, hooks);
  const props = { dataset, overview, from: '10:00', to: '10:59', selectedCustomerIds: [], onApplyCustomerIds() {}, ...overrides };
  const nativeDialog = { open: true, close() { this.open = false; } };
  let tree;
  const nodes = () => {
    const found = [];
    const walk = node => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== 'object' || !node.props) return;
      found.push(node); walk(node.props.children);
    };
    walk(tree); return found;
  };
  const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object'
    ? text(node.props?.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
  const renderTree = () => {
    stateIndex = 0; refIndex = 0; tree = Picker(props);
    nodes().find(node => node.type === 'dialog').props.ref.current = nativeDialog;
  };
  renderTree();
  return {
    props, nativeDialog, render: renderTree,
    text: () => text(tree),
    checkbox: name => nodes().find(node => node.type === 'input' && node.props.type === 'checkbox' && node.props['aria-label'] === name),
    button: name => nodes().find(node => node.type === 'button' && text(node) === name),
    drawerSearch: () => nodes().find(node => node.type === 'input' && node.props.placeholder === '원본 고객번호 전체 또는 일부'),
    dialog: () => nodes().find(node => node.type === 'dialog'),
  };
}

test('real checkbox handlers preserve multiselection across search, cohort and page changes until Apply', () => {
  const applied = [];
  const many = { ...overview, calls: Array.from({ length: 28 }, (_, i) => call('c' + String(i).padStart(2, '0'), 'c', {
    contractId: 'NUM' + String(i).padStart(2, '0'), mos: 2.2,
  })) };
  const ui = pickerHarness({ overview: many, onApplyCustomerIds: ids => applied.push(ids) });
  ui.checkbox('NUM00 선택').props.onChange({ target: { checked: true } }); ui.render();
  ui.button('다음').props.onClick(); ui.render();
  ui.checkbox('NUM25 선택').props.onChange({ target: { checked: true } }); ui.render();
  assert.match(ui.text(), /선택 고객 2명 적용/);
  assert.deepEqual(applied, [], 'toggling checkboxes must not change the applied dashboard scope');
  ui.drawerSearch().props.onChange({ target: { value: 'missing' } }); ui.render();
  assert.match(ui.text(), /조건에 맞는 고객이 없습니다/);
  assert.match(ui.text(), /선택 고객 2명 적용/);
  ui.button('반복 불량 2건 이상').props.onClick(); ui.render();
  assert.match(ui.text(), /선택 고객 2명 적용/);
  ui.drawerSearch().props.onChange({ target: { value: '' } });
  ui.button('전체').props.onClick(); ui.render();
  assert.equal(ui.checkbox('NUM00 선택').props.checked, true);
  ui.button('선택 고객 2명 적용').props.onClick();
  assert.deepEqual(applied, [['c00', 'c25']]);
  assert.equal(ui.nativeDialog.open, false);
});

test('reopening discards canceled draft changes and uses the current applied selection', () => {
  const applied = [];
  const ui = pickerHarness({ selectedCustomerIds: ['c1', 'outside'], onApplyCustomerIds: ids => applied.push(ids) });
  assert.equal(ui.checkbox('0000123 선택').props.checked, true);
  assert.match(ui.text(), /1명은 현재 기간·시간에 통화가 없습니다/);
  ui.checkbox('UE00 선택').props.onChange({ target: { checked: true } }); ui.render();
  ui.dialog().props.onKeyDownCapture({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(applied, []);
  ui.props.selectedCustomerIds = ['c2'];
  ui.render();
  ui.nativeDialog.open = true; // no DOM is needed for the already-open native-dialog path
  ui.button('고객 찾기').props.onClick({ currentTarget: {} }); ui.render();
  assert.equal(ui.checkbox('0000123 선택').props.checked, false);
  assert.equal(ui.checkbox('UE00 선택').props.checked, true);
  assert.match(ui.text(), /선택 고객 1명 적용/);
  ui.button('전체 선택 해제').props.onClick(); ui.render();
  assert.deepEqual(applied, [], 'clearing draft alone must not reset the active dashboard');
  ui.button('전체 고객 조회').props.onClick();
  assert.deepEqual(applied, [[]]);
});

test('page select/deselect handlers leave hidden selections intact and selected-only can show them', () => {
  const many = { ...overview, calls: Array.from({ length: 26 }, (_, i) => call('c' + String(i).padStart(2, '0'), 'c', {
    contractId: 'NUM' + String(i).padStart(2, '0'),
  })) };
  const ui = pickerHarness({ overview: many, selectedCustomerIds: ['c25'] });
  ui.button('현재 페이지 전체 선택').props.onClick(); ui.render();
  assert.match(ui.text(), /선택 고객 26명 적용/);
  ui.button('현재 페이지 선택 해제').props.onClick(); ui.render();
  assert.match(ui.text(), /선택 고객 1명 적용/);
  ui.button('선택 고객만').props.onClick(); ui.render();
  assert.equal(ui.checkbox('NUM25 선택').props.checked, true);
  assert.equal(ui.checkbox('NUM00 선택'), undefined);
});
