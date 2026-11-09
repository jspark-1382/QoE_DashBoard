const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const forbidden = /GNSS|3\s*[-–]?\s*Site|3사이트|3변측량|다변측량|무선 추정|MOS/g;
const roots = ['app', 'components', 'lib'];
const machineCode = /(RAW_MDT_GNSS|TRAINING_GNSS_|GNSS_CDR_ASSOCIATION|GNSS_REFERENCE_POLICY|strict-3-site-v1|coarse-three-site-v1)/;

test('display strings consistently use GPS and 삼각 측량; preserve internal IDs', () => {
  const violations = [];
  function examine(file) {
    const source = fs.readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    function walk(node) {
      const visible = ts.isJsxText(node) || ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
      if (visible) {
        const raw = node.getText(sf);
        if (!machineCode.test(raw) && !/^['"](?:https?:\/\/|\/|\.\/|\.\.\/)/.test(raw)) {
          const found = raw.match(forbidden);
          if (found) violations.push(file + ':' + sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + ' ' + found.join(','));
        }
      }
      ts.forEachChild(node, walk);
    }
    walk(sf);
  }
  function walkFiles(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) walkFiles(file);
      else if (/\.(ts|tsx)$/.test(item.name) && !item.name.endsWith('.d.ts')) examine(file);
    }
  }
  roots.forEach(walkFiles);
  assert.deepEqual(violations, []);
  const ui = fs.readFileSync('components/analyst/quality-proposal-four.tsx', 'utf8');
  assert(ui.includes('삼각 측량(3개 사이트 RSRP 가중중심 방식)'));
  assert(ui.includes("policy:'strict-3-site-v1'"));
  assert(ui.includes("name:'QoE 평가 가능'"));
  assert(ui.includes('QoE 대비 {entry.mosRate}'));
  assert(fs.readFileSync('components/analyst/quality-top-nav.tsx','utf8').includes('QoE 알고리즘 비교'));
  assert(fs.readFileSync('components/analyst/mos-lab.tsx','utf8').includes("qoeBasis !== 'rtcp-mos-v5'"));
  assert(fs.readFileSync('components/analyst/improvement-candidates.tsx','utf8').includes('displayQualityLabel(candidate.label)'));
  assert(fs.readFileSync('components/analyst/improvement-candidate-map.tsx','utf8').includes('displayQualityLabel(candidate.label)'));
  assert(fs.readFileSync('lib/analyst/quality-improvement-candidates.ts', 'utf8').includes("'strict-3-site-v1'"));
});
