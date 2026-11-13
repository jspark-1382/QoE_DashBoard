import {candidateResource} from './candidate-resource-cache';
import {loadQualityCandidateDetail,type QualityCandidateScope,type QualityCandidateSummary} from './quality-improvement-candidates';
import type {ScreeningMapQueryResult,ScreeningQueryResult} from './screening-query';
import type {TopCustomerMap,TopCustomerMapPoint} from './customer-screening-top-ten';
import {voiceQuery} from './server-query';

export interface CandidateTopTenCustomer {id:string;number:string;poor:number;rank:number}
export interface CandidateTopTenMember extends CandidateTopTenCustomer {memberCalls:number;withinRange?:boolean}
export interface CandidateTopTenMatch {candidateId:string;customers:CandidateTopTenMember[]}
export interface CandidateTopTenState {
  status:'idle'|'loading'|'ready'|'error';
  customers:readonly CandidateTopTenCustomer[];
  error:string|null;
}

const scopeKey=(scope:QualityCandidateScope)=>[
  scope.sourceRevision,scope.dateStart,scope.dateEnd,scope.from,scope.to,scope.policy,
];

/** Share the customer-status default ranking, including unlocated customers and original ranks. */
export function loadCandidateTopTenCustomers(scope:QualityCandidateScope,signal?:AbortSignal):Promise<CandidateTopTenCustomer[]> {
  return candidateResource(JSON.stringify(['candidate-top-ten-customers',...scopeKey(scope)]),async sharedSignal=>{
    const {dateStart,dateEnd,from,to}=scope;
    const result=await voiceQuery<ScreeningQueryResult>('screening',{
      sourceRevision:scope.sourceRevision,scope:{dateStart,dateEnd,from,to},
      query:'',filter:'all',sort:'poor',page:0,
    },sharedSignal);
    if(!Array.isArray(result.topRows))throw new Error('고객 TOP 10 순위 자료를 확인하지 못했습니다.');
    return result.topRows.slice(0,10).flatMap((row,index)=>
      row.poor>0?[{id:row.id,number:row.number,poor:row.poor,rank:index+1}]:[]);
  },signal);
}

/** The same default TOP10 representative locations used by customer status, pinned to the current source. */
export function loadCandidateTopTenLocations(scope:QualityCandidateScope,signal?:AbortSignal):Promise<TopCustomerMap> {
  return candidateResource(JSON.stringify(['candidate-top-ten-locations',...scopeKey(scope)]),async sharedSignal=>{
    const {dateStart,dateEnd,from,to}=scope;
    const result=await voiceQuery<ScreeningMapQueryResult>('screening-map',{
      sourceRevision:scope.sourceRevision,scope:{dateStart,dateEnd,from,to},query:'',filter:'all',sort:'poor',
    },sharedSignal);
    const locations=result.topCustomers;
    if(!locations||!Array.isArray(locations.points)||!Number.isFinite(locations.total)||!Number.isFinite(locations.unlocated))
      throw new Error('고객 TOP 10 위치 자료를 확인하지 못했습니다.');
    return locations;
  },signal);
}

/** Pass discovery members only; validation observations belong to a separate cohort. */
export function candidateHasTopTenCustomer(members:readonly {customerId:string}[],customers:readonly CandidateTopTenCustomer[]):boolean {
  const ids=new Set(customers.map(customer=>customer.id));
  return members.some(member=>ids.has(member.customerId));
}

function orderedCustomers(customers:readonly CandidateTopTenCustomer[]):CandidateTopTenCustomer[] {
  const seen=new Set<string>();
  return [...customers].sort((a,b)=>a.rank-b.rank).filter(customer=>{
    if(seen.has(customer.id))return false;
    seen.add(customer.id);return true;
  });
}

/** Count discovery calls per exact customer, retaining the customer-status rank and number. */
export function candidateTopTenMembers(members:readonly {customerId:string;callId?:string}[],
  customers:readonly CandidateTopTenCustomer[]):CandidateTopTenMember[] {
  const ids=new Set(customers.map(customer=>customer.id));
  const counts=new Map<string,{callIds:Set<string>;unkeyed:number}>();
  for(const member of members){
    if(!ids.has(member.customerId))continue;
    let count=counts.get(member.customerId);
    if(!count){count={callIds:new Set(),unkeyed:0};counts.set(member.customerId,count);}
    if(member.callId===undefined)count.unkeyed++;
    else count.callIds.add(member.callId);
  }
  return orderedCustomers(customers).flatMap(customer=>{
    const count=counts.get(customer.id);
    return count?[{...customer,memberCalls:count.callIds.size+count.unkeyed}]:[];
  });
}

const validCoordinate=(lat:number,lon:number)=>Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;
function sphericalDistanceM(a:{lat:number;lon:number},b:{lat:number;lon:number}):number {
  const radians=Math.PI/180,lat=(b.lat-a.lat)*radians,lon=(b.lon-a.lon)*radians;
  const value=Math.sin(lat/2)**2+Math.cos(a.lat*radians)*Math.cos(b.lat*radians)*Math.sin(lon/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(Math.max(0,Math.min(1,value))),Math.sqrt(Math.max(0,1-value)));
}

