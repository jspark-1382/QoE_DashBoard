/* eslint-disable @typescript-eslint/no-require-imports -- Uses the repository CommonJS TypeScript test loader. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../analyst-ts-loader.cjs');
const { getCandidateSourceCauseAssessments } = load('lib/analyst/candidate-ai-selections.ts');
const target = (id, criteria) => ({ id, criteria, mapPoints: [], callIds: [], evidenceIds: [], sopIds: [] });
function savedRun(targets) {
 const key = {coverage:'dl',uplink:'ul',interference:'pollution'};
 const categories = [...Object.keys(key),'equipment'];
 const analysisTargets = targets.map(t => ({ ...t, evidenceIds:[t.id+'-fact'],
   allowedCauseCategories:categories.filter(c => t.criteria?.[key[c]]?.status === 'matched') }));
 const causeAssessments = categories.map(category => {
   const linked = analysisTargets.filter(t => t.allowedCauseCategories.includes(category));
   return {category,status:linked.length?'criteria-met':'insufficient',reason:category+' 원본 조사',nextCheck:'원본 측정 대조',
     missingEvidence:[],targetIds:linked.map(t=>t.id),evidenceIds:linked.flatMap(t=>t.evidenceIds)};
 });
 return {evidence:{versions:{evidence:'candidate-evidence-v6'},analysisTargets,causeAssessments,facts:analysisTargets.map(t=>({id:t.evidenceIds[0]}))}};
}
test('saved historical DL and UL rows keep their actual matched sources', () => {
 const job = savedRun([target('ul-only', {dl:{status:'not-matched'},ul:{status:'matched'}}),target('dl-only',{dl:{status:'matched'},ul:{status:'insufficient'}})]);
 const rows = getCandidateSourceCauseAssessments(job);
 assert.deepEqual(rows.map(row => row.category), ['coverage','uplink','interference','equipment']);
 assert.deepEqual(rows[0].targetIds,['dl-only']); assert.deepEqual(rows[1].targetIds,['ul-only']);
 assert.equal(rows[2].status,'insufficient'); assert.equal(rows[2].targets.length,0);
});
test('missing legacy criteria never create matched evidence', () => {
 const rows = getCandidateSourceCauseAssessments({ evidence: { versions: {}, analysisTargets:[target('unknown', undefined)] } });
 assert.deepEqual(rows, []);
});

test('shared cause selection follows priority targets and clears empty cause targets', () => {
 const { getCandidateCauseSelection } = load('lib/analyst/candidate-ai-selections.ts');
 const job = savedRun([target('dl',{dl:{status:'matched'}}),target('ul',{ul:{status:'matched'}}),target('pollution',{pollution:{status:'matched'}})]);
 assert.deepEqual(getCandidateCauseSelection(job, 'coverage', 'ul'), {category:'uplink',targetId:'ul'});
 assert.deepEqual(getCandidateCauseSelection(job, 'uplink', 'pollution'), {category:'interference',targetId:'pollution'});
 assert.deepEqual(getCandidateCauseSelection(job, 'equipment', ''), {category:'equipment',targetId:''});
 assert.deepEqual(getCandidateCauseSelection(job), {category:'coverage',targetId:'dl'});
});

test('a priority target shared by DL and UL preserves the selected UL cause', () => {
 const { getCandidateCauseSelection } = load('lib/analyst/candidate-ai-selections.ts');
 const job = savedRun([target('shared',{dl:{status:'matched'},ul:{status:'matched'}})]);
 assert.deepEqual(getCandidateCauseSelection(job, 'uplink', 'shared'), {category:'uplink',targetId:'shared'});
});

test('coverage presentation balances five proven grids and five calls without mutating stored rows', () => {
 const { getBalancedCandidateCoverageTargets } = load('lib/analyst/candidate-ai-selections.ts');
 const grids = Array.from({length:7},(_,i)=>({...target('grid'+i,{dl:{status:'matched'}}),kind:'mdt-grid',allowedCauseCategories:['coverage']}));
 const calls = Array.from({length:7},(_,i)=>({...target('call'+i,{dl:{status:'matched'}}),kind:'call-criteria',allowedCauseCategories:['coverage']}));
 const ulOnly = {...target('ul-only',{ul:{status:'matched'}}),kind:'mdt-grid',allowedCauseCategories:['uplink']};
 const wrongAllowed = {...target('wrong-category',{dl:{status:'matched'}}),kind:'mdt-grid',allowedCauseCategories:['uplink']};
 const source = [...calls,...grids,ulOnly,wrongAllowed]; const original = JSON.stringify(source);
 const balanced = getBalancedCandidateCoverageTargets(source,'coverage');
 assert.equal(balanced.length,10); assert.equal(balanced.filter(target=>target.kind==='mdt-grid').length,5);
 assert.equal(balanced[0].id,'grid0'); assert.ok(!balanced.some(target=>['ul-only','wrong-category'].includes(target.id)));
 assert.equal(JSON.stringify(source),original);
 assert.deepEqual(getBalancedCandidateCoverageTargets(source,'uplink').map(target=>target.id),['ul-only']);
});
