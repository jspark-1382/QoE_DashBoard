/* eslint-disable @typescript-eslint/no-require-imports -- Node tests use the project's TypeScript loader. */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {load} = require('../analyst-ts-loader.cjs');
const {getCandidateCallInsights, getCandidateCallInsight} = load('lib/analyst/candidate-call-insight');

const date = '2026-09-12';
const stamp = second => date + 'T17:34:' + second + '+09:00';
const event = (second,pci,rsrp,channel=1550) => ({at:stamp(second),servingPci:pci,rsrp,earfcn:channel});
function window(events){return {status:'matched',window:{startedAt:events[0].at,endedAt:events.at(-1).at,events}};}
function orig(id){return {id,date,start:'17:34:00',end:'17:36:05',href:'/?source=MDT&view=contract&date='+date+'&call='+id};}
function target(id, criteria, allowedCauseCategories=['coverage','interference']) {
  return {id:'target-'+id, evidenceIds:['T'+id],kind:'call-criteria',sourceDates:[date],callIds:['c'+id],criteria,
    allowedCauseCategories,metrics:[],mapPoints:[],sopIds:[]};
}
const overlap = rows => ({overlap:window(rows),dl:{status:'matched',threshold:-100,minimum:-103,validSamples:7,observedCount:1}});
function job(targets) {
  const calls=[...new Set(targets.flatMap(t=>t.callIds))].map(orig);
  return {id:'scope',status:'completed',model:'qwen',modelVerification:{responseModelVerified:true,responseModel:'qwen'},
    evidence:{versions:{evidence:'candidate-evidence-v7',prompt:'candidate-prompt-v11'},analysisTargets:targets,
      calls,members:[],facts:targets.flatMap(t=>t.evidenceIds.map(id=>({id})))},
    report:{comparison:undefined}};
}
const sequence = () => [event('08.010',8,-97),event('08.510',19,-99),event('09.120',8,-95)];
test('return window preserves source timestamps, PCI order, dBm, same-call counterevidence and original URL',()=>{
  const t=target('01',overlap(sequence())),j=job([t]),r=getCandidateCallInsight(j);
  assert.equal(r.kind,'overlap');
  assert.equal(r.call.id,'c01');
  assert.equal(r.call.href,orig('c01').href);
  assert.deepEqual(r.rows.map(x=>[x.label,x.value,x.time]),[['PCI 8','−97 dBm','17:34:08.010'],['PCI 19','−99 dBm','17:34:08.510'],['PCI 8','−95 dBm','17:34:09.120']]);
  assert.match(r.period,/09.12.*17:34:08.*17:34:10/);
  assert.match(r.conclusion,/세 시점 모두/);
  assert.match(r.context,/다른 시점.*−103 dBm/);
});
test('does not invent simultaneous or different-time readings when RSRP is missing or meets the cutoff',()=>{
  const rows=sequence();rows[1].rsrp=null;
  const missing=getCandidateCallInsight(job([target('02',overlap(rows))]));
  assert.match(missing.rows[1].value,/미확보/);
  assert.doesNotMatch(missing.conclusion,/세 시점 모두/);
  assert.doesNotMatch(missing.context,/다른 시점/);
  rows[1].rsrp=-100;
  const mixed=getCandidateCallInsight(job([target('02',overlap(rows))]));
  assert.match(mixed.conclusion,/1개|1곳|1회|1건/);
});
test('a verified cited termination takes precedence over a different unrelated overlap; each linked call is available',()=>{
  const t=target('03',{},['equipment']);
  Object.assign(t,{kind:'termination-group',callIds:['c03','c04'],metrics:[{label:'byeReasonRaw',value:'102^RTP timeout'}]});
  const j=job([target('02',overlap(sequence())),t]);
  j.report.comparison={schemaVersion:'cause-comparison-v1',assessment:'unresolved',primary:{category:'equipment',evidenceIds:['T03']},
    alternative:null,interpretation:'응답',limitation:'근거 부족',nextCheck:'대조'};
  const results=getCandidateCallInsights(j);
  assert.equal(results[0].kind,'termination');
  assert.deepEqual(results.slice(0,2).map(r=>r.call.id),['c03','c04']);
  assert.equal(results[0].basis,'qwen');
  assert.equal(results.find(r=>r.call.id==='c02').basis,'measurement');
});
test('cell-ID return, carrier switch and UL-only sources keep their own semantics',()=>{
  const rows=sequence();rows.forEach((x,i)=>{x.servingPci=44;x.cellId=['10','12','10'][i];});
  assert.deepEqual(getCandidateCallInsight(job([target('01',overlap(rows))])).rows.map(r=>r.label),['Cell 10','Cell 12','Cell 10']);
  const change=window([event('15',3,-107,475),event('16',4,-92,1550)]);
  const handoff=getCandidateCallInsight(job([target('01',{frequencyChange:change},['mobility'])]));
  assert.deepEqual(handoff.rows.map(r=>r.label),['EARFCN 475','EARFCN 1550']);
  assert.equal(handoff.kind,'frequencyChange');
  const power=getCandidateCallInsight(job([target('01',{ul:{status:'matched',threshold:3,validSamples:3,observedCount:1,minimum:0}},['coverage'])]));
  assert.equal(power.kind,'ul');assert(power.rows.some(r=>r.value==='0'));
});
test('relationships must resolve in the displayed job, with safe original href and valid event sequence',()=>{
  const t=target('05',{overlap:window(sequence())},['interference']);
  const j=job([t]);
  j.evidence.calls[0].href='//private.example/?call=c05';assert.equal(getCandidateCallInsight(j),null);
  j.evidence.calls[0].href='/?source=MDT&date='+date+'&call=other';assert.equal(getCandidateCallInsight(j),null);
  j.evidence.calls[0]=orig('c05');j.evidence.facts=[];assert.equal(getCandidateCallInsight(j),null);
  j.evidence.facts=[{id:'T05'}];t.criteria.overlap.window.events[2].earfcn=123;assert.equal(getCandidateCallInsight(j),null);
  t.criteria.overlap=window(sequence());j.evidence.calls[0].end='17:34:04';assert.equal(getCandidateCallInsight(j),null);
  assert.equal(getCandidateCallInsight(null),null);
});
