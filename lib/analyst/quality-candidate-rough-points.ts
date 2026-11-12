import type {AnalystOverview} from './types';
import {overlayThreeSiteRough,type ThreeSiteRoughDataset} from './three-site-rough';
import {buildImprovedView} from './improved-overview';
import type {QualityCandidateScope} from './quality-improvement-candidates';
import {candidateResource} from './candidate-resource-cache';

export interface CandidateRoughPoint {
  callId:string;
  customerId:string;
  date:string;
  lat:number;
  lon:number;
  observedAt:string|null;
  cdrEndAt:string|null;
  secondsBeforeEnd:number|null;
  roughSearchRadiusM:number;
  usedSiteCount:number;
  usedStations:Array<{ruId:string;cellId:string;lat:number;lon:number;rsrpDbm:number}>;
}

/** The rough centroids are a display-only reference layer, NOT DBSCAN evidence. */
export function buildCandidateRoughPoints(
  overview:AnalystOverview,
  scope:QualityCandidateScope,
  partitions:readonly ThreeSiteRoughDataset[],
):CandidateRoughPoint[]{
  if(overview.sourceRevision!==scope.sourceRevision || partitions.length===0)return [];
  const first=Date.parse(scope.dateStart+'T00:00:00Z');
  const last=Date.parse(scope.dateEnd+'T00:00:00Z');
  const validDates=Number.isFinite(first)&&Number.isFinite(last)&&last>=first&&last-first<=31*86400000;
  if(!validDates)return [];
  const dateRange:string[]=[];
  for(let t=first;t<=last;t+=86400000)dateRange.push(new Date(t).toISOString().slice(0,10));
  const byDate=new Map(partitions.map(part=>[part.date,part]));
  if(new Set(partitions.map(p=>p.date)).size!==dateRange.length||
     dateRange.some(date=>{
       const item=byDate.get(date);
       return !item||item.sourceRevision!==scope.sourceRevision||
         item.schemaVersion!=='coarse-three-site-v1'||
         item.method!=='THREE_SITE_RSRP_CENTROID'||item.notA90PercentAccuracyRegion!==true||
         !Array.isArray(item.points);
     }))return [];
  const combined:ThreeSiteRoughDataset={
    schemaVersion:'coarse-three-site-v1',
    sourceRevision:scope.sourceRevision,
    date:overview.date,
    method:'THREE_SITE_RSRP_CENTROID',
    counts:{},
    notA90PercentAccuracyRegion:true,
    points:dateRange.flatMap(d=>byDate.get(d)!.points),
  };
  // Reuse the same source-validation, GPS priority and low-QoE selection as
  // the existing overview map, not a copy of its approximating algorithm.
  const overlaid=overlayThreeSiteRough(overview,combined,true);
  const view=buildImprovedView(overlaid,{
    from:scope.from,to:scope.to,hour:null,districtId:null,evidence:'estimated',band:'poor'
  });
  const calls=new Map(overview.calls.map(c=>[c.id,c]));
  const deduped=new Map<string,CandidateRoughPoint>();
  for(const p of view.locations){
    if(p.positionQuality!=='three-site-rough'||p.estimationMethod!=='THREE_SITE_RSRP_CENTROID')continue;
    const call=calls.get(p.callId);
    if(!call||!p.usedStations||!Number.isFinite(p.roughSearchRadiusM)||!Number.isFinite(p.lat)||!Number.isFinite(p.lon))continue;
    const date=call.startTimestamp?.slice(0,10)??scope.dateStart;
    if(date<scope.dateStart||date>scope.dateEnd)continue;
    deduped.set(p.callId,{
      callId:p.callId,customerId:call.customerId,date,lat:p.lat,lon:p.lon,
      observedAt:p.observedAt??null,cdrEndAt:p.cdrEndAt??null,
      secondsBeforeEnd:p.secondsBeforeEnd??null,
      roughSearchRadiusM:p.roughSearchRadiusM!,
      usedSiteCount:p.usedSiteCount??p.usedStations.length,
      usedStations:p.usedStations.map(s=>({ruId:s.ruId,cellId:s.cellId,lat:s.lat,lon:s.lon,rsrpDbm:s.rsrpDbm})),
    });
  }
  return [...deduped.values()];
}

export async function loadCandidateRoughPoints(
  overview:AnalystOverview,
  scope:QualityCandidateScope,
  signal?:AbortSignal,
):Promise<CandidateRoughPoint[]>{
  if(overview.sourceRevision!==scope.sourceRevision)throw new Error('삼각 측량 근사 원본 버전 불일치');
  const start=Date.parse(scope.dateStart+'T00:00:00Z'),end=Date.parse(scope.dateEnd+'T00:00:00Z');
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||end-start>31*86400000)
    throw new Error('삼각 측량 근사 날짜 범위 오류');
  const dates:string[]=[];
  for(let t=start;t<=end;t+=86400000)dates.push(new Date(t).toISOString().slice(0,10));
  const data=await Promise.all(dates.map(date=>candidateResource('candidate-rough|'+scope.sourceRevision+'|'+date,async sharedSignal=>{
    const response=await fetch('/qoe/three-site-rough/'+date+'.json',{signal:sharedSignal,cache:'no-cache'});
    if(!response.ok)throw new Error('삼각 측량 근사 자료를 불러오지 못했습니다: '+date);
    const part=await response.json() as ThreeSiteRoughDataset;
    if(part.date!==date||part.sourceRevision!==scope.sourceRevision||part.schemaVersion!=='coarse-three-site-v1'||part.method!=='THREE_SITE_RSRP_CENTROID'||part.notA90PercentAccuracyRegion!==true)
      throw new Error('삼각 측량 근사 근거 자료 검증 실패');
    return part;
  },signal)));
  if(data.some((part,i)=>part.date!==dates[i]||part.sourceRevision!==scope.sourceRevision||
    part.schemaVersion!=='coarse-three-site-v1'||part.method!=='THREE_SITE_RSRP_CENTROID'||
    part.notA90PercentAccuracyRegion!==true))
      throw new Error('삼각 측량 근사 근거 자료 검증 실패');
  return buildCandidateRoughPoints(overview,scope,data);
}
