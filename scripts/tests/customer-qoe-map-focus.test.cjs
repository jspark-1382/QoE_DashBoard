/* eslint-disable @typescript-eslint/no-require-imports -- Node behavioral fixture. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
const file='lib/analyst/customer-qoe-map-focus.ts';
const helper=fs.existsSync(file)?load(file):{};
const call={id:'opaque:call',rawCallId:'raw:1',date:'2026-10-29',start:'14:32:00',startSecond:52320,qoe:0,drop:true,cell:'000123',location:{lat:37.5,lon:127.05,evidence:'gnss'}};

test('selected chart call uses only its own evidenced position and preserves zero QoE and Cell IDs',()=>{
  assert.equal(typeof helper.customerQoeMapFocus,'function');
  const focus=helper.customerQoeMapFocus(call);
  assert.deepEqual([focus.lat,focus.lon,focus.evidence],[37.5,127.05,'gnss']);
  assert.deepEqual(focus.lines,['2026-10-29 14:32:00','QoE 0.00 · SIP Drop','BYE Cell 000123','GPS 실측 위치']);
  assert.match(focus.title,/그래프에서 선택한 통화/);
});

test('BYE site reference remains distinct from GPS and unscored is never formatted as zero',()=>{
  assert.equal(typeof helper.customerQoeMapFocus,'function');
  const focus=helper.customerQoeMapFocus({...call,qoe:null,location:{...call.location,evidence:'bye-cell'}});
  assert.equal(focus.evidence,'bye-cell');
  assert.equal(focus.lines[1],'QoE 미평가 · SIP Drop');
  assert.match(focus.lines[3],/기지국 참고 위치.*단말 실측 위치 아님/);
});

test('missing, invalid, unsupported and out-of-region positions cannot create map markers',()=>{
  assert.equal(typeof helper.customerQoeMapFocus,'function');
  for(const location of [null,{...call.location,lat:NaN},{...call.location,lon:Infinity},{...call.location,lat:0},{...call.location,evidence:'estimated'}]){
    assert.equal(helper.customerQoeMapFocus({...call,location}),null);
  }
  assert.equal(helper.customerQoeMapFocus(null),null);
});
