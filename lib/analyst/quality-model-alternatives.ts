import type {QualityCandidateScope} from './quality-improvement-candidates';

export type AlternativeModelId='hdbscan'|'st_dbscan'|'adaptive_kde'|'spatial_scan'|'bayesian';
export type QualityModelId='dbscan'|AlternativeModelId;
export const MODEL_OPTIONS:ReadonlyArray<{id:QualityModelId;name:string;short:string;group:string}>= [
 {id:'dbscan',name:'DBSCAN',short:'100m 이웃 군집',group:'GPS·MDT 통합'},
 {id:'hdbscan',name:'HDBSCAN',short:'다중 밀도 안정 군집',group:'공간 군집'},
 {id:'st_dbscan',name:'ST-DBSCAN',short:'공간 100m + 시간 48h',group:'시공간 군집'},
 {id:'adaptive_kde',name:'Adaptive KDE',short:'위치 종류별 커널 밀도',group:'밀도 탐색'},
 {id:'spatial_scan',name:'Spatial Scan',short:'관측 표본 기준 우도비 탐색',group:'탐색 전용'},
 {id:'bayesian',name:'Bayesian (Empirical Bayes)',short:'위치·시간 가중 사후분포',group:'탐색 전용'}
];
export interface ModelObservation {
 callId:string;customerId:string;date:string;mos:number;lat:number;lon:number;
 kind:'gnss'|'reviewed-radio'|'rough';startSecond:number;observedAt?:string|null;roughSearchRadiusM?:number;usedSiteCount?:number;positionStatus?:string;
}
export interface AlternativeCandidate{
 id:string;lat:number;lon:number;radiusM:number;rank:number|null;
 poorCustomers:number;poorCalls:number;days:number;gnssCalls:number;roughCalls?:number;medoidKind?:'gnss'|'reviewed-radio'|'rough';locationMode?:string;locationUnvalidated?:boolean;
 validationNewCustomers:number;validationStatus:string;
 maxCenterDistanceM:number;maxPairDistanceM:number;rangeReviewRequired:boolean;
 rankingScore:number;metric:Record<string,number>;
 members:ModelObservation[];validationPoints:ModelObservation[];
}
export interface AlternativeModelEntry{
 status:'computed'|'exploratory-located-only';
 parameters:Record<string,unknown>;
 discoveryApprovedPoorCalls?:number;discoveryApprovedNormalCalls?:number;discoveryLocatedPoorCalls?:number;discoveryLocatedNormalCalls?:number;
 candidates:AlternativeCandidate[];
}
export interface AlternativeModelReport{
 schemaVersion:'quality-alternative-models-v1';
 sourceRevision:string;scope:QualityCandidateScope;scopeKey:string;analysisMode?:'all'|'evaluation';
 discoveryDates:string[];validationDates:string[];
 coverage:{poorScored:number;normalScored:number;poorLocated:number;normalLocated:number};locationMode?:string;locationUnvalidated?:boolean;inputCounts?:{gpsPoor:number;roughPoor:number;gpsNormal:number;roughNormal:number};
 selectionBiasWarning:string;
 models:Record<AlternativeModelId,AlternativeModelEntry>;
}
interface ModelIndex{
 schemaVersion:'quality-model-index-v1';sourceRevision:string;
 entries:Array<{scopeKey:string;scope:QualityCandidateScope;path:string}>;
}
const BASE='/qoe/quality-models/';
const MIXED_FULL='/qoe/quality-models-mixed-full/';
const MIXED_EVAL='/qoe/quality-models-mixed-evaluation/';
const MIXED_TAG='gps-mdt-rough-unvalidated-v1';
const safePath=(path:string)=>!path.includes('..')&&!path.startsWith('/')&&/^[-a-zA-Z0-9_/.]+$/.test(path);
const sameScope=(a:QualityCandidateScope,b:QualityCandidateScope)=>a.sourceRevision===b.sourceRevision&&
 a.dateStart===b.dateStart&&a.dateEnd===b.dateEnd&&a.from===b.from&&a.to===b.to&&a.policy===b.policy;
