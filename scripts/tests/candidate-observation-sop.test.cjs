/* eslint-disable @typescript-eslint/no-require-imports -- Source-only targets must not become interventions. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {selectCandidateSop}=require('../qwen-candidate-sop.cjs');
test('observation-only call targets never receive a causal SOP or crowd out allowed procedures',()=>{
 const target=(id,kind)=>({id,kind,title:'실제 관측',observation:'조회할 통화',evidenceIds:['T'+id],sopIds:[],allowedCauseCategories:[],metrics:[],limitations:[]});
 const targets=[...Array.from({length:6},(_,i)=>target('Q'+i,'call-quality')),...Array.from({length:3},(_,i)=>target('P'+i,'call-pattern'))];
 const result=selectCandidateSop({candidate:{rangeReviewRequired:false,validationDates:[]},comparison:{status:'unavailable'},coverage:{radioCalls:0,rtpCalls:0},summary:{dropCalls:0},analysisTargets:targets});
 assert(result.templates.every(sop=>!sop.id.startsWith('TG_')));
 assert.deepEqual(result.templates.map(sop=>sop.id),['COMPARISON_CHECK','TIMING_ALIGNMENT','POST_CHANGE_CHECK']);
});
