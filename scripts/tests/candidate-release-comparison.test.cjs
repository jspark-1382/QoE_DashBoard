/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {buildCoverageComparison} = require('../candidate-coverage-comparison.cjs');
const {createExportDetailReader} = require('../voice-query-export-details.cjs');

test('comparison uses a measured 25m peer on the same carrier and date', () => {
  const make = (id, tail, count, earfcn='3743') => ({
    id, kind:'mdt-grid', band:'900', earfcn, sourceDates:['2026-11-03'], mapPoints:[{pot:id}],
    metrics:[{label:'RSRP ≤-105 dBm',value:tail},{label:'측정 수',value:count}],
  });
  const targets=[make('A',48,268),make('B',1,219),make('C',0,1),make('D',0,200,'1550')];
  const links=targets.slice(1).map(t=>['A',t.id,'북쪽',25]);
  const review={priorities:[{category:'coverage',targetIds:['A']}]};
  assert.equal(buildCoverageComparison(targets,links,review).comparisonTargetId,'B');
  assert.equal(buildCoverageComparison(targets,links.slice(1),review),undefined);
});

test('precise candidate window excludes post-release measurements in the same second', () => {
  const date='2026-10-26', id='call', customerId='fixture';
  const call={id,start:'10:00:00',end:'10:01:00',startTimestamp:date+'T10:00:00.501+09:00',
    endTimestamp:date+'T10:01:00.250+09:00',matchStatus:'MATCHED',hasMdt:true};
  const sample=(clock,second)=>{const row=Array(22).fill(null);row[0]=second;row[19]=id;row[21]={timestamp:date+'T'+clock+'+09:00'};return row;};
  const samples=[sample('10:00:00.500',36000),sample('10:01:00.250',36060),sample('10:01:00.251',36060)];
  const read=createExportDetailReader({publicDir:__dirname,exactWindow:true,entryFor:()=>({customerId,date,calls:[call],samples})});
  assert.deepEqual(read(customerId,date,id).radioSeries.map(r=>r.timestamp),[date+'T10:01:00.250+09:00']);
});
