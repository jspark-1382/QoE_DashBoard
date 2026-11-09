import { datesInRange } from '../date-range';
import { analysisScope, canonicalScopeJson } from './scope';
import { validateVoiceImprovementReport } from './validation';
import type { AnalysisScope, CandidatePolicy, ImprovementIndex, ImprovementReport, ImprovementScope } from './types';

export type ImprovementLoadCode='not-generated'|'http-error'|'revision-mismatch'|'invalid-report'|'invalid-index'|'missing-date';
export class ImprovementLoadError extends Error {
  constructor(public readonly code:ImprovementLoadCode,message:string,public readonly reasons:string[]=[]){super(message);this.name='ImprovementLoadError';}
}
async function json(url:string,signal?:AbortSignal):Promise<unknown>{
  signal?.throwIfAborted();
  const response=await fetch(url,{signal,cache:'no-cache'});
  signal?.throwIfAborted();
  if(!response.ok)throw new ImprovementLoadError(response.status===404?'not-generated':'http-error',response.status===404?'선택 조건의 분석 자료가 아직 생성되지 않았습니다.':`분석 자료를 불러오지 못했습니다 (${response.status}).`);
  const value=await response.json();signal?.throwIfAborted();return value;
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export async function loadImprovementIndex(signal?:AbortSignal):Promise<ImprovementIndex>{
  const [value,manifest]=await Promise.all([json('/qoe/voice-improvement-1/index.json',signal),json('/qoe/voice-1030.json',signal)]);
  signal?.throwIfAborted();
  if(!object(value)||value.schemaVersion!=='voice-improvement-1-index-v1'||typeof value.sourceRevision!=='string'||!Array.isArray(value.availableDates)||!value.availableDates.length||!Array.isArray(value.entries))throw new ImprovementLoadError('invalid-index','분석 조건 목록의 형식이 올바르지 않습니다.');
  if(!object(manifest)||!object(manifest.meta)||!Array.isArray(manifest.meta.dates)||manifest.meta.revision!==value.sourceRevision)throw new ImprovementLoadError('revision-mismatch','원본 버전이 변경되어 같은 조건 비교를 할 수 없습니다. 분석 자료를 다시 생성해야 합니다.');
  if(value.availableDates.some(d=>typeof d!=='string'||!manifest.meta || !object(manifest.meta)||!(manifest.meta.dates as unknown[]).includes(d))||new Set(value.availableDates).size!==value.availableDates.length)throw new ImprovementLoadError('invalid-index','분석 목록의 가용 일자가 원본과 일치하지 않습니다.');
  const seen=new Set<string>();
  for(const entry of value.entries){
    if(!object(entry)||typeof entry.scopeKey!=='string'||!/^[a-f0-9]{20}$/.test(entry.scopeKey)||seen.has(entry.scopeKey)||!object(entry.scope)||!object(entry.policy)||entry.scope.sourceRevision!==value.sourceRevision||typeof entry.path!=='string'||!/^[-\w]+\/[a-f0-9]{20}\/report\.json$/.test(entry.path)||entry.path!==`${value.sourceRevision}/${entry.scopeKey}/report.json`||typeof entry.inputHash!=='string'||!/^[a-f0-9]{64}$/.test(entry.inputHash)||typeof entry.inventoryHash!=='string'||!/^[a-f0-9]{64}$/.test(entry.inventoryHash))throw new ImprovementLoadError('invalid-index','분석 조건 목록의 버전·경로·계보가 올바르지 않습니다.');
    const canonical=canonicalScopeJson(entry.scope as unknown as AnalysisScope,entry.policy as unknown as CandidatePolicy);
    if(entry.canonicalScope!==undefined&&entry.canonicalScope!==canonical)throw new ImprovementLoadError('invalid-index','분석 목록의 정규화 조건이 일치하지 않습니다.');
    seen.add(entry.scopeKey);
  }
  return value as unknown as ImprovementIndex;
}
export async function loadImprovementReport(scope:ImprovementScope|AnalysisScope,policy:CandidatePolicy,signal?:AbortSignal):Promise<ImprovementReport>{
  const index=await loadImprovementIndex(signal);signal?.throwIfAborted();
  if(index.sourceRevision!==scope.sourceRevision)throw new ImprovementLoadError('revision-mismatch','선택한 원본 버전과 생성된 분석 버전이 다릅니다.');
  if(!datesInRange(index.availableDates,scope.dateStart,scope.dateEnd).length)throw new ImprovementLoadError('missing-date','선택 기간의 일별 자료가 빠져 있습니다.');
  const aggregate=analysisScope({...scope,hour:null,customerId:null}),canonical=canonicalScopeJson(aggregate,policy);
  const entries=index.entries.filter(entry=>canonicalScopeJson(entry.scope,entry.policy)===canonical);
  if(entries.length!==1)throw new ImprovementLoadError(entries.length?'invalid-index':'not-generated','선택 조건의 분석 자료가 아직 생성되지 않았습니다.');
  const entry=entries[0],value=await json('/qoe/voice-improvement-1/'+entry.path,signal);signal?.throwIfAborted();
  const checked=validateVoiceImprovementReport(value,aggregate,policy);
  if(!checked.ok)throw new ImprovementLoadError('invalid-report','선택 조건과 분석 자료의 검증 결과가 일치하지 않습니다.',checked.reasons);
  const report=value as ImprovementReport;
  if(report.scopeKey!==entry.scopeKey||report.inputHash!==entry.inputHash||report.inventoryHash!==entry.inventoryHash)throw new ImprovementLoadError('invalid-report','분석 자료의 입력 계보가 조건 목록과 일치하지 않습니다.');
  signal?.throwIfAborted();return report;
}
