import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const options = {
  module: ts.ModuleKind.ESNext,
  jsx: ts.JsxEmit.ReactJSX,
  target: ts.ScriptTarget.ES2022,
};
const files = [];
try {
  const selectionPath = new URL(
    './.analyst-selection-test.mjs',
    import.meta.url,
  );
  files.push(selectionPath);
  await fs.writeFile(
    selectionPath,
    ts.transpileModule(await fs.readFile('lib/analyst/selection.ts', 'utf8'), {
      compilerOptions: options,
    }).outputText.replace(
      /import\s+\{\s*datesInRange\s*\}\s+from\s+['"]\.\/date-range['"];?/,
      'const datesInRange=()=>[];',
    ),
  );
  const documentLinkPath = new URL(
    './.document-link-test.mjs',
    import.meta.url,
  );
  files.push(documentLinkPath);
  await fs.writeFile(
    documentLinkPath,
    ts.transpileModule(
      await fs.readFile('components/analyst/document-link.tsx', 'utf8'),
      { compilerOptions: options },
    ).outputText,
  );
  let code = ts.transpileModule(
    await fs.readFile('components/analyst/analyst-dashboard.tsx', 'utf8'),
    { compilerOptions: options },
  ).outputText;
  code = code.replace(
    /import Link from ['"]\.\/document-link['"];?/,
    'import Link from "./.document-link-test.mjs";',
  );
  code = code.replace(
    /import\s+\{[^}]+\}\s+from\s+['"]\.\.\/\.\.\/lib\/analyst\/data-loader['"];?/s,
    'const loadDataset=()=>Promise.reject(new Error("SSR must not fetch")),loadDay=loadDataset,loadOverview=loadDataset;',
  );
  code = code.replace(
    /import\s+\{[^}]+\}\s+from\s+['"]\.\.\/\.\.\/lib\/analyst\/data['"];?/s,
    'const getContractId=c=>c?.sourceContractId??null;',
  );
  code=code.replace(
    /import\s+\{\s*indexDataset\s*\}\s+from\s+['"]\.\.\/\.\.\/lib\/analyst\/dataset-index['"];?/,
    'const indexDataset=()=>({customersById:new Map(),daysByCustomer:new Map()});',
  );
  code = code
    .replace("'../../lib/analyst/selection'", "'./.analyst-selection-test.mjs'")
    .replace(
      '"../../lib/analyst/selection"',
      '"./.analyst-selection-test.mjs"',
    );
  code = code
    .replace(
      /import\s+\{[^}]+\}\s+from\s+['"]\.\/contract-workspace['"];?/s,
      'const ContractWorkspace=()=>null;',
    )
    .replace(
      /import\s+\{[^}]+\}\s+from\s+['"]\.\/quality-overview['"];?/s,
      'const QualityOverview=()=>null;',
    );
  code = code.replace(
    /import\s+\{[^}]+\}\s+from\s+['"]\.\/contract-picker['"];?/s,
    'const ContractPicker=()=>null;',
  );
  // Keep this SSR-only contract test independent of the runtime data modules.
  code = code.replace(
    /import\s+\{[^}]+\}\s+from\s+['"]\.\.\/\.\.\/lib\/analyst\/date-range['"];?/s,
    'const adjustDateRange=()=>({}),combineDateOverviews=()=>({}),datesInRange=()=>[],dateOfCall=()=>"";',
  );
  code = code.replace(
    /import\s+\{[^}]+\}\s+from\s+['"]\.\.\/\.\.\/lib\/analyst\/three-site-rough['"];?/s,
    'const overlayThreeSiteRough=()=>null;',
  );
  code = code.replace(
    /import\s+\{\s*QualityTopNav\s*\}\s+from\s+['"]\.\/quality-top-nav['"];?/,
    'const QualityTopNav=()=>"QoE 분석";',
  );
  code = code.replace(
    /import styles from ['"]\.\/analyst-shell.module.css['"];?/,
    'const styles={};',
  );
  const shellPath = new URL('./.analyst-shell-test.mjs', import.meta.url);
  code += '\nexport {readFilters, urlFor};\n';
  files.push(shellPath);
  await fs.writeFile(shellPath, code);
  const { AnalystDashboard, readFilters, urlFor } = await import(
    shellPath.href
  );
  const { parseSelection } = await import(selectionPath.href);
  const queryFilters = readFilters(
    '?metric=mos&band=fair&experience=repeat&from=08%3A00&to=20%3A00&hour=14&cell=x&poor=0',
  );
  assert.equal(queryFilters.scoreMetric, 'mos');
  assert.equal(queryFilters.scoreBand, 'fair');
  assert.equal(queryFilters.experienceGroup, 'repeat');
  const encoded = urlFor(
    parseSelection('?source=실측&view=overview'),
    queryFilters,
  );
  assert.deepEqual(readFilters(encoded), queryFilters);
  const qoeFair=readFilters('?band=fair&poor=0');
  assert.equal(qoeFair.scoreMetric,'qoe');
  assert.equal(qoeFair.scoreBand,'fair');
  assert.deepEqual(readFilters(urlFor(parseSelection('?source=MDT&view=overview'),qoeFair)),qoeFair);
  assert.equal(
    readFilters('?metric=bad&band=fair&experience=bad').scoreBand,
    'fair',
  );
  assert.equal(readFilters('?metric=bad&experience=bad').experienceGroup, null);
  const html = renderToStaticMarkup(React.createElement(AnalystDashboard));
  assert.match(html, /데이터 목록을 불러오는 중입니다/);
  assert.match(html, /QoE 분석/);
  assert.match(html, /role="combobox"/);
  assert.match(html, /aria-label="전체 분석기간 조회"/);
  assert.match(html, />전체 기간<\/button>/);
  assert.doesNotMatch(html, /최대 3일/);
  assert.doesNotMatch(html, /SSR must not fetch/);
  assert.deepEqual(
    [...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((match) => match[1]),
    [],
  );
  console.log(
    'Analyst shell SSR initial loading and search accessibility tests passed',
  );
} finally {
  await Promise.all(files.map((file) => fs.unlink(file).catch(() => {})));
}
