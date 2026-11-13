/* eslint-disable @typescript-eslint/no-require-imports -- Explicit model review scope. */
const BASIS='서버는 전체 MDT 조합을 검토합니다. Qwen에는 규칙 검토의 우선 POT·인접 비교, 날짜·대역·EARFCN별 대표 관측과 측정 가중치를 고려한 RSRP 꼬리 순서로 최대 80개 조합을 전달합니다. 제외된 관측은 정상으로 판정하지 않습니다.';
function boundCandidateModelInput(modelInput,findings,maxCharacters=160000,gridLimit=80){
 const targets=modelInput.analysisTargets??[],grids=targets.filter(target=>target.kind==='mdt-grid');
 const fullScope={mode:'all-targets',fullScopeReviewed:true,availableMdtCombinations:grids.length,includedMdtCombinations:grids.length,omittedMdtCombinations:0,selectionBasis:'전체 분석 대상의 상세 관측을 Qwen에 전달했습니다.'};
 const complete={...modelInput,modelReviewScope:fullScope};
 if(grids.length<=gridLimit&&JSON.stringify(complete).length<=maxCharacters)return {modelInput:complete,transmission:modelInput.transmission};
 const publicTargets=new Map(findings.analysisTargets.map(target=>[target.id,target]));
 const byId=new Map(grids.map(target=>[target.id,target]));
 const evidenceToTarget=new Map(grids.flatMap(target=>target.evidenceIds.map(id=>[id,target.id])));
 const comparisonIds=(modelInput.comparisonContext?.gridComparisons??[]).flatMap(row=>row.evidenceIds.map(ref=>evidenceToTarget.get(ref)));
 const fieldIds=[...new Set([...(modelInput.coveragePointTargetIds??[]),...(modelInput.coveragePairTargetIds??[]),...comparisonIds].filter(id=>byId.has(id)))];
 // Calculated contrasts must retain all cited neighbours even under a tight budget.
 const targetLimit=Math.max(gridLimit,fieldIds.length);
 const selected=new Set(),add=id=>{if(selected.size<targetLimit&&byId.has(id))selected.add(id);};
 const priorityIds=[...fieldIds,...(modelInput.causeAssessments??[]).flatMap(item=>item.targetIds),...(findings.independentReview?.priorities??[]).flatMap(item=>item.targetIds),...(modelInput.observationGroups??[]).flatMap(group=>[...group.targetIds,...group.comparisonTargetIds])];
 for(const id of priorityIds)add(id);
 const priorityEvidence=new Set(priorityIds.flatMap(id=>byId.get(id)?.evidenceIds??[]));
 for(const [a,b] of modelInput.neighbourLinks??[]){
  if(priorityEvidence.has(a))add(evidenceToTarget.get(b));
  if(priorityEvidence.has(b))add(evidenceToTarget.get(a));
 }
 const rank=target=>{
  const m=target.metrics??{},weight=m.metricSamples?.['-100']??m.metricSamples?.['-105']??m.samples??0;
  return (['-100','-105','-110'].reduce((sum,key)=>sum+(typeof m.belowPct?.[key]==='number'?m.belowPct[key]:0),0)+(m.criteria?.ul?.status==='matched'?30:0))*Math.min(1,weight/30);
 };
 const ranked=[...grids].sort((a,b)=>rank(b)-rank(a)||(b.metrics?.samples??0)-(a.metrics?.samples??0)||a.id.localeCompare(b.id));
 const strata=new Set();
 for(const target of ranked){
  const key=JSON.stringify([target.sourceDates,target.band,target.earfcn]);
  if(!strata.has(key)){strata.add(key);add(target.id);}
 }
 // One ranked combination per POT broadens spatial review before more bands
 // from an already represented POT consume the remaining detailed input.
 const pots=new Set([...selected].map(id=>publicTargets.get(id)?.mapPoints?.[0]?.pot??id));
 for(const target of ranked){
  const pot=publicTargets.get(target.id)?.mapPoints?.[0]?.pot??target.id;
  if(!pots.has(pot)){pots.add(pot);add(target.id);}
 }
 for(const target of ranked)add(target.id);
 const included=targets.filter(target=>target.kind!=='mdt-grid'||selected.has(target.id));
 const includedEvidence=new Set(included.flatMap(target=>target.evidenceIds));
 const includedIds=new Set(included.map(target=>target.id));
 const causeAssessments=(modelInput.causeAssessments??[]).map(row=>{
  const targetIds=row.targetIds.filter(id=>includedIds.has(id)),evidenceIds=row.evidenceIds.filter(id=>includedEvidence.has(id)||/^E\d+$/.test(id)&&modelInput.facts?.some(fact=>fact.id===id));
  const omittedTargets=row.targetIds.length-targetIds.length;
  return {...row,targetIds,evidenceIds,...(omittedTargets?{sourceTargetsOmitted:omittedTargets,missingEvidence:[...row.missingEvidence,'서버에서 검토한 일부 근거의 상세가 모델 전송 범위에서 제외되었습니다. 전송한 대상만 가설에 연결합니다.']}:{}),...(row.targetIds.length&&!targetIds.length?{status:'insufficient',reason:'서버 원본 평가는 있으나 해당 분류의 상세 대상이 모델 전송 범위에 없어 모델은 원인을 선정하지 않습니다.'}:{})};
 });
 const omitted=grids.length-selected.size;
 const scope={mode:'prioritized-targets',fullScopeReviewed:true,availableMdtCombinations:grids.length,includedMdtCombinations:selected.size,omittedMdtCombinations:omitted,selectionBasis:BASIS};
 const transmission=(modelInput.transmission??[]).map(row=>row.label==='배경 MDT 분석 대상'?{...row,sent:selected.size,excluded:[...(row.excluded??[]),'전체 서버 검토 '+grids.length+'개 조합 중 Qwen 상세 전달에서 제외 '+omitted+'개 조합. '+BASIS]}:row);
 const bounded={transmission,modelInput:{...modelInput,analysisTargets:included,...(modelInput.causeAssessments?{causeAssessments}:{}),
  observationGroups:(modelInput.observationGroups??[]).filter(group=>[...group.targetIds,...group.comparisonTargetIds].every(id=>selected.has(id))),
  facts:(modelInput.facts??[]).filter(fact=>!/^T\d+$/.test(fact.id)||includedEvidence.has(fact.id)),
  neighbourLinks:(modelInput.neighbourLinks??[]).filter(([a,b])=>includedEvidence.has(a)&&includedEvidence.has(b)),
  mdtCoverage:{...modelInput.mdtCoverage,serverReviewedCombinations:grids.length,includedCombinations:selected.size},
  transmission,modelReviewScope:scope,limitations:[...(modelInput.limitations??[]),BASIS]
 }};
 // Keep every sampled call and the paired field targets. Reduce only the
 // explicitly disclosed grid selection if verbose call windows need room.
 const used=JSON.stringify(bounded.modelInput).length;
 const minimum=Math.min(grids.length,Math.max(1,fieldIds.length));
 if(used>maxCharacters&&selected.size>minimum){
  const average=JSON.stringify(included.filter(t=>t.kind==='mdt-grid')).length/selected.size;
  const next=Math.max(minimum,selected.size-Math.ceil((used-maxCharacters)/average));
  return boundCandidateModelInput(modelInput,findings,maxCharacters,next);
 }
 return bounded;
}
module.exports={boundCandidateModelInput};
