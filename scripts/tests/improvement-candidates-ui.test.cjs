const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load}=require('../analyst-ts-loader.cjs');
const {callEvidenceUrl,validateImprovementReport}=load('lib/analyst/improvement-candidates.ts');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const report=read('public/improvement-candidates/2026-10-26_2026-10-30.json');
const manifest=read('public/voice-1030.json');

test('historical 5-day improvement evidence has exact version and 3 GNSS + 2 cell candidates',()=>{
 assert.equal(validateImprovementReport(report,manifest.meta.revision),true);
 assert.equal(validateImprovementReport(report,'outdated'),false);
 assert.deepEqual(report.analysisDates,manifest.meta.dates);
 assert.equal(report.summary.candidateCount,5);
 assert.equal(report.summary.independentlyConfirmedRootCauses,0);
 assert.equal(report.candidates.filter(c=>c.kind==='spatial').length,3);
 assert.equal(report.candidates.filter(c=>c.kind==='cell').length,2);
 assert.equal(report.candidates.filter(c=>c.location).length,4);
 assert.equal(report.candidates.find(c=>c.id==='cell-788228').location,null);
 assert.equal(report.candidates.find(c=>c.id==='cell-3470091').location.ruId,'RNSL71213T');
});
test('all representative calls resolve to same customer/date original CDR with unchanged MOS',()=>{
 const byDate=new Map(report.analysisDates.map(date=>{
  const q=read('public/analyst-overview/MDT/'+date+'.json');
  return [date,new Map(q.calls.map(c=>[c.id,c]))];
 }));
 for(const candidate of report.candidates){
  assert(candidate.validation.newPoorCustomers>=2);
  assert(candidate.radioReference.linkedCdrMdtRepresentativeCalls>=0);
  for(const ref of candidate.representativeCalls){
   const c=byDate.get(ref.date).get(ref.callId);
   assert(c,'referenced CDR must exist on its own date');
   assert.equal(c.customerId,ref.customerId);
   assert(c.mos<3);
   assert(Math.abs(c.mos-ref.mos)<0.001);
   assert.equal(c.endCellId,ref.endCellId);
   const href=callEvidenceUrl(ref);
   const query=new URLSearchParams(href.split('?')[1]);
   assert.equal(query.get('date'),ref.date);
   assert.equal(query.get('customer'),ref.customerId);
   assert.equal(query.get('call'),ref.callId.slice(ref.customerId.length+1));
   assert.equal(query.get('view'),'contract');
  }
 }
});
test('spatial centroids come from discovery GNSS, NOT withheld 30th or a base-station location',()=>{
 const sourceByDate=new Map(report.trainingDates.map(date=>{
  const d=read('public/analyst-overview/MDT/'+date+'.json');
  return [date,d.callLocations.filter(p=>p.evidence==='gnss')];
 }));
 for(const candidate of report.candidates.filter(c=>c.kind==='spatial')){
  assert.equal(candidate.location.source,'TRAINING_GNSS_CLUSTER_MEDOID');
  assert(candidate.location.radiusM>=100);
  const original=report.trainingDates.some(date=>sourceByDate.get(date).some(p=>
    Math.abs(p.lat-candidate.location.lat)<1e-7&&Math.abs(p.lon-candidate.location.lon)<1e-7));
  assert(original,'centroid must be an actual training GNSS observation, not a synthetic site point');
  assert.equal(candidate.validation.date,'2026-10-30');
  assert(candidate.relatedEndCells.length>=1);
 }
});
test('current dashboard includes opt-in mode and keeps original 1-3 day view/table intact',()=>{
 const ui=fs.readFileSync('components/analyst/quality-proposal-four.tsx','utf8');
 const workspace=fs.readFileSync('components/analyst/improvement-candidates.tsx','utf8');
 assert(ui.includes('aria-label="지도 모드"'));
 assert(ui.includes("mapMode==='improvement'"));
 assert(ui.includes("mapMode==='current'"));
 assert(ui.includes("{mapMode==='current'&&<section className={styles.kpis}"));
 assert(ui.includes("{mapMode==='current'&&<div className={styles.charts}"));
 assert(ui.includes('<ImprovementCandidateWorkspace sourceRevision={dataset?.meta.revision'));
 assert(ui.includes('<AnalystMap'));
 assert(ui.includes('<Table calls={dataCalls}'));
 assert(!workspace.includes('독립 고객 반복 저품질 후보'));
 assert(!workspace.includes('2026.10.26 ~ 10.30 원본 5일 고정'));
 assert(!workspace.includes('원인 확정 0건 · 현장 검증 필요'));
 const buttons=ui.indexOf('className={styles.mapModeButtons}');
 const customer=ui.indexOf('<QualityCustomerPicker');
 const source=ui.indexOf('className={styles.analysisBasis}');
 const charts=ui.indexOf('className={styles.charts}');
 assert(buttons>0 && customer>buttons && source>customer && charts>source,
   'main filters keep map modes, customer search and compact analysis basis above charts');
 assert.equal(ui.match(/className=\{styles\.mapModeButtons\}/g)?.length,1);
 assert(workspace.includes('관련 원본 통화'));
 assert(workspace.includes('validateImprovementReport(report,sourceRevision)'));
 assert(workspace.includes('지도 위치 미표시'));
});

test('improvement map enables real wheel zoom and candidate panels use matched responsive heights',()=>{
 const map=fs.readFileSync('components/analyst/improvement-candidate-map.tsx','utf8');
 const css=fs.readFileSync('components/analyst/improvement-candidates.module.css','utf8');
 assert(map.includes('scrollWheelZoom:true'),'wheel zoom must be enabled');
 assert(!map.includes('scrollWheelZoom:false'));
 assert(map.includes('wheelPxPerZoomLevel:75'));
 assert(css.includes('align-items:stretch'));
 assert(css.includes('height:clamp(555px,67vh,710px)'));
 assert(css.includes('.detail{flex:1;min-height:0;'));
 assert(css.includes('.mapHost{flex:1;min-height:330px;'));
 assert(css.includes('grid-template-columns:repeat(3,minmax(0,1fr))'));
 assert(css.includes('@media(max-width:1100px)'));
});

