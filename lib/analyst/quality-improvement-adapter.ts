import type { AnalystOverview, OverviewCall } from './types';
import type { QualityComparisonState } from './quality-comparison-state';
import { scopeOverviewToCustomers } from './customer-overview-scope';
import { calculateProposalGrades } from './quality-proposal-metrics';
import { buildFourthHourly } from './quality-proposal-four';
import { buildCoverage } from './voice-improvement-1/coverage';
import { buildCustomerExperience } from './voice-improvement-1/customer-metrics';
import type { EvidenceCall, EvidenceDecision } from './voice-improvement-1/types';
import { dateOfCall } from './date-range';

export interface QualityEvidenceRecord {
  callId:string;mdtLinkStatus:'unique'|'ambiguous'|'none'|'unknown';status?:'accepted'|'excluded';
  kind?:'gnss'|'reviewed-radio';lat?:number;lon?:number;observedAt?:string|null;reasons?:string[];
}
export interface QualityEvidenceIndex {date?:string;revision:string;policy:string;censusComplete:boolean;records:QualityEvidenceRecord[]}
export interface QualityCandidateInvestigation {candidateId:string;callIds:string[];customerIds:string[]}
export function qualityCandidateInvestigationCalls(calls:readonly OverviewCall[],selection:QualityCandidateInvestigation,mode:'members'|'customers') {
  const members=new Set(selection.callIds),customers=new Set(selection.customerIds);
  return calls.filter(c=>mode==='members'?members.has(c.id):customers.has(c.customerId)).map(c=>({...c,isCandidateMember:members.has(c.id)}));
}
export function buildQualityImprovementMetrics(overview:AnalystOverview,state:QualityComparisonState,evidence:QualityEvidenceIndex|null){
  const scoped=scopeOverviewToCustomers(overview,state.customerIds)!;
  const lower=Number(state.from.slice(0,2))*3600+Number(state.from.slice(3))*60;
  const upper=Number(state.to.slice(0,2))*3600+Number(state.to.slice(3))*60+59;
  const rows=scoped.calls.filter(c=>c.startSecond>=lower&&c.startSecond<=upper);
  const compatible=evidence&&(!overview.sourceRevision||evidence.revision===overview.sourceRevision)?evidence:null;
  const records=new Map(compatible?.records.map(r=>[r.callId,r])??[]);
  const recordFor=(c:OverviewCall)=>records.get(c.id)??records.get(dateOfCall(c,overview.date)+':'+c.id);
  const calls:EvidenceCall[]=rows.map(c=>({date:dateOfCall(c,overview.date),callId:c.id,rawCallId:c.rawCallId??c.id,
    customerId:c.customerId,startedAt:c.startTimestamp??null,mos:c.mos??null,sipReason:c.sipCause,
    mdtLinkStatus:recordFor(c)?.mdtLinkStatus??(compatible?.censusComplete?'none':'unknown'),sourceRevision:overview.sourceRevision??'',sourceFile:''}));
  const decisions:EvidenceDecision[]=calls.flatMap(c=>{
    const r=records.get(c.callId)??records.get(c.date+':'+c.callId);
    return r?.status?[{...r,callId:c.callId,status:r.status,reasons:r.reasons??[],lineage:{date:c.date,rawCallId:c.rawCallId,sourceRevision:c.sourceRevision,sourceFile:''}}]:[];
  });
  const availableDates:string[]=[];
  for(let day=Date.parse(state.dateStart+'T00:00:00Z'),end=Date.parse(state.dateEnd+'T00:00:00Z');day<=end;day+=86400000)availableDates.push(new Date(day).toISOString().slice(0,10));
  return {grades:calculateProposalGrades(scoped,state.from,state.to),hourly:buildFourthHourly(scoped,state.from,state.to),
    coverage:buildCoverage(calls,decisions),customers:buildCustomerExperience(calls,availableDates),
    evidenceStatus:!evidence?'unavailable':!compatible?'revision-mismatch':compatible.censusComplete?'complete':'partial'};
}
export type QualityImprovementMetrics=ReturnType<typeof buildQualityImprovementMetrics>;
