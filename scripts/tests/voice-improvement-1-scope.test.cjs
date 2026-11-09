/* eslint-disable @typescript-eslint/no-require-imports -- Node test harness uses shared TypeScript loader. */
const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('../analyst-ts-loader.cjs');
const s=load('lib/analyst/voice-improvement-1/scope.ts');
const dates=['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30'];
test('scope defaults to manifest range and preserves aggregate scope over drilldowns',()=>{
 const r=s.parseImprovementScope('',dates,'rev'); assert.equal(r.ok,true); assert.equal(r.scope.mode,'holdout'); assert.equal(r.scope.dateEnd,dates[4]);
 const one=s.parseImprovementScope('?date=2026-10-28',dates,'rev');assert.equal(one.scope.mode,'screening');assert.equal(one.scope.dateStart,dates[2]);
 const scoped={...r.scope,from:'08:00',to:'22:00',hour:9,customerId:'customer:a'};
 assert.deepEqual(s.parseImprovementScope('?'+s.improvementScopeQuery(scoped),dates,'rev').scope,scoped);
 assert.equal(s.canonicalScopeJson(s.analysisScope(scoped),s.DEFAULT_CANDIDATE_POLICY),s.canonicalScopeJson(s.analysisScope({...scoped,hour:10,customerId:'b'}),s.DEFAULT_CANDIDATE_POLICY));
 assert(s.legacyComparisonHref(scoped).startsWith('/?view=overview&'));assert(!s.legacyComparisonHref(scoped).includes('/qoe'));
});
test('scope rejects incompatible values and gaps without replacing explicit period with date',()=>{
 for(const [query,reason] of [['?source=실측','unsupported-source'],['?metric=qoe','unsupported-metric'],['?compareRevision=old','revision-mismatch'],['?from=23:00&to=01:00','invalid-range'],['?mode=holdout&date=2026-10-26','invalid-range'],['?dateStart=2026-10-26','invalid-range'],['?date=2026-11-01','missing-date']]) assert.equal(s.parseImprovementScope(query,dates,'rev').reason,reason,query);
 assert.equal(s.parseImprovementScope('?dateStart=2026-10-26&dateEnd=2026-10-30&date=2026-10-28',dates,'rev').scope.dateStart,dates[0]);
 assert.equal(s.parseImprovementScope('?dateStart=2026-10-26&dateEnd=2026-10-28',[dates[0],dates[2]],'rev').reason,'missing-date');
});