async function read<T>(path:string,signal?:AbortSignal,base=BASE):Promise<T>{
 if(!safePath(path))throw new Error('모델 자료 경로가 유효하지 않습니다.');
 const response=await fetch(base+path,{signal,cache:'no-cache'});
 if(!response.ok)throw new Error(response.status===404?'이 분석 조건에 대한 대안 모델 결과가 없습니다.':'모델 자료를 불러오지 못했습니다.');
 return response.json() as Promise<T>;
}
export async function loadAlternativeModelReport(scope:QualityCandidateScope,signal?:AbortSignal,mode:'all'|'evaluation'='evaluation',source:'strict'|'mixed'='strict'):Promise<AlternativeModelReport>{
 const base=source==='mixed'?(mode==='all'?MIXED_FULL:MIXED_EVAL):mode==='all'?'/qoe/quality-models-full/':BASE;
 const idx=await read<ModelIndex>('index.json',signal,base);
 if(idx.schemaVersion!=='quality-model-index-v1'||idx.sourceRevision!==scope.sourceRevision||(source==='mixed')!==((idx as ModelIndex&{locationMode?:string}).locationMode===MIXED_TAG))
  throw new Error('대안 모델과 현재 원본의 버전이 일치하지 않습니다.');
 const entry=idx.entries.find(e=>sameScope(e.scope,scope));
 if(!entry)throw new Error('이 기간·시간 조합은 아직 대안 모델 결과를 생성하지 않았습니다.');
 const result=await read<AlternativeModelReport>(entry.path,signal,base);
 if(result.schemaVersion!=='quality-alternative-models-v1'||(result.analysisMode??'evaluation')!==mode||(source==='mixed')!==(result.locationMode===MIXED_TAG)||result.sourceRevision!==scope.sourceRevision||
  !sameScope(result.scope,scope)||result.scopeKey!==entry.scopeKey||result.discoveryDates.some(d=>d<scope.dateStart||d>scope.dateEnd)||
  result.validationDates.some(d=>d<scope.dateStart||d>scope.dateEnd||result.discoveryDates.includes(d)))
  throw new Error('대안 모델 자료의 기간·원본 버전 검증에 실패했습니다.');
 for(const id of ['hdbscan','st_dbscan','adaptive_kde','spatial_scan','bayesian'] as AlternativeModelId[]){
  const model=result.models[id];
  if(!model||!['computed','exploratory-located-only'].includes(model.status)||!Array.isArray(model.candidates)||
   new Set(model.candidates.map(c=>c.id)).size!==model.candidates.length||
   model.candidates.some(c=>!Number.isFinite(c.lat)||!Number.isFinite(c.lon)||c.radiusM<=0||
    c.members.length!==c.poorCalls||new Set(c.members.map(p=>p.customerId)).size!==c.poorCustomers||
    c.members.some(p=>!(p.mos>=1&&p.mos<3)||!result.discoveryDates.includes(p.date))||
    c.validationPoints.some(p=>!result.validationDates.includes(p.date))))
    throw new Error('대안 모델 후보 근거 또는 원본 날짜가 잘못됐습니다.');
 }
 return result;
}
export const MODEL_EXPLANATIONS:Record<AlternativeModelId,{title:string;overview:string;criterion:string;scopeNote:string;meaning:string}>={
 hdbscan:{
  title:'HDBSCAN · 여러 밀도 수준에서 안정적인 저QoE 군집',
  overview:'발견기간 GPS와 MDT RSRP 가중중심으로 위치가 확보된 저QoE를 대상으로 Haversine HDBSCAN(min_cluster_size 3, min_samples 2)을 계산하고, 독립 고객 3명·2일 이상 조건을 후처리합니다.',
  criterion:'밀도가 다른 지역의 군집이 별도로 나올 수 있지만, 표본이 적으면 군집에서 제외되기도 합니다.',
  scopeNote:'정상 통화가 분모로 입력되지 않는 위치 집중 탐색입니다.',
  meaning:'지도 원은 해당 군집의 대표 구성점에서 가장 먼 구성점까지의 거리에 여유 20m를 더한 표시 범위입니다.'
 },
 st_dbscan:{
  title:'ST-DBSCAN · 위치와 발생 시각을 동시에 고려',
  overview:'통화 발생 시각을 사용하여 공간 100m·시간 48시간 이웃을 동시에 충족하는 관측점을 연결합니다. 최소 이웃 수 2, 독립 고객 3명·2일 이상을 요구합니다.',
  criterion:'같은 지역에서도 시간 간격이 벌어지면 다른 군집이 됩니다. 검증일은 발견군집 생성에 포함하지 않습니다.',
  scopeNote:'시간 임계값 48시간은 비교 실험용 가정이며, 반복 장애의 주기성은 별도 분석이 필요합니다.',
  meaning:'지도 원은 승인된 군집 구성점들의 표시 범위이지 정확한 QoE 저하 발생점이 아닙니다.'
 },
 adaptive_kde:{
  title:'Adaptive KDE · 저QoE 관측 밀도 피크',
  overview:'GPS는 커널 폭 70m, MDT RSRP 근사는 160m로 가정한 가우시안 커널의 합을 계산합니다. 각 고객 가중치를 조정하여 반복 통화에 의한 과대 밀집을 완화합니다.',
  criterion:'밀도 피크 주변 180m 이내 저QoE 관측점을 후보로 구성하고, 서로 다른 고객 3명·관측 2일 이상을 적용합니다.',
  scopeNote:'GPS 70m/MDT 근사 160m 커널 폭은 실제 측위 오차가 아니라 탐색용 민감도 가정입니다. 정상 통화 대비 상대위험도를 계산한 것은 아닙니다.',
  meaning:'지도 원은 밀도 피크 주변 탐색 반경 180m이며 DBSCAN 대표점의 100m 이웃 원과 계산 방식이 다릅니다.'
 },
 spatial_scan:{
  title:'Spatial Scan · 위치 확보 표본의 우도비 탐색',
  overview:'발견기간에 GPS 또는 MDT RSRP 근사 위치가 확보된 QoE 평가 통화만 이용합니다. 100·200·400m 원창의 내부·외부 저QoE 비율에 대한 Bernoulli 로그우도비를 계산하고 99회 라벨 순열의 최대통계량으로 조건부 p값을 구합니다.',
  criterion:'우도비가 큰 탐색창 중 독립 고객 3명·2일 이상을 충족하는 후보를 보여줍니다.',
  scopeNote:'GPS·MDT 근사 위치의 확보율과 정확도는 QoE·지역별로 달라질 수 있습니다. 조건부 p값은 위치 확보 표본 내 결과일 뿐 망 전체의 유의한 불량률을 의미하지 않습니다.',
  meaning:'지도 원은 스캔 창의 반경(100·200·400m)입니다. 현장 개선 우선순위에 직접 반영하지 마세요.'
 },
 bayesian:{
  title:'Bayesian 실험형 · 시공간 가중 Empirical Bayes',
  overview:'위치 확보 표본의 기준 저QoE 비율로 강도 20인 Beta 사전분포를 만들고, 공간 200m 가우시안 가중치와 하루당 0.7의 시간 감쇠를 적용한 가중 성공/실패 건수로 사후분포를 계산합니다.',
  criterion:'발견기간의 독립 고객 3명·2일 이상을 만족하는 220m 반경 관측 후보를 표시합니다.',
  scopeNote:'BYM2 등의 완전한 공간계층모형이 아닙니다. GPS·MDT 추정 위치의 오차·표본 선택 편향 및 관측점 의존성 때문에 사후확률·신용구간은 망 전체 위험 확률이 아닙니다.',
  meaning:'지도 원은 실험적 사후분포를 설명하기 위한 220m 근방이며 위치 오차반경이 아닙니다.'
 }
};
