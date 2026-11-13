import {analysisRequest,isAnalysisActive,AnalysisClientError,type AnalysisScope,type AnalysisStatus,type AnalysisCall,type AnalysisFact} from './customer-ai-analysis';
import type {QualityCandidateSummary} from './quality-improvement-candidates';
import type {QualityModelId} from './quality-model-alternatives';

export type CandidateAnalysisTarget={
 kind:'candidate';candidateId:string;sourceRevision:string;scope:AnalysisScope;
 candidateScope:{scopeKey:string;policy:string;analysisMode:'all'|'evaluation';locationMode:string;modelId:QualityModelId};
};
export type CandidatePromptDraft={system:string;user:string};
export type CandidatePromptDraftResponse=CandidatePromptDraft&{target:CandidateAnalysisTarget;fingerprint:string};
export const CANDIDATE_PROMPT_LIMITS={system:32000,user:200000} as const;
export const fetchCandidatePromptDraft=(target:CandidateAnalysisTarget,fetcher=fetch,init:RequestInit={})=>analysisRequest<CandidatePromptDraftResponse>('/candidate-prompt',{...init,method:'POST',body:JSON.stringify(target)},fetcher);
export type CandidateCauseCategory='capacity'|'interference'|'coverage'|'uplink'|'mobility'|'equipment';
export type CandidateCauseAssessment={category:CandidateCauseCategory;headline?:string;status:'criteria-met'|'possible'|'insufficient';reason:string;nextCheck:string;missingEvidence:string[];targetIds:string[];evidenceIds:string[]};
export type CandidateEvidenceTarget={
 allowedCauseCategories?:CandidateCauseCategory[];
 id:string;kind:'mdt-grid'|'termination-group'|'call-radio'|'call-quality'|'call-pattern'|'call-criteria';title:string;observation:string;
 sourceDates:string[];band:string|null;earfcn:string|null;
 metrics:{label:string;value:number|string|null;unit?:string}[];
 evidenceIds:string[];sopIds:string[];callIds:string[];
 mapPoints:{pot:string;lat:number;lon:number;band:string;date:string}[];limitations:string[];
 investigationHint?:{why:string;check:string};
 criteria?:Record<string,unknown>;
};
export type CandidateTransmissionEntry={label:string;available:number|null;sent:number|null;fields:string[];excluded:string[]};
export type CandidateReferenceResolution={policy:'selected-target-evidence-v1';comparisonExpansions?:{side:'primary'|'alternative';surveyEvidenceId:string;addedEvidenceIds:string[]}[];addedEvidence:{hypothesis?:number;investigation?:number;targetId:string;evidenceId:string}[];targetAliases?:{scope:'investigation'|'hypothesis';index:number;providedId:string;targetId:string}[]};
export type CandidateCoverageMetric = {kind:'dl-rsrp';thresholdDbm:number;percent:number} | {kind:'ul-phr';mean:number};
export type CandidateCoveragePoint = {
 rank: number;
 targetId: string;
 pot: string;
 sourceDate: string;
 band: string;
 earfcn: string;
 areaSize: number;
 reason: string;
 metric?: CandidateCoverageMetric;
 comparisons: {kind:'adjacent-same-carrier'|'same-pot-other-band';targetId:string;distanceM:number}[];
};
export type CandidateCoveragePoints = {
 bandSummaries?: {
   sourceDate:string; band:string; earfcn:string; validPots:number; weakPots:number;
   sourceWeight:number; weakPercent:number;
 }[];
 reviewedCombinations: number;
 qualifiedCombinations: number;
 qualifiedPotCount: number;
 areaCount: number;
 points: CandidateCoveragePoint[];
};
export type CandidateAnalysisDiagnostics={
 sectionOrigins?:{coreAttempt:number|null;comparisonAttempt:number|null};
 referenceResolution?:CandidateReferenceResolution;
 schemaVersion:'candidate-analysis-diagnostics-v1';status:'not-sent'|'captured'|'unavailable';
 request?:{capturedAt:string;model:string;messages:{role:string;content:string}[];parameters:Record<string,unknown>;redacted:boolean;hash:string};
 response?:{receivedAt:string;model:string|null;content:string|null;finishReason:string|null;usage:Record<string,unknown>|null};
 validation?:{status:'passed'|'partial'|'failed'|'pending';code?:string;message?:string};
 transmission:CandidateTransmissionEntry[];reused:boolean;
 attempts?:{attempt:number;phase?:'report'|'comparison';request?:CandidateAnalysisDiagnostics['request'];response?:CandidateAnalysisDiagnostics['response'];validation?:CandidateAnalysisDiagnostics['validation']}[];
};
export type CandidateSopTemplate={causeCategory?:CandidateCauseCategory;id:string;title:string;purpose:string;reason:string;materials:string[];method:string[];outcomes:string[];additionalData:string[];evidenceIds:string[];targetKind:'radio'|'rtp'|'drop'|'members';checkNow:string[];conditionalActions:{when:string;action:string}[];verifyAfter:string[]};
export type CandidateAnalysisReport={
 mode?:'comparison-only';
 comparison?:{schemaVersion:'cause-comparison-v1';assessment:'prioritize'|'unresolved';
   primary:{category:CandidateCauseCategory;evidenceIds:string[]};alternative:{category:CandidateCauseCategory;evidenceIds:string[]}|null;
   interpretation:string;limitation:string;nextCheck:string}|null;
 summary:{observed:string;priority:string;missing:string};
 investigations?:{title:string;reason:string;nextCheck:string;targetIds:string[];evidenceIds:string[]}[];
 observations:{text:string;evidenceIds:string[]}[];
 hypotheses:{category:CandidateCauseCategory;targetIds:string[];title:string;assessment:'supported'|'possible'|'insufficient';reason:string;supportingEvidenceIds:string[];missingEvidence:string;sopIds:string[]}[];
 checks:{action:string;reason:string;evidenceIds:string[]}[];
 limitations:string[];sop:{sopId:string;reason:string;evidenceIds:string[]}[];
};
export type CandidateAnalysisEvidence={
 comparisonReading?:{primary:{category:CandidateCauseCategory;evidenceIds:string[]};alternative:{category:CandidateCauseCategory;evidenceIds:string[]}|null;text:string};
 coveragePoints?:CandidateCoveragePoints;
 coverageComparison?:{primaryTargetId:string;comparisonTargetId:string;otherBandTargetId?:string;distanceM:number;sourceDate:string;band:string;earfcn:string;thresholdDbm:-105};
 neighbourLinks?:[string,string,string,number][];
 causeAssessments?:CandidateCauseAssessment[];
 publicCoverage?:{schemaVersion:'candidate-public-coverage-v1';policy:'sent-priority-report-v1';reviewedTargets:number;detailedTargets:number;omittedTargets:number;modelSentTargets:number;totalFacts:number;detailedFacts:number;totalNeighbourLinks:number;detailedNeighbourLinks:number;radioSeriesIncluded:false};
 independentReview?:{schemaVersion:'candidate-independent-review-v1';label:'근거 규칙 검토';method:string;reviewed:{mdtTargets:number;terminationTargets:number;radioTargets:number;prioritizedTargets:number;zeroTailTargets:number;sparseTargets:number};priorities:{id:string;category:'coverage'|'equipment';assessment:'possible';targetIds:string[];evidenceIds:string[];title:string;observation:string;nextCheck:string;limitations:string[]}[];limitations:string[]};
 schemaVersion:'qwen-candidate-evidence-v1'|'qwen-candidate-evidence-v2';analysisTargets:CandidateEvidenceTarget[];transmission:CandidateTransmissionEntry[];target:CandidateAnalysisTarget;sourceRevision:string;generatedAt:string;fingerprint:string;
 versions:{evidence:string;prompt:string;sop:string};
 candidate:{id:string;title:string;algorithm:string;parameters:Record<string,unknown>;scopeKey:string;locationMode:string;rangeReviewRequired:boolean;radiusM:number;maxPairDistanceM:number|null;discoveryDates:string[];validationDates:string[];memberSetHash:string};
 summary:{customers:number;totalCalls:number;evaluatedCalls:number;poorCalls:number;rawMosEvaluatedCalls:number;rawMosPoorCalls:number;meanQoe:number|null;meanMos:number|null;dropCalls:number;observedDays:number};
 byDay:{date:string;totalCalls:number;evaluatedCalls:number;poorCalls:number;dropCalls:number;customers?:number}[];
 byCell:{cell:string;totalCalls:number;evaluatedCalls:number;poorCalls:number;dropCalls:number;customers?:number}[];
 facts:AnalysisFact[];calls:AnalysisCall[];
 members:{id:string;customerLabel:string;date:string;start:string;qoe:number|null;mos:number|null;cell:string;locationEvidence:string;href:string}[];
 byHour:{hour:number;totalCalls:number;evaluatedCalls:number;poorCalls:number;dropCalls:number}[];
 coverage:{sampledCalls:number;radioCalls:number;rtpCalls:number;locationCalls:number;fullPopulation:boolean;detailsPolicy:string;matchedMdt?:{status:string;matchedCalls:number|null;measurementRows:number|null;validRows:number|null;excludedRows:number|null;description:string}};
 radio?:{sampledCalls:number;rsrpCalls:number;sinrCalls:number;meanRsrp:number|null;meanSinr:number|null;weighting:string;timingStatus:string};
 rtp?:{field:string;measuredCalls:number;mean:number|null;unit:string}[];
 comparison:{status:'unavailable'|'available';calls:number|null;conditions:string;limitations:string[]};
 location:{gpsCalls:number;roughCalls:number};
 mdtGrid:{status:string;measurementDates:string[];frequency:string;description:string};
 limitations:string[];sop:{version:string;templates:CandidateSopTemplate[]};
};
export type CandidateAnalysisJob={id:string;target:CandidateAnalysisTarget;status:AnalysisStatus;createdAt:string;updatedAt:string;model:string;currentConditionsMatch?:boolean;diagnosticsAvailable?:boolean;reused?:boolean;promptEdited?:boolean;promptHash?:string;referenceResolution?:CandidateReferenceResolution;attempt?:{attempt:number;status:'started'|'retrying'|'completed'|'failed';errorCode?:string};persistence?:{status:'saved'|'failed';savedAt?:string;message?:string};modelVerification?:{responseModel:string|null;responseModelVerified:boolean;durationMs:number};error?:{code:string;message:string};evidence?:CandidateAnalysisEvidence;report?:CandidateAnalysisReport};
/** Saved source-linked reports stay inspectable independently of reuse eligibility. */
export function isReadableCandidateAnalysisJob(job:CandidateAnalysisJob|null|undefined):boolean{
 if(job?.status!=='completed'||!job.evidence||!job.report)return false;
 const {evidence,report}=job;
 if(evidence.schemaVersion!=='qwen-candidate-evidence-v2'||!['candidate-sop-draft-v4','candidate-sop-draft-v5','candidate-sop-draft-v6','candidate-sop-draft-v7'].includes(evidence.versions?.sop)||evidence.sop?.version!==evidence.versions.sop)return false;
 if(!['candidate-evidence-v3','candidate-evidence-v4','candidate-evidence-v5','candidate-evidence-v6','candidate-evidence-v7'].includes(evidence.versions?.evidence)||!['candidate-prompt-v5','candidate-prompt-v6','candidate-prompt-v7','candidate-prompt-v8','candidate-prompt-v9','candidate-prompt-v10','candidate-prompt-v11'].includes(evidence.versions?.prompt))return false;
 const nonempty=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0;
 const strings=(value:unknown):value is string[]=>Array.isArray(value)&&value.length>0&&value.every(nonempty);
 const templates=evidence.sop.templates;
 if(!Array.isArray(templates)||templates.length>20||templates.some(row=>!row||!nonempty(row.id)||!['radio','rtp','drop','members'].includes(row.targetKind)||!strings(row.checkNow)||!strings(row.verifyAfter)||!Array.isArray(row.conditionalActions)||!row.conditionalActions.length||row.conditionalActions.some(action=>!action||!nonempty(action.when)||!nonempty(action.action))))return false;
 const allowed=new Set(templates.map(row=>row.id));
 if(allowed.size!==templates.length||!Array.isArray(report.hypotheses)||report.hypotheses.length>5||!Array.isArray(evidence.analysisTargets))return false;
 const linked=new Set<string>();
 for(const row of report.hypotheses){
  if(!row||!['capacity','interference','coverage','uplink','mobility','equipment'].includes(row.category)||!strings(row.targetIds)||row.targetIds.length>5||row.targetIds.some(id=>!evidence.analysisTargets.some(target=>target.id===id))||!strings(row.sopIds)||row.sopIds.length>5||new Set(row.sopIds).size!==row.sopIds.length||row.sopIds.some(id=>!allowed.has(id)))return false;
  const targets=row.targetIds.map(id=>evidence.analysisTargets.find(target=>target.id===id)!);
  if(evidence.versions.evidence==='candidate-evidence-v7' && row.category==='uplink')return false;
  if(targets.some(target=>target.allowedCauseCategories&&!target.allowedCauseCategories.includes(row.category)))return false;
  if(targets.some(target=>!Array.isArray(target.sopIds)||!target.sopIds.some(id=>row.sopIds.includes(id))))return false;
  const mdtTargets=targets.filter(target=>target.kind==='mdt-grid');
  if(row.category==='coverage'&&mdtTargets.length&&!mdtTargets.some(target=>{
   const criterion=(key:string)=>{const entry=target.criteria?.[key];return !!entry&&typeof entry==='object'&&'status' in entry&&entry.status==='matched';};
   return criterion('dl')||(evidence.versions.evidence!=='candidate-evidence-v6'&&criterion('ul'))||(target.metrics??[]).some(metric=>['RSRP ≤-105 dBm','RSRP ≤-110 dBm'].includes(metric.label)&&typeof metric.value==='number'&&Number.isFinite(metric.value)&&metric.value>0);
  }))return false;
  if(row.sopIds.some(id=>{const template=templates.find(item=>item.id===id);return !!template?.causeCategory&&template.causeCategory!==row.category;}))return false;
  for(const id of row.sopIds)linked.add(id);
 }
 const ordered=templates.filter(row=>linked.has(row.id)).map(row=>row.id);
 if(report.mode==='comparison-only'){
  const card=report.comparison;
  if(evidence.versions.prompt!=='candidate-prompt-v11'||!card||!job.modelVerification?.responseModelVerified||job.modelVerification.responseModel!==job.model||
    card.schemaVersion!=='cause-comparison-v1'||!['prioritize','unresolved'].includes(card.assessment)||!card.primary||
    (!card.alternative&&card.assessment!=='unresolved')||card.primary.category===card.alternative?.category||
    ![card.interpretation,card.limitation,card.nextCheck].every(nonempty)||
    report.summary?.observed!==card.interpretation||report.summary.priority!==card.nextCheck||report.summary.missing!==card.limitation||
    ![report.investigations,report.hypotheses,report.observations,report.checks,report.limitations,report.sop].every(rows=>Array.isArray(rows)&&!rows.length))return false;
  const facts=new Set((evidence.facts??[]).map(f=>f.id));
  for(const side of [card.primary,...(card.alternative?[card.alternative]:[])]){
   if(!strings(side.evidenceIds)||side.evidenceIds.length>12||new Set(side.evidenceIds).size!==side.evidenceIds.length||
    !side.evidenceIds.every(id=>facts.has(id)&&evidence.analysisTargets.some(t=>t.evidenceIds.includes(id)&&t.allowedCauseCategories?.includes(side.category))))return false;
  }
 }
 return Array.isArray(report.sop)&&report.sop.length===ordered.length&&report.sop.every((row,index)=>!!row&&row.sopId===ordered[index]);
}
/** Server-owned assessments retain the versioned category set and exact sources. */
export function areCandidateCauseAssessmentsValid(evidence:CandidateAnalysisEvidence|null|undefined):boolean{
 const rows=evidence?.causeAssessments,categories=evidence?.versions.evidence==='candidate-evidence-v6'?['coverage','uplink','interference','equipment']:['capacity','interference','coverage','mobility','equipment'];
 if(!Array.isArray(rows)||rows.length!==categories.length||new Set(rows.map(row=>row.category)).size!==categories.length||!Array.isArray(evidence?.analysisTargets))return false;
 const targets=new Map(evidence.analysisTargets.map(target=>[target.id,target]));if(targets.size!==evidence.analysisTargets.length)return false;
 const facts=new Set((evidence.facts??[]).map(fact=>fact.id));
 return rows.every(row=>{
  if(!row||!categories.includes(row.category)||!['criteria-met','possible','insufficient'].includes(row.status)||typeof row.reason!=='string'||!row.reason.trim()||typeof row.nextCheck!=='string'||!row.nextCheck.trim()||!Array.isArray(row.missingEvidence)||row.missingEvidence.some(text=>typeof text!=='string'||!text.trim())||!Array.isArray(row.targetIds)||new Set(row.targetIds).size!==row.targetIds.length||row.targetIds.some(id=>!targets.has(id))||!Array.isArray(row.evidenceIds)||new Set(row.evidenceIds).size!==row.evidenceIds.length||row.evidenceIds.some(id=>!facts.has(id)))return false;
  if(row.status!=='insufficient'&&(!row.targetIds.length||!row.evidenceIds.length))return false;
  const linked=row.targetIds.map(id=>targets.get(id)!);
  if(evidence.versions.evidence==='candidate-evidence-v7' && linked.some(target=>!target.allowedCauseCategories?.includes(row.category)))return false;
  if(evidence.versions.evidence==='candidate-evidence-v6'&&linked.some(target=>{
   if(!target.allowedCauseCategories?.includes(row.category))return true;
   const key=row.category==='coverage'?'dl':row.category==='uplink'?'ul':row.category==='interference'?'pollution':null;
   if(!key)return row.status!=='possible';
   const criterion=target.criteria?.[key];
   return row.status!=='criteria-met'||!criterion||typeof criterion!=='object'||!('status' in criterion)||criterion.status!=='matched';
  }))return false;
  return !linked.length||row.evidenceIds.every(id=>linked.some(target=>target.evidenceIds.includes(id)))&&linked.every(target=>target.evidenceIds.some(id=>row.evidenceIds.includes(id)));
 });
}
/** Old versions remain readable, but cannot suppress the new investigation analysis. */
export function isCurrentCandidateAnalysisJob(job:CandidateAnalysisJob|null|undefined):boolean{
 if(job?.currentConditionsMatch===false||!isReadableCandidateAnalysisJob(job)||!job?.evidence||!job.report)return false;
 const {evidence,report}=job;
 if(evidence.versions?.evidence!=='candidate-evidence-v7'||!['candidate-prompt-v10','candidate-prompt-v11'].includes(evidence.versions?.prompt)||evidence.versions?.sop!=='candidate-sop-draft-v7'||!areCandidateCauseAssessmentsValid(evidence))return false;
 if(report.mode==='comparison-only')return true;
 const targets=new Map(evidence.analysisTargets.map(target=>[target.id,target]));
 if(targets.size!==evidence.analysisTargets.length)return false;
 if(!Array.isArray(report.investigations)||report.investigations.length>(6)||(!report.investigations.length&&targets.size>0))return false;
 return report.investigations.every(row=>{
  if(!row||!['title','reason','nextCheck'].every(key=>typeof row[key as 'title']==='string'&&row[key as 'title'].trim())||!Array.isArray(row.targetIds)||row.targetIds.length<1||row.targetIds.length>5||new Set(row.targetIds).size!==row.targetIds.length||row.targetIds.some(id=>!targets.has(id))||!Array.isArray(row.evidenceIds)||row.evidenceIds.length<1||row.evidenceIds.length>12||new Set(row.evidenceIds).size!==row.evidenceIds.length)return false;
  const linked=row.targetIds.map(id=>targets.get(id)!);
  return row.evidenceIds.every(id=>linked.some(target=>target.evidenceIds.includes(id)))&&linked.every(target=>target.evidenceIds.some(id=>row.evidenceIds.includes(id)));
 });
}
export const fetchCandidateAnalysisDiagnostics=(id:string,fetcher=fetch,init:RequestInit={})=>analysisRequest<CandidateAnalysisDiagnostics>('/jobs/'+encodeURIComponent(id)+'/diagnostics',init,fetcher);
export type CandidateAnalysisEntry={target:CandidateAnalysisTarget;job:CandidateAnalysisJob|null;pending:boolean;error:string;history?:CandidateAnalysisJob[];historyLoading?:boolean;historyError?:string};
export const isCandidateAnalysisBusy=(entry?:CandidateAnalysisEntry)=>!!entry&&!entry.error&&(entry.pending||!!entry.job&&isAnalysisActive(entry.job.status));
export const candidateAnalysisDisplayState=(entry?:CandidateAnalysisEntry)=>entry?.error?'status-error':entry?.job?.status??(entry?.pending?'queued':'idle');

