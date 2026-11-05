/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Node scripts and the existing test harness require CommonJS imports. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');

test('dataset index preserves first-match identity, date boundaries and source objects',()=>{
  assert(fs.existsSync('lib/analyst/dataset-index.ts'),'dataset lookup index is available');
  const {indexDataset}=load('lib/analyst/dataset-index.ts');
  const first={id:'001',dates:['2026-10-26']},other={id:'001:2026-10-26',dates:['2026-10-27']};
  const a={customerId:'001',date:'2026-10-26',samples:[],key:'first'},
    b={customerId:'001',date:'2026-10-27',samples:[],key:'second'},
    c={customerId:other.id,date:'2026-10-27',samples:[],key:'colon-id'};
  const dataset={customers:[first,{...first,displayName:'duplicate'},other],days:[a,b,{...a,key:'duplicate'},c]};
  const before=JSON.stringify(dataset),index=indexDataset(dataset);
  assert.equal(index.customersById.get('001'),first);
  assert.equal(index.customersById.get(other.id),other);
  assert.equal(index.daysByCustomer.get('001').get('2026-10-26'),a);
  assert.equal(index.daysByCustomer.get('001').get('2026-10-27'),b);
  assert.equal(index.daysByCustomer.get(other.id).get('2026-10-27'),c);
  assert.equal(index.daysByCustomer.get('001').get('2026-10-30'),undefined);
  assert.equal(index.customersById.get('1'),undefined);
  assert.equal(JSON.stringify(dataset),before);
  assert.equal(indexDataset({...dataset,days:[]}).daysByCustomer.size,0);
});
