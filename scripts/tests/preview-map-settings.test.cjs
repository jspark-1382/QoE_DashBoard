/* eslint-disable @typescript-eslint/no-require-imports -- Node CLI tests. */
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
test('preview receives only existing VWorld setting without copying unrelated secrets',()=>{
 const {syncPreviewMapSettings}=require('../sync-qoe-preview-settings.cjs');const root=fs.mkdtempSync(path.join(os.tmpdir(),'qoe-map-'));
 try {fs.writeFileSync(path.join(root,'.env.local'),'OTHER_SECRET=private\nVITE_VWORLD_API_KEY=test-map-key\n');const target=path.join(root,'outputs','preview');syncPreviewMapSettings(root,target);assert.equal(fs.readFileSync(path.join(target,'.env.local'),'utf8'),'VITE_VWORLD_API_KEY=test-map-key\n');assert.throws(()=>syncPreviewMapSettings(root,root),/separate/);assert.throws(()=>syncPreviewMapSettings(root,path.dirname(root)),/inside/);}finally{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert(path.basename(root).startsWith('qoe-map-'));fs.rmSync(root,{recursive:true,force:true});}
});
