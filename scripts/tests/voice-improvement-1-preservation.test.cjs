/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const baseline={
  "components/analyst/quality-overview.tsx": "cf7566e1e0bd7372c0296d95bae565250659ee49394de60d8917468bcd02ad57",
  "components/analyst/quality-overview.module.css": "3610baf982e4fd67e0c4e54460c9c35c7d71d4ff7fa2028ba0f5de55caa2fd9e",
};
test('legacy overview body and style remain byte-identical',()=>{
 for(const [file,expected] of Object.entries(baseline))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),expected,file);
});
