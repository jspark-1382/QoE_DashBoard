import type {ImprovementCandidateReport} from './improvement-candidates';
import type {QualityCandidateSummary} from './quality-improvement-candidates';

export interface CandidateLocationComparison {
 legacyId:string;legacyLabel:string;oldLat:number;oldLon:number;
 nearestId:string|null;nearestLabel:string|null;newLat:number|null;newLon:number|null;
 nearestDistanceM:number|null;newRank:string;
}
export function haversineMeters(a:{lat:number;lon:number},b:{lat:number;lon:number}):number{
 const rad=Math.PI/180,lat1=a.lat*rad,lat2=b.lat*rad,dlat=(b.lat-a.lat)*rad,dlon=(b.lon-a.lon)*rad;
 const h=Math.sin(dlat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dlon/2)**2;
 return 6371008.8*2*Math.atan2(Math.sqrt(Math.max(0,h)),Math.sqrt(Math.max(0,1-h)));
}
/** Nearest coordinates are *only* a spatial reference, never a reproduced candidate identity. */
export function compareCandidateLocations(legacy:ImprovementCandidateReport,strict:QualityCandidateSummary):CandidateLocationComparison[]{
 if(legacy.sourceRevision!==strict.scope.sourceRevision)return [];
 return legacy.candidates.filter(c=>c.kind==='spatial'&&c.location!==null).map(old=>{
  const oldPoint={lat:old.location!.lat,lon:old.location!.lon};
  const nearest=strict.candidates.map(c=>({candidate:c,distance:haversineMeters(oldPoint,c.medoid)}))
    .sort((a,b)=>a.distance-b.distance)[0];
  return {legacyId:old.id,legacyLabel:old.label,oldLat:oldPoint.lat,oldLon:oldPoint.lon,
   nearestId:nearest?.candidate.id??null,nearestLabel:nearest?.candidate.label??null,
   newLat:nearest?.candidate.medoid.lat??null,newLon:nearest?.candidate.medoid.lon??null,
   nearestDistanceM:nearest?.distance??null,newRank:nearest?.candidate.rank===null?'범위 검토':String(nearest?.candidate.rank??'미산출')};
 });
}
