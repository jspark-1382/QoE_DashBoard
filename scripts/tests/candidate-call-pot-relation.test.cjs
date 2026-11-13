/* eslint-disable @typescript-eslint/no-require-imports */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {load} = require('../analyst-ts-loader.cjs');
const {getCandidateCallPotRelation} = load('lib/analyst/candidate-call-pot-relation');

const call = {id:'a', date:'2026-10-26', start:'10:00:00', href:'/?date=2026-10-26&call=a'};
const windowOf = events => ({status:'matched', window:{events}});
const target = (id,kind,properties={}) => ({
  id,kind,sourceDates:[call.date],callIds:[call.id],evidenceIds:[id],mapPoints:[],...properties,
});
const survey = target('grid','mdt-grid',{band:'900',earfcn:'3743',mapPoints:[{pot:'P1',date:call.date}]});
function read(targets,kind,selected='P1',observations) {
  return getCandidateCallPotRelation({sourceRevision:'rev',calls:[call],analysisTargets:targets,facts:targets.map(t=>({id:t.id}))},
    {call,kind,targetId:targets[0].id},selected,observations);
}
const lte = earfcn => ({earfcn,technology:'LTE'});
test('candidate membership, matching carrier/date, and even a background grid call ID do not locate the call',()=>{
  const t=target('rule','call-criteria',{criteria:{overlap:windowOf([lte(3743),lte(3743),lte(3743)])}});
  assert.deepEqual(read([t,survey],'overlap'),{relation:'candidate-only',callDate:call.date,observedPots:[],locationScope:'unknown',locationComplete:false,frequencyScope:'event',
    frequencyLabel:'900 MHz · EARFCN 3743',channels:['3743']});
  assert.equal(read([t,survey],'overlap',null).relation,'no-selection');
  const change=target('rule','call-criteria',{criteria:{frequencyChange:windowOf([lte(1694),lte(1550)])}});
  assert.equal(read([change,survey],'frequencyChange').frequencyLabel,'1.8 GHz 협대역 · EARFCN 1694 → 1.8 GHz 광대역 · EARFCN 1550');
});

const ordered=['10:00:01.001234','10:00:01.001235','10:00:03.500'];
const returning=target('a','call-criteria',{criteria:{overlap:windowOf(ordered.map(at=>({...lte(3743),at})))}});
function observations(pots) {
  return {sourceRevision:'rev',callId:call.id,callDate:call.date,samples:ordered.map((at,i)=>({timestamp:call.date+'T'+at+'+09:00',pot:pots[i],earfcn:3743,technology:'LTE'}))};
}
test('links full-precision event timestamps to GNSS POTs, including another POT and a UTC representation',()=>{
  const original=observations(['Q','Q','Q']);
  original.samples[2].timestamp=call.date+'T01:00:03.5Z';
  const other=read([returning,survey],'overlap','P1',original);
  assert.deepEqual([other.locationScope,other.locationComplete,other.relation,other.observedPots],['event',true,'other-pot',['Q']]);
  const same=read([returning,survey],'overlap','Q',original);
  assert.equal(same.relation,'direct');
  original.samples[1].pot='R';
  assert.deepEqual(read([returning,survey],'overlap','R',original).observedPots,['Q','R']);
  original.samples.push({...original.samples[1],pot:'conflict'});
  const conflict=read([returning,survey],'overlap','R',original);
  assert.deepEqual([conflict.locationComplete,conflict.relation,conflict.observedPots],[false,'candidate-only',['Q']]);
});
test('missing or ambiguous event positions, a different instant, and stale snapshots cannot rule out the selected POT',()=>{
  const partial=observations(['Q',null,null]);
  const missing=read([returning],'overlap','P1',partial);
  assert.deepEqual([missing.locationScope,missing.locationComplete,missing.relation],['event',false,'candidate-only']);
  assert.equal(read([returning],'overlap','Q',partial).relation,'direct');
  partial.samples[0].timestamp='10:00:01.001233';
  const nearby=read([returning],'overlap','P1',partial);
  assert.deepEqual([nearby.locationScope,nearby.relation],['call','candidate-only']);
  assert.equal(read([returning],'overlap','Q',partial).relation,'direct');
  for (const mismatch of [{callId:'b'},{callDate:'2026-10-29'},{sourceRevision:'outdated'}])
    assert.equal(read([returning],'overlap','Q',{...partial,...mismatch}).locationScope,'unknown');
});
test('the original same-call raw frequencies are useful for termination without assigning a carrier to BYE',()=>{
  const sample=observations(['Q','Q','Q']);
  const bye=target('end','termination-group');
  const result=read([bye],'termination','P1',sample);
  assert.equal(result.frequencyScope,'call');
  assert.equal(result.frequencyLabel,'900 MHz · EARFCN 3743');
  assert.equal(result.locationScope,'call');
  assert.equal(result.relation,'candidate-only');
});
test('an individual source-owned dated call POT can locate the call only, never the timing of an event',()=>{
  const t=target('q','call-quality');
  const pot=target('position','call-radio',{mapPoints:[{pot:'P1',date:call.date}]});
  assert.equal(read([t,pot],'quality').relation,'direct');
  assert.equal(read([t,pot],'quality','P2').relation,'candidate-only');
  for (const patch of [{callIds:['a','b']},{callIds:['b']},{sourceDates:['2026-10-28']},{evidenceIds:['missing']},
    {mapPoints:[{pot:'P1',date:'2026-11-03'}]},{kind:'termination-group'}]) {
    assert.equal(read([t,{...pot,...patch}],'quality').relation,'candidate-only');
  }
});
test('a summary or termination may only identify a same-call observed channel, never an event carrier',()=>{
  const end=target('bye','termination-group',{callIds:['a','b'],earfcn:'1694'});
  const same=target('rule','call-criteria',{criteria:{overlap:windowOf([lte(1550),lte(1550),lte(1550)])}});
  const other=target('other','call-radio',{callIds:['b'],earfcn:'3743'});
  const result=read([end,same,other,survey],'termination');
  assert.equal(result.frequencyScope,'call');
  assert.deepEqual(result.channels,['1550']);
  const missing=read([end,other,survey],'termination');
  assert.equal(missing.frequencyLabel,'미확인');
  assert.equal(missing.frequencyScope,'unknown');
});
test('missing observations, unknown channels and non-LTE technology never inherit the selected grid band',()=>{
  const change=events=>target('c','call-criteria',{criteria:{frequencyChange:windowOf(events)}});
  assert.equal(read([change([lte(999),lte(null)])],'frequencyChange').frequencyLabel,'EARFCN 999 → 일부 미확인');
  assert.equal(read([change([{earfcn:475,technology:'NR'}, {earfcn:1694,technology:'NR'}])],'frequencyChange').frequencyLabel,
    'NR-ARFCN 475 → NR-ARFCN 1694');
  assert.equal(read([change([{earfcn:3743}])],'frequencyChange').frequencyLabel,'채널 3743 (대역 미확인)');
  assert.equal(getCandidateCallPotRelation(null,null,'P1').relation,'unknown');
});
