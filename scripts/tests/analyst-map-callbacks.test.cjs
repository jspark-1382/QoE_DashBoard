/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Node scripts and the existing test harness require CommonJS imports. */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { load } = require('../analyst-ts-loader.cjs');

// Run the real component and its effects with a small hook/Leaflet host. This
// counts expensive layer creation and invokes the event handlers on those layers.
function mountMap() {
  const hooks = [], pending = [];
  const layers = [], polygons = [], markers = [], elements = [];
  let cursor = 0, dirty = false;
  const react = {
    useRef(value) { const i = cursor++; return hooks[i] ??= { current: value }; },
    useState(value) {
      const i = cursor++;
      const slot = hooks[i] ??= { value };
      return [slot.value, next => {
        const value = typeof next === 'function' ? next(slot.value) : next;
        if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; }
      }];
    },
    useEffect(effect, deps) {
      const i = cursor++, old = hooks[i];
      if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) {
        hooks[i] = { deps, cleanup: old?.cleanup };
        pending.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup = effect(); });
      }
    },
  };
  function node() {
    return {
      events: {}, children: [],
      addTo() { return this; }, bindTooltip() { return this; },
      bindPopup(popup) { this.popup = popup; return this; },
      on(name, fn) { this.events[name] = fn; return this; },
      getElement() { return { setAttribute() {} }; },
      appendChild(child) { this.children.push(child); },
      addEventListener(name, fn) { this.events[name] = fn; },
      remove() { this.removed = true; },
    };
  }
  const map = {
    setView() { return this; }, on() { return this; }, remove() {},
    getZoom() { return 13; }, getCenter() { return {lat:37.48,lng:127.05}; },
    fitBounds() {}, closePopup() {}, invalidateSize() {},
  };
  const leaflet = {
    map: () => map, svg: () => ({}), canvas: () => ({}),
    control: {zoom: () => node()}, latLngBounds: value => value,
    layerGroup() { const layer = node(); layers.push(layer); return layer; },
    geoJSON() { const polygon = node(); polygons.push(polygon); return polygon; },
    marker() { const marker = node(); markers.push(marker); return marker; },
    circleMarker() { const marker = node(); markers.push(marker); return marker; },
    circle: () => node(), polyline: () => node(), divIcon: value => value,
  };
  const source = fs.readFileSync('components/analyst/analyst-map.tsx', 'utf8');
  const js = ts.transpileModule(source, {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  }}).outputText.replaceAll('import.meta', '({env:{}})');
  const componentModule = {exports:{}};
  const context = vm.createContext({
    module:componentModule, exports:componentModule.exports,
    ResizeObserver: class {observe() {} disconnect() {}},
    document: {createElement() {const element=node(); elements.push(element); return element;}},
    require(id) {
      if (id === 'react') return react;
      if (id === 'leaflet') return leaflet;
      if (id.endsWith('.css')) return {default:new Proxy({}, {get:(_,key)=>key})};
      if (id.startsWith('../../lib/')) return load('lib/'+id.slice('../../lib/'.length));
      return require(id);
    },
  });
  vm.runInContext(js, context, {filename:'analyst-map.tsx'});
  return {
    layers, polygons, markers, elements,
    async render(props) {
      for (let pass=0; pass<8; pass++) {
        cursor=0; dirty=false;
        componentModule.exports.AnalystMap(props);
        hooks[0].current={}; // Attach the component's map host before effects.
        for (const run of pending.splice(0)) run();
        for (let i=0;i<6;i++) await Promise.resolve();
        if (!dirty) return;
      }
      throw new Error('Map did not settle');
    },
  };
}
const district={id:'dong',label:'관측 지역',lat:37.48,lon:127.05,coordinates:[]};
const cell={id:'dong',label:'관측 지역',lat:37.48,lon:127.05,total:1,poor:1,evaluated:1};
const place={callId:'call',areaId:'dong',lat:37.48,lon:127.05,evidence:'gnss',start:'12:00',mos:2};

test('callback-only changes reuse polygons/markers and invoke the latest cell and call handlers', async () => {
  const host=mountMap(), called=[];
  const props={administrativeDongs:[district],cells:[cell],callLocations:[place],
    onCellSelect:id=>called.push('old-cell:'+id),
    onCallLocationSelect:id=>called.push('old-call:'+id)};
  await host.render(props);
  assert.equal(host.layers.length,1);
  const polygon=host.polygons[0];
  const button=host.elements.find(element=>element.type==='button');
  assert(button, 'call analysis action is present in the real popup');
  for(let i=0;i<4;i++) await host.render({...props,
    onCellSelect:id=>called.push('new-cell:'+id),
    onCallLocationSelect:id=>called.push('new-call:'+id)});
  assert.equal(host.layers.length,1,'search/detail renders must not rebuild map layers');
  assert.equal(host.layers[0].removed,undefined);
  polygon.events.click(); button.events.click();
  assert.deepEqual(called,['new-cell:dong','new-call:call']);
  await host.render({...props,selectedCellId:'dong'});
  assert.equal(host.layers.length,2,'selection style changes still rebuild the visible layers');
  await host.render({...props,selectedCellId:'dong',onCallLocationSelect:undefined});
  assert.equal(host.layers.length,3,'callback presence controls popup action creation');
  assert(!host.markers.at(-1).popup.children.some(element=>element.type==='button'));
  await host.render({...props,selectedCellId:'dong',onCallLocationSelect:undefined,
    callLocations:[{...place,lon:127.1}]});
  assert.equal(host.layers.length,4,'changed source coordinates still redraw');
});

test('sample markers retain their layers while dispatching the latest observation callback', async () => {
  const host=mountMap(), called=[];
  const sample={index:7,time:'12:00',lat:37.48,lon:127.05,locationSource:'gnss',inCallWindow:true};
  const props={samples:[sample],onSampleSelect:index=>called.push('old:'+index)};
  await host.render(props);
  assert.equal(host.layers.length,1);
  const marker=host.markers[0];
  await host.render({...props,onSampleSelect:index=>called.push('new:'+index)});
  assert.equal(host.layers.length,1);
  marker.events.click();
  assert.deepEqual(called,['new:7']);
  await host.render({...props,metric:'sinr'});
  assert.equal(host.layers.length,2,'measurement color changes still redraw');
});
