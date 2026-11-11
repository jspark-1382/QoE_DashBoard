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
const api = load('../../lib/analyst/overview.ts', { './data': data, './derived-qoe': require('../analyst-ts-loader.cjs').load('lib/analyst/derived-qoe.ts') });
const map = load('../../lib/analyst/map.ts', {});
const ui = load('../../lib/analyst/overview-ui.ts', {});
const analytics = require('../analyst-ts-loader.cjs').load(
  'lib/analyst/overview-analytics.ts',
);
const jsx = (type, props) => ({ type, props });
let stateValues = [],
  stateIndex = 0;
const stateUpdates = [];
const { QualityOverview } = load(
  '../../components/analyst/quality-overview.tsx',
  {
    react: {
      useMemo: (fn) => fn(),
      useEffect: (fn) => fn(),
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
    '../../lib/analyst/overview-analytics': analytics,
    './quality-distribution': { QualityDistribution: 'QualityDistribution' },
    './mos-summary-strip': { MosSummaryStrip: 'MosSummaryStrip' },
    './customer-experience': { CustomerExperience: 'CustomerExperience' },
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
function render(filters = {}, values = [], source = overview) {
  stateValues = values;
  stateIndex = 0;
  stateUpdates.length = 0;
  const updates = [],
    analyzed = [];
  const tree = QualityOverview({
    overview: source,
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
  assert.match(text(r.tree), /고객번호 미제공/);
  assert.equal(r.analyzed.length, 0);
  r.all
    .find((n) => n.props?.['aria-label'] === '0000123 08:00:00 통화 분석')
    .props.onClick();
  assert.equal(r.analyzed[0].id, 'a');
});

test('distribution and experience filters change investigation while keeping whole-scope summary', () => {
  const r = render();
  const distribution = r.all.find((n) => n.type === 'QualityDistribution');
  distribution.props.onBandSelect('good');
  assert.equal(r.updates[0].scoreBand, 'good');
  assert.equal(r.updates[0].poorOnly, false);
  const experience = r.all.find((n) => n.type === 'CustomerExperience');
  experience.props.onGroupSelect('repeat');
  assert.equal(r.updates[1].experienceGroup, 'repeat');
  const selected = render({
    scoreBand: 'good',
    experienceGroup: 'repeat',
    poorOnly: false,
  });
  assert.equal(
    selected.all.filter((n) => n.props?.['aria-label']?.endsWith('통화 분석'))
      .length,
    0,
  );
  assert.match(
    text(
      selected.all.find((n) => n.props?.['aria-label'] === '전체 분석 요약'),
    ),
    /100\.0%/,
  );
  assert.equal(
    selected.all.find((n) => n.type === 'QualityDistribution').props.analytics
      .total,
    3,
  );
  selected.all
    .find((n) => n.type === 'button' && text(n) === '조사 조건 전체 해제')
    .props.onClick();
  assert.equal(selected.updates[0].scoreBand, null);
  assert.equal(selected.updates[0].experienceGroup, null);
});

test('QoE fair investigation filters rows and keeps the same global denominator', () => {
  const original=calls[1].qoe;
  calls[1].qoe=3;
  try {
    const r=render({scoreMetric:'qoe',scoreBand:'fair',poorOnly:false});
    const rows=r.all.filter(n=>n.props?.['aria-label']?.endsWith('통화 분석'));
    assert.equal(rows.length,1);
    assert.match(rows[0].props['aria-label'],/09:00:00/);
    const a=r.all.find(n=>n.type==='QualityDistribution').props.analytics;
    assert.deepEqual(a.bands.map(b=>[b.id,b.count]),[['good',0],['fair',1],['poor',1]]);
    assert.equal(a.total,3);
    assert.equal(a.evaluated,2);
    assert.match(text(r.all.find(n=>n.props?.['aria-label']==='전체 분석 요약')),/50\.0%/);
  } finally {calls[1].qoe=original;}
});

test('MOS projects all summaries and rows consistently without changing original QoE', () => {
  calls[0].mos = 4.2;
  calls[1].mos = 2.8;
  try {
    const r = render({ scoreMetric: 'mos', poorOnly: true });
    assert.equal(
      r.updates.length,
      0,
      'available MOS stays selected without normalization',
    );
    const summary = text(
      r.all.find((n) => n.props?.['aria-label'] === '전체 분석 요약'),
    );
    assert.match(summary, /평균 QoE3\.50/);
    assert.match(summary, /50\.0%/);
    const rows = r.all.filter((n) =>
      n.props?.['aria-label']?.endsWith('통화 분석'),
    );
    assert.equal(rows.length, 1);
    assert.match(rows[0].props['aria-label'], /09:00:00/);
    assert.equal(calls[0].qoe, 0);
    assert.equal(calls[1].qoe, 2);
    assert.equal(
      r.all.find((n) => n.type === 'QualityDistribution').props.analytics
        .metric,
      'mos',
    );
  } finally {
    delete calls[0].mos;
    delete calls[1].mos;
  }
  const missing = render({ scoreMetric: 'mos' });
  assert.match(
    text(missing.all.find((n) => n.props?.['aria-label'] === '전체 분석 요약')),
    /평균 QoE/,
  );
  assert.equal(
    missing.all.find((n) => n.type === 'option' && n.props.value === 'mos')
      .props.disabled,
    true,
  );
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
    n.props?.['aria-label']?.startsWith('08시 · 전체 품질 통화'),
  );
  hourButton.props.onClick();
  assert.equal(r.updates[0].hour, null);
});
test('unlocated link clears selected grid and lists unlocated poor calls only', () => {
  const r = render({
    cellId: 'x',
    hour: 8,
    scoreBand: 'good',
    experienceGroup: 'repeat',
    page: 3,
  });
  r.all
    .find(
      (n) => n.type === 'button' && text(n) === '위치 없는 저품질 1통화 보기',
    )
    .props.onClick();
  assert.equal(r.updates[0].cellId, null);
  assert.equal(r.updates[0].missingLocation, true);
  assert.equal(
    r.updates[0].hour,
    null,
    'global unlocated count must open the same whole time scope',
  );
  assert.equal(r.updates[0].scoreBand, null);
  assert.equal(r.updates[0].experienceGroup, null);
  assert.equal(r.updates[0].page, 0);
  assert.equal(r.updates[0].poorOnly, true);
  const missing = render(r.updates[0]);
  const analysis = missing.all.filter((n) =>
    n.props?.['aria-label']?.endsWith('통화 분석'),
  );
  assert.equal(analysis.length, 1);
  assert.match(analysis[0].props['aria-label'], /고객번호 미제공/);
});

test('unavailable consecutive selection with missing or tied chronology withholds investigation and tells user to clear it', () => {
  for (const timestamp of [undefined, '2026-10-24T08:00:00+09:00']) {
    const source = {
      ...overview,
      calls: calls.map((call) => ({
        ...call,
        customerId: '1',
        startTimestamp: timestamp,
      })),
    };
    const r = render(
      { experienceGroup: 'consecutive', poorOnly: false },
      [],
      source,
    );
    const experience = r.all
      .find((n) => n.type === 'CustomerExperience')
      .props.analytics.experience.find((group) => group.id === 'consecutive');
    assert.equal(
      experience.count,
      null,
      'fixture must represent truly unavailable chronology',
    );
    assert.equal(
      r.all.filter((n) => n.props?.['aria-label']?.endsWith('통화 분석'))
        .length,
      0,
      'unavailable group cannot display unrelated calls',
    );
    assert.equal(
      r.all
        .find((n) => n.type === 'AnalystMap')
        .props.cells.reduce((sum, cell) => sum + cell.evaluated, 0),
      0,
    );
    assert.match(text(r.tree), /체감.*집계 보류.*해제/);
    const summary = text(
      r.all.find((n) => n.props?.['aria-label'] === '전체 분석 요약'),
    );
    assert.match(summary, /전체 통화3/);
    assert.match(summary, /100\.0%/);
    const badge = r.all.find(
      (n) =>
        n.type === 'button' &&
        text(n).includes('2회 이상 연속') &&
        text(n).includes('해제'),
    );
    badge.props.onClick();
    assert.equal(r.updates[0].experienceGroup, null);
    const cleared = render(r.updates[0], [], source);
    assert.equal(
      cleared.all.filter((n) => n.props?.['aria-label']?.endsWith('통화 분석'))
        .length,
      2,
      'clearing the unavailable group restores the evaluated calls',
    );
  }
});

test('unavailable MOS URL normalizes QoE and clears metric-specific investigation before rendering', () => {
  const r = render({
    scoreMetric: 'mos',
    scoreBand: 'fair',
    experienceGroup: 'consecutive',
    poorOnly: false,
    hour: 8,
    page: 5,
  });
  assert.equal(r.updates.length, 1);
  const normalized = r.updates[0];
  assert.equal(normalized.scoreMetric, 'qoe');
  assert.equal(normalized.scoreBand, null);
  assert.equal(normalized.experienceGroup, null);
  assert.equal(normalized.page, 0);
  assert.equal(
    normalized.hour,
    8,
    'metric normalization preserves the independent hour scope',
  );
  assert.equal(normalized.from, '00:00');
  const distribution = r.all.find((n) => n.type === 'QualityDistribution');
  assert.equal(distribution.props.selectedBand, null);
  assert.equal(distribution.props.analytics.metric, 'qoe');
  assert.equal(
    r.all.find((n) => n.type === 'CustomerExperience').props.selectedGroup,
    null,
  );
  assert.equal(
    r.all.filter((n) => n.props?.['aria-label']?.endsWith('통화 분석')).length,
    1,
    'fallback must not render an impossible QoE fair band',
  );
  assert.match(
    text(r.all.find((n) => n.props?.['aria-label'] === '전체 분석 요약')),
    /전체 통화3/,
  );
  assert.equal(
    render(normalized).updates.length,
    0,
    'normalized URL does not repeat updates',
  );
  assert.equal(
    render({ scoreMetric: 'qoe' }).updates.length,
    0,
    'ordinary QoE needs no normalization',
  );
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
test('hourly stacked chart totals assessed calls without double counting poor calls', () => {
  const r = render({ hour: 8 }, ['list']);
  const zero = r.all.find((n) =>
    n.props?.['aria-label']?.startsWith('00시 · 전체 품질 통화'),
  );
  assert.match(zero.props.title, /전체 품질 통화 0건 \(그 외 0건 \+ 저품질 통화 0건\)/);
  const eight = r.all.find((n) =>
    n.props?.['aria-label']?.startsWith('08시 · 전체 품질 통화'),
  );
  assert.match(eight.props.title, /전체 품질 통화 1건 \(그 외 0건 \+ 저품질 통화 1건\) · QoE 미평가 1건/);
  assert.equal(eight.props['aria-pressed'], true);
  const chart = r.all.find((n) => n.props?.['aria-label'] === '시간대별 통화 내역');
  assert.equal(
    nodes(chart).filter((n) => n.type === 'span' && n.props?.className === 'barStack').length,
    24,
    '24 hours show one stack each',
  );
  const segments = nodes(chart).filter((n) => n.type === 'span' &&
    (n.props?.className === 'bar barOther' || n.props?.className === 'bar barPoor'));
  assert.equal(segments.length, 48, 'each stack has mutually exclusive poor and other segments');
  const eightPoor = nodes(eight).find((n) => n.props?.className === 'bar barPoor');
  const eightOther = nodes(eight).find((n) => n.props?.className === 'bar barOther');
  assert.equal(eightPoor.props.style.height, '82px');
  assert.equal(eightOther.props.style.height, '0px');
  eight.props.onClick();
  assert.equal(r.updates[0].hour, null, 'selected hour can be removed');

  const mix = render({}, [], {
    ...overview,
    calls: calls.map((call) => call.id === 'c' ? { ...call, qoe: 4 } : call),
  });
  const mixedEight = mix.all.find((n) =>
    n.props?.['aria-label']?.startsWith('08시 · 전체 품질 통화'),
  );
  assert.match(mixedEight.props.title, /전체 품질 통화 2건 \(그 외 1건 \+ 저품질 통화 1건\)/);
  const mixedPoor = nodes(mixedEight).find((n) => n.props?.className === 'bar barPoor');
  const mixedOther = nodes(mixedEight).find((n) => n.props?.className === 'bar barOther');
  assert.equal(mixedPoor.props.style.height, '41px');
  assert.equal(mixedOther.props.style.height, '41px');
  assert.equal(parseFloat(mixedPoor.props.style.height) + parseFloat(mixedOther.props.style.height), 82);

  r.all
    .find((n) => n.type === 'button' && text(n) === '지도 중심')
    .props.onClick();
  assert.equal(stateUpdates[0].next, 'map');
});

test('administrative-dong SHP regions replace grid markers and keep district selection interactive', () => {
  const region = {
    id: 'adm:11230710', label: '개포4동', lat: 37.478, lon: 127.055,
    coordinates: [[[[127.05,37.47],[127.06,37.47],[127.06,37.48],[127.05,37.47]]]],
  };
  const regionSource = {
    ...overview,
    spatialUnit: 'administrative-dong',
    boundaryBaseDate: '20250630',
    administrativeDongs: [region],
    callLocations: [{
      callId: 'a', areaId: region.id, lat: 37.4779, lon: 127.0548,
      evidence: 'gnss', start: '08:00:00', mos: 2.4,
    }],
    cells: [{
      id: region.id, lat: region.lat, lon: region.lon,
      label: region.label, callIds: ['a','c'],
      gnssCalls: 1, estimatedCalls: 1,
    }],
    calls: calls.map((call) => ({
      ...call,
      gridIds: call.gridIds.length ? [region.id] : [],
    })),
  };
  const view = render({}, [], regionSource);
  assert.match(text(view.tree), /행정동별 품질/);
  assert.match(text(view.tree), /행정동별 저품질 순위/);
  assert.match(text(view.tree), /개포4동/);
  assert.match(text(view.tree), /GPS 1 \/ 추정 1/);
  assert.match(text(view.tree), /저품질 통화 발생 건수/);
  assert.match(text(view.tree), /행정동별 전체 저품질 비율을 산출하지 않습니다/);
  assert.doesNotMatch(text(view.tree), /색상: 저품질 비율/);
  assert.doesNotMatch(text(view.tree), /60m 격자/);
  const map = view.all.find((n) => n.type === 'AnalystMap');
  assert.deepEqual(map.props.administrativeDongs,[region]);
  assert.equal(map.props.callLocations.length,1);
  assert.deepEqual(map.props.callLocations[0],regionSource.callLocations[0]);
  map.props.onCallLocationSelect('a');
  assert.equal(view.analyzed.length,1, 'occurrence-point click should open exact call detail');
  assert.equal(view.analyzed[0].id,'a');
  map.props.onCellSelect(region.id);
  assert.equal(view.updates[0].cellId,region.id);
  const ranked = view.all.find((n) => n.type === 'button' && text(n) === '개포4동');
  assert(ranked,'district list should include SHP area name');
});

test('overview legend uses the same discrete colors as map rendering', () => {
  const r = render();
  const colors = r.all
    .filter((n) => n.type === 'i' && n.props?.style?.background)
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
