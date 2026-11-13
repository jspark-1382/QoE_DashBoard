/* eslint-disable @typescript-eslint/no-require-imports -- Native candidate input regressions. */
const test=require('node:test'),assert=require('node:assert/strict');
const {buildCandidateFindings}=require('../qwen-candidate-findings.cjs');
const {selectCandidateSop}=require('../qwen-candidate-sop.cjs');
const candidate={medoid:{lat:37,lon:127},displayRadiusM:200,rangeReviewRequired:false,validationDates:[]};
const row=(tail=0,patch={})=>({date:'2026-11-03',band:'900',earfcn:'3743',samples:80,rsrpMean:-94,rsrqMean:-14,phrMean:null,rsrpMeanSumCnt:-88,belowPct:{'-105':tail,'-110':0},metricSamples:{'-105':80,'-110':80,rsrp:80,rsrq:80},...patch});
const cell=(pot,x,y,analysis=[row()])=>({pot,x,y,lat:37+y/110900,lon:127+x/(111320*Math.cos(37*Math.PI/180)),analysis});
const findings=records=>buildCandidateFindings({candidate,grid:{analysisSchemaVersion:'mdt-grid-analysis-v1',records},rows:[],calls:[]});
test('all measured POT combinations including zero-tail comparison remain AI-selectable beyond six',()=>{
 const f=findings(Array.from({length:12},(_,i)=>cell('POT'+i,(i%4)*25,Math.floor(i/4)*25,[row(i===11?11.163895:0)])));
 assert.equal(f.analysisTargets.length,12);assert.equal(f.transmission[0].available,12);assert.equal(f.transmission[0].sent,12);
 assert.equal(f.mdtCoverage.inRangePots,12);assert.equal(f.mdtCoverage.measuredPots,12);
 assert(f.analysisTargets.some(t=>t.mapPoints[0].pot==='POT11'));
 assert(!JSON.stringify(f.modelTargets).includes('POT11'));
 assert(f.modelTargets.some(t=>t.metrics.belowPct['-105']===0));
});
test('missing threshold and missing measurements remain distinct from a genuine zero',()=>{
 const f=findings([cell('zero',0,0),cell('null',25,0,[row(null,{belowPct:{'-105':null,'-110':null}})]),cell('empty',50,0,[])]);
 assert.equal(f.analysisTargets.length,2);assert.equal(f.mdtCoverage.inRangePots,3);assert.equal(f.mdtCoverage.measuredPots,2);assert.equal(f.mdtCoverage.missingPots,1);
 assert.equal(f.modelTargets.find(t=>f.analysisTargets.find(p=>p.id===t.id).mapPoints[0].pot==='null').metrics.belowPct['-105'],null);
});
test('adjacency only joins equal date band and EARFCN, once per undirected 25m neighbour pair',()=>{
 const f=findings([cell('selected',0,0,[row(11.16)]),cell('north',0,25,[row(22.73),row(99,{date:'2026-11-04'}),row(99,{earfcn:'999'})]),cell('far',0,150,[row(90)])]);
 const selected=f.analysisTargets.find(t=>t.mapPoints[0].pot==='selected').id;
 const north=f.analysisTargets.find(t=>t.mapPoints[0].pot==='north'&&t.sourceDates[0]==='2026-11-03'&&t.earfcn==='3743').id;
 assert.deepEqual(f.neighbourLinks,[[selected,north,'북쪽',25]]);
});
test('many MDT targets share category-specific SOPs without exceeding the protocol limit',()=>{
 const f=findings(Array.from({length:80},(_,i)=>cell('POT'+i,(i%10)*10,Math.floor(i/10)*10,[row(i%40)])));
 const sop=selectCandidateSop({candidate,comparison:{status:'unavailable'},coverage:{radioCalls:0,rtpCalls:0},summary:{dropCalls:0},analysisTargets:f.analysisTargets});
 assert(sop.templates.length<=20);
 for(const category of ['coverage']){
  const s=sop.templates.find(x=>x.causeCategory===category);assert(s);assert.equal(s.targetKind,'radio');assert(s.checkNow.length&&s.conditionalActions.length);
  assert(f.analysisTargets.every(t=>t.sopIds.includes(s.id)));assert(s.evidenceIds.every(id=>f.facts.some(fact=>fact.id===id)));
 }
 assert(f.analysisTargets.every(t=>t.allowedCauseCategories.includes('coverage')));
 assert(f.analysisTargets.every(t=>!t.allowedCauseCategories.includes('interference')),'RSRP tails alone do not authorize a Pollution/independent interference cause');
});

