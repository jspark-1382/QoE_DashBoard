import { CONFIG, DEFAULT_OPTIONS, HISTORY_WINDOW, MAX_MOVEMENT_SPEED } from './config';
import { matchBaseStation } from './master';
import { calculateRadius } from './uncertainty';
import { generateCandidateGrid, scoreCandidatePoint } from './candidate-grid';
import { movementSupport, applyMovementPenalty } from './trajectory';
import { findCellTransition, applyCellTransitionBonus, type Evidence } from './cell-transition';
import { decideConfidence } from './confidence';
import { distanceM } from './geo';
import type { MdtSample, BaseStation, PositionEstimate, EstimationOptions, Candidate } from './types';
export * from './types';
export { DEFAULT_OPTIONS } from './config';

export function estimatePosition(samples: MdtSample[], stations: BaseStation[], options: EstimationOptions = DEFAULT_OPTIONS): PositionEstimate[] {
  const results:PositionEstimate[]=[];
  let history:Evidence[]=[], previous:PositionEstimate|null=null;
  const ordered=[...samples].filter(s=>Number.isFinite(s.timestamp)).sort((a,b)=>a.timestamp-b.timestamp);
  for(const sample of ordered) {
    const last=history.at(-1)?.sample;
    if(last && (sample.streamId!==last.streamId || sample.timestamp-last.timestamp>CONFIG.maxHistoryGapSeconds*1000)) {history=[];previous=null;}
    const match=matchBaseStation(sample,stations);
    const radius=match && calculateRadius(sample,match.station,options);
    if(!match || !radius) {history=[];previous=null;continue;}
    const current={sample,station:match.station,radius};
    history=[...history,current].slice(-HISTORY_WINDOW);
    const transition=findCellTransition(history);
    const grid=generateCandidateGrid(match.station,radius);
    const scores=grid.candidates.map(point=>{
      let total=point.score, weight=1;
      for(let i=history.length-2;i>=0;i--) {
        const older=history[i], age=history.length-1-i, w=CONFIG.historyDecay**age;
        const slack=(sample.timestamp-older.sample.timestamp)/1000*MAX_MOVEMENT_SPEED[options.movementMode];
        total+=scoreCandidatePoint(point,older.station,older.radius,slack)*w;weight+=w;
      }
      let score=total/weight;
      if(previous) score*=1-CONFIG.movementWeight+CONFIG.movementWeight*movementSupport(previous.candidates,point,(sample.timestamp-previous.sample.timestamp)/1000,options.movementMode);
      if(transition) {
        const a=[...history].reverse().find(e=>e.station.cellId===transition.from.cellId);
        if(a) score+=applyCellTransitionBonus(point,a,current,transition.trend,(sample.timestamp-a.sample.timestamp)/1000*MAX_MOVEMENT_SPEED[options.movementMode]);
      }
      return {...point,score};
    });
    const max=Math.max(...scores.map(p=>p.score));
    const candidates=scores.filter(p=>p.score>=max*CONFIG.candidateFraction);
    if(!candidates.length) continue;
    const total=candidates.reduce((s,p)=>s+p.score,0);
    const centroid={latitude:candidates.reduce((s,p)=>s+p.latitude*p.score,0)/total,longitude:candidates.reduce((s,p)=>s+p.longitude*p.score,0)/total};
    // A symmetric ring's centroid lies in its excluded hole. Project to a supported grid point.
    // This is only a representative candidate, not evidence for that arbitrary bearing.
    const centerScore=(p:Candidate)=>previous
      ? p.score*(1-CONFIG.representativeContinuityWeight+CONFIG.representativeContinuityWeight*applyMovementPenalty(previous,p,(sample.timestamp-previous.sample.timestamp)/1000,options.movementMode))
      : -distanceM(p,centroid);
    const center=candidates.reduce((best,p)=>centerScore(p)>centerScore(best)?p:best,candidates[0]);
    const confidenceRadiusM=Math.max(...candidates.map(p=>distanceM(center,p)))+grid.resolution/Math.sqrt(2);
    const candidateArea=candidates.length*grid.resolution**2/1e6;
    const evidenceConsistent=max>=CONFIG.consistencyFloor;
    const quality=decideConfidence({cells:new Set(history.map(e=>e.station.latitude+','+e.station.longitude)).size,history:history.length,areaKm2:candidateArea,
      transition:!!transition,trend:transition?.trend??false,sinr:sample.sinr??null,consistent:evidenceConsistent,
      virtual:history.some(e=>e.station.isVirtual),exact:history.every(e=>matchBaseStation(e.sample,stations)?.mode==='cell'),
      knownFrequency:radius.frequencyMhz!=null,score:max});
    const transitionCandidates=transition ? candidates.filter(p=> {
      const a=history.find(e=>e.station.cellId===transition.from.cellId);
      return a && scoreCandidatePoint(p,a.station,a.radius,(sample.timestamp-a.sample.timestamp)/1000*MAX_MOVEMENT_SPEED[options.movementMode])>=CONFIG.candidateFraction;
    }):[];
    const result:PositionEstimate={...center,sample,station:match.station,radius,candidates,...quality,candidateArea,confidenceRadiusM,
      transition,transitionCandidates,historyCount:history.length,evidenceConsistent,gridResolutionM:grid.resolution,
      warnings:[...radius.warnings,...(match.mode==='station-fallback'?['Cell 미일치 · 단일 기지국 좌표 대체']:[])]};
    results.push(result);previous=result;
  }
  return results;
}
