export type CandidateKind='spatial'|'cell';

export interface EvidenceCall {
  date:string;
  customerId:string;
  callId:string;
  mos:number;
  endCellId:string;
  start:string;
}
export interface CandidateLocation {
  lat:number;
  lon:number;
  radiusM:number|null;
  source:'TRAINING_GNSS_CLUSTER_MEDOID'|'TRAINING_MDT_ROUGH_CLUSTER_MEDOID'|'UNIQUE_INVENTORY_CELL_RU_SITE';
  ruId?:string;
  meaning:string;
}
export interface ImprovementCandidate {
  id:string;
  kind:CandidateKind;
  label:string;
  location:CandidateLocation|null;
  locationUnknownReason?:string|null;
  discovery:{
    distinctPoorCustomers:number;
    poorCalls:number;
    dropCalls:number; // SIP CDR 11.REASON H:Drop; subset of discovery poorCalls
    days:number;
    trainStart?:string; trainEnd?:string;
    scoredCalls?:number; normalCalls?:number;
    observedPoorAmongScoredPct?:number; ratioToOverallObserved?:number;
  };
  validation:{
    newPoorCustomers:number;
    newPoorCalls:number;
    date:string;
    definition:string;
  };
  normalReference:{
    nearbyCalls:number|null;
    distinctCustomers:number|null;
    caution:string;
  };
  relatedEndCells:Array<{id:string;poorCalls:number}>;
  representativeCalls:EvidenceCall[];
  /** Every real GNSS MDT event from related poor-MOS calls; not a modelled impairment position. */
  relatedGnss:Array<{
    date:string;callId:string;customerId:string;lat:number;lon:number;
    observedAt:string|null;phase:string|null;
    source:'RAW_MDT_GNSS';validationDay:boolean;
  }>;
  relatedGnssCallCount:number;
  evidence:'GNSS_CDR_ASSOCIATION'|'GNSS_MDT_ROUGH_ASSOCIATION'|'SIP_CDR_END_CELL_REPEAT';
  verification:'INDEPENDENT_NEXT_DAY_CUSTOMER_REPEAT';
  clientFdrQ?:number;
  hypotheses:string[];
  fieldChecks:string[];
  radioReference:{
    linkedCdrMdtRepresentativeCalls:number;
    rsrpMedianDbm:number|null;
    rsrqMedianDb:number|null;
    sinrMedianDb:number|null;
    warning:string;
  };
  nearbyCandidateIds?:string[];
}
export interface ImprovementCandidateReport {
  schemaVersion:'qoe-improvement-candidates-v1';
  sourceRevision:string;
  analysisDates:string[];
  trainingDates:string[];
  verificationDate:string;
  analysisWindowNote:string;
  sourceBasis:string;
  algorithm:string;
  summary:{
    cdrCalls:number;mosScored:number;poorCalls:number;
    candidateCount:number;spatialCandidateCount:number;
    distinctAffectedCustomers:number;
    cellCandidateCount:number;mappedCandidates:number;
    independentlyConfirmedRootCauses:number;
  };
  limitations:string[];
  candidates:ImprovementCandidate[];
}
const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);

export function validateImprovementReport(
  source:ImprovementCandidateReport,
  currentRevision:string,
): boolean {
  if(source.schemaVersion!=='qoe-improvement-candidates-v1' ||
    source.sourceRevision!==currentRevision ||
    source.verificationDate!=='2026-10-30' ||
    source.trainingDates.join(',')!=='2026-10-26,2026-10-27,2026-10-28,2026-10-29' ||
    source.analysisDates.join(',')!=='2026-10-26,2026-10-27,2026-10-28,2026-10-29,2026-10-30' ||
    source.summary.independentlyConfirmedRootCauses!==0 ||
    source.summary.candidateCount!==5 ||
    !Number.isInteger(source.summary.distinctAffectedCustomers) ||
    source.summary.distinctAffectedCustomers<source.summary.candidateCount ||
    source.summary.spatialCandidateCount!==3 ||
    source.summary.cellCandidateCount!==2 ||
    source.candidates.length!==5 ||
    source.summary.mappedCandidates!==4
  ) return false;
  const ids=new Set<string>();
  for(const candidate of source.candidates){
    if(ids.has(candidate.id) ||
      !['spatial','cell'].includes(candidate.kind) ||
      candidate.validation.date!==source.verificationDate ||
      candidate.validation.newPoorCustomers<2 ||
      candidate.discovery.distinctPoorCustomers<3 ||
      !Number.isInteger(candidate.discovery.dropCalls) ||
      candidate.discovery.dropCalls<0 ||
      candidate.discovery.dropCalls>candidate.discovery.poorCalls ||
      candidate.representativeCalls.length===0 ||
      !Array.isArray(candidate.relatedGnss) ||
      !Number.isInteger(candidate.relatedGnssCallCount)) return false;
    ids.add(candidate.id);
    if(candidate.location){
      const loc=candidate.location;
      if(!finite(loc.lat)||!finite(loc.lon)||loc.lat<33||loc.lat>39.8||
        loc.lon<124||loc.lon>132) return false;
      if(candidate.kind==='spatial' && (loc.source!=='TRAINING_GNSS_CLUSTER_MEDOID'||
        !finite(loc.radiusM)||loc.radiusM<100||loc.radiusM>1500)) return false;
      if(candidate.kind==='cell' && (loc.source!=='UNIQUE_INVENTORY_CELL_RU_SITE'||
        !loc.ruId||loc.radiusM!==null)) return false;
    }else if(candidate.kind!=='cell'||!candidate.locationUnknownReason)return false;
    if(candidate.relatedGnssCallCount>candidate.relatedGnss.length)return false;
    for(const point of candidate.relatedGnss){
      if(point.source!=='RAW_MDT_GNSS' || !finite(point.lat)||!finite(point.lon)||
        point.lat<33||point.lat>39.8||point.lon<124||point.lon>132||
        !/^2026-10-(2[6-9]|30)$/.test(point.date)||
        !point.callId.startsWith(point.customerId+':call-')||
        !point.customerId.startsWith('mdt-'))return false;
    }
    for(const ref of candidate.representativeCalls){
      if(!/^2026-10-(2[6-9]|30)$/.test(ref.date) ||
        !ref.customerId.startsWith('mdt-') ||
        !ref.callId.startsWith(ref.customerId+':call-') ||
        !finite(ref.mos)||ref.mos>=3) return false;
    }
  }
  return true;
}

/** Deep link uses original raw call identity and its own date; no cross-call join. */
export function callEvidenceUrl(call:EvidenceCall):string {
  const short=call.callId.slice(call.customerId.length+1);
  const query=new URLSearchParams({
    source:'MDT',view:'contract',date:call.date,
    customer:call.customerId,call:short,
  });
  return '/?'+query.toString();
}
