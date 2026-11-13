/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
const file='lib/analyst/consecutive-poor.ts';
const api=fs.existsSync(file)?load(file):{};
const classify=blocks=>{
  assert.equal(typeof api.classifyConsecutiveBlocks,'function');
  return api.classifyConsecutiveBlocks(blocks);
};
const block=(timestamp,total,poor)=>({timestamp,total,poor});

test('homogeneous ties preserve every call and have a definite adjacency result',()=>{
  assert.equal(classify([block(1,2,2)]),true);
  assert.equal(classify([block(1,1,1),block(2,2,0),block(3,1,1)]),false);
  assert.equal(classify([block(1,2,0),block(2,2,2)]),true);
});
test('mixed timestamp blocks distinguish guaranteed, possible and impossible runs',()=>{
  assert.equal(classify([block(1,3,2)]),null);
  assert.equal(classify([block(1,4,3)]),true);
  assert.equal(classify([block(1,1,1),block(2,2,1),block(3,1,1)]),true);
  assert.equal(classify([block(1,1,1),block(2,2,1),block(3,1,0)]),null);
  assert.equal(classify([block(1,1,0),block(2,2,1),block(3,1,0)]),false);
  assert.equal(classify([block(1,1,1),block(2,1,1),block(3,1,0),block(4,2,1)]),true);
});
test('duplicate input blocks merge by timestamp before considering possible orders',()=>{
  const input=[block(2,1,1),block(1,1,1),block(1,1,0)];
  const snapshot=structuredClone(input);
  assert.equal(classify(input),null);
  assert.deepEqual(input,snapshot);
  assert.equal(classify([...input].reverse()),null);
});
test('missing chronology remains unknown unless the call counts alone prove the result',()=>{
  assert.equal(classify([]),false);
  assert.equal(classify([block(null,3,1)]),false);
  assert.equal(classify([block(null,2,2)]),true);
  assert.equal(classify([block(null,1,1),block(1,1,0),block(2,1,1)]),null);
});

function permutations(total,poor,prefix=[]){
  if(!total)return [prefix];
  return [
    ...(poor?permutations(total-1,poor-1,[...prefix,1]):[]),
    ...(poor<total?permutations(total-1,poor,[...prefix,0]):[]),
  ];
}
function exhaustive(blocks){
  let rows=[[]];
  for(const item of blocks)rows=rows.flatMap(prefix=>permutations(item.total,item.poor).map(row=>[...prefix,...row]));
  const results=rows.map(row=>row.some((value,i)=>i&&value&&row[i-1]));
  return results.every(Boolean)?true:results.some(Boolean)?null:false;
}
test('three timestamp blocks match exhaustive permutations independently of endpoint implementation',()=>{
  const choices=[];
  for(let total=1;total<=3;total++)for(let poor=0;poor<=total;poor++)choices.push({total,poor});
  for(const a of choices)for(const b of choices)for(const c of choices){
    const input=[{timestamp:1,...a},{timestamp:2,...b},{timestamp:3,...c}];
    assert.equal(classify(input),exhaustive(input),JSON.stringify(input));
  }
});
