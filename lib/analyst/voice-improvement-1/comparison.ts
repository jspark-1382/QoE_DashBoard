import { distanceM } from '../../location-estimation/geo';
import type { SpatialCandidate } from './types';
export interface CandidateCorrespondence {
  beforeId:string;afterId:string;sharedCallCount:number;beforeOverlap:number;afterOverlap:number;centerDistanceM:number;
}
export function compareSpatialCandidates(before:readonly SpatialCandidate[],after:readonly SpatialCandidate[]):CandidateCorrespondence[]{
  const result:CandidateCorrespondence[]=[];
  for(const a of before){
    if(a.kind&&a.kind!=='spatial')continue;
    const aIds=new Set(a.memberCallIds);
    for(const b of after){
      if(b.kind&&b.kind!=='spatial')continue;
      const bIds=new Set(b.memberCallIds),shared=[...aIds].filter(id=>bIds.has(id)).length;
      if(!shared)continue;
      result.push({beforeId:a.id,afterId:b.id,sharedCallCount:shared,beforeOverlap:shared/aIds.size,afterOverlap:shared/bIds.size,
        centerDistanceM:distanceM({latitude:a.medoid.lat,longitude:a.medoid.lon},{latitude:b.medoid.lat,longitude:b.medoid.lon})});
    }
  }
  return result.sort((a,b)=>a.beforeId.localeCompare(b.beforeId)||b.sharedCallCount-a.sharedCallCount||a.afterId.localeCompare(b.afterId));
}
