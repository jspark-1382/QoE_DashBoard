import type {AlternativeModelId} from './quality-model-alternatives';

export interface LearningPoint{
 id:string;x:number;y:number;date:string;customerId:string;kind:'gnss'|'reviewed-radio';
 mos:number;startSecond:number;
}
export interface LearningCandidate{
 id:string;memberIds:string[];validationIds:string[];
 customerCount:number;callCount:number;dayCount:number;newCustomers:number;
 centerX:number;centerY:number;analysisCenterX:number;analysisCenterY:number;
 radiusM:number;maxCenterM:number;maxPairM:number;rangeReview:boolean;
 score:number;metrics:Record<string,number>;
 betaCurves?:{probabilities:number[];prior:number[];posterior:number[]}|null;
}
export interface LearningDetails{
 pairABDistanceM:number;trainCount:number;normalCount:number;
 coreDistancesM?:Record<string,number>;mutualReachabilityABM?:number;
 mst?:Array<{a:string;b:string;metricM:number}>;
 edges?:Array<{a:string;b:string;distanceM:number;hours:number}>;
 densityById?:Record<string,number>;kernelWidthByIdM?:Record<string,number>;
 peakId?:string;peakDensity?:number;
 approvedSubsetPoorRate?:number;
 topWindowMetric?:Record<string,number>;
 betaCurves?:{probabilities:number[];prior:number[];posterior:number[]};
 pairABHours?:number;
}
export interface LearningState{
 case:string;params:Record<string,number>;
 points:LearningPoint[];normalPoints:LearningPoint[];validationPoints:LearningPoint[];
 candidates:LearningCandidate[];details:LearningDetails;
}
export interface LearningManifest{
 version:1;cases:Record<string,{name:string;note:string}>;
 controls:Record<AlternativeModelId,Record<string,number[]>>;
 defaults:Record<AlternativeModelId,Record<string,number>>;
 labels:Record<AlternativeModelId,Record<string,string>>;
}
export interface LearningBundle{
 schemaVersion:'quality-educational-model-sim-v1';
 model:AlternativeModelId;states:Record<string,LearningState>;
}
export const LEARNING_BASE='/qoe/quality-model-simulations/v1/';
/** Python sorted name/value pairs are used as a canonical, reproducible key. */
export function learningStateKey(caseId:string,params:Record<string,number>):string{
 return caseId+'|'+Object.entries(params).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,v])=>
  k+':'+(k==='bandwidth_scale'?v.toFixed(1):String(v))).join('|');
}
async function getJson<T>(file:string,signal?:AbortSignal):Promise<T>{
 if(!/^[a-z0-9_-]+(?:\.json)?$/.test(file))throw new Error('교육용 시뮬레이터 파일 경로가 잘못됐습니다.');
 const response=await fetch(LEARNING_BASE+file,{signal,cache:'no-cache'});
 if(!response.ok)throw new Error('교육용 시뮬레이터 계산 파일을 읽을 수 없습니다 ('+response.status+').');
 return response.json() as Promise<T>;
}
export async function loadLearningBundle(model:AlternativeModelId,signal?:AbortSignal){
 const [manifest,bundle]=await Promise.all([getJson<LearningManifest>('index.json',signal),getJson<LearningBundle>(model+'.json',signal)]);
 if(manifest.version!==1||bundle.schemaVersion!=='quality-educational-model-sim-v1'||bundle.model!==model||!manifest.controls[model])
  throw new Error('시뮬레이터 모델 또는 버전이 일치하지 않습니다.');
 const defaults=manifest.defaults[model];
 for(const scenario of Object.keys(manifest.cases)){
  const key=learningStateKey(scenario,defaults);
  if(!bundle.states[key])throw new Error('모델 기본 시뮬레이션 계산이 누락됐습니다.');
 }
 return {manifest,bundle};
}
