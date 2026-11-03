/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');
const { load } = require('../analyst-ts-loader.cjs');
const { mosGrade, evaluateCallEvidence } = load('lib/mos/call-evidence.ts');
const { compareMosCandidate } = load('lib/mos/comparison.ts');

const overview = {
  source: 'MDT', date: '2026-10-30', sourceRevision: 'revision-test-10',
  schemaVersion: 'analyst-overview-v1', gridSizeM: 60, cells: [],
  calls: [
    {id:'c:a', rawCallId:'a',customerId:'c', mos:2.9},
    {id:'c:b', rawCallId:'b',customerId:'c', mos:3.2},
    {id:'c:c', rawCallId:'c',customerId:'c', mos:3.7},
    {id:'c:d', rawCallId:'d',customerId:'c', mos:null},
    {id:'c:e', rawCallId:'e',customerId:'c', mos:4.2},
  ],
};
const candidate = {
  algorithmVersion:'experimental-v2',
  sourceRevision:'revision-test-10',
  date:'2026-10-30',
  records:[
    {callId:'a',mosImproved:3.1},
    {callId:'b',mosImproved:3.55},
    {callId:'c',mosImproved:3.3},
    {callId:'d',mosImproved:4.0},
    {callId:'e',mosImproved:null},
    {callId:'unknown',mosImproved:4.0},
  ],
};

test('MOS 3.0 and 3.5 boundaries are exact, non-numeric scores are unavailable',()=>{
  assert.equal(mosGrade(2.9999),'POOR');
  assert.equal(mosGrade(3),'WARNING');
  assert.equal(mosGrade(3.5),'GOOD');
  assert.equal(mosGrade(null),'UNAVAILABLE');
  assert.equal(mosGrade(0),'UNAVAILABLE');
  assert.equal(mosGrade(5.01),'UNAVAILABLE');
});

test('comparison validates same-day pairs, counts missing separately and reports descriptive differences',()=>{
  const result=compareMosCandidate(candidate,overview);
  assert.equal(result.matchedIds,5);
  assert.equal(result.unknownIds,1);
  assert.equal(result.unscoredOriginal,1);
  assert.equal(result.missingCandidate,1);
  assert.equal(result.paired,3);
  assert.equal(result.shiftedUp,2);
  assert.equal(result.shiftedDown,1);
  assert.equal(result.unchanged,0);
  assert.equal(result.gradeOriginal.POOR,1);
  assert.equal(result.gradeOriginal.WARNING,1);
  assert.equal(result.gradeOriginal.GOOD,1);
  assert.equal(result.gradeCandidate.WARNING,2);
  assert.equal(result.gradeCandidate.GOOD,1);
  assert(Math.abs(result.meanDifference - 0.05)<1e-9);
  assert.equal(result.greatestDifferences.length,3);
  assert.equal(overview.calls[0].mos,2.9,'original MOS must not be overwritten');
});

test('comparison rejects stale version, wrong date, malformed values and duplicate calls',()=>{
  const invalid=[
    {...candidate,sourceRevision:'stale'},
    {...candidate,date:'2026-10-29'},
    {...candidate,records:[{callId:'a',mosImproved:6}]},
    {...candidate,records:[{callId:'a',mosImproved:3},{callId:'a',mosImproved:4}]},
    {...candidate,records:[{callId:'a',mosImproved:NaN}]},
    {...candidate,records:[]},
  ];
  for(const payload of invalid) assert.throws(()=>compareMosCandidate(payload,overview));
});

test('MDT evidence is withheld for unmatched calls, and attention observations do not claim causality',()=>{
  const call={
    id:'a',mos:2.8,mosV5Original:2.8,matchStatus:'MATCHED',
    rtp:{txJitter:4,rxJitter:2,txPacketLoss:2,rxPacketLoss:0,txLossCount:0,rxLossCount:3},
  };
  const samples=[
    {callId:'a',inCallWindow:true,rsrp:-109,sinr:-1},
    {callId:'other',inCallWindow:true,rsrp:-130,sinr:-10},
  ];
  const present=evaluateCallEvidence(call,samples);
  assert.equal(present.grade,'POOR');
  assert.equal(present.sampleCount,1);
  assert.equal(present.hasRadio,true);
  assert.equal(present.evidence.find(x=>x.key==='rsrp').value,'-109 dBm');
  assert.match(present.conclusion,/확정할 수는 없습니다/);
  const ambiguous=evaluateCallEvidence({...call,matchStatus:'AMBIGUOUS'},samples);
  assert.equal(ambiguous.sampleCount,0);
  assert.equal(ambiguous.hasRadio,false);
  assert.equal(ambiguous.evidence.find(x=>x.key==='rsrp').value,'미제공');
});
