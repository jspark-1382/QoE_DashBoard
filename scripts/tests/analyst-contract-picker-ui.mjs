import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
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
  const helper = new URL('./.contract-picker-helper.mjs', import.meta.url);
  files.push(helper);
  await fs.writeFile(
    helper,
    ts.transpileModule(
      await fs.readFile('lib/analyst/contract-picker.ts', 'utf8'),
      { compilerOptions: options },
    ).outputText,
  );
  let code = ts.transpileModule(
    await fs.readFile('components/analyst/contract-picker.tsx', 'utf8'),
    { compilerOptions: options },
  ).outputText;
  code = code
    .replace(
      /['"]\.\.\/\.\.\/lib\/analyst\/contract-picker['"]/,
      "'./.contract-picker-helper.mjs'",
    )
    .replace(
      /import styles from ['"]\.\/contract-picker.module.css['"];?/,
      'const styles={};',
    );
  const component = new URL(
    './.contract-picker-component.mjs',
    import.meta.url,
  );
  files.push(component);
  await fs.writeFile(component, code);
  const { ContractPicker } = await import(component.href);
  const dataset = {
    customers: [
      {
        id: 'c',
        sourceContractId: '0000123',
        displayName: '고객',
        sampleCount: 999,
      },
    ],
    days: [
      {
        customerId: 'c',
        date: '2026-10-01',
        sampleCount: 0,
        callCount: 0,
        gnssSampleCount: undefined,
      },
    ],
  };
  const html = renderToStaticMarkup(
    React.createElement(ContractPicker, {
      dataset,
      date: '2026-10-01',
      source: 'MDT',
      selectedId: 'c',
      onSelect: () => {},
    }),
  );
  assert.match(html, /<dialog[^>]+aria-labelledby="contract-picker-title"/);
  assert.match(html, /계약 목록 \/ 계약 선택/);
  assert.match(html, /0000123/);
  assert.match(html, /현재 선택/);
  assert.match(html, /미제공/);
  assert.match(html, /GNSS 없는 계약만/);
  assert.match(html, /25개/);
  assert.match(html, /50개/);
  assert.doesNotMatch(html, /999/);
  const measured = renderToStaticMarkup(
    React.createElement(ContractPicker, {
      dataset,
      date: '2026-10-01',
      source: '실측',
      selectedId: null,
      onSelect: () => {},
    }),
  );
  assert.doesNotMatch(measured, /GNSS 없는 계약만/);
  console.log(
    'Contract picker SSR accessible dialog, metadata counts and source filter passed',
  );
} finally {
  await Promise.all(files.map((file) => fs.unlink(file).catch(() => {})));
}
