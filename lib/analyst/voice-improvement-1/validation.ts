import { datesInRange } from '../date-range';
import { canonicalScopeJson } from './scope';
import { buildCoverage, isPoorOriginalMos } from './coverage';
import type { AnalysisScope, CandidatePolicy, ImprovementReport } from './types';

const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const stable=(v:unknown):unknown=>Array.isArray(v)?v.map(stable):object(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,value])=>[k,stable(value)])):v;
const same=(a:unknown,b:unknown)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
export function validateVoiceImprovementReport(value:unknown,scope:AnalysisScope,policy:CandidatePolicy):{ok:boolean;reasons:string[]}{
  try{return validateReport(value,scope,policy);}catch{return {ok:false,reasons:['malformed-report-values']};}
}
function validateReport(value:unknown,scope:AnalysisScope,policy:CandidatePolicy):{ok:boolean;reasons:string[]}{
  const reasons:string[]=[];
  if(!object(value))return {ok:false,reasons:['invalid-report-object']};
  if(value.schemaVersion!=='voice-improvement-1-v1')reasons.push('schema-mismatch');
  if(value.sourceRevision!==scope.sourceRevision)reasons.push('revision-mismatch');
  if(!object(value.scope)||!object(value.policy)||canonicalScopeJson(value.scope as unknown as AnalysisScope,value.policy as unknown as CandidatePolicy)!==canonicalScopeJson(scope,policy))reasons.push('scope-or-policy-mismatch');
  if(!hash(value.inputHash)||!hash(value.inventoryHash))reasons.push('missing-input-hash');
  if(!Array.isArray(value.inputFiles)||!value.inputFiles.length||value.inputFiles.some(f=>!object(f)||typeof f.file!=='string'||!f.file||!hash(f.sha256)))reasons.push('invalid-input-file-lineage');
  if(typeof value.scopeKey!=='string'||!/^[a-f0-9]{20}$/.test(value.scopeKey))reasons.push('invalid-scope-key');
  if(!Array.isArray(value.availableDates)||value.availableDates.some(d=>typeof d!=='string')||new Set(value.availableDates).size!==value.availableDates.length)reasons.push('invalid-available-dates');
  const selected=Array.isArray(value.availableDates)?datesInRange(value.availableDates as string[],scope.dateStart,scope.dateEnd):[];
  if(!selected.length)reasons.push('missing-date');
  const discovery=scope.mode==='holdout'?selected.slice(0,-1):selected,validation=scope.mode==='holdout'?selected.slice(-1):[];
  if(scope.mode==='holdout'&&selected.length<3)reasons.push('invalid-holdout');
  if(!same(value.discoveryDates,discovery)||!same(value.validationDates,validation))reasons.push('discovery-validation-split-mismatch');
  if(!Array.isArray(value.calls)||!Array.isArray(value.decisions)||!object(value.coverage)||!Array.isArray(value.baselineSpatialCandidates)||!Array.isArray(value.improvedSpatialCandidates))return {ok:false,reasons:[...reasons,'missing-report-arrays']};
  const report=value as unknown as ImprovementReport;
  const ids=new Set<string>(),calls=new Map(report.calls.map(c=>[c.callId,c]));
  for(const call of report.calls){
    if(!call.callId||ids.has(call.callId))reasons.push('duplicate-or-missing-call-id');ids.add(call.callId);
    if(!call.customerId||!call.rawCallId||!selected.includes(call.date)||call.sourceRevision!==scope.sourceRevision||!call.sourceFile)reasons.push('invalid-call-lineage');
    if(!['unique','ambiguous','none','unknown'].includes(call.mdtLinkStatus))reasons.push('invalid-mdt-link-status');
    const clock=call.startedAt?.match(/T(\d{2}:\d{2})/)?.[1]??call.start?.slice(0,5);
    if(clock&&(clock<scope.from||clock>scope.to))reasons.push('call-outside-daily-window');
  }
  const decisions=new Set<string>();
  for(const decision of report.decisions){
    const call=calls.get(decision.callId);
    if(!call||decisions.has(decision.callId))reasons.push('duplicate-or-unknown-decision');decisions.add(decision.callId);
    if(!Array.isArray(decision.reasons)||!decision.lineage||decision.lineage.sourceRevision!==scope.sourceRevision||decision.lineage.date!==call?.date||decision.lineage.rawCallId!==call?.rawCallId||decision.lineage.sourceFile!==call?.sourceFile)reasons.push('invalid-decision-lineage');
    if(decision.status==='accepted'){
      if(call?.mdtLinkStatus!=='unique'||!['gnss','reviewed-radio'].includes(decision.kind??'')||![decision.lat,decision.lon,decision.ageSec].every(v=>typeof v==='number'&&Number.isFinite(v))||Math.abs(decision.lat!)>90||Math.abs(decision.lon!)>180||!Number.isFinite(Date.parse(decision.observedAt??''))||decision.ageSec! < -1||decision.ageSec!>180)reasons.push('invalid-accepted-evidence');
      if(decision.kind==='reviewed-radio'&&(!decision.review?.accepted||decision.review.policy!==policy.locationPolicy))reasons.push('missing-strict-radio-review');
    }else if(decision.status!=='excluded')reasons.push('invalid-evidence-status');
  }
  if(decisions.size!==calls.size)reasons.push('incomplete-evidence-decisions');
  try{
    const actual=buildCoverage(report.calls,report.decisions);
    if(!same(actual,report.coverage))reasons.push('coverage-set-sum-mismatch');
  }catch{reasons.push('invalid-coverage-call-sets');}
  for(const list of [report.baselineSpatialCandidates,report.improvedSpatialCandidates]){
    const candidateIds=new Set<string>();
    for(const candidate of list){
      if(!candidate||!candidate.id||candidateIds.has(candidate.id)){reasons.push('invalid-candidate-id');continue;}candidateIds.add(candidate.id);
      if(!Array.isArray(candidate.memberCallIds)||new Set(candidate.memberCallIds).size!==candidate.memberCallIds.length){reasons.push('invalid-candidate-members');continue;}
      const members=candidate.memberCallIds.map(id=>calls.get(id));
      if(members.some(c=>!c||!discovery.includes(c.date)||!isPoorOriginalMos(c.mos)))reasons.push('invalid-discovery-membership');
      if(candidate.poorCallCount!==members.length||candidate.poorCustomerCount!==new Set(members.map(c=>c?.customerId)).size||candidate.poorDateCount!==new Set(members.map(c=>c?.date)).size)reasons.push('candidate-count-mismatch');
      if(!candidate.medoid||!candidate.memberCallIds.includes(candidate.medoid.callId??'')||![candidate.medoid.lat,candidate.medoid.lon,candidate.maxCenterDistanceM,candidate.maxPairDistanceM,candidate.displayRadiusM].every(Number.isFinite))reasons.push('invalid-candidate-range');
      if(!Array.isArray(candidate.nearbyPoints)){reasons.push('missing-nearby-points');continue;}
      const nearbyIds=new Set<string>();
      for(const point of candidate.nearbyPoints){
        const call=calls.get(point.callId);
        if(!call||nearbyIds.has(point.callId)||point.customerId!==call.customerId||point.date!==call.date||!isPoorOriginalMos(call.mos))reasons.push('invalid-nearby-membership');nearbyIds.add(point.callId);
      }
    }
  }
  // Detail-only selections must not enter the aggregate artifact contract.
  if(object(value.scope)&&('hour' in value.scope||'customerId' in value.scope))reasons.push('detail-filter-in-aggregate-scope');
  return {ok:reasons.length===0,reasons:[...new Set(reasons)]};
}
