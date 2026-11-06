/* eslint-disable @typescript-eslint/no-require-imports -- This Node test loads the TSX component through the existing CommonJS test pattern. */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');

// Exercise the real component's state, handlers and effect cleanup without
// adding a DOM dependency. The browser integration checks Leaflet's live DOM.
function mountFrame() {
  const hooks = [], effects = [], listeners = new Map();
  let cursor = 0, tree;
  const document = {
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
    dispatch(name, event) { for (const listener of listeners.get(name) ?? []) listener(event); },
  };
  class Element {
    constructor(parentElement = null) {
      this.parentElement = parentElement;
      this.children = [];
      this.style = {};
      this.tabIndex = 0;
      this.inert = false;
      this.isConnected = true;
      parentElement?.children.push(this);
    }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    focus() { document.activeElement = this; document.dispatch('focusin', {target:this}); }
    querySelectorAll() { return this.focusables ?? []; }
    getClientRects() { return this.hidden ? [] : [{}]; }
    closest() {
      for (let node = this; node; node = node.parentElement) if (node.hidden || node.inert) return node;
      return null;
    }
  }
  document.body = new Element();
  document.body.style.overflow = 'clip';
  const page = new Element(document.body), utility = new Element(document.body);
  const heading = new Element(page), frame = new Element(page), after = new Element(page);
  after.inert = true;
  const header = new Element(frame), toggle = new Element(header), filter = new Element(header);
  const hidden = new Element(frame); hidden.hidden = true;
  const last = new Element(frame);
  frame.focusables = [toggle, filter, hidden, last];
  document.activeElement = toggle;
  const react = {
    useRef(value) { return hooks[cursor++] ??= {current:value}; },
    useState(value) {
      const i = cursor++;
      const slot = hooks[i] ??= {value};
      return [slot.value, next => { slot.value = typeof next === 'function' ? next(slot.value) : next; }];
    },
    useEffect(effect, deps) {
      const i = cursor++, old = hooks[i];
      if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) {
        hooks[i] = {deps, cleanup:old?.cleanup};
        effects.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup = effect(); });
      }
    },
  };
  const componentModule = {exports:{}};
  const filename = 'components/analyst/map-panel-frame.tsx';
  assert.ok(fs.existsSync(filename), 'MapPanelFrame should provide the expanded-map behavior');
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {
    module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, jsx:ts.JsxEmit.ReactJSX,
  }}).outputText;
  vm.runInNewContext(js, {
    module:componentModule, exports:componentModule.exports, document,
    HTMLElement:Element, Node:Element,
    require(id) {
      if (id === 'react') return react;
      if (id.endsWith('.css')) return {default:new Proxy({}, {get:(_, key) => key})};
      return require(id);
    },
  }, {filename});
  const map = React.createElement('div', {'data-map-surface':true, key:'map'});
  let rendered;
  const props = {label:'종료 위치 지도', className:'existing-panel', children(value) {
    rendered = value;
    return [React.createElement('header', {key:'heading'}, value.toggleButton), map];
  }};
  function render() {
    cursor = 0;
    tree = componentModule.exports.MapPanelFrame(props);
    tree.props.ref.current = frame;
    rendered.toggleButton.props.ref.current = toggle;
    for (const run of effects.splice(0)) run();
    return tree;
  }
  render();
  return {
    document, frame, toggle, filter, last, utility, heading, after, map,
    get tree() { return tree; }, get rendered() { return rendered; },
    click() { rendered.toggleButton.props.onClick(); render(); },
    suspend(value) { props.suspended = value; render(); },
    key(key, shiftKey = false) {
      const event = {key, shiftKey, prevented:false, stopped:false,
        preventDefault() {this.prevented = true;}, stopPropagation() {this.stopped = true;}};
      document.dispatch('keydown', event); render(); return event;
    },
    unmount() { for (const hook of hooks) hook?.cleanup?.(); },
    listenerCount() { return [...listeners.values()].reduce((count, set) => count + set.size, 0); },
  };
}

