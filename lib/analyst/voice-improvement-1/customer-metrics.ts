import { classifySipReason11 } from '../sip-reason';
import { isPoorOriginalMos, validOriginalMos } from './coverage';
import type { CandidateCustomerPeriod, CustomerExperience, EvidenceCall, SpatialCandidate } from './types';

function ordered(calls:readonly EvidenceCall[]):EvidenceCall[]{
  return [...calls].sort((a,b)=>(Date.parse(a.startedAt??'')||0)-(Date.parse(b.startedAt??'')||0)||a.callId.localeCompare(b.callId));
}
export function buildCustomerExperience(calls:readonly EvidenceCall[],availableDates:readonly string[]):CustomerExperience[]{
  const customers=new Map<string,EvidenceCall[]>();
  for(const call of calls){const rows=customers.get(call.customerId)??[];rows.push(call);customers.set(call.customerId,rows);}
  const availability=new Set(availableDates);
  const sortedDates=[...availability].sort();
  const hasMissingPartition=sortedDates.some((date,index)=>index>0&&Date.parse(date+'T00:00:00Z')-Date.parse(sortedDates[index-1]+'T00:00:00Z')!==86400000);
  return [...customers].sort(([a],[b])=>a.localeCompare(b)).map(([customerId,rows])=>{
    const poor=rows.filter(c=>isPoorOriginalMos(c.mos)),poorDates=[...new Set(poor.map(c=>c.date))].sort();
    const indeterminateReasons:string[]=[];
    const stamps=rows.map(c=>Date.parse(c.startedAt??''));
    if(stamps.some(t=>!Number.isFinite(t)))indeterminateReasons.push('missing-call-time');
    if(new Set(stamps).size!==stamps.length)indeterminateReasons.push('tied-call-times');
    const sorted=ordered(rows);
    const missingDates=hasMissingPartition||rows.some(c=>!availability.has(c.date));
    if(missingDates)indeterminateReasons.push('missing-date-partition');
    const consecutiveCalls=indeterminateReasons.length?null:sorted.some((c,i)=>i>0&&isPoorOriginalMos(c.mos)&&isPoorOriginalMos(sorted[i-1].mos));
    let maximum=0,streak=0,previous=NaN;
    for(const date of poorDates){const next=Date.parse(date+'T00:00:00Z');streak=next-previous===86400000?streak+1:1;maximum=Math.max(maximum,streak);previous=next;}
    return {customerId,affected:poor.length>0,callCount:rows.length,evaluatedCallCount:rows.filter(c=>validOriginalMos(c.mos)).length,
      poorCallCount:poor.length,poorDateCount:poorDates.length,repeatCalls:poor.length>=2,consecutiveCalls,
      maxConsecutivePoorDates:missingDates?null:maximum,indeterminateReasons};
  });
}
const alias=(index:number):string=>index<26?String.fromCharCode(65+index):alias(Math.floor(index/26)-1)+String.fromCharCode(65+index%26);
export function candidateCustomerCalls(allCalls:readonly EvidenceCall[],candidate:SpatialCandidate):CandidateCustomerPeriod[]{
  const members=new Set(candidate.memberCallIds),nearby=new Map((candidate.nearbyPoints??[]).map(p=>[p.callId,p]));
  const customers=new Set(allCalls.filter(c=>members.has(c.callId)||nearby.has(c.callId)).map(c=>c.customerId));
  const dates=[...new Set(allCalls.map(c=>c.date))].sort();
  return [...customers].sort().map((customerId,index)=>{
    const calls=ordered(allCalls.filter(c=>c.customerId===customerId));
    return {customerId,alias:alias(index),experience:buildCustomerExperience(calls,dates)[0],calls:calls.map(c=>{
      const query=new URLSearchParams({view:'contract',source:'MDT',date:c.date,customer:c.customerId,call:c.rawCallId,metric:'mos'});
      return {...c,isMember:members.has(c.callId),nearbyRole:nearby.get(c.callId)?.role??null,drop:classifySipReason11(c.sipReason)==='drop',detailHref:'/?'+query.toString()};
    })};
  });
}
