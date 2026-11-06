const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load}=require('../analyst-ts-loader.cjs');
const {normalizeDay}=load('lib/analyst/data.ts');
const {appendOverview}=load('lib/analyst/overview.ts');
test('source BYE RAT survives normalization and overview independently of LTE MDT labels',()=>{
  const dataset={meta:{},customers:[{id:'customer',sourceContractId:'00001234'}]};
  for(const endRat of ['NR','LTE',null]){
    const day=normalizeDay(dataset,{key:'c:d',customerId:'customer',date:'2026-10-30',sampleCount:0,samples:[],calls:[{
      id:'cdr',start:'09:00:00',end:'09:01:00',qoe:null,mos:2.1,mosV5Original:2.1,
      startCellId:'1',endCellId:'000987654321',endRat,mdtCount:0,radioCount:0,hasMdt:false,
    }]},'MDT');
    assert.equal(day.calls[0].endRat,endRat);
    const overview={calls:[],cells:[]};appendOverview(overview,day);
    assert.equal(overview.calls[0].endRat,endRat);
    assert.equal(overview.calls[0].endCellId,'000987654321');
    assert.equal(overview.calls[0].mos,2.1);assert.equal(overview.calls[0].id,'customer:cdr');
    assert.deepEqual(day.samples,[],'adding BYE RAT never invents NR measurement samples');
  }
});
