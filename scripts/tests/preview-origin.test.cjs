const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const configPath = path.resolve(__dirname, '../../next.config.ts');
const configCode = ts.transpileModule(fs.readFileSync(configPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const originCheck = import(
  pathToFileURL(
    path.resolve(__dirname, '../../node_modules/vinext/dist/server/dev-origin-check.js'),
  ).href
);

function loadConfig(previewHost) {
  const module = { exports: {} };
  const env = previewHost === undefined ? {} : { QOE_PREVIEW_HOST: previewHost };
  vm.runInNewContext(configCode, {
    module,
    exports: module.exports,
    process: { env },
  }, { filename: configPath });
  return module.exports.default;
}

test('without a preview hostname external dev requests remain blocked', async () => {
  const config = loadConfig();
  const { validateDevRequest } = await originCheck;
  assert.equal(config.basePath, '/qoe');
  assert.equal(config.allowedDevOrigins?.length ?? 0, 0);
  assert.match(validateDevRequest({
    host: 'localhost:3001',
    origin: 'https://preview.example.com',
  }, config.allowedDevOrigins), /not allowed/);
  assert.equal(validateDevRequest({
    host: 'localhost:3001',
    origin: 'http://localhost:3001',
  }, config.allowedDevOrigins), null);
});

test('one preview hostname allows its browser modules while other origins stay blocked', async () => {
  const config = loadConfig('preview.example.com');
  const { validateDevRequest } = await originCheck;
  assert.equal(config.basePath, '/qoe');
  assert.deepEqual(Array.from(config.allowedDevOrigins ?? []), ['preview.example.com']);
  assert.equal(validateDevRequest({
    host: 'localhost:3001',
    origin: 'https://preview.example.com',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
  }, config.allowedDevOrigins), null);
  for (const origin of [
    'https://other.example.com',
    'https://child.preview.example.com',
    'https://preview.example.com.attacker.test',
    'null',
  ]) {
    assert.match(validateDevRequest({
      host: 'localhost:3001', origin,
    }, config.allowedDevOrigins), /not allowed/);
  }
  assert.match(validateDevRequest({
    host: 'localhost:3001',
    'sec-fetch-mode': 'no-cors',
    'sec-fetch-site': 'cross-site',
  }, config.allowedDevOrigins), /cross-site no-cors/);
  assert.match(validateDevRequest({
    host: 'localhost:3001',
    origin: 'https://preview.example.com',
    'sec-fetch-mode': 'no-cors',
    'sec-fetch-site': 'cross-site',
  }, config.allowedDevOrigins), /cross-site no-cors/);
});

test('preview hostnames are matched with DNS case normalization', async () => {
  const config = loadConfig('Preview.Example.COM');
  const { validateDevRequest } = await originCheck;
  assert.equal(validateDevRequest({
    host: 'localhost:3001', origin: 'https://preview.example.com',
  }, config.allowedDevOrigins), null);
});

test('invalid preview values fail closed during config loading', () => {
  for (const value of [
    '', '*', '*.example.com', 'https://preview.example.com',
    'preview.example.com/qoe', 'preview.example.com,other.example.com',
    'preview.example.com:3001', 'preview.example.com?query',
    'preview.example.com#fragment', 'user@preview.example.com',
    ' preview.example.com', 'preview.example.com ', 'preview..example.com',
    '-preview.example.com', 'preview-.example.com', 'preview_example.com',
    'null', '[::1]', `${'a'.repeat(64)}.example.com`, `${'a.'.repeat(127)}com`,
  ]) {
    assert.throws(() => loadConfig(value), /QOE_PREVIEW_HOST/, value);
  }
});
