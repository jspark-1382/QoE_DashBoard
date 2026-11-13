/* eslint-disable @typescript-eslint/no-require-imports -- A source link catalog is not a generated model verdict. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildSourceHypothesisCandidates,buildSourceInvestigationCandidates}=require('../qwen-candidate-cause-assessment.cjs');
test('cause link catalog keeps actual per-target DL and UL support, aliases and matching procedures',()=>{
 const model={targetIdPolicy:'evidence-id-alias-v1',analysisTargets:[{id:'CRITERIA_a',kind:'call-criteria',evidenceIds:['T01'],allowedCauseCategories:['coverage'],sopIds:['RULE_COVERAGE_REVIEW'],metrics:{criteria:{dl:{status:'not-matched'},ul:{status:'matched'},pollution:{status:'not-matched'}}}},{id:'CRITERIA_b',kind:'call-criteria',evidenceIds:['T02'],allowedCauseCategories:['coverage','mobility','interference'],sopIds:['RULE_COVERAGE_REVIEW','RULE_MOBILITY_REVIEW','RULE_INTERFERENCE_REVIEW'],metrics:{criteria:{dl:{status:'matched'},ul:{status:'not-matched'},pollution:{status:'matched'}}}}],sop:{templates:['coverage','interference','mobility'].map(category=>({id:'RULE_'+category.toUpperCase()+'_REVIEW',causeCategory:category}))}};
 const rows=buildSourceHypothesisCandidates(model),coverage=rows.find(row=>row.category==='coverage');
 assert.deepEqual(coverage.targetIds,['T01']);assert.deepEqual(coverage.evidenceIds,['T01']);assert.deepEqual(coverage.sopIds,['RULE_COVERAGE_REVIEW']);
 assert.equal(coverage.criteriaByEvidenceId.T01.dlStatus,'not-matched');assert.equal(coverage.criteriaByEvidenceId.T01.ulStatus,'matched');
 assert.deepEqual(rows.find(row=>row.category==='mobility').targetIds,['T02']);assert(!rows.some(row=>row.category==='capacity'));
 const absent=structuredClone(model);absent.sop.templates=[];assert.deepEqual(buildSourceHypothesisCandidates(absent),[]);
});
test('source investigation links never mix background POTs with independent call observations',()=>{
 const targets=[{id:'C',kind:'call-criteria',evidenceIds:['T01'],metrics:{criteria:{pollution:{status:'matched'}}}},{id:'G',kind:'mdt-grid',band:'900',earfcn:'3743',sourceDates:['2026-11-03'],evidenceIds:['T02']},{id:'Q',kind:'call-quality',evidenceIds:['T03']}];
 const rows=buildSourceInvestigationCandidates({targetIdPolicy:'evidence-id-alias-v1',analysisTargets:targets,observationGroups:[{targetIds:['G']}]});
 assert.deepEqual(rows.map(row=>row.kind),['mdt-grid','call-criteria','call-quality']);
 for(const row of rows)assert.deepEqual(row.targetIds,row.evidenceIds);
});
test('background MDT source groups stay separate from actual call criteria and catalog targets are bounded',()=>{
 const targets=Array.from({length:7},(_,i)=>({id:'CRITERIA_'+i,kind:'call-criteria',evidenceIds:['T'+i],allowedCauseCategories:['coverage'],sopIds:['RULE_COVERAGE_REVIEW'],metrics:{criteria:{dl:{status:'matched'}}}}));
 const model={targetIdPolicy:'evidence-id-alias-v1',analysisTargets:[...targets,{id:'MDT_a',kind:'mdt-grid',evidenceIds:['T99'],metrics:{belowPct:{'-100':40}}}],targetRules:{'mdt-grid':{allowedCauseCategories:['coverage'],sopByCategory:{coverage:['MDT_COVERAGE_REVIEW']}}},sop:{templates:[{id:'RULE_COVERAGE_REVIEW',causeCategory:'coverage'},{id:'MDT_COVERAGE_REVIEW',causeCategory:'coverage'}]}};
 const coverage=buildSourceHypothesisCandidates(model).find(row=>row.category==='coverage');assert.deepEqual(coverage.targetIds,['T99']);assert.equal(coverage.sourceKind,'mdt-grid');
});
