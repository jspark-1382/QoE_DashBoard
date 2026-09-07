import { CONFIG, GRID_RESOLUTION } from './config';
import { distanceM, offsetPoint } from './geo';
import type { Point, RadiusEstimate, Candidate } from './types';
export function scoreCandidatePoint(point: Point, station: Point, radius: RadiusEstimate, movementSlackM = 0) {
  const error = Math.max(0, Math.abs(distanceM(point, station)-radius.estimatedRadiusM)-movementSlackM);
  const width = Math.max(1, radius.outerRadiusM-radius.estimatedRadiusM);
  return Math.max(CONFIG.currentRingFloor, 1-error/width);
}
export function generateCandidateGrid(station: Point, radius: RadiusEstimate) {
  const resolution = Math.max(GRID_RESOLUTION, Math.ceil(2*radius.outerRadiusM/Math.sqrt(CONFIG.maxGridPoints)));
  const candidates: Candidate[] = [];
  for (let north=-radius.outerRadiusM; north<=radius.outerRadiusM; north+=resolution) {
    for (let east=-radius.outerRadiusM; east<=radius.outerRadiusM; east+=resolution) {
      const point=offsetPoint(station,east,north), d=distanceM(point,station);
      if (d>=radius.innerRadiusM && d<=radius.outerRadiusM) candidates.push({...point,score:scoreCandidatePoint(point,station,radius)});
    }
  }
  // Very small rings still need directional alternatives (not a made-up bearing).
  if (!candidates.length) for(let i=0;i<16;i++) candidates.push({...offsetPoint(station, radius.estimatedRadiusM*Math.cos(i*Math.PI/8),radius.estimatedRadiusM*Math.sin(i*Math.PI/8)),score:1});
  return { candidates, resolution };
}
