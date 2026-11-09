/* eslint-disable @typescript-eslint/no-require-imports -- Node test harness uses shared TypeScript loader. */
const test=require('node:test'),assert=require('node:assert/strict');const {load}=require('../analyst-ts-loader.cjs');
const {scanComparisonEligibility,validateFieldEvidence}=load('lib/analyst/voice-improvement-1/field-evidence.ts');
test('SCAN needs supplied matching time, population, region and metric definitions',()=>{
 const scope={dateStart:'2026-10-26',dateEnd:'2026-10-30',from:'00:00',to:'23:59',source:'MDT',metric:'mos',sourceRevision:'rev',mode:'holdout'};
 assert.equal(scanComparisonEligibility(null,scope).eligible,false);
 const ref={...scope,regionDefinition:'observed-call-locations',populationDefinition:'MDT-CDR',metricDefinition:'original-mos-v5',supplied:true};
 assert.equal(scanComparisonEligibility(ref,scope).eligible,true);assert.equal(scanComparisonEligibility({...ref,metricDefinition:'qoe'},scope).eligible,false);
 assert.equal(validateFieldEvidence({candidateId:'a',observedAt:'',audioRef:'https://elsewhere/a.mp3',measuredMos:4,rfRef:null,result:'observed'}).ok,false);
});