test('expansion changes the same section to a labelled modal and retains its map subtree', () => {
  const host = mountFrame();
  assert.equal(host.tree.type, 'section');
  assert.equal(host.tree.props.role, undefined);
  assert.equal(host.rendered.expanded, false);
  assert.equal(host.rendered.toggleButton.props['aria-label'], '지도 전체 화면');
  host.click();
  assert.equal(host.tree.type, 'section');
  assert.equal(host.tree.props.role, 'dialog');
  assert.equal(host.tree.props['aria-modal'], true);
  assert.equal(host.tree.props['aria-label'], '종료 위치 지도');
  assert.equal(host.rendered.expanded, true);
  assert.equal(host.rendered.toggleButton.props['aria-label'], '전체 화면 닫기');
  assert.equal(host.tree.props.children[1], host.map);
  assert.equal(host.document.body.style.overflow, 'hidden');
  assert.equal(host.heading.inert, true);
  assert.equal(host.utility.inert, true);
  host.click();
  assert.equal(host.tree.props.children[1], host.map);
  assert.equal(host.tree.props.role, undefined);
  assert.equal(host.document.body.style.overflow, 'clip');
  host.unmount();
});

test('Escape closes the map and restores focus, preexisting inert state and scroll settings', () => {
  const host = mountFrame();
  host.click();
  host.filter.focus();
  const event = host.key('Escape');
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(host.rendered.expanded, false);
  assert.equal(host.document.activeElement, host.toggle);
  assert.equal(host.document.body.style.overflow, 'clip');
  assert.equal(host.heading.inert, false);
  assert.equal(host.utility.inert, false);
  assert.equal(host.after.inert, true);
  assert.equal(host.listenerCount(), 0);
  host.unmount();
});

test('Tab stays inside the expanded map and outside focus is redirected to its close control', () => {
  const host = mountFrame();
  host.click();
  const backwards = host.key('Tab', true);
  assert.equal(backwards.prevented, true);
  assert.equal(host.document.activeElement, host.last);
  const forwards = host.key('Tab');
  assert.equal(forwards.prevented, true);
  assert.equal(host.document.activeElement, host.toggle);
  host.filter.focus();
  assert.equal(host.key('Tab').prevented, false, 'normal movement inside the panel remains native');
  host.utility.focus();
  assert.equal(host.document.activeElement, host.toggle);
  host.frame.focus();
  assert.equal(host.key('Tab', true).prevented, true);
  assert.equal(host.document.activeElement, host.last);
  host.unmount();
});

test('unmounting an expanded map releases its modal effects and can be reopened without listener leaks', () => {
  const host = mountFrame();
  host.click(); host.click(); host.click();
  assert.equal(host.listenerCount(), 2);
  host.unmount();
  assert.equal(host.document.body.style.overflow, 'clip');
  assert.equal(host.heading.inert, false);
  assert.equal(host.utility.inert, false);
  assert.equal(host.after.inert, true);
  assert.equal(host.listenerCount(), 0);
});

test('a higher dialog temporarily owns focus and Escape while the map remains expanded and scroll locked', () => {
  const host = mountFrame();
  host.click();
  host.suspend(true);
  assert.equal(host.document.body.style.overflow, 'hidden');
  assert.equal(host.heading.inert, false, 'the higher dialog must not inherit the map background lock');
  host.utility.focus();
  assert.equal(host.document.activeElement, host.utility);
  assert.equal(host.key('Escape').prevented, false);
  assert.equal(host.rendered.expanded, true);
  host.suspend(false);
  assert.equal(host.document.body.style.overflow, 'hidden');
  assert.equal(host.document.activeElement, host.toggle);
  assert.equal(host.heading.inert, true);
  assert.equal(host.key('Escape').prevented, true);
  assert.equal(host.rendered.expanded, false);
  assert.equal(host.document.body.style.overflow, 'clip');
  host.unmount();
});
