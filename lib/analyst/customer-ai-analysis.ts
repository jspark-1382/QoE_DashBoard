export type AnalysisScope={dateStart:string;dateEnd:string;from:string;to:string};
export type AnalysisTarget={kind:'customer'|'call';customerId:string;callId?:string;scope:AnalysisScope;sourceRevision:string};
export type AnalysisFact={id:string;title:string;detail:string;severity:'info'|'attention'|'caution'};
export type AnalysisCall={id:string;date:string;start:string;end:string;qoe:number|null;mos:number|null;isDrop:boolean;cell:string;area:string;locationEvidence:string;href:string;rsrp:number|null;sinr:number|null};
export type AnalysisEvidence={
 schemaVersion:'qwen-evidence-v1';sourceRevision:string;target:AnalysisTarget;generatedAt:string;
 summary:{totalCalls:number;evaluatedCalls:number;poorCalls:number;poorRate:number|null;rawMosEvaluatedCalls:number;rawMosPoorCalls:number;meanMos:number|null;meanQoe:number|null;dropCalls:number;observedDays:number;poorDays:number};
 byDay:{date:string;totalCalls:number;evaluatedCalls:number;poorCalls:number;dropCalls:number}[];
 byCell:{cell:string;totalCalls:number;evaluatedCalls:number;poorCalls:number;poorRate:number|null;dropCalls:number}[];
 facts:AnalysisFact[];calls:AnalysisCall[];
 coverage:{locationCalls:number;radioCalls:number;rtpCalls:number;sampledCalls:number;fullPopulation:boolean;detailsPolicy:string};
 limitations:string[];
};
export type AnalysisReport={summary:string;hypotheses:{title:string;assessment:'supported'|'possible'|'insufficient';reason:string;evidenceIds:string[]}[];checks:{action:string;reason:string;evidenceIds:string[]}[];limitations:string[]};
export type AnalysisStatus='queued'|'collecting'|'analyzing'|'completed'|'failed'|'cancelled';
export type AnalysisJob={id:string;target:AnalysisTarget;status:AnalysisStatus;createdAt:string;updatedAt:string;model:string;error?:{code:string;message:string};evidence?:AnalysisEvidence;report?:AnalysisReport};
export type AnalysisConfigStatus={configured:boolean;model:string;missing:string[];error?:{code:string;message:string}};
export class AnalysisClientError extends Error{
 constructor(message:string,public code:string){super(message);this.name='AnalysisClientError';}
}
type Fetcher=(url:string,init?:RequestInit)=>Promise<Response>;
const base='/qoe/api/analysis';
export const isAnalysisActive=(status:AnalysisStatus)=>['queued','collecting','analyzing'].includes(status);
export const analysisTargetKey=(target:AnalysisTarget)=>JSON.stringify([target.kind,target.customerId,target.callId??'',target.sourceRevision,target.scope.dateStart,target.scope.dateEnd,target.scope.from,target.scope.to]);

export async function analysisRequest<T>(path:string,init:RequestInit={},fetcher:Fetcher=fetch):Promise<T>{
 try{
  const headers=new Headers(init.headers);
  if(!headers.has('Content-Type'))headers.set('Content-Type','application/json');
  const response=await fetcher(base+path,{...init,headers,cache:'no-store'});
  const value:unknown=await response.json().catch(()=>{throw new AnalysisClientError('분석 서버의 응답 형식을 확인할 수 없습니다.','INVALID_RESPONSE');});
  if(!response.ok){
   const problem=(value&&typeof value==='object'?value:{}) as {error?:unknown;code?:unknown};
   throw new AnalysisClientError(typeof problem.error==='string'?problem.error:'분석 요청을 처리하지 못했습니다.',typeof problem.code==='string'?problem.code:'HTTP_ERROR');
  }
  return value as T;
 }catch(error){
  if(error instanceof AnalysisClientError)throw error;
  if(error instanceof Error&&error.name==='AbortError')throw error;
  throw new AnalysisClientError('분석 서버에 연결할 수 없습니다. 로컬 프로그램 실행 상태를 확인한 뒤 다시 시도해 주세요.','NETWORK_ERROR');
 }
}

