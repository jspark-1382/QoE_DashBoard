import { datesInRange } from '../date-range';
import type { AnalysisScope, CandidatePolicy, ImprovementScope } from './types';
export type { AnalysisScope, CandidatePolicy, ImprovementScope } from './types';
export const DEFAULT_CANDIDATE_POLICY:CandidatePolicy={
  version:'voice-improvement-1-policy-v1',epsM:100,minSamples:2,minPoorCustomers:3,
  minPoorDates:2,minNewCustomers:2,maxDiameterMultiplier:2,locationPolicy:'strict-3-site-v1',
};
export type ScopeResult={ok:true;scope:ImprovementScope}|{ok:false;reason:'unsupported-source'|'unsupported-metric'|'invalid-range'|'missing-date'|'revision-mismatch'};
const dateValid=(date:string)=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;
const validTime=(v:string)=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
export function parseImprovementScope(search:string,availableDates:readonly string[],revision:string):ScopeResult {
  const q=new URLSearchParams(search), dates=[...new Set(availableDates)].filter(dateValid).sort();
  if(q.has('source')&&q.get('source')!=='MDT')return {ok:false,reason:'unsupported-source'};
  if(q.has('metric')&&q.get('metric')!=='mos')return {ok:false,reason:'unsupported-metric'};
  if(q.has('compareRevision')&&q.get('compareRevision')!==revision)return {ok:false,reason:'revision-mismatch'};
  if(!revision||!dates.length)return {ok:false,reason:'missing-date'};
  const hasPeriod=q.has('dateStart')||q.has('dateEnd');
  if(hasPeriod&&(!q.get('dateStart')||!q.get('dateEnd')))return {ok:false,reason:'invalid-range'};
  const dateStart=hasPeriod?q.get('dateStart')!:q.get('date')??dates[0];
  const dateEnd=hasPeriod?q.get('dateEnd')!:q.get('date')??dates.at(-1)!;
  if(!dateValid(dateStart)||!dateValid(dateEnd)||dateStart>dateEnd)return {ok:false,reason:'invalid-range'};
  const selected=datesInRange(dates,dateStart,dateEnd);
  if(!selected.length)return {ok:false,reason:'missing-date'};
  const from=q.get('from')??'00:00',to=q.get('to')??'23:59';
  if(!validTime(from)||!validTime(to)||from>to)return {ok:false,reason:'invalid-range'};
  const mode=q.get('mode')??(selected.length>=3?'holdout':'screening');
  if(!['holdout','screening'].includes(mode)||(mode==='holdout'&&selected.length<3))return {ok:false,reason:'invalid-range'};
  const hour=q.has('hour')?Number(q.get('hour')):null;
  if(hour!==null&&(!q.get('hour')||!Number.isInteger(hour)||hour<0||hour>23))return {ok:false,reason:'invalid-range'};
  return {ok:true,scope:{source:'MDT',sourceRevision:revision,dateStart,dateEnd,from,to,hour,metric:'mos',customerId:q.get('customer')||null,mode:mode as ImprovementScope['mode']}};
}
export function analysisScope(scope:ImprovementScope):AnalysisScope {
  return {source:scope.source,sourceRevision:scope.sourceRevision,dateStart:scope.dateStart,dateEnd:scope.dateEnd,from:scope.from,to:scope.to,metric:scope.metric,mode:scope.mode};
}
export function improvementScopeQuery(scope:ImprovementScope):string {
  const q=new URLSearchParams({source:scope.source,compareRevision:scope.sourceRevision,dateStart:scope.dateStart,dateEnd:scope.dateEnd,date:scope.dateEnd,from:scope.from,to:scope.to,metric:'mos',mode:scope.mode});
  if(scope.hour!==null)q.set('hour',String(scope.hour));if(scope.customerId)q.set('customer',scope.customerId);
  return q.toString();
}
export const legacyComparisonHref=(scope:ImprovementScope)=>'/?view=overview&'+improvementScopeQuery(scope);
export const improvementComparisonHref=(scope:ImprovementScope)=>'/overview-improvement-1?'+improvementScopeQuery(scope);
/** Shared by browser comparison and Node-only SHA-256; never imports node:crypto. */
export function canonicalScopeJson(scope:AnalysisScope,policy:CandidatePolicy):string {
  const sort=(value:unknown):unknown=>{
    if(Array.isArray(value))return value.map(sort);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,sort(v)]));
    return value;
  };
  return JSON.stringify(sort({scope:analysisScope({...scope,hour:null,customerId:null}),policy}));
}
