import type {CandidateRoughPoint} from './quality-candidate-rough-points';

/** Visible candidate display circles; NOT geolocation-accuracy envelopes. */
export interface CandidateDisplayCircle {
  id:string;
  location:{lat:number;lon:number;radiusM:number|null}|null;
}
export interface CandidateRoughMatch extends CandidateRoughPoint {
  matchingCandidateIds:string[];
}
const RAD=Math.PI/180;
export function candidateCircleDistanceM(a:{lat:number;lon:number},b:{lat:number;lon:number}):number{
  if(!Number.isFinite(a.lat)||!Number.isFinite(a.lon)||
     !Number.isFinite(b.lat)||!Number.isFinite(b.lon))return Number.POSITIVE_INFINITY;
  const dLat=(b.lat-a.lat)*RAD,dLon=(b.lon-a.lon)*RAD;
  const f=a.lat*RAD,g=b.lat*RAD;
  const s=Math.sin(dLat/2)**2+Math.cos(f)*Math.cos(g)*Math.sin(dLon/2)**2;
  return 12742000*Math.asin(Math.min(1,Math.sqrt(s)));
}
/**
 * Display-only: retain a rough point iff its ESTIMATED CENTRE falls within
 * at least one candidate circle already drawn on the map. This does not mean
 * its own broad uncertainty region intersects the candidate, nor validate
 * radio geometry. A call is displayed once even when circles overlap.
 */
export function matchCandidateRoughPoints(
  candidates:readonly CandidateDisplayCircle[],
  points:readonly CandidateRoughPoint[],
):CandidateRoughMatch[]{
  const circles=candidates.filter(c=>c.id && c.location &&
    Number.isFinite(c.location.lat) && Number.isFinite(c.location.lon) &&
    Number.isFinite(c.location.radiusM) && (c.location.radiusM??0)>0);
  const seen=new Set<string>();
  const result:CandidateRoughMatch[]=[];
  for(const point of points){
    if(seen.has(point.callId)||!point.callId||
       !Number.isFinite(point.lat)||!Number.isFinite(point.lon))continue;
    const ids=circles.filter(c=>
      candidateCircleDistanceM(point,c.location!) <= (c.location!.radiusM??0)
    ).map(c=>c.id);
    if(!ids.length)continue;
    result.push({...point,matchingCandidateIds:ids});
    seen.add(point.callId);
  }
  return result;
}
