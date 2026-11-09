import type { AnalystDay, AnalystSample, OverviewCallLocation } from '../types';
import { reviewAdaptivePosition } from '../../location-estimation/review';
import { distanceM } from '../../location-estimation/geo';
import type { EvidenceCall, EvidenceDecision } from './types';

const coordinate=(lat:unknown,lon:unknown)=>typeof lat==='number'&&typeof lon==='number'&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180&&(lat!==0||lon!==0);
const timestamp=(value:string|null|undefined)=>value?Date.parse(value):NaN;
function replayRadio(sample:AnalystSample):ReturnType<typeof reviewAdaptivePosition>|null {
  const e=sample.estimation;
  if(!e||!Array.isArray(e.usedSites)||!Array.isArray(e.warnings)||e.usedSites.some(s=>!s.siteId||![s.estimatedDistanceM,s.deltaTimeSec,s.latitude,s.longitude,s.residualM].every(Number.isFinite))||
    ![e.siteCount,e.windowSec,e.geometry,sample.accuracyM,sample.confidence].every(v=>typeof v==='number'&&Number.isFinite(v))||typeof e.jump!=='boolean')return null;
  const result=reviewAdaptivePosition({
    ...e,estimatedLat:e.candidateLat??sample.lat,estimatedLon:e.candidateLon??sample.lon,
    estimatedAccuracyM:sample.accuracyM,confidenceScore:sample.confidence!,
    sample:{timestamp:sample.timestamp,cellId:sample.cellId,baseStationId:sample.baseStationId,frequency:sample.frequency,rsrp:sample.rsrp,rsrq:sample.rsrq,sinr:sample.sinr,streamId:sample.callId,sampleIndex:sample.index},
    timestamp:sample.timestamp,usedCellIds:[...new Set(e.usedSites.flatMap(s=>s.cellIds))],usedCellCount:new Set(e.usedSites.flatMap(s=>s.cellIds)).size,
    avgRsrp:null,strongestRsrp:null,confidenceGrade:'',breakBefore:false,speedKmh:null,
  });
  const anchor=sample.gnssReference;
  if(result.accepted&&anchor&&coordinate(e.candidateLat??sample.lat,e.candidateLon??sample.lon)){
    const displacement=distanceM({latitude:anchor.lat,longitude:anchor.lon},{latitude:(e.candidateLat??sample.lat)!,longitude:(e.candidateLon??sample.lon)!});
    if(displacement>anchor.movementRadiusM){result.accepted=false;result.reasons.push('최근 GPS 기준 이동 가능 범위 이탈');}
  }
  // normalizeDay may reject a replayable solver for an additional source rule.
  if(e.review?.accepted===false){result.accepted=false;result.reasons.push(...e.review.reasons);}
  return result;
}
/** Preserve original GNSS timing policy (180s before end; 1s rounding after). */
export function selectCandidateEvidence(call:EvidenceCall,gnss:OverviewCallLocation|null,day:AnalystDay|null):EvidenceDecision {
  const lineage={sourceRevision:call.sourceRevision,sourceFile:call.sourceFile,rawCallId:call.rawCallId,date:call.date};
  const exclude=(reasons:string[]):EvidenceDecision=>({callId:call.callId,status:'excluded',reasons:[...new Set(reasons)],lineage});
  if(!call.callId||!call.rawCallId||!call.customerId||!call.sourceRevision||!call.sourceFile)return exclude(['missing-lineage']);
  if(call.mdtLinkStatus!=='unique')return exclude(['mdt-'+call.mdtLinkStatus]);
  const reasons:string[]=[];
  if(gnss?.evidence==='gnss'){
    if(![call.callId,call.rawCallId,call.customerId+':'+call.rawCallId].includes(gnss.callId))reasons.push('different-call-gnss');
    if(!coordinate(gnss.lat,gnss.lon))reasons.push('invalid-coordinate');
    const observed=timestamp(gnss.observedAt),end=timestamp(call.endedAt??gnss.cdrEndAt),age=(end-observed)/1000;
    if(!Number.isFinite(observed)||!Number.isFinite(end))reasons.push('missing-observation-time');
    else if(age < -1||age>180)reasons.push('gnss-outside-original-time-policy');
    if(!reasons.length)return {callId:call.callId,status:'accepted',kind:'gnss',lat:gnss.lat,lon:gnss.lon,observedAt:gnss.observedAt,ageSec:age,referenceBasis:gnss.referenceBasis??'direct-gnss',reasons:[],lineage};
  }else if(gnss)reasons.push(gnss.evidence==='bye-cell'?'bye-only':'unreviewed-estimate');
  if(day&&day.source==='MDT'&&day.date===call.date&&day.customerId===call.customerId){
    const end=timestamp(call.endedAt??gnss?.cdrEndAt);
    const samples=day.samples.filter(s=>s.callId===call.rawCallId&&s.locationSource==='radio'&&coordinate(s.lat,s.lon)&&Number.isFinite(s.timestamp))
      .sort((a,b)=>Math.abs(end-a.timestamp)-Math.abs(end-b.timestamp)||a.index-b.index);
    for(const sample of samples){
      const review=replayRadio(sample),age=(end-sample.timestamp)/1000;
      if(!Number.isFinite(age)||age < -1||age>180){reasons.push('radio-outside-original-time-policy');continue;}
      if(!review){reasons.push('missing-radio-diagnostics');continue;}
      if(!review.accepted){reasons.push(...review.reasons);continue;}
      return {callId:call.callId,status:'accepted',kind:'reviewed-radio',lat:sample.lat!,lon:sample.lon!,observedAt:new Date(sample.timestamp).toISOString(),ageSec:age,referenceBasis:'reviewed-radio',review,reasons:[],lineage};
    }
  }else if(day)reasons.push('different-call-day');
  return exclude(reasons.length?reasons:['no-eligible-location']);
}
