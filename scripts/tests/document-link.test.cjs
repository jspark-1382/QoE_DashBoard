/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const filename = path.resolve(__dirname, '../../components/analyst/document-link.tsx');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const componentModule = { exports: {} };
vm.runInThisContext('(function(require,module,exports){' + compiled + '\n})', {
  filename,
})(require, componentModule, componentModule.exports);
const DocumentLink = componentModule.exports.default;
const { withQoeBasePath } = componentModule.exports;

test('document links apply the QoE base path without changing queries or fragments', () => {
  const cases = [
    ['/', '/qoe/'],
    ['/overview-proposal-4', '/qoe/overview-proposal-4'],
    ['/?source=MDT&view=contract&call=a%2Fb#call', '/qoe/?source=MDT&view=contract&call=a%2Fb#call'],
    ['/qoe', '/qoe'],
    ['/qoe/', '/qoe/'],
    ['/qoe/overview-proposal-4?date=2026-10-30#calls', '/qoe/overview-proposal-4?date=2026-10-30#calls'],
    ['/qoe?source=MDT', '/qoe?source=MDT'],
    ['/qoe#calls', '/qoe#calls'],
    ['/qoe-other', '/qoe/qoe-other'],
    ['https://example.com/path?x=1#calls', 'https://example.com/path?x=1#calls'],
    ['//example.com/path', '//example.com/path'],
    ['mailto:analyst@example.com', 'mailto:analyst@example.com'],
    ['#calls', '#calls'],
    ['?source=MDT', '?source=MDT'],
    ['relative?source=MDT#calls', 'relative?source=MDT#calls'],
  ];
  for (const [href, expected] of cases) {
    const element = DocumentLink({ href, children: 'Open' });
    assert.equal(element.type, 'a');
    assert.equal(element.props.href, expected, href);
    assert.equal(withQoeBasePath(href), expected, 'shared URL helper must match DocumentLink');
    assert.equal(element.props.onClick, undefined, 'navigation must use the browser default');
    assert.equal(element.props.onMouseEnter, undefined, 'navigation must not start framework prefetching');
  }
});

test('document links preserve anchor attributes and native interaction', () => {
  const element = DocumentLink({
    href: '/overview-proposal-4?date=2026-10-30#calls',
    className: 'selected',
    'aria-current': 'page',
    'aria-label': 'Open quality proposal',
    target: '_blank',
    rel: 'noopener',
    children: '개선4안',
  });
  assert.equal(element.type, 'a');
  assert.equal(element.props.className, 'selected');
  assert.equal(element.props['aria-current'], 'page');
  assert.equal(element.props['aria-label'], 'Open quality proposal');
  assert.equal(element.props.target, '_blank');
  assert.equal(element.props.rel, 'noopener');
  assert.equal(element.props.children, '개선4안');
  assert.equal(element.props.onClick, undefined);
  const html = renderToStaticMarkup(React.createElement(DocumentLink, element.props));
  assert.match(html, /href="\/qoe\/overview-proposal-4\?date=2026-10-30#calls"/);
  assert.match(html, /aria-current="page"/);
});
