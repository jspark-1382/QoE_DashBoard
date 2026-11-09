/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
test('candidate member calls differ from related customers full period calls',()=>{
 assert.ok(fs.existsSync('lib/analyst/quality-improvement-adapter.ts'),'investigation adapter exists');
 const {qualityCandidateInvestigationCalls}=load('lib/analyst/quality-improvement-adapter.ts');
 const calls=[{id:'member',customerId:'a',mos:2},{id:'normal-other-region',customerId:'a',mos:4},{id:'missing',customerId:'a',mos:null},{id:'outside',customerId:'b',mos:2}];
 const selection={candidateId:'c',callIds:['member'],customerIds:['a']};
 assert.deepEqual(qualityCandidateInvestigationCalls(calls,selection,'members').map(c=>c.id),['member']);
 const full=qualityCandidateInvestigationCalls(calls,selection,'customers');
 assert.deepEqual(full.map(c=>[c.id,c.isCandidateMember]),[['member',true],['normal-other-region',false],['missing',false]]);
});
