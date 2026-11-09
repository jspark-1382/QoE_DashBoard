import type {ImprovementCandidate} from './improvement-candidates';
import type {QualityCandidateSummary,QualityCandidateDetail} from './quality-improvement-candidates';
import {classifySipReason11} from './sip-reason';
export function buildQualityPresentationCandidates(summary:QualityCandidateSummary,detail:QualityCandidateDetail|null):ImprovementCandidate[]{
 return summary.candidates.map(card=>{
  const selected=detail?.candidate.id===card.id?detail:null;
  const calls=selected?.calls??[],members=new Set(selected?.candidate.memberCallIds??[]);
  const points=selected?.candidate.nearbyPoints??[];
  const endCells=new Map<string,number>();for(const c of calls)if(c.endCellId)endCells.set(c.endCellId,(endCells.get(c.endCellId)??0)+1);
  const rawId=(c:typeof calls[number])=>c.rawCallId??c.callId.replace(/^\d{4}-\d{2}-\d{2}:/,'').slice(c.customerId.length+1);
  const gnss=points.filter(p=>p.kind==='gnss').flatMap(p=>{const call=calls.find(c=>c.callId===p.callId);return call?[{date:p.date,customerId:p.customerId,callId:call.customerId+':'+rawId(call),lat:p.lat,lon:p.lon,observedAt:p.observedAt??null,phase:'채택 대표 GPS',source:'RAW_MDT_GNSS' as const,validationDay:p.role.startsWith('validation')}]:[];});
  return {id:card.id,kind:'spatial',label:card.label,
   location:{...card.medoid,radiusM:card.displayRadiusM,source:'TRAINING_GNSS_CLUSTER_MEDOID',meaning:'발견기간 채택 대표점; QoE 열화 순간의 위치 아님'},
   discovery:{distinctPoorCustomers:card.poorCustomerCount,poorCalls:card.poorCallCount,days:card.poorDateCount,dropCalls:calls.filter(c=>members.has(c.callId)&&classifySipReason11(c.sipReason)==='drop').length},
   validation:{newPoorCustomers:card.validationNewCustomers,newPoorCalls:points.filter(p=>p.role==='validation-new').length,date:summary.validationDates.join(', '),definition:'후보별 발견기간과 다른 고객의 검증일 재관측'},
   normalReference:{nearbyCalls:null,distinctCustomers:null,caution:'정상 참고 표본을 별도 산정하지 않았습니다. 지역 전체 불량률 분모가 아닙니다.'},
   relatedEndCells:[...endCells].map(([id,poorCalls])=>({id,poorCalls})),
   representativeCalls:calls.filter(c=>typeof c.mos==='number'&&c.mos>=1&&c.mos<3).map(c=>({date:c.date,customerId:c.customerId,callId:c.customerId+':'+rawId(c),mos:c.mos!,endCellId:c.endCellId??'',start:c.start??c.startedAt?.slice(11,19)??''})),
   relatedGnss:gnss,relatedGnssCallCount:new Set(gnss.map(p=>p.callId)).size,
   evidence:'GNSS_CDR_ASSOCIATION',verification:'INDEPENDENT_NEXT_DAY_CUSTOMER_REPEAT',
   hypotheses:['약전계·간섭·HO 등 무선 원인 후보 (원인 미확정)','전송망·코어망·단말 및 QoE 산출 영향도 추가 검토 필요'],
   fieldChecks:['후보 조사 권역과 인접 정상 권역에서 VoLTE 현장 측정','음성 녹음·QoE·RF의 동일 측정시각 확인','관련 Cell의 HO·간섭·RTP/RTCP 근거 대조'],
   radioReference:{linkedCdrMdtRepresentativeCalls:0,rsrpMedianDbm:null,rsrqMedianDb:null,sinrMedianDb:null,warning:'선택 통화의 원본 MDT는 아래 통화 목록과 통화 상세에서 확인합니다. 이 후보 요약에는 RF 중앙값을 별도 산정하지 않았습니다.'}};
 });
}