export const candidateAnalysisTarget=(summary:Pick<QualityCandidateSummary,'scope'|'scopeKey'|'locationMode'>,candidateId:string,analysisMode:'all'|'evaluation',modelId:QualityModelId='dbscan'):CandidateAnalysisTarget=>({
 kind:'candidate',candidateId,sourceRevision:summary.scope.sourceRevision,
 scope:{dateStart:summary.scope.dateStart,dateEnd:summary.scope.dateEnd,from:summary.scope.from,to:summary.scope.to},
 candidateScope:{scopeKey:summary.scopeKey,policy:summary.scope.policy,analysisMode,locationMode:summary.locationMode??'strict-3-site-v1',modelId},
});
export const candidateAnalysisTargetKey=(target:CandidateAnalysisTarget)=>JSON.stringify([
 target.kind,target.candidateId,target.sourceRevision,target.scope.dateStart,target.scope.dateEnd,target.scope.from,target.scope.to,
 target.candidateScope.scopeKey,target.candidateScope.policy,target.candidateScope.analysisMode,target.candidateScope.locationMode,target.candidateScope.modelId,
]);
const completedCache=new Map<string,{entry:CandidateAnalysisEntry;expires:number}>();
const lastConditions=new Map<string,string>();
const conditionKey=(target:CandidateAnalysisTarget)=>candidateAnalysisTargetKey({...target,candidateId:''});
export const hasPreviousCandidateCondition=(target:CandidateAnalysisTarget)=>{
 const last=lastConditions.get(target.candidateScope.modelId);return !!last&&last!==conditionKey(target);
};

