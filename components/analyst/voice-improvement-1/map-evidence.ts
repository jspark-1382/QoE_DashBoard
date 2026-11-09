import type { ImprovementReport,NearbyPoint,SpatialCandidate } from '../../../lib/analyst/voice-improvement-1/types';

export type ObservationPoint=Omit<NearbyPoint,'role'>;
/** Observation-only screening is a display layer, never a synthesized candidate. */
export function mapEvidencePoints(report:ImprovementReport|null,selected:SpatialCandidate|undefined):{nearbyPoints:readonly NearbyPoint[];observationPoints:ObservationPoint[]}{
 if(!report)return {nearbyPoints:[],observationPoints:[]};
 if(report.improvedSpatialCandidates.length)return {nearbyPoints:selected?.nearbyPoints??[],observationPoints:[]};
 const raw=report.diagnostics.observationPoints;
 if(!Array.isArray(raw))return {nearbyPoints:[],observationPoints:[]};
 const calls=new Map(report.calls.map(c=>[c.callId,c]));
 const decisions=new Map(report.decisions.map(d=>[d.callId,d]));
 const seen=new Set<string>();
 const observationPoints:ObservationPoint[]=[];
 for(const value of raw){
  if(!value||typeof value!=='object')continue;
  const point=value as ObservationPoint,call=calls.get(point.callId),decision=decisions.get(point.callId);
  if(!call||!decision||seen.has(point.callId)||decision.status!=='accepted'||decision.kind!==point.kind||decision.lat!==point.lat||decision.lon!==point.lon||call.customerId!==point.customerId||call.date!==point.date||call.mos===null||call.mos<1||call.mos>=3||!Number.isFinite(point.lat)||!Number.isFinite(point.lon))continue;
  seen.add(point.callId);observationPoints.push(point);
 }
 return {nearbyPoints:[],observationPoints};
}
