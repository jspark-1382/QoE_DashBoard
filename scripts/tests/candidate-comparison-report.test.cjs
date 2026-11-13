/* eslint-disable @typescript-eslint/no-require-imports -- Test Qwen output against original input scopes. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateComparison}=require('../qwen-candidate-comparison.cjs');

function example(){
 const grid={category:'coverage',survey:{evidenceId:'T10'},evidenceIds:['T10','T197','T220']};
 const call={category:'equipment',evidenceIds:['T09']};
 const targets=[grid,call].flatMap(row=>row.evidenceIds.map(ref=>({
  id:'target_'+ref,evidenceIds:[ref],allowedCauseCategories:[row.category],
 })));
 const facts=targets.map(t=>({id:t.evidenceIds[0]}));
 return {
  card:{schemaVersion:'cause-comparison-v1',assessment:'prioritize',primary:{category:'coverage',evidenceIds:[...grid.evidenceIds]},alternative:structuredClone(call),
   interpretation:'인접 격자보다 약전계가 집중돼 현장의 신호 분포를 먼저 볼 만합니다. RTP 중단은 통화가 끊긴 현상을 뒷받침합니다.',
   limitation:'격자 측정일이 달라 끊긴 통화가 그 지점을 지났는지 알 수 없습니다.',
   nextCheck:'같은 경로에서 약한 신호가 반복되는지 확인하고 음성이 끊긴 통화에서 신호가 유지되면 수신 경로를 점검합니다.'},
  evidence:{analysisTargets:targets,facts,modelInput:{analysisTargets:targets,facts,comparisonContext:{
   schemaVersion:'candidate-comparison-input-v1',gridComparisons:[grid],callObservations:[call],
  }}}
 };
}
test('spatial and call-based evidence may be weighed or explicitly left unresolved',()=>{
 const {card,evidence}=example();
 validateComparison(card,evidence);
 validateComparison({...card,assessment:'unresolved'},evidence);
 const ctx=evidence.modelInput.comparisonContext;
 ctx.callObservations=[];
 assert.throws(()=>validateComparison(card,evidence));
 validateComparison({...card,alternative:null,assessment:'unresolved'},evidence);
 assert.throws(()=>validateComparison({...card,alternative:null},evidence));
 ctx.gridComparisons=[];
 validateComparison(null,evidence);
 assert.throws(()=>validateComparison(card,evidence));
});
test('a uniquely cited survey expands to its measured neighbors without changing the prose or raw model references',()=>{
 const {card,evidence}=example();
 card.primary.evidenceIds=['T10'];
 const added=[];
 const linked=validateComparison(card,evidence,{onExpansion:entry=>added.push(entry)});
 assert.deepEqual(added,[{side:'primary',surveyEvidenceId:'T10',addedEvidenceIds:['T197','T220']}]);
 assert.deepEqual(linked.primary.evidenceIds,['T10','T197','T220']);
 assert.equal(linked.interpretation,card.interpretation);
 assert.deepEqual(card.primary.evidenceIds,['T10']);
 card.primary.evidenceIds=['T197'];
 assert.throws(()=>validateComparison(card,evidence));
 card.primary.evidenceIds=['T10'];
 evidence.modelInput.comparisonContext.gridComparisons.push({...evidence.modelInput.comparisonContext.gridComparisons[0],evidenceIds:['T10','T197']});
 assert.throws(()=>validateComparison(card,evidence));
});
test('comparison cannot conflate evidence scopes, insert an unrelated comparator, or borrow a numeric observation',()=>{
 for(const change of [
  card=>card.primary.evidenceIds.pop(),
  card=>card.primary.evidenceIds.push('T09'),
  card=>card.alternative.evidenceIds=['T996'],
  card=>card.alternative.category='coverage',
  card=>card.alternative.evidenceIds=['T220'],
  card=>card.primary.evidenceIds=['T197','T197','T10'],
  card=>card.interpretation+=' RSRP가 -40dBm 입니다.',
  card=>card.limitation+=' 근거 T09 참조.',
  card=>card.nextCheck+=' https://example.test',
  card=>card.nextCheck=card.limitation,
 ]){
  const {card,evidence}=example();
  change(card);
  assert.throws(()=>validateComparison(card,evidence),e=>e.code==='QWEN_INVALID_COMPARISON');
 }
 const {card,evidence}=example();
 evidence.modelInput.analysisTargets=evidence.modelInput.analysisTargets.slice(1);
 assert.throws(()=>validateComparison(card,evidence),e=>e.code==='QWEN_INVALID_COMPARISON');
});