/** Each target owns its response and poll. Selecting another candidate never retargets a running job. */
export function createCandidateAnalysisManager({onChange,fetcher=fetch,pollMs=1200}:{
 onChange:(entries:Map<string,CandidateAnalysisEntry>)=>void;fetcher?:(url:string,init?:RequestInit)=>Promise<Response>;pollMs?:number;
}){
 type RecordState=CandidateAnalysisEntry&{generation:number;selection:number;historyGeneration:number;pollNetworkFailures?:number;promptIdentity?:string;cancelGeneration?:number;cancelPromise?:Promise<void>;historyLoaded?:boolean;historyPromise?:Promise<void>;timer?:ReturnType<typeof setTimeout>;controller?:AbortController;historyController?:AbortController};
 const records=new Map<string,RecordState>();let disposed=false;
 for(const [key,cached] of completedCache){if(cached.expires<=Date.now()||!isCurrentCandidateAnalysisJob(cached.entry.job)){completedCache.delete(key);continue;}records.set(key,{...cached.entry,generation:0,selection:0,historyGeneration:0,historyLoading:false});}
 const emit=()=>{if(!disposed){
  while(records.size>32){const oldest=[...records].find(([,record])=>!record.pending&&(!record.job||!isAnalysisActive(record.job.status)));if(!oldest)break;records.delete(oldest[0]);}
  const entries=new Map([...records].map(([key,r])=>[key,{target:r.target,job:r.job,pending:r.pending,error:r.error,history:r.history??[],historyLoading:!!r.historyLoading,historyError:r.historyError??''}]));
  for(const [key,entry] of entries)if(isCurrentCandidateAnalysisJob(entry.job)){
   const cached=completedCache.get(key);
   if(cached?.entry.job?.id!==entry.job!.id)completedCache.set(key,{entry,expires:Date.now()+30*60*1000});
  }
  while(completedCache.size>24)completedCache.delete(completedCache.keys().next().value!);
  onChange(entries);
 }};
 const clear=(record:RecordState)=>{if(record.timer!==undefined)clearTimeout(record.timer);record.timer=undefined;record.controller?.abort();record.controller=undefined;};
 const validate=(value:CandidateAnalysisJob,target:CandidateAnalysisTarget,id?:string)=>{
  if(!value||typeof value.id!=='string'||!value.target?.scope||!value.target.candidateScope||value.target.kind!=='candidate'||!['queued','collecting','analyzing','completed','failed','cancelled'].includes(value.status))throw new AnalysisClientError('후보 분석 작업의 응답 형식이 올바르지 않습니다.','INVALID_RESPONSE');
  if((id&&value.id!==id)||candidateAnalysisTargetKey(value.target)!==candidateAnalysisTargetKey(target))throw new AnalysisClientError('분석 대상 후보와 응답 조건이 일치하지 않습니다.','TARGET_MISMATCH');
  if(value.status==='completed'&&(!value.evidence||!value.report))throw new AnalysisClientError('완료된 후보 분석에 근거 또는 보고서가 없습니다.','INVALID_RESPONSE');
  return value;
 };
 const relevant=(record:RecordState,generation:number)=>!disposed&&record.generation===generation;
 const discard=(job:CandidateAnalysisJob)=>{if(isAnalysisActive(job.status))void analysisRequest('/jobs/'+encodeURIComponent(job.id),{method:'DELETE'},fetcher).catch(()=>{});};
 const errorText=(error:unknown)=>error instanceof Error?error.message:'후보 분석 상태를 확인하지 못했습니다. 다시 시도해 주세요.';
 const historyTime=(job:CandidateAnalysisJob)=>job.persistence?.savedAt??job.updatedAt??job.createdAt;
 const mergeHistory=(...lists:(CandidateAnalysisJob[]|undefined)[])=>[...new Map(lists.flatMap(list=>list??[]).filter(job=>job.status==='completed'&&job.report&&job.evidence).map(job=>[job.id,job])).values()].sort((a,b)=>historyTime(b).localeCompare(historyTime(a))).slice(0,3);
 const remember=(record:RecordState,job:CandidateAnalysisJob|null)=>{if(job?.status==='completed'&&job.report&&job.evidence&&job.persistence?.status!=='failed')record.history=mergeHistory([job],record.history);};
 const ensure=(input:CandidateAnalysisTarget)=>{
  const key=candidateAnalysisTargetKey(input);let record=records.get(key);
  if(!record){record={target:structuredClone(input),job:null,pending:false,error:'',history:[],historyError:'',historyLoading:false,generation:0,selection:0,historyGeneration:0};records.set(key,record);}
  return record;
 };
 function schedule(record:RecordState,generation:number){record.timer=setTimeout(()=>{void poll(record,generation);},pollMs);}
 async function poll(record:RecordState,generation:number){
  if(!relevant(record,generation)||!record.job)return;
  record.controller=new AbortController();
  try{
   const job=validate(await analysisRequest<CandidateAnalysisJob>('/jobs/'+encodeURIComponent(record.job.id),{signal:record.controller.signal},fetcher),record.target,record.job.id);
   if(!relevant(record,generation))return;
   record.pollNetworkFailures=0;record.job=job;remember(record,job);record.pending=isAnalysisActive(job.status);record.error='';emit();
   if(record.pending)schedule(record,generation);
  }catch(error){if(relevant(record,generation)){
   if(error instanceof AnalysisClientError&&error.code==='NETWORK_ERROR'){
    record.pollNetworkFailures=(record.pollNetworkFailures??0)+1;
    if(record.pollNetworkFailures<=2){schedule(record,generation);return;}
   }
   record.pending=false;record.error=errorText(error);emit();
  }}
 }
 function loadHistory(input:CandidateAnalysisTarget):Promise<void>{
   if(disposed)return Promise.resolve();
   const record=ensure(input);if(record.historyPromise)return record.historyPromise;
   const target=structuredClone(input),generation=record.generation,selection=record.selection,historyGeneration=++record.historyGeneration;
   const controller=new AbortController();record.historyController=controller;record.historyLoading=true;record.historyError='';emit();
   const loading=(async()=>{try{
    const result=await analysisRequest<{target:CandidateAnalysisTarget;jobs:CandidateAnalysisJob[];limit:number}>('/candidate-history',{method:'POST',body:JSON.stringify(target),signal:controller.signal},fetcher);
    if(!result?.target||candidateAnalysisTargetKey(result.target)!==candidateAnalysisTargetKey(target))throw new AnalysisClientError('저장된 분석 대상 후보와 응답 조건이 일치하지 않습니다.','TARGET_MISMATCH');
    if(result.limit!==3||!Array.isArray(result.jobs)||result.jobs.length>3)throw new AnalysisClientError('저장된 후보 분석의 응답 형식이 올바르지 않습니다.','INVALID_RESPONSE');
    const saved=result.jobs.map(job=>{const value=validate(job,target);if(value.status!=='completed')throw new AnalysisClientError('저장된 후보 분석이 완료 상태가 아닙니다.','INVALID_RESPONSE');return value;});
    if(disposed||record.historyGeneration!==historyGeneration)return;
    record.history=mergeHistory(record.history,saved);record.historyError='';record.historyLoaded=true;
    if(record.generation===generation&&record.selection===selection&&!record.pending&&(!record.job||record.job.status==='completed')){
     const newest=record.history[0];if(newest&&(!record.job||historyTime(newest)>=historyTime(record.job)))record.job=newest;
    }
   }catch(error){if(!disposed&&record.historyGeneration===historyGeneration)record.historyError=errorText(error);}
   finally{if(!disposed&&record.historyGeneration===historyGeneration){record.historyLoading=false;record.historyController=undefined;record.historyPromise=undefined;emit();}}})();
   record.historyPromise=loading;return loading;
 }
 return {
  loadHistory,
  selectSaved(input:CandidateAnalysisTarget,id:string){
   if(disposed)return;
   const record=records.get(candidateAnalysisTargetKey(input)),saved=record?.history?.find(job=>job.id===id);
   if(!record||!saved)return;
   record.selection++;
   if(!record.pending&&(!record.job||!isAnalysisActive(record.job.status))){record.job=saved;record.error='';}
   emit();
  },
  start:async function start(input:CandidateAnalysisTarget,{rerun=false,promptOverride}:{rerun?:boolean;promptOverride?:CandidatePromptDraft}={}):Promise<void>{
   if(disposed)return;
   if(promptOverride)rerun=true;
   const key=candidateAnalysisTargetKey(input),existing=records.get(key),promptIdentity=promptOverride?JSON.stringify([promptOverride.system,promptOverride.user]):undefined;
   // A new POST must not reuse a job while its explicit DELETE is still in flight.
   if(existing?.cancelPromise){await existing.cancelPromise;return start(input,{rerun,promptOverride});}
   if(existing&&(existing.pending&&existing.promptIdentity===promptIdentity||!rerun&&isCurrentCandidateAnalysisJob(existing.job))){emit();return;}
   const target=structuredClone(input),record=ensure(target);remember(record,record.job);
   lastConditions.set(target.candidateScope.modelId,conditionKey(target));
   clear(record);record.generation++;record.cancelGeneration=undefined;record.pollNetworkFailures=0;record.promptIdentity=promptIdentity;const generation=record.generation;record.pending=true;record.error='';record.job=null;records.set(key,record);emit();
   try{
    if(!rerun&&!record.historyLoaded){
     await loadHistory(target);if(!relevant(record,generation))return;
     if(record.historyError){record.pending=false;record.error=record.historyError;emit();return;}
     const saved=record.history?.find(isCurrentCandidateAnalysisJob);
     if(saved){record.job=saved;record.pending=false;emit();return;}
    }
    const job=validate(await analysisRequest<CandidateAnalysisJob>('/jobs',{method:'POST',body:JSON.stringify({...target,...(rerun?{rerun:true}:{}),...(promptOverride?{promptOverride}:{} )})},fetcher),target);
    if(!relevant(record,generation)){if(!disposed&&record.cancelGeneration===record.generation)discard(job);return;}
    record.job=job;remember(record,job);record.pending=isAnalysisActive(job.status);emit();if(record.pending)schedule(record,generation);
   }catch(error){if(relevant(record,generation)){record.pending=false;record.error=errorText(error);emit();}}
  },
  async cancel(target:CandidateAnalysisTarget){
   const record=records.get(candidateAnalysisTargetKey(target));if(!record)return;
   const job=record.job;clear(record);record.generation++;const generation=record.generation;record.cancelGeneration=generation;record.pending=false;
   if(!job||!isAnalysisActive(job.status)){emit();return;}
   const cancelling=(async()=>{try{
     const value=validate(await analysisRequest<CandidateAnalysisJob>('/jobs/'+encodeURIComponent(job.id),{method:'DELETE'},fetcher),record.target,job.id);
     if(relevant(record,generation)){record.job=value;record.error='';emit();}
    }catch(error){if(relevant(record,generation)){record.error=errorText(error);emit();}}
   })();record.cancelPromise=cancelling;
   try{await cancelling;}finally{if(record.cancelPromise===cancelling)record.cancelPromise=undefined;}
  },
  dispose(){if(disposed)return;disposed=true;for(const record of records.values()){clear(record);record.historyController?.abort();record.historyGeneration++;record.generation++;}records.clear();},
  restore(){emit();},
 };
}
