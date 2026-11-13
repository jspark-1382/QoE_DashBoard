/* eslint-disable @typescript-eslint/no-require-imports -- Full evidence review and model input budgeting. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {boundCandidateModelInput}=require('../qwen-candidate-model-scope.cjs');

test('large scopes retain full server review and transmit a disclosed shortlist with comparison neighbours',()=>{
 const targets=Array.from({length:220},(_,i)=>({id:'MDT_'+i,kind:'mdt-grid',sourceDates:['2026-11-03'],band:i%2?'900':'2100',earfcn:i%2?'3743':'101',evidenceIds:['T'+i],metrics:{samples:100,belowPct:{'-105':i===219?70:0}},extra:'x'.repeat(900)}));
 const input={analysisTargets:targets,facts:[{id:'E01'},...targets.map(t=>({id:t.evidenceIds[0]}))],neighbourLinks:[['T219','T218','동쪽',25],['T1','T2','북쪽',25]],transmission:[{label:'배경 MDT 분석 대상',available:220,sent:220,excluded:[]}],mdtCoverage:{measuredPots:220,includedCombinations:220},limitations:[]};
 const findings={analysisTargets:targets.map((t,i)=>({...t,mapPoints:[{pot:'POT_'+i}]})),independentReview:{priorities:[{targetIds:['MDT_219']}]}},before=JSON.stringify(input);
 const bounded=boundCandidateModelInput(input,findings);
 assert.equal(JSON.stringify(input),before,'the complete source evidence remains available');
 assert.equal(bounded.modelInput.analysisTargets.length,80);assert.ok(JSON.stringify(bounded.modelInput).length<=160000);
 assert.ok(bounded.modelInput.analysisTargets.some(t=>t.id==='MDT_219'));
 assert.ok(bounded.modelInput.analysisTargets.some(t=>t.id==='MDT_218'),'same-scope zero-tail neighbour remains a comparison');
 assert.deepEqual(bounded.modelInput.modelReviewScope,{mode:'prioritized-targets',fullScopeReviewed:true,availableMdtCombinations:220,includedMdtCombinations:80,omittedMdtCombinations:140,selectionBasis:'서버는 전체 MDT 조합을 검토합니다. Qwen에는 규칙 검토의 우선 POT·인접 비교, 날짜·대역·EARFCN별 대표 관측과 측정 가중치를 고려한 RSRP 꼬리 순서로 최대 80개 조합을 전달합니다. 제외된 관측은 정상으로 판정하지 않습니다.'});
 assert.equal(bounded.transmission[0].available,220);assert.equal(bounded.transmission[0].sent,80);assert.match(bounded.transmission[0].excluded.join(' '),/140/);
 const ids=new Set(bounded.modelInput.analysisTargets.flatMap(t=>t.evidenceIds));
 assert.ok(bounded.modelInput.facts.every(f=>f.id==='E01'||ids.has(f.id)));
 assert.ok(bounded.modelInput.neighbourLinks.every(([a,b])=>ids.has(a)&&ids.has(b)));
});

test('small evidence scopes keep every model target and state that no target was omitted',()=>{
 const target={id:'MDT_a',kind:'mdt-grid',evidenceIds:['T01']};
 const input={analysisTargets:[target],facts:[{id:'T01'}],neighbourLinks:[],transmission:[],limitations:[]};
 const result=boundCandidateModelInput(input,{analysisTargets:[target],independentReview:{priorities:[]}});
 assert.deepEqual(result.modelInput.analysisTargets,[target]);assert.equal(result.modelInput.modelReviewScope.mode,'all-targets');
 assert.equal(result.modelInput.modelReviewScope.omittedMdtCombinations,0);
});

test('five-cause source priorities are actually transmitted and model assessment references remain in scope',()=>{
 const targets=Array.from({length:220},(_,i)=>({id:'MDT_'+i,kind:'mdt-grid',sourceDates:['2026-11-03'],band:'900',earfcn:'3743',evidenceIds:['T'+i],metrics:{samples:50,belowPct:{'-100':0}}}));
 const input={analysisTargets:targets,facts:targets.map(row=>({id:row.evidenceIds[0]})),causeAssessments:[{category:'coverage',status:'criteria-met',targetIds:['MDT_219'],evidenceIds:['T219'],missingEvidence:[]}],transmission:[],limitations:[]};
 const result=boundCandidateModelInput(input,{analysisTargets:targets,independentReview:{priorities:[]}}).modelInput;
 assert(result.analysisTargets.some(row=>row.id==='MDT_219'));
 const ids=new Set(result.analysisTargets.map(row=>row.id)),facts=new Set(result.facts.map(row=>row.id));
 assert(result.causeAssessments.every(row=>row.targetIds.every(id=>ids.has(id))&&row.evidenceIds.every(id=>facts.has(id))));
});
