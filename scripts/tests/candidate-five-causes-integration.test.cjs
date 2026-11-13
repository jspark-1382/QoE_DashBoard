/* eslint-disable @typescript-eslint/no-require-imports -- Actual criteria/source/SOP contracts. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildCandidateFindings}=require('../qwen-candidate-findings.cjs');
const {selectCandidateSop}=require('../qwen-candidate-sop.cjs');
const {publicCandidateEvidence}=require('../qwen-candidate-public-evidence.cjs');
const {validateCandidateReport}=require('../qwen-candidate-client.cjs');
const call={id:'private-call-one',date:'2026-10-28',start:'10:00:00',qoe:2,mos:2,cell:'private-cell',radioSeries:[0,10,20,30].map((s,i)=>({timestamp:'2026-10-28T10:00:'+String(s).padStart(2,'0'),cellId:'secret-cell-'+(i%2),frequency:3743,rsrp:-100,phr:i?4:3}))};
const collect=()=>buildCandidateFindings({candidate:{medoid:{lat:37.5,lon:127},displayRadiusM:500},sourceRevision:'fixture',rows:[],calls:[structuredClone(call)],grid:{analysisSchemaVersion:'mdt-grid-analysis-v1',records:[{pot:'actual-pot',lat:37.5,lon:127,analysis:[{date:'2026-11-03',band:'900',earfcn:'3743',samples:50,rsrpMean:-93,rsrqMean:-12,phrMean:0,belowPct:{'-100':25,'-105':0,'-110':0}}]}]}});
test('the -100 DL POT criterion and actual call criteria are model-linked without leaking original identifiers',()=>{
 const f=collect(),grid=f.modelTargets.find(target=>target.kind==='mdt-grid'),criteria=f.modelTargets.find(target=>target.kind==='call-criteria');
 assert.equal(grid.metrics.belowPct['-100'],25);assert(criteria);
 assert.equal(criteria.metrics.criteria.dl.status,'matched');assert.equal(criteria.metrics.criteria.ul.status,'matched');assert.equal(criteria.metrics.criteria.pollution.status,'matched');
 assert(!JSON.stringify(f.modelTargets).includes('private-call-one'));assert(!JSON.stringify(f.modelTargets).includes('secret-cell-'));
 assert.equal(f.causeAssessments.length,5);assert.equal(f.causeAssessments.find(row=>row.category==='capacity').status,'insufficient');
 for(const category of ['coverage','mobility'])assert.equal(f.causeAssessments.find(row=>row.category===category).status,'criteria-met');assert.equal(f.causeAssessments.find(row=>row.category==='interference').status,'possible');
});
test('each restored cause hypothesis receives only source-matched SOPs and no more than twenty templates',()=>{
 const f=collect(),sop=selectCandidateSop({candidate:{rangeReviewRequired:false,validationDates:[]},summary:{dropCalls:0},coverage:{radioCalls:1,rtpCalls:0},comparison:{status:'unavailable'},analysisTargets:f.analysisTargets});
 assert(sop.templates.length<=20);
 const target=f.analysisTargets.find(target=>target.kind==='call-criteria');
 for(const category of ['coverage','interference','mobility']){
  const permitted=target.sopIds.map(id=>sop.templates.find(row=>row.id===id)).filter(row=>row?.causeCategory===category);assert.equal(permitted.length,1);
  assert(permitted[0].evidenceIds.includes(target.evidenceIds[0]));
 }
});
test('five-category source assessment references survive public compaction even when Qwen did not select them',()=>{
 const f=collect(),target=f.analysisTargets.find(row=>row.kind==='call-criteria');assert(target);
 const projected=publicCandidateEvidence({...f,calls:[],facts:f.facts,causeAssessments:f.causeAssessments},{hypotheses:[],investigations:[]},{analysisTargets:[]});
 assert(projected.analysisTargets.some(row=>row.id===target.id));assert(projected.facts.some(row=>row.id===target.evidenceIds[0]));
});

test('v10 checks a same-frequency return separately from a frequency change, capacity and confirmed interference',()=>{
 const f=collect(),source=f.analysisTargets.find(t=>t.kind==='call-criteria'),model=f.modelTargets.find(t=>t.id===source.id);
 const sop=selectCandidateSop({candidate:{validationDates:[]},summary:{dropCalls:0},coverage:{},comparison:{},analysisTargets:f.analysisTargets});
 const evidence={schemaVersion:'qwen-candidate-evidence-v2',versions:{prompt:'candidate-prompt-v10'},sop,analysisTargets:f.analysisTargets,facts:f.facts,modelInput:{analysisTargets:[model],facts:f.facts}};
 const ev=source.evidenceIds;
 const hypothesis={category:'interference',title:'같은 주파수 서빙 셀 복귀 검토',assessment:'possible',reason:'동일 EARFCN에서 서빙 식별자가 복귀한 원본 관측이 있습니다.',supportingEvidenceIds:ev,missingEvidence:'동시 이웃 셀 관측이 필요합니다.',sopIds:['RULE_INTERFERENCE_REVIEW'],targetIds:[source.id]};
 const report={summary:{observed:'서빙 셀 복귀를 관측했습니다.',priority:'통화 원본을 대조합니다.',missing:'인접 셀 동시 측정이 필요합니다.'},hypotheses:[hypothesis],observations:[{text:'서빙 식별자가 복귀했습니다.',evidenceIds:ev}],checks:[{action:'동일 시각의 서빙·이웃 셀 기록을 대조합니다.',reason:'중첩과 부하를 구분합니다.',evidenceIds:ev}],limitations:['동시 이웃 셀 측정이 필요합니다.'],sop:[{sopId:'RULE_INTERFERENCE_REVIEW',reason:'같은 주파수 원본을 대조합니다.',evidenceIds:ev}]};
 assert.deepEqual(validateCandidateReport(report,evidence),report);
 for(const change of [
  (e,r)=>{r.observations[0].text='간섭이 확인되었습니다.';},
  e=>{e.modelInput.analysisTargets[0].metrics.criteria.overlap.sameFrequencyReturn=false;},
  e=>{e.modelInput.analysisTargets[0].metrics.criteria.overlap.window.events[1].earfcn=1550;},
  (e,r)=>{const h=r.hypotheses[0];h.category='mobility';h.sopIds=['RULE_MOBILITY_REVIEW'];r.sop[0].sopId=h.sopIds[0];h.title='주파수 전환 검토';},
  (e,r)=>{r.hypotheses[0].category='capacity';},
 ]){const e=structuredClone(evidence),r=structuredClone(report);change(e,r);assert.throws(()=>validateCandidateReport(r,e));}
});
