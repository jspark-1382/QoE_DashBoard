/* eslint-disable @typescript-eslint/no-require-imports -- Real bounded local history retention, without inference. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createCandidateHistoryStore}=require('../qwen-candidate-history.cjs');
const target={kind:'candidate',candidateId:'history-size',sourceRevision:'revision',scope:{dateStart:'2026-10-26',dateEnd:'2026-10-30',from:'00:00',to:'23:59'},candidateScope:{scopeKey:'full',policy:'strict-3-site-v1',analysisMode:'all',locationMode:'gps-mdt-rough-unvalidated-v1',modelId:'dbscan'}};

test('oversized aggregate history rejects the new save and preserves the previous readable group',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qwen-history-size-')),store=createCandidateHistoryStore(root);
 t.after(()=>{const resolved=path.resolve(root),temporary=path.resolve(os.tmpdir());assert(resolved.startsWith(temporary+path.sep));fs.rmSync(resolved,{recursive:true,force:true});});
 const item=id=>({job:{id,target,status:'completed',persistence:{status:'saved'},report:{summary:'검증된 결과'},evidence:{detail:'x'.repeat(34*1024*1024)}}});
 store.save(item('first'));
 assert.throws(()=>store.save(item('second')),error=>error.code==='ANALYSIS_HISTORY_TOO_LARGE');
 assert.deepEqual(store.list(target).map(row=>row.job.id),['first']);assert.equal(store.find('first').job.id,'first');
 assert(fs.statSync(path.join(root,'outputs/candidate-ai-analysis',fs.readdirSync(path.join(root,'outputs/candidate-ai-analysis'))[0])).size<64*1024*1024);
});
