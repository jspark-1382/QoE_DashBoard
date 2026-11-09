import type {AnalystOverview} from './types';
import type {QualityCandidateCard,QualityCandidateDetail,QualityCandidateSummary} from './quality-improvement-candidates';
import {classifySipReason11} from './sip-reason';

export type CandidateCustomerRow={
 customerId:string; alias:string; discoveryCalls:number; verificationCalls:number;
 poorDates:number; dropCalls:number; minMos:number|null; calls:Array<{
 callId:string;date:string;start:string;mos:number|null;isDiscovery:boolean;isVerification:boolean;drop:boolean;sip:'normal'|'drop'|'other';kind:'gnss'|'reviewed-radio'|null;
 }>;
};

/** An individual customer's repeat observations are distinct from multiple customers in the same area. */
export function buildCandidateCustomerRows(detail:QualityCandidateDetail):CandidateCustomerRow[]{
 const members=new Set(detail.candidate.memberCallIds);
 const verification=new Set(detail.candidate.nearbyPoints.filter(p=>p.role==='validation-new'||p.role==='validation-existing').map(p=>p.callId));
 const positions=new Map(detail.candidate.nearbyPoints.map(p=>[p.callId,p]));
 const byCustomer=new Map<string,CandidateCustomerRow>();
 for(const call of detail.calls){
   if(!members.has(call.callId)&&!verification.has(call.callId))continue;
   let row=byCustomer.get(call.customerId);
   if(!row){row={customerId:call.customerId,alias:'',discoveryCalls:0,verificationCalls:0,poorDates:0,dropCalls:0,minMos:null,calls:[]};byCustomer.set(call.customerId,row);}
   const isDiscovery=members.has(call.callId),isVerification=!isDiscovery&&verification.has(call.callId);
   if(isDiscovery)row.discoveryCalls++;
   if(isVerification)row.verificationCalls++;
   const mos=call.mos;
   const isPoor=typeof mos==='number'&&Number.isFinite(mos)&&mos>=1&&mos<3;
   if(isPoor)row.minMos=row.minMos===null?mos:Math.min(row.minMos,mos);
   const sip=classifySipReason11(call.sipReason);const drop=sip==='drop';
   if(drop)row.dropCalls++;
   row.calls.push({callId:call.callId,date:call.date,start:call.start??call.startedAt?.slice(11,19)??'시각 미확인',
    mos:typeof mos==='number'?mos:null,isDiscovery,isVerification,drop,sip,kind:positions.get(call.callId)?.kind??null});
 }
 const list=[...byCustomer.values()].sort((a,b)=>(b.discoveryCalls-a.discoveryCalls)||(b.verificationCalls-a.verificationCalls)||a.customerId.localeCompare(b.customerId));
 for(const [index,row] of list.entries()){
   row.alias='고객 '+(index<26?String.fromCharCode(65+index):String(index+1));
   row.poorDates=new Set(row.calls.filter(call=>typeof call.mos==='number'&&call.mos>=1&&call.mos<3).map(c=>c.date)).size;
   row.calls.sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start));
 }
 return list;
}
export const repeatedCustomerCount=(rows:readonly CandidateCustomerRow[])=>rows.filter(row=>row.calls.filter(c=>typeof c.mos==='number'&&c.mos>=1&&c.mos<3).length>=2).length;
export const candidateStatus=(card:Pick<QualityCandidateCard,'rangeReviewRequired'|'validationStatus'|'rank'>)=>{
 if(card.rangeReviewRequired||card.rank===null)return {label:'범위 검토 필요',tone:'review' as const};
 if(card.validationStatus==='reobserved')return {label:'새 고객 재관측',tone:'repeat' as const};
 if(card.validationStatus==='not-applicable')return {label:'기간 내 반복 관측',tone:'repeat' as const};
 return {label:'추가 관측 필요',tone:'pending' as const};
};
export const candidateTitle=(index:number)=>'후보 지역 '+(index+1);

/** Uses supplied administrative-dong polygon rings. Return null outside known boundaries; never infer a guessed district. */
export function candidateAdministrativeDong(overview:Pick<AnalystOverview,'administrativeDongs'>,lat:number,lon:number):string|null{
 if(!Number.isFinite(lat)||!Number.isFinite(lon))return null;
 const pointInRing=(ring:number[][]):boolean=>{
  let inside=false; let prev:[number,number]|null=null;let first:[number,number]|null=null;
  for(const raw of ring){
   const [x,y]=raw;if(!Number.isFinite(x)||!Number.isFinite(y))continue;
   const v:[number,number]=[x,y];
   if(!first)first=v;
   if(prev&&((v[1]>lat)!==(prev[1]>lat))&&(lon<(prev[0]-v[0])*(lat-v[1])/(prev[1]-v[1])+v[0]))inside=!inside;
   prev=v;
  }
  if(prev&&first&&((first[1]>lat)!==(prev[1]>lat))&&(lon<(prev[0]-first[0])*(lat-first[1])/(prev[1]-first[1])+first[0]))inside=!inside;
  return inside;
 };
 for(const dong of overview.administrativeDongs??[]){
  // GeoJSON MultiPolygon coordinates: polygons -> rings -> [longitude, latitude].
  const polygons=dong.coordinates??[];
  for(const polygon of polygons) {
   let inside=false;
   for(const ring of polygon)if(pointInRing(ring))inside=!inside;
   if(inside)return dong.label;
  }
 }
 return null;
}
export function candidateEvidenceSummary(detail:QualityCandidateDetail){
 const members=new Set(detail.candidate.memberCallIds);
 const discovery=detail.candidate.nearbyPoints.filter(point=>point.role==='discovery-member'&&members.has(point.callId));
 const verified=detail.candidate.nearbyPoints.filter(point=>point.role==='validation-new'||point.role==='validation-existing');
 return {gnss:discovery.filter(point=>point.kind==='gnss').length,radio:discovery.filter(point=>point.kind==='reviewed-radio').length,
  verificationCalls:new Set(verified.map(point=>point.callId)).size,verificationNewCustomers:new Set(verified.filter(p=>p.role==='validation-new').map(p=>p.customerId)).size};
}
export function verifyCandidateSummaryConsistency(summary:QualityCandidateSummary,detail:QualityCandidateDetail):string[]{
 const card=summary.candidates.find(c=>c.id===detail.candidate.id);
 if(!card)return ['선택 후보 요약을 찾을 수 없습니다.'];
 const members=new Set(detail.candidate.memberCallIds);
 const calls=detail.calls.filter(c=>members.has(c.callId));
 const issues:string[]=[];
 if(calls.length!==card.poorCallCount)issues.push('후보 구성 통화 건수가 요약과 일치하지 않습니다.');
 if(new Set(calls.map(c=>c.customerId)).size!==card.poorCustomerCount)issues.push('후보 구성 고객 수가 요약과 일치하지 않습니다.');
 if(new Set(calls.map(c=>c.date)).size!==card.poorDateCount)issues.push('후보 관측일 수가 요약과 일치하지 않습니다.');
 if(calls.some(c=>!(typeof c.mos==='number'&&c.mos>=1&&c.mos<3)))issues.push('구성 통화에서 유효 저QoE가 아닌 자료가 발견됐습니다.');
 if(detail.candidate.validationNewCustomerIds.length!==card.validationNewCustomers)issues.push('신규 고객 재관측 수가 일치하지 않습니다.');
 return issues;
}
