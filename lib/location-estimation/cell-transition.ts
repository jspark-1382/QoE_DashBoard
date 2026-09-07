import { CONFIG } from './config';
import { scoreCandidatePoint } from './candidate-grid';
import type { Candidate, BaseStation, MdtSample, RadiusEstimate, Transition } from './types';
export type Evidence = { sample: MdtSample; station: BaseStation; radius: RadiusEstimate };
export function findCellTransition(history: Evidence[]): Transition | null {
  for(let i=history.length-1;i>0;i--) {
    const a=history[i-1],b=history[i];
    if(a.sample.cellId===b.sample.cellId) continue;
    const before=history[i-2], after=history[i+1];
    const trend=Boolean(before && after && before.sample.cellId===a.sample.cellId && after.sample.cellId===b.sample.cellId &&
      a.sample.rsrp! <= before.sample.rsrp!-CONFIG.trendDb && after.sample.rsrp! >= b.sample.rsrp!+CONFIG.trendDb);
    return {from:a.station,to:b.station,timestamp:b.sample.timestamp,trend};
  }
  return null;
}
export function applyCellTransitionBonus(point: Candidate, previous: Evidence, current: Evidence, trend: boolean, slackM: number) {
  const a=scoreCandidatePoint(point,previous.station,previous.radius,slackM);
  const b=scoreCandidatePoint(point,current.station,current.radius);
  return Math.min(a,b)*(CONFIG.transitionBonus+(trend?CONFIG.transitionTrendBonus:0));
}
