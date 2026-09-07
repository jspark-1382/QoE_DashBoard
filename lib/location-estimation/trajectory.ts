import { CONFIG, MAX_MOVEMENT_SPEED } from './config';
import { distanceM } from './geo';
import type { Point, Candidate, EstimationOptions } from './types';
export function applyMovementPenalty(previous: Point, current: Point, deltaTime: number, mode: EstimationOptions['movementMode'] = 'unknown') {
  const allowance = Math.max(0,deltaTime)*MAX_MOVEMENT_SPEED[mode];
  const excess = Math.max(0,distanceM(previous,current)-allowance);
  return Math.max(CONFIG.movementFloor, Math.exp(-((excess/Math.max(CONFIG.movementSoftScaleM,allowance))**2)));
}
export function movementSupport(previous: Candidate[], current: Candidate, seconds: number, mode: EstimationOptions['movementMode']) {
  // Distributed representatives retain alternative directions on a single-cell ring.
  const step=Math.max(1,Math.ceil(previous.length/CONFIG.beamSize));
  let support=CONFIG.movementFloor;
  for(let i=0;i<previous.length;i+=step) support=Math.max(support,applyMovementPenalty(previous[i],current,seconds,mode));
  return support;
}
