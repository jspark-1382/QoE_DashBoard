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
  let cursor = 0, dirty = false, zoom = 13;
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
      addTo() { return this; }, bindTooltip(text) { this.tooltip = text; return this; },
      bindPopup(popup) { this.popup = popup; return this; },
      on(name, fn) { this.events[name] = fn; return this; },
      getElement() { return { setAttribute() {} }; },
      appendChild(child) { this.children.push(child); },
      addEventListener(name, fn) { this.events[name] = fn; },
      remove() { this.removed = true; },
    };
  }
  const map = {
    events: {}, setView() { return this; }, on(name, fn) { this.events[name] = fn; return this; }, remove() {},
    getZoom() { return zoom; }, getCenter() { return {lat:37.48,lng:127.05}; },
    project([lat, lon]) { return {x:lon * 1000, y:lat * 1000}; },
    fitBounds() {}, closePopup() {}, invalidateSize() {},
  };
  const leaflet = {
    map: () => map, svg: () => ({}), canvas: () => ({}),
    control: {zoom: () => node()}, latLngBounds: value => value,
    layerGroup() { const layer = node(); layers.push(layer); return layer; },
    geoJSON() { const polygon = node(); polygons.push(polygon); return polygon; },
    marker(position, options) { const marker = node(); marker.position = position; marker.options = options; markers.push(marker); return marker; },
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
    setZoom(value) { zoom = value; map.events.moveend(); },
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

const point = (callId, evidence, extra={}) => ({
  callId, evidence, areaId:'dong', lat:37.48, lon:127.05,
  start:'12:00', mos:2, ...extra,
});
const points = [
  point('gnss-a','gnss'), point('gnss-b','gnss'),
  point('estimate-a','estimated'), point('estimate-b','estimated'),
  point('bye-a','bye-cell'), point('bye-b','bye-cell'),
];
const popupCalls = marker => marker.popup.children
  .filter(child=>child.type==='button').map(child=>child.textContent);

test('improved map keeps GNSS, radio estimate and BYE cluster membership separate', async () => {
  const host=mountMap(), selected=[];
  await host.render({callLocations:points,clusterOccurrences:true,separateEvidence:true,
    onCallLocationSelect:id=>selected.push(id)});
  assert.equal(host.markers.length,3,'three evidence categories must not collapse to one marker');
  assert.deepEqual(host.markers.map(marker=>popupCalls(marker).length),[2,2,2]);
  assert.match(host.markers[0].options.icon.html,/occurrenceGnss/);
  assert.match(host.markers[1].options.icon.html,/occurrenceEstimate/);
  assert.match(host.markers[2].options.icon.html,/occurrenceByeCell/);
  assert.match(host.markers[0].popup.children[1].textContent,/GPS 관측/);
  assert.match(host.markers[2].popup.children[1].textContent,/단말 실제 위치 아님/);
  for(const marker of host.markers) marker.popup.children.find(child=>child.type==='button').events.click();
  assert.deepEqual(selected,['gnss-a','estimate-a','bye-a']);
});

test('current mode retains mixed visual clusters and changing the option redraws existing map', async () => {
  const host=mountMap();
  const props={callLocations:points,clusterOccurrences:true};
  await host.render(props);
  assert.equal(host.markers.length,1);
  assert.match(host.markers[0].options.icon.html,/occurrenceGrouped/);
  await host.render({...props,separateEvidence:true});
  assert.equal(host.layers.length,2,'changing evidence separation redraws the map immediately');
  assert.equal(host.layers[0].removed,true);
  assert.equal(host.markers.length,4);
});

test('zoom 17 restores exact evidence coordinates and invalid coordinates create no marker', async () => {
  const host=mountMap();
  const data=[...points,point('nearby','gnss',{lat:37.481}),point('invalid','gnss',{lat:NaN})];
  const props={callLocations:data,clusterOccurrences:true,separateEvidence:true};
  await host.render(props);
  assert.equal(host.markers.length,3);
  host.setZoom(17);
  await host.render(props);
  const exact=host.markers.slice(3);
  assert.equal(exact.length,4);
  assert.deepEqual(Array.from(exact.at(-1).position),[37.481,127.05]);
  assert(exact.every(marker=>!marker.options.icon.html.includes('occurrenceGrouped')));
});
