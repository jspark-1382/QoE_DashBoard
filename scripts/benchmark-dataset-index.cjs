/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Node scripts and the existing test harness require CommonJS imports. */
// Local source-backed measurement; timings are reported, never used as test gates.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {load}=require('./analyst-ts-loader.cjs');
const {indexDataset}=load('lib/analyst/dataset-index.ts');
const dataset=JSON.parse(fs.readFileSync('public/voice-1030.json','utf8'));
const started=performance.now(),index=indexDataset(dataset),buildMs=performance.now()-started;
const probes=Array.from({length:1000},(_,i)=>dataset.days[(i*7919)%dataset.days.length]);
function scan(){return probes.map(day=>[
  dataset.customers.find(customer=>customer.id===day.customerId),
  dataset.days.find(entry=>entry.customerId===day.customerId&&entry.date===day.date),
]);}
function lookup(){return probes.map(day=>[
  index.customersById.get(day.customerId),index.daysByCustomer.get(day.customerId)?.get(day.date),
]);}
const before=scan(),after=lookup();
for(let i=0;i<probes.length;i++){
  assert.equal(before[i][0],after[i][0]);assert.equal(before[i][1],after[i][1]);
}
function median(fn){const runs=[];for(let i=0;i<5;i++){const t=performance.now();fn();runs.push(performance.now()-t);}return runs.sort((a,b)=>a-b)[2];}
console.log(JSON.stringify({customers:dataset.customers.length,days:dataset.days.length,queries:probes.length,
  indexBuildMs:+buildMs.toFixed(2),scanMedianMs:+median(scan).toFixed(2),indexedMedianMs:+median(lookup).toFixed(2)},null,2));
