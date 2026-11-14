/* eslint-disable @typescript-eslint/no-require-imports -- Load configuration without running the build or server. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

async function configPlugins() {
  const file = path.resolve('vite.config.ts');
  const mod = { exports: {} };
  const mocks = {
    vite: { defineConfig: config => config },
    vinext: { default: () => ({ name: 'mock:vinext' }), __esModule: true },
    '@openai/sites-vite-plugin': { sites: () => ({ name: 'mock:sites' }) },
    '@tailwindcss/postcss': { default: () => ({}), __esModule: true },
    '@cloudflare/vite-plugin': { cloudflare: () => ({ name: 'mock:cloudflare' }) },
    './.openai/hosting.json': {},
  };
  const requireMock = id => Object.hasOwn(mocks, id) ? mocks[id] : require(id);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: requireMock,
    process: { cwd: () => process.cwd(), env: {} } }, { filename: file });
  return (await mod.exports.default({ mode: 'local-preview', command: 'build' })).plugins;
}

test('RSC preloads are collected after CSS-only JS removal while real JS and CSS remain', async () => {
  const plugins = await configPlugins();
  const fix = plugins.find(p => p.name === 'qoe:rsc-assets-after-css');
  assert(fix, 'build must register the manifest lifecycle fix');
  assert.equal(fix.apply, 'build', 'development behavior must remain unchanged');
  let seen;
  const context = { environment: { name: 'client' } };
  const collect = function (_options, bundle) {
    assert.equal(this, context, 'the original hook context must be preserved');
    seen = { js: bundle.entry.imports.slice(), css: [...bundle.entry.viteMetadata.importedCss] };
  };
  const rsc = { name: 'rsc:virtual:vite-rsc/assets-manifest', generateBundle: collect };
  await fix.configResolved({ plugins: [rsc] });
  assert.equal(rsc.generateBundle.order, 'post');
  assert.equal(rsc.generateBundle.handler, collect);
  const bundle = {
    entry: { imports: ['styles-stub.js', 'map-engine-real.js'], viteMetadata: { importedCss: new Set(['map.css']) } },
    'styles-stub.js': { type: 'chunk' },
    'map-engine-real.js': { type: 'chunk' },
    'map.css': { type: 'asset' },
  };
  // Vite's normal-order css-post hook removes its temporary CSS-only JS chunk.
  const cssPost = () => {
    delete bundle['styles-stub.js'];
    bundle.entry.imports = bundle.entry.imports.filter(file => file !== 'styles-stub.js');
  };
  const hooks = [rsc.generateBundle, cssPost];
  const rank = hook => typeof hook === 'function' ? 0 : ({ pre: -1, post: 1 }[hook.order] ?? 0);
  for (const hook of hooks.sort((a, b) => rank(a) - rank(b))) {
    await (typeof hook === 'function' ? hook : hook.handler).call(context, {}, bundle);
  }
  assert.deepEqual(seen, { js: ['map-engine-real.js'], css: ['map.css'] });
});

test('hook metadata is preserved and configurations without RSC are left alone', async () => {
  const fix = (await configPlugins()).find(p => p.name === 'qoe:rsc-assets-after-css');
  assert(fix);
  const handler = () => {};
  const rsc = { name: 'rsc:virtual:vite-rsc/assets-manifest',
    generateBundle: { handler, sequential: true, order: 'pre' } };
  await fix.configResolved({ plugins: [rsc] });
  assert.equal(rsc.generateBundle.handler, handler);
  assert.equal(rsc.generateBundle.sequential, true);
  assert.equal(rsc.generateBundle.order, 'post');
  await fix.configResolved({ plugins: [] });
});
