const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
const {summarizeCallMdtObservations,formatMdtObservation}=load('lib/analyst/mdt-observation.ts');
const {normalizeDay}=load('lib/analyst/data.ts');

function row(id,time,extra={}){
 const r=Array(22).fill(null);
 const clock=time.match(/T(\d{2}):(\d{2}):(\d{2})/);
 r[0]=clock?Number(clock[1])*3600+Number(clock[2])*60+Number(clock[3]):0;
 r[1]=clock?clock[0].slice(1):'00:00:00';
 r[19]=id;r[21]={timestamp:time,phase:'Call_1',...extra};
 return r;
}
const sourceCall={
 id:'call-test',start:'12:00:00',end:'12:02:00',
 startTimestamp:'2026-10-30T12:00:00+09:00',
 endTimestamp:'2026-10-30T12:02:00+09:00'
};
test('one verified call: during, before and after 60s, closest signed time',()=>{
 const records=[
 row('call-test','2026-10-30T12:01:00+09:00'), // -60 boundary
 row('call-test','2026-10-30T12:01:30+09:00'), // -30
 row('call-test','2026-10-30T12:02:00+09:00'), // 0, count only before
 row('call-test','2026-10-30T12:02:00.500+09:00'), // +0.5s
 row('call-test','2026-10-30T12:03:00+09:00'), // +60
 row('call-test','2026-10-30T12:03:01+09:00'), // +61
 row('different-call','2026-10-30T12:01:59+09:00'),
 ];
 const result=summarizeCallMdtObservations(sourceCall,records);
 assert.equal(result.taggedRows,6);
 assert.equal(result.timestampedRows,6);
 assert.equal(result.duringCallRows,3);
 assert.equal(result.endBefore60Rows,3);
 assert.equal(result.endAfter60Rows,2);
 assert.equal(result.closestToEndSignedSeconds,0);
 const view=formatMdtObservation(result,'MATCHED');
 assert.equal(view.headline,'종료 전 60초 이내 · 3건');
 assert.equal(view.observation,'before');
 assert.match(view.detail,/통화 중 3건/);
 assert.match(view.detail,/종료 후 60초 2건/);
});
test('after-only data never presented as during-call measurements',()=>{
 const result=summarizeCallMdtObservations(sourceCall,[row('call-test','2026-10-30T12:02:25+09:00')]);
 const view=formatMdtObservation(result,'MATCHED');
 assert.equal(result.duringCallRows,0);
 assert.equal(result.endAfter60Rows,1);
 assert.equal(view.headline,'종료 후 60초 이내 · 1건');
 assert.match(view.timeDetail,/통화 중 품질 증거가 아닙니다/);
});
test('distant previous observation is distinct from no MDT',()=>{
 const result=summarizeCallMdtObservations(sourceCall,[row('call-test','2026-10-30T12:00:30+09:00')]);
 const view=formatMdtObservation(result,'MATCHED');
 assert.equal(view.headline,'종료 전후 60초 내 없음');
 assert.equal(result.duringCallRows,1);
 assert.match(view.detail,/통화 중 1건/);
 assert.match(view.timeDetail,/90.0초 전/);
});
test('no tagged MDT rows does not imply customer has no MDT anywhere',()=>{
 const result=summarizeCallMdtObservations(sourceCall,[row('call-other','2026-10-30T12:01:59+09:00')]);
 const view=formatMdtObservation(result,'UNMATCHED');
 assert.equal(view.headline,'해당 통화 MDT 없음');
 assert.match(view.timeDetail,/다른 통화·고객 전체/);
});
test('ambiguous same-time candidates do not imply verified call measurements',()=>{
 const result=summarizeCallMdtObservations(sourceCall,[row('call-test','2026-10-30T12:01:59+09:00')]);
 assert.equal(formatMdtObservation(result,'AMBIGUOUS').observation,'ambiguous');
});
test('invalid or missing timezone/clock does not manufacture a time proximity',()=>{
 const invalid={...sourceCall,endTimestamp:'2026-10-30T12:02:00'};
 const result=summarizeCallMdtObservations(invalid,[
   row('call-test','2026-10-30T12:01:59+09:00'),
   row('call-test','2026-10-30T12:02:00'),
 ]);
 assert.equal(result.timestampedRows,1);
 assert.equal(result.clockBasis,'time-not-verifiable');
 assert.equal(formatMdtObservation(result,'MATCHED').observation,'unverified');
});
test('call ID matching must be strict across same-customer partition',()=>{
 const result=summarizeCallMdtObservations(sourceCall,[row('call-test-2','2026-10-30T12:01:59+09:00')]);
 assert.equal(result.taggedRows,0);
});
test('cross-midnight GMT offsets are calculated by epoch time',()=>{
 const call={...sourceCall,startTimestamp:'2026-10-30T23:59:50+09:00',endTimestamp:'2026-10-31T00:00:10+09:00'};
 const result=summarizeCallMdtObservations(call,[
  row('call-test','2026-10-31T00:00:09.000+09:00'),
  row('call-test','2026-10-31T00:00:10.500+09:00'),
 ]);
 assert.equal(result.duringCallRows,1);
 assert.equal(result.endBefore60Rows,1);
 assert.equal(result.endAfter60Rows,1);
 assert.equal(result.closestToEndSignedSeconds,.5);
});
test('normalizeDay attaches raw time observations even if a row is not in call window',()=>{
 const dataset={meta:{dates:['2026-10-30']},customers:[],days:[]};
 const detail={customerId:'mdt-example',date:'2026-10-30',
   calls:[{...sourceCall,matchStatus:'MATCHED',hasMdt:true,mdtCount:1}],
   samples:[row('call-test','2026-10-30T12:01:58+09:00'),
      row('call-test','2026-10-30T12:02:20+09:00',{inCallWindow:false})]};
 const normalized=normalizeDay(dataset,detail,'MDT');
 const call=normalized.calls[0];
 assert.equal(call.mdtObservation.timestampedRows,2);
 assert.equal(call.mdtObservation.endBefore60Rows,1);
 assert.equal(call.mdtObservation.endAfter60Rows,1);
 assert.equal(normalized.samples.length,1,'outside call row must not become in-call radio evidence');
});
test('UI shows real observation presence instead of opaque call association status',()=>{
 const source=fs.readFileSync('components/analyst/quality-proposal-four.tsx','utf8');
 assert(source.includes('MDT 측정 현황'));
 assert(source.includes('mdtObserved?.headline'));
 assert(source.includes('상태코드 결과 (11.REASON)'));
 assert(source.includes('sipReasonLabel(classifySipReason11(selectedActual.sipCause))'));
 const mosIndex=source.indexOf('<span>CDR MOS(v5)</span>');
 const sipIndex=source.indexOf('상태코드 결과 (11.REASON)');
 const lossIndex=source.indexOf('<span>Audio Tx Loss (원본)</span>');
 assert(mosIndex>=0&&mosIndex<sipIndex&&sipIndex<lossIndex);
 assert(source.includes('mdtObserved.detail'));
 assert(source.includes('mdtObserved.timeDetail'));
 assert(!source.includes('시각 단독 후보'));
 assert(!source.includes('MDT 연계 상태'));
});
