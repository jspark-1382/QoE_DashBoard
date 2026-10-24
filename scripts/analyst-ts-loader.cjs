/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript');
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (!path.extname(file))
    file = fs.existsSync(file + '.ts')
      ? file + '.ts'
      : path.join(file, 'index.ts');
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} };
  cache.set(file, mod);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  vm.runInThisContext('(function(require,module,exports){' + js + '\n})', {
    filename: file,
  })(
    (id) =>
      id.startsWith('.')
        ? load(path.resolve(path.dirname(file), id))
        : require(id),
    mod,
    mod.exports,
  );
  return mod.exports;
}
module.exports = { load };
