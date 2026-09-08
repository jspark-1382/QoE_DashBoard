import type { BaseStation, MdtSample, Point } from './types';
import { distanceM, offsetPoint } from './geo';
import { matchBaseStation } from './master';
import { ADAPTIVE_CONFIG, type AdaptiveConfig } from './adaptive-config';
export type PhysicalSite = Point & {siteId:string; cells:BaseStation[]; excluded:boolean; distanceFromMedianM:number};
export type SiteObservation = Point & {siteId:string; rsrp:number; deltaTimeSec:number; weight:number; estimatedDistanceM:number; cellIds:string[]; residualM:number};
export type AdaptivePosition = {
  sample:MdtSample; timestamp:number; estimatedLat:number|null; estimatedLon:number|null;
  method:'MULTILATERATION'|'WEIGHTED_2_SITE'|'CELL_SITE'|'INVALID';
  siteCount:number; usedCellIds:string[]; usedCellCount:number; avgRsrp:number|null; strongestRsrp:number|null;
  residualErrorM:number|null; estimatedAccuracyM:number|null; confidenceScore:number; confidenceGrade:string;
  windowSec:number; geometry:number; usedSites:SiteObservation[]; jump:boolean; breakBefore:boolean; speedKmh:number|null; warnings:string[];
};
const clamp=(v:number,a:number,b:number)=>Math.min(b,Math.max(a,v));
const median=(v:number[])=>{const a=[...v].sort((x,y)=>x-y);return a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2;};
export function groupPhysicalSites(stations:BaseStation[], config=ADAPTIVE_CONFIG):PhysicalSite[]{
  // Complete-link grouping prevents chains of nearby cells merging distant endpoints.
  const groups:BaseStation[][]=[];
  for(const cell of [...stations].sort((a,b)=>a.latitude-b.latitude||a.longitude-b.longitude||a.cellId.localeCompare(b.cellId))){
    if(!Number.isFinite(cell.latitude)||!Number.isFinite(cell.longitude)||Math.abs(cell.latitude)>90||Math.abs(cell.longitude)>180)continue;
    const group=groups.find(g=>g.every(other=>distanceM(cell,other)<=config.siteClusterDistanceM));
    if(group)group.push(cell);else groups.push([cell]);
  }
  const sites=groups.map((cells,i)=>({siteId:`SITE_${String(i+1).padStart(3,'0')}`,latitude:median(cells.map(s=>s.latitude)),longitude:median(cells.map(s=>s.longitude)),cells,excluded:false,distanceFromMedianM:0}));
  if(!sites.length)return sites;
  const center={latitude:median(sites.map(s=>s.latitude)),longitude:median(sites.map(s=>s.longitude))};
  return sites.map(site=>({...site,distanceFromMedianM:distanceM(site,center),excluded:sites.length>=3&&distanceM(site,center)>config.maxSiteDistanceKm*1000}));
}
export function logDistance(rsrp:number,config=ADAPTIVE_CONFIG){
  return clamp(config.referenceDistanceM*10**((config.referenceRsrpDbm-rsrp)/(10*config.pathlossExponent)),config.minDistanceM,config.maxDistanceM);
}
const local=(origin:Point,p:Point)=>({x:(p.longitude-origin.longitude)*Math.PI/180*6371008.8*Math.cos(origin.latitude*Math.PI/180),y:(p.latitude-origin.latitude)*Math.PI/180*6371008.8});
export function solveWeighted(sites:SiteObservation[],config=ADAPTIVE_CONFIG){
  const origin={latitude:sites.reduce((s,p)=>s+p.latitude,0)/sites.length,longitude:sites.reduce((s,p)=>s+p.longitude,0)/sites.length};
  const points=sites.map(p=>({...local(origin,p),d:p.estimatedDistanceM,w:p.weight}));
  const sum=points.reduce((s,p)=>s+p.w,0);
  let x=points.reduce((s,p)=>s+p.x*p.w,0)/sum,y=points.reduce((s,p)=>s+p.y*p.w,0)/sum;
  const loss=(a:number,b:number)=>points.reduce((s,p)=>s+p.w*(Math.hypot(a-p.x,b-p.y)-p.d)**2,0);
  let damping=config.initialDamping;
  if(sites.length>=3)for(let i=0;i<config.maxIterations;i++){
    let xx=damping,xy=0,yy=damping,gx=0,gy=0;
    for(const p of points){const r=Math.max(1e-6,Math.hypot(x-p.x,y-p.y)),jx=(x-p.x)/r,jy=(y-p.y)/r,e=r-p.d;xx+=p.w*jx*jx;xy+=p.w*jx*jy;yy+=p.w*jy*jy;gx+=p.w*jx*e;gy+=p.w*jy*e;}
    const det=xx*yy-xy*xy;if(det<=1e-15)break;
    const dx=(yy*gx-xy*gy)/det,dy=(xx*gy-xy*gx)/det;
    if(loss(x-dx,y-dy)<loss(x,y)){x-=dx;y-=dy;damping=Math.max(1e-9,damping/3);if(Math.hypot(dx,dy)<config.solverToleranceM)break;}else damping*=10;
  }
  // Weighted directional information matrix; collinearity yields near-zero geometry.
  let xx=0,xy=0,yy=0;
  for(const p of points){const r=Math.max(1e-6,Math.hypot(x-p.x,y-p.y)),a=(x-p.x)/r,b=(y-p.y)/r;xx+=p.w*a*a;xy+=p.w*a*b;yy+=p.w*b*b;}
  const trace=xx+yy, geometry=trace?clamp(4*(xx*yy-xy*xy)/trace**2,0,1):0;
  return {...offsetPoint(origin,x,y),geometry,residual:Math.sqrt(loss(x,y)/sum)};
}
export function confidenceGrade(score:number,config=ADAPTIVE_CONFIG){return ['A','B','C','D','E'][config.gradeThresholds.findIndex(t=>score>=t)<0?4:config.gradeThresholds.findIndex(t=>score>=t)];}
export function estimateAdaptive(samples:MdtSample[],stations:BaseStation[],config:AdaptiveConfig=ADAPTIVE_CONFIG){
  const sites=groupPhysicalSites(stations,config),siteByCell=new Map<BaseStation,PhysicalSite>();
  sites.forEach(site=>site.cells.forEach(cell=>siteByCell.set(cell,site)));
  const ordered=[...samples].filter(s=>Number.isFinite(s.timestamp)).sort((a,b)=>a.timestamp-b.timestamp||a.sampleIndex-b.sampleIndex);
  const matched=ordered.map(sample=>{const match=matchBaseStation(sample,stations);return {sample,match,site:match?siteByCell.get(match.station):undefined};});
  const streams=new Map<string,typeof matched>();matched.forEach(e=>{const a=streams.get(e.sample.streamId)??[];a.push(e);streams.set(e.sample.streamId,a);});
  const positions:AdaptivePosition[]=[];
  for(const stream of streams.values()){
    let previous:AdaptivePosition|undefined;
    for(const current of stream){
      const sample=current.sample;let windowSec=config.windowsSec.at(-1)!,observations:SiteObservation[]=[];
      for(const window of config.windowsSec){
        const groups=new Map<string,typeof matched>();
        for(const entry of stream){if(Math.abs(entry.sample.timestamp-sample.timestamp)>window*1000||!entry.site||entry.site.excluded||entry.sample.rsrp==null||!Number.isFinite(entry.sample.rsrp))continue;
          const group=groups.get(entry.site.siteId)??[];group.push(entry);groups.set(entry.site.siteId,group);}
        observations=[...groups].map(([siteId,group])=>{
          const values=group.map(e=>e.sample.rsrp!);const rsrp=config.siteRsrpMode==='max'?Math.max(...values):config.siteRsrpMode==='median'?median(values):values.reduce((s,v)=>s+v,0)/values.length;
          const representative=[...group].sort((a,b)=>Math.abs(a.sample.rsrp!-rsrp)-Math.abs(b.sample.rsrp!-rsrp)||Math.abs(a.sample.timestamp-sample.timestamp)-Math.abs(b.sample.timestamp-sample.timestamp))[0];
          const site=representative.site!;
          return {siteId,latitude:site.latitude,longitude:site.longitude,rsrp,deltaTimeSec:(representative.sample.timestamp-sample.timestamp)/1000,weight:0,estimatedDistanceM:logDistance(rsrp,config),cellIds:[...new Set(group.map(e=>e.sample.cellId))],residualM:0};
        });
        windowSec=window;if(observations.length>=3)break;
      }
      const strongest=observations.length?Math.max(...observations.map(o=>o.rsrp)):null;
      observations.forEach(o=>o.weight=Math.exp(-Math.abs(o.deltaTimeSec)/config.timeDecayTauSec)*clamp(10**((o.rsrp-strongest!)/config.rsrpWeightDivisor),config.minRsrpWeight,1));
      const count=observations.length, cells=[...new Set(observations.flatMap(o=>o.cellIds))];
      const result:AdaptivePosition={sample,timestamp:sample.timestamp,estimatedLat:null,estimatedLon:null,method:count>=3?'MULTILATERATION':count===2?'WEIGHTED_2_SITE':count===1?'CELL_SITE':'INVALID',siteCount:count,usedCellIds:cells,usedCellCount:cells.length,avgRsrp:count?observations.reduce((s,o)=>s+o.rsrp,0)/count:null,strongestRsrp:strongest,residualErrorM:null,estimatedAccuracyM:null,confidenceScore:0,confidenceGrade:'E',windowSec,geometry:0,usedSites:observations,jump:false,breakBefore:!previous,speedKmh:null,warnings:[]};
      if(!current.match)result.warnings.push('현재 Cell 미매칭 · 인접 시간 근거 사용');
      if(current.site?.excluded)result.warnings.push('현재 Cell 좌표 이상치 제외');
      if(count){
        const solved=solveWeighted(observations,config);let point:Point=solved;
        if(previous?.estimatedLat!=null&&previous.estimatedLon!=null){
          const seconds=(sample.timestamp-previous.timestamp)/1000,dist=distanceM({latitude:previous.estimatedLat,longitude:previous.estimatedLon},point);
          result.breakBefore=seconds>config.pathGapSec;
          result.speedKmh=seconds>0?dist/seconds*3.6:dist>config.solverToleranceM?null:0;
          result.jump=!result.breakBefore&&(seconds===0?dist>config.solverToleranceM:result.speedKmh!>config.maxSpeedKmh);
          if(result.jump){result.breakBefore=true;result.warnings.push('이동속도 상한 초과');
            if(config.jumpAction==='smooth'&&seconds>0){const ratio=Math.min(1,config.maxSpeedKmh/3.6*seconds/dist);const delta=local({latitude:previous.estimatedLat,longitude:previous.estimatedLon},point);point=offsetPoint({latitude:previous.estimatedLat,longitude:previous.estimatedLon},delta.x*ratio,delta.y*ratio);}}
        }
        observations.forEach(o=>o.residualM=distanceM(point,o)-o.estimatedDistanceM);
        const sum=observations.reduce((s,o)=>s+o.weight,0),residual=Math.sqrt(observations.reduce((s,o)=>s+o.weight*o.residualM**2,0)/sum);
        result.residualErrorM=residual;result.geometry=solved.geometry;
        const meanDistance=observations.reduce((s,o)=>s+o.estimatedDistanceM*o.weight,0)/sum;
        const geometryFactor=count<3?2:1/Math.sqrt(Math.max(config.geometryFloor,solved.geometry));
        result.estimatedAccuracyM=Math.max(config.uncertaintyFloorM,(residual+meanDistance*config.uncertaintyDistanceRatio)*geometryFactor*(1+windowSec/config.windowsSec.at(-1)!)*(strongest!<config.uncertaintyWeakRsrpDbm?config.uncertaintyWeakFactor:1));
        const weights=config.confidenceWeights;
        let score=100*(weights.siteCount*Math.min(count/3,1)+weights.window*Math.exp(-windowSec/config.windowsSec.at(-1)!)+weights.rsrp*clamp((strongest!-config.confidenceRsrpFloorDbm)/config.confidenceRsrpSpanDb,0,1)+weights.residual*Math.exp(-residual/config.confidenceResidualScaleM)+weights.geometry*solved.geometry);
        score=Math.min(score,count===1?config.singleSiteScoreCap:count===2?config.twoSiteScoreCap:100);
        if(sites.filter(s=>observations.some(o=>o.siteId===s.siteId)).some(s=>s.cells.some(c=>c.isVirtual||c.provenanceUnknown))){score=Math.min(score,config.uncertainSourceScoreCap);result.warnings.push('가상 또는 출처 미확인 기지국 포함');}
        if(solved.geometry<config.geometryFloor&&count>=3)result.warnings.push('기지국 배치 조건 불량');
        if(result.jump)score*=config.jumpConfidenceFactor;
        result.confidenceScore=Math.round(score);result.confidenceGrade=confidenceGrade(result.confidenceScore,config);
        if(!(result.jump&&config.jumpAction==='exclude')){result.estimatedLat=point.latitude;result.estimatedLon=point.longitude;}
        else result.warnings.push('점프 위치 표시 제외');
        if(count===1)result.warnings.push('단일 Site 좌표를 임시 위치로 사용 · 방향 미식별');
        result.warnings.push('±시간창 비동시 관측 기반 · 미보정 거리모델');
      }
      positions.push(result);previous=result.estimatedLat==null?undefined:result;
    }
  }
  positions.sort((a,b)=>a.timestamp-b.timestamp||a.sample.sampleIndex-b.sample.sampleIndex);
  return {positions,sites,stats:{samples:samples.length,matched:matched.filter(e=>e.match).length,unmatched:matched.filter(e=>!e.match).length,excludedSamples:matched.filter(e=>e.site?.excluded).length,excludedSites:sites.filter(s=>s.excluded).map(s=>s.siteId)}};
}
