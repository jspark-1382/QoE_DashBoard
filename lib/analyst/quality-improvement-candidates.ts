import type {AnalystOverview} from './types';
import type {SpatialCandidate,EvidenceCall,EvidenceDecision} from './voice-improvement-1/types';
import type {QualityEvidenceIndex} from './quality-improvement-adapter';
export type {QualityEvidenceIndex} from './quality-improvement-adapter';
export interface QualityCandidateScope {sourceRevision:string;dateStart:string;dateEnd:string;from:string;to:string;policy:string}
export interface QualityCandidateCard {id:string;label:string;poorCustomerCount:number;poorCallCount:number;poorDateCount:number;medoid:{lat:number;lon:number};displayRadiusM:number;rangeReviewRequired:boolean;rank:number|null;validationStatus:string;validationNewCustomers:number;detailPath:string}
export interface QualityCandidateSummary {schemaVersion:'quality-candidate-summary-v1';scope:QualityCandidateScope;scopeKey:string;discoveryDates:string[];validationDates:string[];distinctAffectedCustomers?:number;candidates:QualityCandidateCard[];auditReference:string;observationPath:string}
export interface QualityCandidateDetail {schemaVersion:'quality-candidate-detail-v1';scope:QualityCandidateScope;scopeKey:string;candidate:SpatialCandidate;calls:EvidenceCall[];decisions:EvidenceDecision[]}
export interface QualityObservationPoint {callId:string;customerId:string;date:string;mos:number;lat:number;lon:number;kind:'gnss'|'reviewed-radio';observedAt?:string|null}
export const qualityCandidateRankLabel=(candidate:Pick<QualityCandidateCard,'rank'>)=>candidate.rank===null?'범위 검토':String(candidate.rank);
export function buildQualityCandidateInvestigation(detail:QualityCandidateDetail,overview:AnalystOverview){
 const members=new Set(detail.candidate.memberCallIds);
 const related=new Set([...members,...detail.candidate.nearbyPoints.filter(p=>p.role==='validation-new'||p.role==='validation-existing').map(p=>p.callId)]);
 const overviewIds=new Set(overview.calls.map(c=>c.id));
 return {candidateId:detail.candidate.id,callIds:detail.calls.filter(c=>members.has(c.callId)).map(c=>overviewIds.has(c.callId)?c.callId:overviewIds.has(c.callId.slice(11))?c.callId.slice(11):c.callId),customerIds:[...new Set(detail.calls.filter(c=>related.has(c.callId)).map(c=>c.customerId))]};
}
interface Index {schemaVersion:'quality-improvement-index-v1';sourceRevision:string;availableDates?:string[];entries:Array<{scope:QualityCandidateScope;path:string}>;evidence:Array<{date:string;path:string}>}
export class QualityCandidateError extends Error {constructor(public code:'not-generated'|'revision-mismatch'|'invalid-data'|'unavailable',message:string){super(message);this.name='QualityCandidateError';}}
const BASE='/qoe/quality-improvement/';
const scopeFields=['sourceRevision','dateStart','dateEnd','from','to','policy'] as const;
export const sameQualityCandidateScope=(a:QualityCandidateScope,b:QualityCandidateScope)=>scopeFields.every(k=>a?.[k]===b?.[k]);
async function read<T>(path:string,signal?:AbortSignal,base=BASE):Promise<T>{
 if(path.startsWith('/')||path.includes('..')||!/^[-a-zA-Z0-9_/.]+$/.test(path))throw new QualityCandidateError('invalid-data','후보 자료 경로가 유효하지 않습니다.');
 const response=await fetch(base+path,{signal,cache:'no-cache'});
 if(!response.ok)throw new QualityCandidateError(response.status===404?'not-generated':'unavailable',response.status===404?'현재 조건의 후보 자료가 아직 생성되지 않았습니다.':'후보 자료를 불러오지 못했습니다.');
 return response.json() as Promise<T>;
}
async function loadIndex(scope:QualityCandidateScope,signal?:AbortSignal,mode:'all'|'evaluation'='evaluation'){const index=await read<Index>('index.json',signal,mode==='all'?'/qoe/quality-improvement-full/':BASE);if(index.schemaVersion!=='quality-improvement-index-v1')throw new QualityCandidateError('invalid-data','후보 자료 형식이 다릅니다.');if(index.sourceRevision!==scope.sourceRevision)throw new QualityCandidateError('revision-mismatch','후보 자료의 원본 버전이 현재 통화 자료와 다릅니다.');return index;}
export async function loadQualityCandidateSummary(scope:QualityCandidateScope,signal?:AbortSignal,mode:'all'|'evaluation'='evaluation'):Promise<QualityCandidateSummary>{
 const index=await loadIndex(scope,signal,mode),entry=index.entries.find(e=>sameQualityCandidateScope(e.scope,scope));
 if(!entry)throw new QualityCandidateError('not-generated','현재 기간·시간의 후보 자료가 아직 생성되지 않았습니다.');
 const summary=await read<QualityCandidateSummary>(entry.path,signal,mode==='all'?'/qoe/quality-improvement-full/':BASE);
 if(summary.schemaVersion!=='quality-candidate-summary-v1'||!sameQualityCandidateScope(summary.scope,scope)||!Array.isArray(summary.candidates)||new Set(summary.candidates.map(c=>c.id)).size!==summary.candidates.length||summary.discoveryDates.some(d=>d<scope.dateStart||d>scope.dateEnd)||summary.validationDates.some(d=>d<scope.dateStart||d>scope.dateEnd||summary.discoveryDates.includes(d)))throw new QualityCandidateError('invalid-data','후보 자료의 조건이 현재 선택과 다릅니다.');
 return summary;
}
export function validateQualityCandidateDetail(summary:QualityCandidateSummary,detail:QualityCandidateDetail,id:string):boolean{
 if(detail.schemaVersion!=='quality-candidate-detail-v1'||detail.scopeKey!==summary.scopeKey||!sameQualityCandidateScope(summary.scope,detail.scope)||detail.candidate?.id!==id||!summary.candidates.some(c=>c.id===id)||!Array.isArray(detail.calls)||!Array.isArray(detail.candidate.nearbyPoints))return false;
 const calls=new Map(detail.calls.map(c=>[c.callId,c]));
 if(detail.candidate.memberCallIds.some(callId=>!calls.has(callId)||!summary.discoveryDates.includes(calls.get(callId)!.date)))return false;
 return detail.candidate.nearbyPoints.every(p=>calls.has(p.callId)&&(p.role.startsWith('validation')?summary.validationDates:summary.discoveryDates).includes(p.date)&&['gnss','reviewed-radio'].includes(p.kind)&&Number.isFinite(p.lat)&&Number.isFinite(p.lon));
}
export async function loadQualityCandidateDetail(summary:QualityCandidateSummary,id:string,signal?:AbortSignal,mode:'all'|'evaluation'='evaluation'):Promise<QualityCandidateDetail>{
 const card=summary.candidates.find(c=>c.id===id);if(!card)throw new QualityCandidateError('invalid-data','선택 후보가 현재 조건에 없습니다.');
 const detail=await read<QualityCandidateDetail>(card.detailPath,signal,mode==='all'?'/qoe/quality-improvement-full/':BASE);if(!validateQualityCandidateDetail(summary,detail,id))throw new QualityCandidateError('invalid-data','후보 상세의 발견·검증 조건이 맞지 않습니다.');return detail;
}
export async function loadQualityEvidenceIndex(scope:QualityCandidateScope,signal?:AbortSignal):Promise<QualityEvidenceIndex>{
 const index=await loadIndex(scope,signal),entries=index.evidence.filter(e=>e.date>=scope.dateStart&&e.date<=scope.dateEnd);
 const dates=index.availableDates?.filter(d=>d>=scope.dateStart&&d<=scope.dateEnd)??[];
 if(!entries.length||dates.some(d=>!entries.some(e=>e.date===d)))throw new QualityCandidateError('not-generated','현재 기간의 위치 근거가 아직 생성되지 않았습니다.');
 const partitions=await Promise.all(entries.map(e=>read<QualityEvidenceIndex>(e.path,signal)));
 if(partitions.some(p=>p.revision!==scope.sourceRevision||p.policy!==scope.policy))throw new QualityCandidateError('revision-mismatch','위치 근거의 원본 버전·정책이 다릅니다.');
 return {revision:scope.sourceRevision,policy:scope.policy,censusComplete:partitions.every(p=>p.censusComplete),records:partitions.flatMap(p=>p.records)};
}
export function buildQualityScopeObservationPoints(overview:AnalystOverview,state:Pick<QualityCandidateScope,'dateStart'|'dateEnd'|'from'|'to'>&{sourceRevision?:string|null;policy?:string;customerIds?:readonly string[]},evidence:QualityEvidenceIndex):QualityObservationPoint[]{
 if(evidence.revision!==(state.sourceRevision??overview.sourceRevision)||evidence.policy!==(state.policy??'strict-3-site-v1'))return [];
 const records=new Map(evidence.records.map(r=>[r.callId,r]));
 const from=Number(state.from.slice(0,2))*3600+Number(state.from.slice(3))*60,to=Number(state.to.slice(0,2))*3600+Number(state.to.slice(3))*60+59;
 return overview.calls.flatMap(call=>{
 const date=/^\d{4}-\d{2}-\d{2}:/.test(call.id)?call.id.slice(0,10):(call.startTimestamp?.slice(0,10)??overview.date),callId=call.id.startsWith(date+':')?call.id:date+':'+call.id;
 const d=records.get(callId)??records.get(call.id);
 if(date<state.dateStart||date>state.dateEnd||call.startSecond<from||call.startSecond>to||(state.customerIds?.length&&!state.customerIds.includes(call.customerId))||typeof call.mos!=='number'||!Number.isFinite(call.mos)||call.mos<1||call.mos>=3||d?.mdtLinkStatus!=='unique'||d.status!=='accepted'||!['gnss','reviewed-radio'].includes(d.kind??'')||d.reasons?.length||!Number.isFinite(d.lat)||!Number.isFinite(d.lon))return [];
 return [{callId,customerId:call.customerId,date,mos:call.mos,lat:d.lat!,lon:d.lon!,kind:d.kind!,observedAt:d.observedAt}];
 });
}