/** Include actual discovery members or an original TOP10 position inside the displayed candidate circle. */
export function includeCandidateTopTenLocations(members:readonly CandidateTopTenMember[],customers:readonly CandidateTopTenCustomer[],
  points:readonly TopCustomerMapPoint[],circle:{lat:number;lon:number;radiusM:number|null}):CandidateTopTenMember[] {
  const actual=new Map(members.map(member=>[member.id,member]));
  const usable=typeof circle.radiusM==='number'&&Number.isFinite(circle.radiusM)&&circle.radiusM>=0&&validCoordinate(circle.lat,circle.lon);
  return orderedCustomers(customers).flatMap(customer=>{
    const member=actual.get(customer.id);
    const inside=usable&&points.some(point=>point.id===customer.id&&validCoordinate(point.lat,point.lon)&&
      (point.lat!==0||point.lon!==0)&&(point.evidence==='gnss'||point.evidence==='bye-cell')&&sphericalDistanceM(circle,point)<=circle.radiusM!);
    return member||inside?[{...customer,memberCalls:member?.memberCalls??0,...(inside?{withinRange:true}:{})}]:[];
  });
}

/** Regions may contain several TOP10 customers, and one customer may belong to several regions. */
export function summarizeCandidateTopTenCoverage(customers:readonly CandidateTopTenCustomer[],matches:readonly CandidateTopTenMatch[]):{
  included:CandidateTopTenCustomer[];unmatched:CandidateTopTenCustomer[];
} {
  const ids=new Set(matches.flatMap(match=>match.customers.map(customer=>customer.id)));
  const ranked=orderedCustomers(customers);
  return {included:ranked.filter(customer=>ids.has(customer.id)),unmatched:ranked.filter(customer=>!ids.has(customer.id))};
}

const dbscanRequestKey=(summary:QualityCandidateSummary,customers:readonly CandidateTopTenCustomer[],mode:'all'|'evaluation')=>[
  ...scopeKey(summary.scope),summary.scopeKey,summary.locationMode,mode,
  customers.map(customer=>[customer.id,customer.number,customer.poor,customer.rank]),
  summary.candidates.map(candidate=>[candidate.id,candidate.detailPath,candidate.medoid.lat,candidate.medoid.lon,candidate.displayRadiusM]),
];

/** Validate every candidate before deciding which discovery customers belong to TOP 10. */
export function loadDbscanTopTenMatches(summary:QualityCandidateSummary,customers:readonly CandidateTopTenCustomer[],
  mode:'all'|'evaluation',signal?:AbortSignal):Promise<CandidateTopTenMatch[]> {
  const key=JSON.stringify(['candidate-top-ten-dbscan-matches',...dbscanRequestKey(summary,customers,mode)]);
  return candidateResource(key,async sharedSignal=>{
    const batch=new AbortController();
    const cancel=()=>batch.abort(sharedSignal.reason);
    sharedSignal.addEventListener('abort',cancel,{once:true});
    const matches:CandidateTopTenMatch[]=[];
    let next=0;
    const worker=async()=>{
      try {
        while(next<summary.candidates.length){
          batch.signal.throwIfAborted();
          const index=next++,card=summary.candidates[index];
          const detail=await loadQualityCandidateDetail(summary,card.id,batch.signal,mode);
          batch.signal.throwIfAborted();
          const members=new Set(detail.candidate.memberCallIds);
          matches[index]={candidateId:card.id,
            customers:candidateTopTenMembers(detail.calls.filter(call=>members.has(call.callId)),customers)};
        }
      } catch(error) {
        batch.abort(error);
        throw error;
      }
    };
    try {
      sharedSignal.throwIfAborted();
      const locationTask=loadCandidateTopTenLocations(summary.scope,batch.signal).catch(error=>{batch.abort(error);throw error;});
      const [locations]=await Promise.all([locationTask,Promise.all(Array.from({length:Math.min(4,summary.candidates.length)},worker))]);
      sharedSignal.throwIfAborted();
      return matches.map((match,index)=>{
        const card=summary.candidates[index];
        return {...match,customers:includeCandidateTopTenLocations(match.customers,customers,locations.points,
          {lat:card.medoid.lat,lon:card.medoid.lon,radiusM:card.displayRadiusM})};
      }).filter(match=>match.customers.length>0);
    } finally {
      sharedSignal.removeEventListener('abort',cancel);
    }
  },signal);
}

/** Compatibility projection sharing the validated enriched memberships and independent cancellation. */
export function loadDbscanTopTenCandidateIds(summary:QualityCandidateSummary,customers:readonly CandidateTopTenCustomer[],
  mode:'all'|'evaluation',signal?:AbortSignal):Promise<string[]> {
  return candidateResource(JSON.stringify(['candidate-top-ten-dbscan-ids',...dbscanRequestKey(summary,customers,mode)]),
    async sharedSignal=>(await loadDbscanTopTenMatches(summary,customers,mode,sharedSignal)).map(match=>match.candidateId),signal);
}
