/* eslint-disable @typescript-eslint/no-require-imports -- Public projection only; full collection and validation remain server-owned. */
const {comparisonReading}=require('./qwen-candidate-comparison-reading.cjs');
function publicCandidateEvidence(evidence,report,modelInput=evidence.modelInput){
 const {modelInput:_modelInput,comparisonReading:storedReading,...publicEvidence}=evidence;
 const allTargets=evidence.analysisTargets??[],allFacts=evidence.facts??[],allLinks=evidence.neighbourLinks??[];
 const modelTargets=modelInput?.analysisTargets;
 const targetIds=new Set([
  ...(evidence.coveragePoints?.points??[]).flatMap(point=>[point.targetId,...point.comparisons.map(row=>row.targetId)]),
  ...[evidence.coverageComparison?.primaryTargetId,evidence.coverageComparison?.comparisonTargetId,evidence.coverageComparison?.otherBandTargetId].filter(Boolean),
  ...(Array.isArray(modelTargets)?modelTargets:allTargets).map(target=>target.id),
  ...(evidence.independentReview?.priorities??[]).flatMap(priority=>priority.targetIds??[]),
  ...(evidence.causeAssessments??[]).flatMap(assessment=>assessment.targetIds??[]),
  ...(report?.hypotheses??[]).flatMap(hypothesis=>hypothesis.targetIds??[]),
  ...(report?.investigations??[]).flatMap(item=>item.targetIds??[]),
 ]);
 // Preserve every immediate measured peer of each survey POT, including peers
 // with worse signal than the survey POT. These source links already match
 // measurement date, band and EARFCN. Only expand from the original shortlist.
 const surveyIds=new Set(evidence.coveragePoints?.points.map(point=>point.targetId));
 for(const [first,second,,distanceM] of allLinks){
  if(distanceM!==25)continue;
  if(surveyIds.has(first))targetIds.add(second);
  if(surveyIds.has(second))targetIds.add(first);
 }
 const analysisTargets=allTargets.filter(target=>targetIds.has(target.id));
 const factIds=new Set([
  ...allFacts.filter(fact=>/^E\d+$/.test(fact.id)).map(fact=>fact.id),
  ...analysisTargets.flatMap(target=>target.evidenceIds??[]),
  ...(evidence.independentReview?.priorities??[]).flatMap(priority=>priority.evidenceIds??[]),
  ...(evidence.causeAssessments??[]).flatMap(assessment=>assessment.evidenceIds??[]),
  ...(report?.observations??[]).flatMap(row=>row.evidenceIds??[]),
  ...(report?.hypotheses??[]).flatMap(row=>row.supportingEvidenceIds??[]),
  ...(report?.checks??[]).flatMap(row=>row.evidenceIds??[]),
  ...(report?.investigations??[]).flatMap(row=>row.evidenceIds??[]),
  ...(report?.sop??[]).flatMap(row=>row.evidenceIds??[]),
 ]);
 const facts=allFacts.filter(fact=>factIds.has(fact.id));
 const neighbourLinks=allLinks.filter(link=>Array.isArray(link)&&targetIds.has(link[0])&&targetIds.has(link[1]));
 const prior=evidence.publicCoverage;
 const reviewedTargets=prior?.reviewedTargets??allTargets.length;
 const reading=evidence.versions?.prompt==='candidate-prompt-v11' ? comparisonReading(report?.comparison,modelInput?.comparisonContext,new Set(facts.map(fact=>fact.id)),storedReading) : undefined;
 return {...publicEvidence,analysisTargets,facts,neighbourLinks,...(reading?{comparisonReading:reading}:{}),
  calls:(evidence.calls??[]).map(({radioSeries:_radioSeries,...call})=>call),
  sop:evidence.sop?{...evidence.sop,templates:evidence.sop.templates.map(template=>({...template,evidenceIds:template.evidenceIds.filter(id=>factIds.has(id))}))}:evidence.sop,
  publicCoverage:{schemaVersion:'candidate-public-coverage-v1',policy:'sent-priority-report-v1',reviewedTargets,detailedTargets:analysisTargets.length,omittedTargets:Math.max(0,reviewedTargets-analysisTargets.length),modelSentTargets:Array.isArray(modelTargets)?modelTargets.length:prior?.modelSentTargets??analysisTargets.length,totalFacts:prior?.totalFacts??allFacts.length,detailedFacts:facts.length,totalNeighbourLinks:prior?.totalNeighbourLinks??allLinks.length,detailedNeighbourLinks:neighbourLinks.length,radioSeriesIncluded:false},
 };
}
module.exports={publicCandidateEvidence};
