/* eslint-disable @typescript-eslint/no-require-imports -- SSR verifies the actual TypeScript components. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { load } = require('../analyst-ts-loader.cjs');

const componentCache = new Map();
function component(file) {
  file = path.resolve(file);
  if (componentCache.has(file)) return componentCache.get(file);
  const mod = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: file })(
    (id) => {
      if (id.endsWith('.module.css')) return {};
      if (id === './analyst-map') return { AnalystMap: ({ stations, byeSiteTechnology }) => React.createElement('div', {
        'data-station-pairs': stations.map((station) => station.baseStationId + '/' + station.cellId).join(','),
        'data-station-technologies': stations.map(station => station.technology ?? 'LTE').join(','),
        'data-bye-technology': byeSiteTechnology,
      }) };
      if (id === './radio-timeline') return { RadioTimeline: () => null };
      if (id === './mos-call-investigation') return { MosCallInvestigation: () => null };
      if (id === './observation-details') return component(path.join(path.dirname(file), id + '.tsx'));
      if (id.endsWith('/analyst/data')) return { isPoorCall: (value, threshold) => value != null && value < threshold };
      return id.startsWith('.') ? load(path.resolve(path.dirname(file), id)) : require(id);
    }, mod, mod.exports,
  );
  componentCache.set(file, mod.exports);
  return mod.exports;
}
const { ContractWorkspace } = component('components/analyst/contract-workspace.tsx');
const { ObservationDetails } = component('components/analyst/observation-details.tsx');
const station = (overrides = {}) => ({ baseStationId: 'RU-A', cellId: 'CELL-A',
  latitude: 37, longitude: 127, frequency: null, isVirtual: false,
  pci: 0, inventoryPciStatus: 'valid', inventorySource: '수도권_LTE_261104.xlsx', ...overrides });
const sample = { index: 7, callId: 'c', inCallWindow: true, time: '12:00:01',
  baseStationId: 'RU-A', cellId: 'CELL-A', pci: 0, rsrp: -100, rsrq: -10,
  sinr: 3, lat: 37, lon: 127, locationSource: 'gnss', raw: [] };
const call = { id: 'c', start: '12:00:00', end: '12:01:00', startSecond: 43200,
  endSecond: 43260, sampleIndices: [7], mdtCount: 1, hasMdt: true, qoe: 4,
  endCellId: 'CELL-A' };
const renderCall = (overrides = {}, extra = {}) => renderToStaticMarkup(React.createElement(ContractWorkspace, {
  day: { source: 'MDT', customerId: 'customer', date: '2026-10-30',
    samples: [sample], calls: [call], baseStations: [station()], ...overrides },
  callId: 'c', sampleIndex: 7, threshold: 3, onSelectCall() {}, onSelectSample() {}, ...extra,
}));

test('selected observation separates original PCI, registered PCI and exact-pair comparison with provenance', () => {
  const render = (stations, selected = sample) => renderToStaticMarkup(React.createElement(ObservationDetails, {
    sample: selected, call, samples: [selected], source: 'MDT', stations,
  }));
  const html = render([station()]);
  assert.match(html, /<dt>관측 PCI<\/dt><dd>0<\/dd>/);
  assert.match(html, /<dt>등록 PCI<\/dt><dd>0<\/dd>/);
  assert.match(html, /data-pci-comparison="match"[^>]*>일치/);
  assert.match(html, /수도권_LTE_261104.xlsx/);
  assert.match(render([station({ pci: 42 })]), /data-pci-comparison="mismatch"[^>]*>불일치/);
  assert.match(render([station({ cellId: 'CELL-OTHER' })]), /data-pci-comparison="unknown"[^>]*>미확인/);
  assert.match(render([station()], { ...sample, pci: 900 }), /<dt>관측 PCI<\/dt><dd>900<\/dd>/);
});

test('call station connections use a compact comparison table and map excludes RU-only or Cell-only matches', () => {
  const html = renderCall({ baseStations: [station(),
    station({ cellId: 'CELL-B', pci: 42 }), station({ baseStationId: 'RU-B', pci: 99 })] });
  assert.match(html, /<table[^>]*aria-label="선택 통화 PCI 비교"/);
  for (const heading of ['RU', 'Cell', '등록 PCI', '관측 PCI', '비교', '정보 출처'])
    assert.match(html, new RegExp('<th[^>]*>' + heading + '<\\/th>'));
  assert.match(html, /data-station-pairs="RU-A\/CELL-A"/);
  assert.doesNotMatch(html, /RU-B|CELL-B/);
  assert.match(html, /기지국 정보 기준 시점과 통화 관측 시점이 다를 수 있습니다/);
  assert.match(html, /data-pci-comparison="match"/);
});

test('unregistered observation remains visible in comparison table even without a station marker', () => {
  const html = renderCall({ baseStations: [] });
  assert.match(html, /aria-label="선택 통화 PCI 비교"/);
  assert.match(html, /RU-A/);
  assert.match(html, /RU·Cell과 정확히 일치하는 등록 정보 없음/);
  assert.match(html, /data-pci-comparison="unknown"/);
});

test('CDR-only BYE PCI is registered evidence and never a fabricated observation', () => {
  const html = renderCall({ samples: [], baseStations: [], calls: [{ ...call,
    sampleIndices: [], mdtCount: 0, hasMdt: false }] }, {
    sampleIndex: null,
    byeLocation: { callId: 'customer:c', areaId: 'a', evidence: 'bye-cell',
      lat: 37, lon: 127, start: '12:00:00', mos: 4, byeRuId: 'RU-A',
      byeCellId: 'CELL-A', byePci: 0, byeInventoryPciStatus: 'valid',
      byeInventory: '수도권_LTE_261104.xlsx' },
  });
  assert.match(html, /aria-label="선택 통화 PCI 비교"/);
  assert.match(html, /data-pci-comparison="unknown"/);
  assert.match(html, /원본 관측 PCI 미제공/);
  assert.match(html, /수도권_LTE_261104.xlsx/);
  assert.doesNotMatch(html, /data-pci-comparison="match"/);
});

test('an LTE observation and NR BYE with reused RU+Cell retain distinct map stations and PCI rows', () => {
  const html=renderCall({}, {byeLocation:{callId:'customer:c',areaId:'a',evidence:'bye-cell',
    lat:37.2,lon:127.2,start:'12:00:00',mos:4,byeRuId:'RU-A',byeCellId:'CELL-A',
    byePci:1007,byeTechnology:'NR',byeInventoryPciStatus:'valid',byeInventory:'nr.xlsx'}});
  assert.match(html,/data-station-technologies="LTE,NR"/);
  assert.match(html,/data-bye-technology="NR"/);
  assert.match(html,/>1007<\/td>/);
  assert.match(html,/원본 관측 PCI 미제공/);
  assert.doesNotMatch(html,/등록 PCI 유효 범위 확인 필요/);
});

test('contract tower reference exposes MDT selection or first-candidate fallback without claiming a unique UE location',()=>{
  const base={callId:'customer:c',areaId:'a',evidence:'bye-cell',lat:37,lon:127,
    start:'12:00:00',mos:4,byeRuId:'RU-A',byeCellId:'CELL-A',byeCandidateCount:3};
  for(const method of ['mdt','first']){
    const html=renderCall({samples:[],baseStations:[],calls:[{...call,sampleIndices:[],mdtCount:0,hasMdt:false}]},
      {sampleIndex:null,byeLocation:{...base,byeSelectionMethod:method,byeSelectionDeltaSeconds:4.1}});
    assert.match(html,new RegExp('data-bye-selection="'+method+'"'));
    assert.match(html,method==='mdt'?/MDT 장비 일치 · 후보 3개 · 종료 4.1초 전 MDT/:/첫 후보 선택 · 후보 3개 · 기지국 목록 순서/);
    assert.match(html,/기지국 좌표는 고객 단말 위치가 아닙니다/);
    assert.doesNotMatch(html,/유일하게 일치하는 기지국/);
  }
});
