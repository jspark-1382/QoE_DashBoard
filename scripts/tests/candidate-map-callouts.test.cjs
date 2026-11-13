const test = require('node:test');
const assert = require('node:assert/strict');
const {load} = require('../analyst-ts-loader.cjs');
const {layoutCandidateCallouts} = load('lib/analyst/candidate-map-callouts');

test('a survey and four close neighbors have distinct labels inside a narrow map', () => {
  const anchors = [
    ['조사',48,96,''], ['W',42,96,'서쪽'], ['N',48,90,'북쪽'],
    ['E',54,96,'동쪽'], ['S',48,102,'남쪽'], ['outside',-30,15,''],
  ].map(([id,x,y,direction])=>({id,x,y,direction,width:90}));
  const width=320, height=300;
  const output=layoutCandidateCallouts(anchors,width,height,anchors,[{left:185,top:0,width:135,height:55}]);
  assert.deepEqual(output.map(row=>row.id),anchors.slice(0,5).map(row=>row.id));
  for(const [index,box] of output.entries()){
    assert(box.left>=0 && box.top>=0 && box.left+box.width<=width && box.top+box.height<=height);
    assert(box.lineX>=box.left && box.lineX<=box.left+box.width && box.lineY>=box.top && box.lineY<=box.top+box.height);
    for(const placed of output.slice(0,index)){
      assert(box.left>=placed.left+placed.width || placed.left>=box.left+box.width ||
        box.top>=placed.top+placed.height || placed.top>=box.top+box.height);
    }
  }
});
