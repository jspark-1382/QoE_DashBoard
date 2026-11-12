import {SharedRequestCache} from './request-cache';
import type {AnalystDataset,AnalystOverview,OverviewCall,OverviewCallLocation} from './types';
import type {ProposalGradeStats,MosBand} from './quality-proposal-metrics';
import type {HourMosPoint} from './quality-proposal-four';
import type {OverviewAnalytics,ExperienceGroup} from './overview-analytics';
import type {DistrictHotspot,ImprovedLocationFilter} from './improved-overview';
import type {SipReasonGroup} from './sip-reason';
import type {BaseStation} from '../location-estimation/types';

export interface VoiceScope {
  dateStart:string;dateEnd:string;from:string;to:string;customerIds?:string[];
  band?:MosBand|null;distributionMode?:'mos'|'drop';hour?:number|null;
  district?:string|null;evidence?:ImprovedLocationFilter;cohort?:ExperienceGroup|null;
  sipFilter?:SipReasonGroup|'all';search?:string;
}
export interface VoiceMeta {
  schemaVersion:'voice-query-meta-v1';sourceRevision:string;dataset:AnalystDataset;
  totalCalls:number;totalCustomers:number;
  regionNames?:Record<string,string>;
}
export interface VoiceSummary {
  sourceRevision:string;grades:ProposalGradeStats;dropGrades:ProposalGradeStats;
  hourly:HourMosPoint[];analytics:OverviewAnalytics;customerCount:number;
  mapped:{G:number;T:number;U:number;hourly:number[]};regions:DistrictHotspot[];
}
export interface VoiceCallPage {
  sourceRevision:string;rows:OverviewCall[];locations:OverviewCallLocation[];
  total:number;page:number;pageSize:number;
}
export interface VoiceMap {sourceRevision:string;overview:AnalystOverview;stationCount?:number;}
export type VoiceMapStationReference=Pick<OverviewCallLocation,'callId'|'gpsStation'|'usedStations'|'byeStationLat'|'byeStationLon'>;
export interface VoiceMapStations {sourceRevision:string;stationCount:number;stations:BaseStation[];locations:VoiceMapStationReference[];}
export interface VoiceCustomerDataset {sourceRevision:string;dataset:AnalystDataset;}

async function responseJson<T>(response:Response):Promise<T>{
  let result:unknown;
  try{result=await response.json();}
  catch{throw new Error(`분석 서버 응답을 확인하지 못했습니다 (${response.status}).`);}
  if(!response.ok){
    const error=(result as {error?:unknown})?.error;
    throw new Error(typeof error==='string'?error:`분석 자료 조회에 실패했습니다 (${response.status}).`);
  }
  return result as T;
}
let metadata=new SharedRequestCache<VoiceMeta>(1,30_000);
export function resetVoiceMeta(){metadata=new SharedRequestCache<VoiceMeta>(1,30_000);}
export function loadVoiceMeta(signal?:AbortSignal):Promise<VoiceMeta>{
  return metadata.get('voice-meta',async requestSignal=>{
    const value=await responseJson<VoiceMeta>(await fetch('/qoe/api/voice/meta',{signal:requestSignal,cache:'no-cache'}));
    if(value?.schemaVersion!=='voice-query-meta-v1'||!value.sourceRevision||
       value.dataset?.meta?.revision!==value.sourceRevision||!Array.isArray(value.dataset?.meta?.dates))
      throw new Error('분석 요약 자료의 버전 또는 형식이 올바르지 않습니다.');
    return value;
  },signal);
}
/** Read only the requested server result. Never fall back to the bulk source JSON. */
export async function voiceQuery<T>(op:string,args:Record<string,unknown>={},signal?:AbortSignal):Promise<T>{
  signal?.throwIfAborted();
  const value=await responseJson<T&{sourceRevision?:string}>(await fetch('/qoe/api/voice/query',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...args,op}),
    signal,cache:'no-store',
  }));
  signal?.throwIfAborted();
  if(args.sourceRevision&&value.sourceRevision!==args.sourceRevision)
    throw new Error('분석 자료 버전이 바뀌었습니다. 새로고침 후 다시 조회하세요.');
  return value;
}

const stationLayers=new SharedRequestCache<VoiceMapStations>(8,60_000);
/** Optional tower geometry is fetched only by an enabled station layer. */
export function loadVoiceMapStations(args:Record<string,unknown>,signal?:AbortSignal):Promise<VoiceMapStations>{
  return stationLayers.get(JSON.stringify(args),sharedSignal=>voiceQuery<VoiceMapStations>('map-stations',args,sharedSignal),signal);
}
