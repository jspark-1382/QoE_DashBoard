/* eslint-disable @typescript-eslint/no-require-imports -- Node test harness uses shared TypeScript loader. */
const test=require('node:test'),assert=require('node:assert/strict');const {load}=require('../analyst-ts-loader.cjs');
const {compareSpatialCandidates}=load('lib/analyst/voice-improvement-1/comparison.ts');
test('candidate comparison keeps split and merge edges but no proximity-only match',()=>{
 const c=(id,memberCallIds)=>({id,kind:'spatial',memberCallIds,medoid:{lat:37.5,lon:127}});
 const rows=compareSpatialCandidates([c('before',['a','b'])],[c('after1',['a']),c('after2',['b']),c('near',['z'])]);
 assert.equal(rows.length,2); assert.equal(rows[0].sharedCallCount,1);assert.equal(rows[0].beforeOverlap,.5);assert.equal(rows[0].afterOverlap,1);
 assert.equal(compareSpatialCandidates([{...c('cell',['a']),kind:'cell'}],[c('after',['a'])]).length,0);
});