/** Own a single pinned target. Late POSTs are cancelled, never attached to a newer customer. */
export function createAnalysisSession({onJob,onError,onPending=()=>{},fetcher=fetch,pollMs=1200}:{
 onJob:(job:AnalysisJob)=>void;onError:(error:AnalysisClientError)=>void;onPending?:(value:boolean)=>void;fetcher?:Fetcher;pollMs?:number;
}){
 let version=0,disposed=false,current:AnalysisJob|null=null;
 let timer:ReturnType<typeof setTimeout>|undefined;
 let pollController:AbortController|undefined;
 const relevant=(v:number)=>!disposed&&v===version;
 const clear=()=>{if(timer!==undefined)clearTimeout(timer);timer=undefined;pollController?.abort();pollController=undefined;};
 const asError=(error:unknown)=>error instanceof AnalysisClientError?error:new AnalysisClientError('분석 상태를 확인하지 못했습니다. 다시 실행하거나 취소해 주세요.','STATUS_ERROR');
 const discard=(job:AnalysisJob|null)=>{if(job&&isAnalysisActive(job.status))void analysisRequest('/jobs/'+encodeURIComponent(job.id),{method:'DELETE'},fetcher).catch(()=>{});};
 const validate=(job:AnalysisJob,target:AnalysisTarget,id?:string)=>{
  if(!job||typeof job.id!=='string'||!job.target||!job.target.scope||!['queued','collecting','analyzing','completed','failed','cancelled'].includes(job.status))throw new AnalysisClientError('분석 서버가 올바른 작업 상태를 반환하지 않았습니다.','INVALID_RESPONSE');
  if((id&&job.id!==id)||analysisTargetKey(job.target)!==analysisTargetKey(target))throw new AnalysisClientError('분석 대상이 응답과 일치하지 않습니다. 고객과 기간을 확인하고 다시 실행해 주세요.','TARGET_MISMATCH');
  return job;
 };
 const publish=(job:AnalysisJob)=>{current=job;onJob(job);onPending(isAnalysisActive(job.status));};
 const schedule=(v:number,target:AnalysisTarget,id:string)=>{
  timer=setTimeout(()=>{void poll(v,target,id);},pollMs);
 };
 async function poll(v:number,target:AnalysisTarget,id:string){
  if(!relevant(v))return;
  pollController=new AbortController();
  try{
   const job=validate(await analysisRequest<AnalysisJob>('/jobs/'+encodeURIComponent(id),{signal:pollController.signal},fetcher),target,id);
   if(!relevant(v))return;
   publish(job);if(isAnalysisActive(job.status))schedule(v,target,id);
  }catch(error){if(relevant(v)){onPending(false);onError(asError(error));}}
 }
 return {
  async start(input:AnalysisTarget){
   if(disposed)return;
   const v=++version,target=structuredClone(input);clear();discard(current);current=null;onPending(true);
   try{
    // Do not abort POST on a target switch: read the accepted ID, then cancel the orphan.
    const job=validate(await analysisRequest<AnalysisJob>('/jobs',{method:'POST',body:JSON.stringify(target)},fetcher),target);
    if(!relevant(v)){discard(job);return;}
    publish(job);if(isAnalysisActive(job.status))schedule(v,target,job.id);
   }catch(error){if(relevant(v)){onPending(false);onError(asError(error));}}
  },
  async cancel(){
   const v=++version;clear();const job=current;
   if(!job||!isAnalysisActive(job.status)){if(!disposed)onPending(false);return;}
   try{
    const cancelled=validate(await analysisRequest<AnalysisJob>('/jobs/'+encodeURIComponent(job.id),{method:'DELETE'},fetcher),job.target,job.id);
    if(relevant(v)){publish(cancelled);if(isAnalysisActive(cancelled.status))schedule(v,job.target,job.id);}
   }catch(error){if(relevant(v)){onPending(false);onError(asError(error));}}
  },
  dispose(){if(disposed)return;disposed=true;version++;clear();discard(current);current=null;}
 };
}
