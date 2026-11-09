const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {load}=require('../analyst-ts-loader.cjs');
const {classifySipReason11,sipReasonLabel}=load('lib/analyst/sip-reason.ts');
const source=fs.readFileSync('components/analyst/contract-workspace.tsx','utf8');
const css=fs.readFileSync('components/analyst/contract-workspace.module.css','utf8');
test('customer analysis list has SIP status immediately after MOS and before source',()=>{
  const i=source.indexOf("<th>{day.source === 'MDT' ? 'QoE' : 'QoE'}</th>");
  assert(i>0);
  const j=source.indexOf('11.REASON 종료 사유',i);
  const k=source.indexOf('<th>자료</th>',i);
  assert(i<j && j<k);
  assert(source.includes("sipReasonLabel(classifySipReason11(c.sipCause))"));
  assert(source.includes('aria-label="고객 통화 목록"'));
  assert(source.includes('onClick={() => onSelectCall(c.id)}'));
  assert(css.includes(".sipReasonBadge[data-reason='drop']"));
});
test('actual screenshot CDR-only call has SIP reason K: No_RTP -> 기타 while MOS unavailable',()=>{
  const manifest=JSON.parse(fs.readFileSync('public/voice-1030.json','utf8'));
  const entry=manifest.days.find(e=>e.date==='2026-10-30' && e.customerId==='mdt-9ca03fc82627fe865226a54e');
  assert(entry);
  const detail=JSON.parse(fs.readFileSync(path.join('public',entry.dataPath),'utf8'));
  const call=detail.calls.find(x=>x.start==='09:43:36'&&x.end==='09:43:53');
  assert(call);
  assert.equal(call.mos,null);
  assert.equal(call.hasMdt,false);
  assert.match(call.sipCause,/^K:\s*No_RTP/);
  assert.equal(sipReasonLabel(classifySipReason11(call.sipCause)),'기타');
});
test('original SIP 11.REASON classification stays consistent for all call-list rows',()=>{
  const reasons=['A: Normal','H: Drop','H : Drop/V : Rx_RTP_middle_Loss','C^H^J^K','K: No_RTP',''];
  assert.deepEqual(reasons.map(x=>sipReasonLabel(classifySipReason11(x))),
    ['Normal','Drop','Drop','Drop','기타','기타']);
});
