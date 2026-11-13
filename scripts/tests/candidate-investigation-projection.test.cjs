/* eslint-disable @typescript-eslint/no-require-imports -- Report-selected sources survive bounded public projection. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {publicCandidateEvidence}=require('../qwen-candidate-public-evidence.cjs');
test('public projection retains investigation-selected targets and facts independently of causal hypotheses',()=>{
 const evidence={analysisTargets:[{id:'call',kind:'call-quality',evidenceIds:['T1']},{id:'other',kind:'mdt-grid',evidenceIds:['T2']}],facts:[{id:'T1'},{id:'T2'}],calls:[],neighbourLinks:[],modelInput:{analysisTargets:[]}};
 const result=publicCandidateEvidence(evidence,{investigations:[{targetIds:['call'],evidenceIds:['T1']}],hypotheses:[]});
 assert.deepEqual(result.analysisTargets.map(row=>row.id),['call']);assert.deepEqual(result.facts.map(row=>row.id),['T1']);
});