const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createCandidateFixture}=require('./qwen-candidate-fixture.cjs');
const {collectCandidateEvidence}=require('../qwen-candidate-evidence.cjs');
function integratedFixture(t,records){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'candidate-selected-input-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const f=createCandidateFixture(root);
 const grid={analysisSchemaVersion:'mdt-grid-analysis-v1',records};
 f.write('quality-improvement/mdt-grid-analysis-v1.json',grid);
 f.write('quality-improvement/mdt-grid-25m-v1.json',{records:records.map(({analysis:_analysis,...display})=>display)});
 return f;
}
test('compact model adjacency resolves through evidence IDs without leaking POT or losing the target',t=>{
 const records=[{...cell('POT_PRIVATE_A',0,0,[row(11.16)]),lat:37.5,lon:127.05},{...cell('POT_PRIVATE_B',0,25,[row(22.73)]),lat:37.500225,lon:127.05}];
 const e=collectCandidateEvidence(integratedFixture(t,records));
 assert.equal(e.versions.prompt,'candidate-prompt-v8');
 assert.equal(e.sop.version,'candidate-sop-draft-v5');
 assert.equal(e.mdtCoverage.measuredPots,2);
 assert.equal(e.neighbourLinks.length,1);
 assert.deepEqual(e.modelInput.neighbourLinkColumns,['fromEvidenceId','toEvidenceId','direction','distanceM']);
 const [from,to,direction,distance]=e.modelInput.neighbourLinks[0];
 const fromTarget=e.analysisTargets.find(t=>t.evidenceIds.includes(from));
 const toTarget=e.analysisTargets.find(t=>t.evidenceIds.includes(to));
 assert.deepEqual(e.neighbourLinks[0],[fromTarget.id,toTarget.id,direction,distance]);
 assert(!JSON.stringify(e.modelInput).includes('POT_PRIVATE'));
 assert(e.analysisTargets.filter(t=>t.kind==='mdt-grid').every(t=>t.sopIds.includes('MDT_COVERAGE_REVIEW')));
 assert.equal(e.modelInput.targetRules['mdt-grid'].sopByCategory.coverage[0],'MDT_COVERAGE_REVIEW');
 assert.match(e.modelInput.targetRules['mdt-grid'].investigationHint.why,/RSRP 분포/);
 assert.match(e.modelInput.targetRules['mdt-grid'].investigationHint.check,/같은 날짜/);
 assert(e.analysisTargets.filter(t=>t.kind==='mdt-grid').every(t=>t.investigationHint));
 assert(e.modelInput.analysisTargets.filter(t=>t.kind==='mdt-grid').every(t=>!Object.hasOwn(t,'investigationHint')),'shared hints avoid retransmitting the same text for every MDT combination');
});
test('large complete candidates retain all server evidence and disclose the bounded Qwen detail subset',t=>{
 const records=Array.from({length:600},(_,i)=>({
  pot:'PRIVATE_'+i,x:(i%30)*25,y:Math.floor(i/30)*25,
  lat:37.5+Math.floor(i/30)*25/110900,lon:127.05+(i%30)*25/(111320*Math.cos(37.5*Math.PI/180)),
  analysis:['900','1.8협','1.8광','2.1'].map((band,j)=>row(i%30,{band,earfcn:String(3743+j)}))
 }));
 const f=integratedFixture(t,records);
 f.detail.candidate.displayRadiusM=1000;f.summary.candidates[0].displayRadiusM=1000;
 fs.writeFileSync(f.detailPath,JSON.stringify(f.detail));fs.writeFileSync(f.summaryPath,JSON.stringify(f.summary));
 const e=collectCandidateEvidence(f);
 assert.equal(e.mdtCoverage.measuredPots,600);assert.equal(e.analysisTargets.filter(t=>t.kind==='mdt-grid').length,2400);
 assert.equal(e.independentReview.reviewed.mdtTargets,2400);
 assert.equal(e.modelInput.analysisTargets.filter(t=>t.kind==='mdt-grid').length,80);assert.ok(JSON.stringify(e.modelInput).length<=160000);
 assert(e.modelInput.analysisTargets.some(t=>t.kind==='call-quality'),'call investigations survive MDT bounding');
 assert.equal(e.modelInput.modelReviewScope.omittedMdtCombinations,2320);
 assert.equal(e.transmission[0].available,2400);assert.equal(e.transmission[0].sent,80);
 assert.match(e.transmission[0].excluded.join(' '),/2320/);
 assert(!JSON.stringify(e.modelInput).includes('PRIVATE_'));
 const sentEvidence=new Set(e.modelInput.analysisTargets.flatMap(t=>t.evidenceIds));
 assert.ok(e.modelInput.facts.every(fact=>!/^T\d+$/.test(fact.id)||sentEvidence.has(fact.id)));
 assert.ok(e.modelInput.neighbourLinks.every(([from,to])=>sentEvidence.has(from)&&sentEvidence.has(to)));
});
