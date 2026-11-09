/* eslint-disable @typescript-eslint/no-require-imports -- Node test harness uses shared TypeScript loader. */
const test=require('node:test'),assert=require('node:assert/strict');const {load}=require('../analyst-ts-loader.cjs');
const {buildCoverage}=load('lib/analyst/voice-improvement-1/coverage.ts');
test('coverage uses unique call sets, branches after valid MOS and null denominators',()=>{
 const calls=[{callId:'a',mos:2,mdtLinkStatus:'unique'},{callId:'b',mos:4,mdtLinkStatus:'ambiguous'},{callId:'c',mos:null,mdtLinkStatus:'unknown'}];
 const result=buildCoverage(calls,[{callId:'a',status:'accepted',kind:'gnss',reasons:[]},{callId:'b',status:'excluded',reasons:['bye-only']}]);
 assert.deepEqual([result.N,result.M,result.D,result.G,result.T,result.U],[3,2,1,1,0,1]); assert.equal(result.poor.N,1);assert.equal(result.mdtAmbiguous,1);assert.equal(result.mdtUnknown,1);assert.equal(result.ratios.U_N.denominator,3);
 assert.equal(buildCoverage([],[]).ratios.U_N.value,null);assert.throws(()=>buildCoverage([...calls,calls[0]],[]),/duplicate/i);
 assert.equal(result.mosMissing,1);assert.equal(result.mosInvalid,0);assert.equal(buildCoverage([{callId:'x',mos:6,mdtLinkStatus:'none'}],[]).mosInvalid,1);
});
