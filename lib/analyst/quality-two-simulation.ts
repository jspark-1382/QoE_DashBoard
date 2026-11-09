/**
 * Self-contained, EXPLANATORY simulation of the existing strict candidate policy.
 * Uses a synthetic 1-D local-meter scene to make geometry easy to follow.
 * Does not read/modify stored QoE evidence, and does not generate field candidates.
 * Policy gates/DBSCAN match scripts/voice_improvement_1.py. Real data uses
 * Haversine for latitude/longitude; this tiny diagram uses planar distances.
 */
export type SimLocationKind='gnss'|'reviewed-radio'|'bye-cell';
export interface SimulationSettings{
 mos:number; uniqueMdt:boolean; locationKind:SimLocationKind;
 uniqueCustomers:number;observedDays:number;spacingM:number;
 newCustomers:number;validationDistanceM:number;
}
export interface SimPoint {id:string;customer:string;day:number;x:number;y:number}
export interface SimulationResult {
 accepted:boolean;rejectReason:string;
 points:SimPoint[];clusters:SimPoint[][];noise:SimPoint[];
 members:SimPoint[];qualifies:boolean;customers:number;days:number;
 medoid:SimPoint|null;maxCenterDistanceM:number;maxPairDistanceM:number;displayRadiusM:number;
 rangeReviewRequired:boolean;nearbyNewCustomers:number;validationPass:boolean;
 validationPoints:SimPoint[];validationNear:SimPoint[];
}
export const DEFAULT_SIM_SETTINGS:SimulationSettings={
 mos:2.7,uniqueMdt:true,locationKind:'gnss',
 uniqueCustomers:5,observedDays:3,spacingM:45,
 newCustomers:2,validationDistanceM:60,
};
/** 이웃 검색용 반경: 각 저MOS 통화 관측점마다 검사 (고객별 최종 조사 원이 아님). */
export const SIM_NEIGHBOR_EPS_M=100;
/** 대표점에서 가장 먼 구성점까지의 거리에 추가하는 표시용 여유 거리. */
export const SIM_DISPLAY_MARGIN_M=20;
const EPS=SIM_NEIGHBOR_EPS_M,MIN_SAMPLES=2,MIN_CUSTOMERS=3,MIN_DAYS=2;
const dist=(a:SimPoint,b:SimPoint)=>Math.hypot(a.x-b.x,a.y-b.y);
export function evaluateCandidateSimulation(s:SimulationSettings):SimulationResult{
 const accepted=Number.isFinite(s.mos)&&s.mos>=1&&s.mos<3&&s.uniqueMdt&&s.locationKind!=='bye-cell';
 const rejectReason=!(Number.isFinite(s.mos)&&s.mos>=1&&s.mos<3)?'QoE가 1 이상 3 미만이 아닙니다.'
  :!s.uniqueMdt?'CDR과 MDT가 고유하게 연결되지 않았습니다.'
  :s.locationKind==='bye-cell'?'BYE 기지국 위치는 고객 위치 근거로 채택할 수 없습니다.':'위치 증거가 채택됐습니다.';
 const count=Math.max(1,Math.min(5,Math.round(s.uniqueCustomers)));
 const dayCount=Math.max(1,Math.min(3,Math.round(s.observedDays)));
 const spacing=Math.max(20,Math.min(120,s.spacingM));
 const points=accepted?Array.from({length:5},(_,i)=>({
  id:'D'+(i+1),customer:String.fromCharCode(65+i%count),
  day:1+(i%dayCount),x:i*spacing,y:0
 })):[];
 // DBSCAN with min_samples including the observation itself. All data points
 // remain individually identified; repeated calls from one customer do not
 // substitute for distinct customer support.
 const labels=Array.from({length:points.length},()=>-2),clusters:SimPoint[][]=[];
 const neighbours=(idx:number)=>points.map((p,j)=>dist(p,points[idx])<=EPS+1e-8?j:-1).filter(j=>j>=0);
 for(let i=0;i<points.length;i++){
  if(labels[i]!==-2)continue;
  const near=neighbours(i);
  if(near.length<MIN_SAMPLES){labels[i]=-1;continue;}
  const label=clusters.length;
  const seeds=[...near];const queued=new Set(seeds);
  labels[i]=label;
  for(let k=0;k<seeds.length;k++){
   const j=seeds[k];
   if(labels[j]===-1)labels[j]=label;
   if(labels[j]!==-2)continue;
   labels[j]=label;
   const next=neighbours(j);
   if(next.length>=MIN_SAMPLES)for(const candidate of next)
    if(!queued.has(candidate)){queued.add(candidate);seeds.push(candidate);}
  }
  clusters.push(points.filter((_,j)=>labels[j]===label));
 }
 const noise=points.filter((_,i)=>labels[i]===-1);
 const members=clusters.slice().sort((a,b)=>b.length-a.length)[0]??[];
 const customers=new Set(members.map(p=>p.customer)).size,days=new Set(members.map(p=>p.day)).size;
 const qualifies=members.length>=MIN_SAMPLES&&customers>=MIN_CUSTOMERS&&days>=MIN_DAYS;
 let medoid:SimPoint|null=null,maxCenterDistanceM=0,maxPairDistanceM=0,displayRadiusM=0;
 if(qualifies){
  medoid=members.reduce((best,p)=>Math.max(...members.map(q=>dist(p,q)))<Math.max(...members.map(q=>dist(best,q)))?p:best,members[0]);
  maxCenterDistanceM=Math.max(...members.map(p=>dist(medoid!,p)));
  maxPairDistanceM=Math.max(...members.flatMap(p=>members.map(q=>dist(p,q))));
  displayRadiusM=Math.ceil(Math.max(SIM_NEIGHBOR_EPS_M,maxCenterDistanceM+SIM_DISPLAY_MARGIN_M)/10)*10;
 }
 const numberNew=Math.max(0,Math.min(3,Math.round(s.newCustomers)));
 const vd=Math.max(20,Math.min(160,s.validationDistanceM));
 const last=members.at(-1);
 const validationPoints=qualifies&&last?
  Array.from({length:numberNew},(_,i)=>({id:'V'+(i+1),customer:String.fromCharCode(70+i),day:4,x:last.x+vd,y:(i-1)*8})):[];
 const validationNear=validationPoints.filter(p=>members.some(member=>dist(member,p)<=EPS+1e-8));
 const nearbyNewCustomers=new Set(validationNear.map(p=>p.customer)).size;
 return {accepted,rejectReason,points,clusters,noise,members,qualifies,customers,days,medoid,maxCenterDistanceM,maxPairDistanceM,displayRadiusM,
  rangeReviewRequired:qualifies&&maxPairDistanceM>2*EPS,
  nearbyNewCustomers,validationPass:qualifies&&nearbyNewCustomers>=2,validationPoints,validationNear};
}
