// Historical source assertions use the preserved original cohort; current sources have a separate census test.
const {historicalRead,historicalJson,skipHistoricalSource}=require('./published-fixture.cjs');
if(skipHistoricalSource(__filename))return;
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
const {classifySipReason11,sipReasonLabel}=load('lib/analyst/sip-reason.ts');
const {validateImprovementReport}=load('lib/analyst/improvement-candidates.ts');
const read=p=>JSON.parse(historicalRead(p,'utf8'));
const report=read('public/improvement-candidates/2026-10-26_2026-10-30.json');
const byDate=new Map(report.analysisDates.map(day=>[
  day,new Map(read('public/analyst-overview/MDT/'+day+'.json').calls.map(x=>[x.id,x])),
]));
test('SIP CDR column 11 distinguishes A Normal, H Drop, compound H and other',()=>{
 for(const reason of ['A: Normal','A : Normal'])assert.equal(classifySipReason11(reason),'normal');
 for(const reason of ['H: Drop','H : Drop/V : Rx_RTP_middle_Loss','C^H^J^K','C : No_100_Trying/H : Drop/K : No_RTP'])
   assert.equal(classifySipReason11(reason),'drop');
 for(const reason of ['V: Rx_RTP_middle_Loss','K: No_RTP','C^J^K','Z: etc','',null,undefined])
   assert.equal(classifySipReason11(reason),'other');
 assert.deepEqual(['normal','drop','other'].map(sipReasonLabel),['Normal','Drop','기타']);
});
test('source 11.REASON field is in original indexed CDR, without treating all low MOS as Drop',()=>{
 const calls=[...byDate.values()].flatMap(map=>[...map.values()]);
 const totals={normal:0,drop:0,other:0};
 for(const c of calls)totals[classifySipReason11(c.sipCause)]++;
 assert.equal(totals.normal,153863);
 assert.equal(totals.drop,257); // includes H^M^P^U coded combination
 assert.equal(totals.other,30112);
 const poorDrops=calls.filter(c=>c.mos!==null&&c.mos<3&&classifySipReason11(c.sipCause)==='drop');
 assert(poorDrops.length>0&&poorDrops.length<1403);
});
test('five candidates show 42 uniquely affected customers, not 5 candidate sites mislabelled as people',()=>{
 const manifest=read('public/voice-1030.json');
 assert.equal(validateImprovementReport(report,manifest.meta.revision),true);
 assert.equal(report.summary.candidateCount,5);
 assert.equal(report.summary.distinctAffectedCustomers,42);
 assert.equal(report.candidates.filter(x=>x.kind==='spatial').length,3);
 assert.equal(report.candidates.filter(x=>x.kind==='cell').length,2);
 for(const c of report.candidates){
   assert(c.discovery.dropCalls>=0&&c.discovery.dropCalls<=c.discovery.poorCalls);
   assert(c.relatedGnssCallCount<=c.relatedGnss.length);
   assert.equal(c.relatedGnssCallCount,new Set(c.relatedGnss.map(x=>x.callId)).size);
   for(const gps of c.relatedGnss){
     assert.equal(gps.source,'RAW_MDT_GNSS');
     const source=byDate.get(gps.date).get(gps.callId);
     assert(source&&source.mos<3,'each raw GNSS point is from low-MOS source call');
     assert.equal(source.customerId,gps.customerId);
     assert.equal(gps.validationDay,gps.date==='2026-10-30');
   }
 }
});
test('related GNSS sample counts are full per-call point sets, not a single medoid',()=>{
 assert.deepEqual(report.candidates.map(c=>c.relatedGnss.length),[21,32,43,10,2]);
 const labels=report.candidates.filter(c=>c.kind==='spatial').map(c=>c.label);
 assert(labels.every(x=>x.startsWith('MOS 저하고객 중복 위치 ')), 'raw candidate JSON retains original labels');
 const display=historicalRead('components/analyst/improvement-candidates.tsx','utf8');
 assert(display.includes('displayQualityLabel(candidate.label)'), 'UI must normalize the original label without changing evidence');
});
test('inline full map opens selected call analysis directly, retaining SIP and GNSS changes',()=>{
 const ui=historicalRead('components/analyst/quality-proposal-four.tsx','utf8')+'\n'+historicalRead('components/analyst/quality-summary-panels.tsx','utf8');
 const candidate=historicalRead('components/analyst/improvement-candidates.tsx','utf8');
 const map=historicalRead('components/analyst/improvement-candidate-map.tsx','utf8');
 assert(ui.includes('className={styles.geography}'));
 assert(ui.includes('className={styles.mapHost}'));
 assert(ui.includes('id="qoe-call-analysis-dialog"'));
 assert(!ui.includes('mapDialogOpen'));
 assert(!ui.includes('qoe-end-location-dialog'));
 assert(ui.includes('setChosenCall(id);setDeep(false);setDialogOpen(true);setSearch'));
 assert(!ui.slice(ui.indexOf('const selectCall='),ui.indexOf('const selectTableCall=')).includes('scrollIntoView'));
 assert(ui.includes('onCallLocationSelect={selectCall}'));
 assert(ui.includes('SIP 상태코드 (11.REASON)'));
 assert(ui.includes('SIP 종료 구분 필터'));
 assert(ui.includes('sipReasonLabel(classifySipReason11(call.sipCause))'));
 assert(ui.includes('colSpan={11}'));
 assert(candidate.includes('저품질 체감 고객'));
 assert(candidate.includes('report.summary.distinctAffectedCustomers'));
 assert(candidate.includes('QoE 저하고객 중복 위치'));
 assert(candidate.includes('관련 원본 GPS 전체'));
 assert(candidate.includes('data-reason="drop"'));
 assert(candidate.indexOf('className={styles.evidenceRow}')<candidate.indexOf('className={styles.locationNote}'));
 assert(map.includes('selected?.relatedGnss'));
 assert(map.includes('gpsMarkerSvg(band,rf?.rsrpDbm)'));
});
