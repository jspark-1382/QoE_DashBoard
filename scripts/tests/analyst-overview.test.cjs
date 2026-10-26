const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const data = {
  isPoorCall: (value, threshold) =>
    value !== null && Number.isFinite(value) && value < threshold,
  timeToSecond: (time) => {
    const [h, m, s] = time.split(':').map(Number);
    return h * 3600 + m * 60 + (s || 0);
  },
  locationLabels: { gnss: 'GNSS 관측', unavailable: '위치 근거 없음' },
};
function load(file, imports) {
  const output = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, file), 'utf8'),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: (id) => {
      if (id in imports) return imports[id];
      throw new Error(`Unexpected import ${id}`);
    },
  });
  return module.exports;
}
const api = load('../../lib/analyst/overview.ts', { './data': data });
const map = load('../../lib/analyst/map.ts', {});
const ui = load('../../lib/analyst/overview-ui.ts', {});
const jsx = (type, props) => ({ type, props });
let stateValues = [],
  stateIndex = 0;
const stateUpdates = [];
const { QualityOverview } = load(
  '../../components/analyst/quality-overview.tsx',
  {
    react: {
      useMemo: (fn) => fn(),
      useState: (value) => {
        const index = stateIndex++;
        return [
          index in stateValues ? stateValues[index] : value,
          (next) => stateUpdates.push({ index, next }),
        ];
      },
      useRef: (value) => ({ current: value }),
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '../../lib/analyst/overview-ui': ui,
    '../../lib/analyst/map': map,
    '../../lib/analyst/overview': api,
    '../../lib/analyst/data': data,
    './analyst-map': { AnalystMap: 'AnalystMap' },
    './quality-overview.module.css': {
      default: new Proxy({}, { get: (_, key) => key }),
    },
  },
);
const defaults = {
  from: '00:00',
  to: '23:59',
  hour: null,
  cellId: null,
  missingLocation: false,
  poorOnly: true,
  sort: 'poor',
  page: 0,
};
const calls = [
  {
    id: 'a',
    customerId: '1',
    contractId: '0000123',
    start: '08:00:00',
    end: '08:01:00',
    startSecond: 28800,
    qoe: 0,
    gridIds: ['x'],
    locationSource: 'gnss',
  },
  {
    id: 'b',
    customerId: '2',
    contractId: null,
    start: '09:00:00',
    end: '09:01:00',
    startSecond: 32400,
    qoe: 2,
    gridIds: [],
    locationSource: 'unavailable',
  },
  {
    id: 'c',
    customerId: '3',
    contractId: '003',
    start: '08:30:00',
    end: '08:31:00',
    startSecond: 30600,
    qoe: null,
    gridIds: ['x'],
    locationSource: 'gnss',
  },
];
const overview = {
  date: '2026-10-24',
  source: 'MDT',
  gridSizeM: 60,
  calls,
  cells: [{ id: 'x', label: '격자 x', lat: 37, lon: 127, callIds: ['a', 'c'] }],
};
const nodes = (tree) =>
  tree == null
    ? []
    : Array.isArray(tree)
      ? tree.flatMap(nodes)
      : typeof tree === 'object'
        ? [tree, ...nodes(tree.props?.children)]
        : [];
const text = (tree) =>
  tree == null
    ? ''
    : Array.isArray(tree)
      ? tree.map(text).join('')
      : typeof tree === 'object'
        ? text(tree.props?.children)
        : String(tree);
function render(filters = {}, values = []) {
  stateValues = values;
  stateIndex = 0;
  stateUpdates.length = 0;
  const updates = [],
    analyzed = [];
  const tree = QualityOverview({
    overview,
    threshold: 2.5,
    filters: { ...defaults, ...filters },
    onFiltersChange: (value) => updates.push(value),
    onAnalyze: (call) => analyzed.push(call),
  });
  return { tree, updates, analyzed, all: nodes(tree) };
}
test('keeps raw contract zeros and score zero; analyzes only explicit selected row', () => {
  const r = render();
  assert.match(text(r.tree), /0000123/);
  assert.match(text(r.tree), /0\.00/);
  assert.match(text(r.tree), /계약번호 미제공/);
  assert.equal(r.analyzed.length, 0);
  r.all
    .find((n) => n.props?.['aria-label'] === '0000123 08:00:00 통화 분석')
    .props.onClick();
  assert.equal(r.analyzed[0].id, 'a');
});
test('hour investigation narrows map while global summary stays fixed; selection is removable', () => {
  const r = render({ hour: 8 });
  const summary = r.all.find(
    (n) => n.props?.['aria-label'] === '전체 분석 요약',
  );
  assert.match(text(summary), /100\.0%/); // two evaluated calls, both poor
  assert.equal(
    r.all.find((n) => n.type === 'AnalystMap').props.cells[0].evaluated,
    1,
  );
  const hourButton = r.all.find((n) =>
    n.props?.['aria-label']?.startsWith('8시 저품질'),
  );
  hourButton.props.onClick();
  assert.equal(r.updates[0].hour, null);
});
test('unlocated link clears selected grid and lists unlocated poor calls only', () => {
  const r = render({ cellId: 'x' });
  r.all
    .find(
      (n) => n.type === 'button' && text(n) === '위치 없는 저품질 1통화 보기',
    )
    .props.onClick();
  assert.equal(r.updates[0].cellId, null);
  assert.equal(r.updates[0].missingLocation, true);
  const missing = render({ missingLocation: true });
  const analysis = missing.all.filter((n) =>
    n.props?.['aria-label']?.endsWith('통화 분석'),
  );
  assert.equal(analysis.length, 1);
  assert.match(analysis[0].props['aria-label'], /계약번호 미제공/);
});
test('time range and sort callbacks reset pagination; null score never becomes zero', () => {
  const r = render({ page: 8, poorOnly: false });
  r.all
    .find((n) => n.props?.['aria-label'] === '전체 분석 시작 시각')
    .props.onChange({ target: { value: '08:00' } });
  assert.equal(r.updates[0].page, 0);
  assert.equal(r.updates[0].from, '08:00');
  assert.equal(
    r.all.filter((n) => n.props?.['aria-label']?.endsWith('통화 분석')).length,
    2,
  );
});

test('persistent investigation supports independent and all reset with result counts', () => {
  const r = render({ hour: 8, cellId: 'x' });
  const strip = r.all.find((n) => n.props?.['aria-label'] === '현재 조사 조건');
  assert.match(text(strip), /조사 2통화/);
  nodes(strip)
    .find((n) => n.type === 'button' && text(n) === '격자 x 해제 ×')
    .props.onClick();
  assert.equal(r.updates[0].hour, 8);
  assert.equal(r.updates[0].cellId, null);
  nodes(strip)
    .find((n) => n.type === 'button' && text(n) === '조사 조건 전체 해제')
    .props.onClick();
  assert.equal(r.updates[1].hour, null);
  assert.equal(r.updates[1].missingLocation, false);
});
test('rank selection requests explicit scoped map focus with raw coordinate title', () => {
  const r = render();
  const button = r.all.find((n) => n.type === 'button' && text(n) === '격자 x');
  assert.match(button.props.title, /x · 중심 37/);
  button.props.onClick();
  assert.equal(r.updates[0].cellId, 'x');
  const request = stateUpdates.find((x) => x.next?.lat === 37).next;
  assert.match(request.key, /MDT-2026-10-24:/);
  assert.equal(request.lon, 127);
});
test('rate chart exposes evaluated denominator and unavailable hours; view switch preserves filters', () => {
  const r = render({ hour: 8 }, ['list', 'rate']);
  const emptyHour = r.all.find((n) =>
    n.props?.['aria-label']?.startsWith('0시 저품질'),
  );
  assert.match(emptyHour.props.title, /평가 불가.*통화 없음/);
  assert.match(emptyHour.props['aria-label'], /평가 불가/);
  const eight = r.all.find((n) =>
    n.props?.['aria-label']?.startsWith('8시 저품질'),
  );
  assert.match(eight.props.title, /100.0%.*평가 가능 1 \/ 전체 2/);
  assert.match(eight.props['aria-label'], /100.0%/);
  r.all
    .find((n) => n.type === 'button' && text(n) === '지도 중심')
    .props.onClick();
  assert.equal(r.updates.length, 0);
  assert.equal(stateUpdates[0].next, 'map');
});

test('overview legend uses the same discrete colors as map rendering', () => {
  const r = render();
  const colors = r.all
    .filter((n) => n.type === 'i')
    .map((n) => n.props.style.background);
  assert.equal(colors.join(','), '#9ba6ad,#d7ada4,#c47867,#b64536');
});
test('internal grid code becomes stable area name in map and filtered investigation strip', () => {
  const original = overview.cells[0].label;
  overview.cells[0].label = 'grid60:100:200';
  try {
    const initial = render();
    assert.equal(
      initial.all.find((n) => n.type === 'AnalystMap').props.cells[0].label,
      '조사구역 1',
    );
    const narrowed = render({ hour: 8, cellId: 'x' });
    assert.equal(
      narrowed.all.find((n) => n.type === 'AnalystMap').props.cells[0].label,
      '조사구역 1',
    );
    assert.match(
      text(
        narrowed.all.find((n) => n.props?.['aria-label'] === '현재 조사 조건'),
      ),
      /조사구역 1/,
    );
  } finally {
    overview.cells[0].label = original;
  }
});
