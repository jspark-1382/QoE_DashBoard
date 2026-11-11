import type { AnalystOverview, OverviewCall, OverviewCallLocation } from './types';
import {effectiveCallQoe} from './derived-qoe';
import type { MosBand } from './quality-proposal-metrics';

export type HourMosPoint = {
  hour: number;
  total: number;
  evaluated: number;
  poor: number;
  other: number;
  mean: number | null;
};

/** Entire-day RTCP MOS(v5) aggregates. Only valid 1..5 scores enter MOS averages. */
export function buildFourthHourly(overview: AnalystOverview, from: string, to: string): HourMosPoint[] {
  const timeToMinute = (s: string): number | null => {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s)) return null;
    return Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  };
  const lower = timeToMinute(from), upper = timeToMinute(to);
  const sums = Array<number>(24).fill(0);
  const rows: HourMosPoint[] = Array.from({length:24}, (_,hour)=>({
    hour,total:0,evaluated:0,poor:0,other:0,mean:null,
  }));
  if(lower===null || upper===null || lower>upper) return rows;
  for(const call of overview.calls){
    const minute=Math.floor(call.startSecond/60);
    if(minute<lower || minute>upper) continue;
    const point=rows[Math.floor(call.startSecond/3600)];
    if(!point) continue;
    point.total++;
    const mos=effectiveCallQoe(call);
    if(mos===null) continue;
    point.evaluated++;
    if(mos<3) point.poor++;
    else point.other++;
    sums[point.hour]+=mos;
  }
  for(const row of rows) row.mean=row.evaluated?sums[row.hour]/row.evaluated:null;
  return rows;
}
export const fourthMaskedCustomer=(id:string)=>{
  // This is the project-generated opaque customer key, never a guessed phone.
  return '고객 ··'+id.slice(-5).toUpperCase();
};
export const fourthTime=(date:string,time:string)=>date+' '+time;
export const fourthBandForMos=(value:number|null|undefined):MosBand|null=>{
  if(typeof value!=='number'||!Number.isFinite(value)||value< -1.5||value>5)return null;
  return value<3?'poor':value<3.5?'fair':'good';
};

export function fourthBandCalls(
  calls:readonly OverviewCall[],band:MosBand|null,
  scope:{districtId?:string|null;evidence?:'all'|'gnss'|'estimated'|'bye-cell';locations?:readonly OverviewCallLocation[] }={},
):OverviewCall[] {
  if(band===null)return [...calls];
  const matching=calls.filter(call=>fourthBandForMos(effectiveCallQoe(call))===band);
  if(!scope.districtId&&(!scope.evidence||scope.evidence==='all'))return matching;
  // Only original CDR<->MDT linked positions may constrain regional evidence.
  // Non-poor CDRs are intentionally not assigned locations from the low-MOS MDT subset.
  const linked=new Set((scope.locations??[]).filter(loc=>
    (!scope.districtId||loc.areaId===scope.districtId)&&
    (!scope.evidence||scope.evidence==='all'||loc.evidence===scope.evidence),
  ).map(loc=>loc.callId));
  return matching.filter(call=>linked.has(call.id));
}

export function fourthPoorRates(poor:number,total:number,evaluated:number){
  return {
    total:total>0?100*poor/total:null,
    evaluated:evaluated>0?100*poor/evaluated:null,
  };
}
export const fourthMosBand=(call:OverviewCall)=>{
  const band=fourthBandForMos(effectiveCallQoe(call));
  return band==='poor'?'불량':band==='fair'?'보통':band==='good'?'양호':'미평가';
};
