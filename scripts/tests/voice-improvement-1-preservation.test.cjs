/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const baseline={
  "components/analyst/quality-overview.tsx": "7d167eae8c180b8bb37721410f5048772f3dc23035d6de9b676ce13268bc4458",
  "components/analyst/quality-overview.module.css": "3610baf982e4fd67e0c4e54460c9c35c7d71d4ff7fa2028ba0f5de55caa2fd9e",
};
test('legacy overview body and style remain byte-identical',()=>{
 for(const [file,expected] of Object.entries(baseline))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),expected,file);
});
