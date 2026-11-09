/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
test('new comparison tab immediately follows legacy without replacing original routes',()=>{
 const source=fs.readFileSync('components/analyst/quality-top-nav.tsx','utf8');
 assert(source.indexOf('>개선 1안</Link>')>source.indexOf('>기존안</Link>'));
 assert.match(source,/improvementHref/);
});
test('navigation retains population and exploration while preserving revision',()=>{
 const {buildImprovementHref,withComparisonRevision}=load('lib/analyst/improvement-navigation.ts');
 const href=buildImprovementHref({source:'MDT',date:'2026-10-30',dateStart:'2026-10-26',dateEnd:'2026-10-30',customerId:'x'}, {from:'08:00',to:'19:00',hour:9,scoreMetric:'mos'},'revision');
 const p=new URLSearchParams(href.split('?')[1]);
 assert.equal(p.get('dateStart'),'2026-10-26');assert.equal(p.get('from'),'08:00');assert.equal(p.get('hour'),'9');assert.equal(p.get('customer'),'x');assert.equal(p.get('compareRevision'),'revision');
 assert.equal(withComparisonRevision('?date=2026-10-30','r'),'?date=2026-10-30&compareRevision=r');
 assert.equal(withComparisonRevision('?date=x',''),'?date=x');
});
