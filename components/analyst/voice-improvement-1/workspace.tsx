'use client';
import { useEffect,useMemo,useState } from 'react';
import { QualityTopNav } from '../quality-top-nav';
import DocumentLink from '../document-link';
import { loadImprovementIndex,loadImprovementReport } from '../../../lib/analyst/voice-improvement-1/loader';
import { analysisScope,DEFAULT_CANDIDATE_POLICY,improvementScopeQuery,improvementComparisonHref,legacyComparisonHref,parseImprovementScope } from '../../../lib/analyst/voice-improvement-1/scope';
import type { ImprovementIndex,ImprovementReport,ImprovementScope } from '../../../lib/analyst/voice-improvement-1/types';
import { CoveragePanel } from './coverage-panel';
import { CandidateMap } from './candidate-map';
import { mapEvidencePoints } from './map-evidence';
import { CandidatePanel } from './candidate-panel';
import { CustomerPanel } from './customer-panel';
import { ComparisonPanel } from './comparison-panel';
import { FieldPanel } from './field-panel';
import styles from './workspace.module.css';

const errorMessage=(error:unknown)=>{
 const code=typeof error==='object'&&error&&'code' in error?String(error.code):'';
 return ({'not-generated':'현재 조건의 후보 산출물 없음 · 선택한 기간·시간창·모드로 배치 산정이 필요합니다.','revision-mismatch':'원본 버전이 달라 비교를 차단했습니다. 최신 원본 기준으로 후보를 다시 산정해야 합니다.','invalid-report':'산출물의 조건·입력 해시·날짜 또는 통화 ID를 검증하지 못했습니다. 비교를 차단했습니다.','invalid-index':'후보 조건 인덱스를 검증하지 못했습니다.','http-error':'자료를 불러오지 못했습니다. 연결과 파일 제공 상태를 확인해 주세요.'} as Record<string,string>)[code]??'자료를 불러오지 못했습니다. 연결과 산출물을 확인해 주세요.';
};
function ScopeControls({scope,dates,onApply}:{scope:ImprovementScope;dates:readonly string[];onApply:(scope:ImprovementScope)=>void}){
 const [draft,setDraft]=useState(scope);

 return <form className={styles.scope} onSubmit={e=>{e.preventDefault();onApply(draft);}} aria-label="공통 분석 조건"><div className={styles.scopeFields}><label>시작일 (KST)<input type="date" min={dates[0]} max={dates.at(-1)} required value={draft.dateStart} onChange={e=>setDraft({...draft,dateStart:e.target.value})}/></label><label>종료일 (KST)<input type="date" min={dates[0]} max={dates.at(-1)} required value={draft.dateEnd} onChange={e=>setDraft({...draft,dateEnd:e.target.value})}/></label><label>매일 시작시간<input type="time" required value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})}/></label><label>매일 종료시간<input type="time" required value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})}/></label><label>분석 모드<select value={draft.mode} onChange={e=>setDraft({...draft,mode:e.target.value as ImprovementScope['mode']})}><option value="holdout">발견 / 마지막 날 검증</option><option value="screening">탐색 (검증일 없음)</option></select></label><button type="submit" className={styles.primaryButton}>조건 적용</button></div><div className={styles.scopeFoot}><span>MDT · 원본 QoE v5 · 저QoE 1 ≤ QoE &lt; 3</span><span>시간창은 각 날짜에 적용 · 자정 초과 범위 미지원</span><span className={styles.revision}>원본 {scope.sourceRevision}</span></div></form>;
}
export function VoiceImprovementOneWorkspace(){
 const [index,setIndex]=useState<ImprovementIndex|null>(null),[search,setSearch]=useState<string|null>(null),[report,setReport]=useState<ImprovementReport|null>(null),[error,setError]=useState(''),[showDots,setShowDots]=useState(true),[reload,setReload]=useState(0);
 useEffect(()=>{const update=()=>{setSearch(window.location.search);setError('');};update();window.addEventListener('popstate',update);return()=>window.removeEventListener('popstate',update);},[]);
 useEffect(()=>{const controller=new AbortController();void loadImprovementIndex(controller.signal).then(value=>{if(!controller.signal.aborted)setIndex(value);}).catch(reason=>{if(!controller.signal.aborted){setError(errorMessage(reason));}});return()=>controller.abort();},[reload]);
 const parsed=useMemo(()=>index&&search!==null?parseImprovementScope(search,index.availableDates,index.sourceRevision):null,[index,search]);
 const scope=parsed?.ok?parsed.scope:null;
 const scopeKey=scope?JSON.stringify(analysisScope(scope)):'';
 const reportScope=useMemo<ImprovementScope|null>(()=>scopeKey?{...JSON.parse(scopeKey),hour:null,customerId:null}:null,[scopeKey]);
 useEffect(()=>{
  if(!reportScope)return;
  const controller=new AbortController();let current=true;
  void loadImprovementReport(reportScope,DEFAULT_CANDIDATE_POLICY,controller.signal).then(value=>{if(current&&!controller.signal.aborted){setReport(value);}}).catch(reason=>{if(current&&!controller.signal.aborted){setError(errorMessage(reason));}});
  return()=>{current=false;controller.abort();};
  // Only aggregate conditions load a report. hour/customer are detail exploration.
 },[reportScope,reload]);
 const visibleReport=scope&&report&&JSON.stringify(analysisScope({...report.scope,hour:null,customerId:null}))===scopeKey&&report.sourceRevision===scope.sourceRevision?report:null;
 const query=new URLSearchParams(search??''),candidateId=query.get('candidate')??'';
 const candidates=visibleReport?.improvedSpatialCandidates??[];
 const selected=candidates.find(c=>c.id===candidateId)??(!candidateId?candidates[0]:undefined);
 const layers=useMemo(()=>mapEvidencePoints(visibleReport,selected),[visibleReport,selected]);
 const navigate=(next:ImprovementScope,extra?:{candidate?:string})=>{if(JSON.stringify(analysisScope(next))!==scopeKey){setReport(null);setError('');}const q=new URLSearchParams(improvementScopeQuery(next));const chosen=extra?.candidate??candidateId;if(chosen)q.set('candidate',chosen);window.history.pushState(null,'',window.location.pathname+'?'+q.toString());setSearch(window.location.search);};
 const switchConditions=()=>{setError('');const q=new URLSearchParams(search??'');q.set('source','MDT');q.set('metric','mos');if(index)q.set('compareRevision',index.sourceRevision);window.history.pushState(null,'',window.location.pathname+'?'+q.toString());setSearch(window.location.search);};
 const legacyHref=scope?legacyComparisonHref(scope):'/?source=MDT&view=overview';
 const invalid=parsed&&!parsed.ok?parsed.reason:null;
 return <main className={styles.workspace}><QualityTopNav active="improvement1" improvementHref={scope?improvementComparisonHref(scope):undefined} date={scope?.dateEnd} legacyHref={legacyHref} sourceLabel={scope?scope.dateStart.replaceAll('-','.')+' ~ '+scope.dateEnd.replaceAll('-','.')+' · MDT':'MDT · 원본 QoE'}/><div className={styles.body}>
 <header className={styles.hero}><div><span className={styles.eyebrow}>음성 체감지표 · 개선 1안</span><h1>현장에서 확인할 지역을, 근거와 함께.</h1><p>저QoE 통화와 연결된 관측·추정 위치를 바탕으로 조사 우선순위를 살펴봅니다.</p></div><div className={styles.heroActions}><DocumentLink href={legacyHref} className={styles.outlineLink}>같은 조건의 기존안 보기 ↗</DocumentLink><button type="button" className={styles.outlineLink} onClick={()=>{setReport(null);setError('');setReload(v=>v+1);}}>자료 다시 확인</button></div></header>
 {scope&&index&&<ScopeControls key={improvementScopeQuery(scope)} scope={scope} dates={index.availableDates} onApply={next=>navigate(next,{candidate:''})}/>}
 {invalid&&<div className={styles.warning} role="alert">{invalid==='revision-mismatch'?'원본 버전 불일치 · compareRevision과 현재 sourceRevision이 달라 동일 조건 비교를 차단했습니다.':invalid==='unsupported-source'||invalid==='unsupported-metric'?'QoE·MDT 조건으로 비교 가능합니다. 현재 전달된 출처 또는 지표는 지원하지 않습니다.':'분석 기간·일별 시간창·모드를 확인해 주세요. 발견/검증 모드는 연속된 3일 이상이 필요하며 자정을 넘는 시간창은 지원하지 않습니다.'}{(invalid==='unsupported-source'||invalid==='unsupported-metric')&&<p><button type="button" className={styles.primaryButton} onClick={switchConditions}>MDT · QoE 조건으로 전환</button></p>}{invalid==='revision-mismatch'&&<p>원본 버전을 임의로 바꾸지 않았습니다. 최신 조건으로 다시 진입하거나 산출물을 확인해 주세요.</p>}{invalid!=='revision-mismatch'&&invalid!=='unsupported-source'&&invalid!=='unsupported-metric'&&index&&<p><button type="button" className={styles.primaryButton} onClick={()=>{const normalized=parseImprovementScope('',index.availableDates,index.sourceRevision);if(normalized.ok)navigate(normalized.scope,{candidate:''});}}>전체 가용 기간으로 초기화</button></p>}</div>}
 {error&&<div className={styles.error} role="alert">{error}</div>}
 {!visibleReport&&!error&&!invalid&&<output className={styles.loading}>분석 조건과 원본 버전을 확인하고 있습니다…</output>}
 {visibleReport&&scope&&<><div className={styles.status}>규칙 기반 분석 · {scope.mode==='holdout'?`발견 ${visibleReport.discoveryDates.length}일 / 검증 ${visibleReport.validationDates.join(', ')}`:'탐색 모드 · 검증기간 재관측 판정 없음'} · DBSCAN 이웃거리 {visibleReport.policy.epsM}m / 최소 {visibleReport.policy.minSamples}통화</div><CoveragePanel coverage={visibleReport.coverage}/>
 <div className={styles.mapGrid}><section className={`${styles.panel} ${styles.mapPanel}`}><div className={styles.mapTitle}><div><span className={styles.eyebrow}>위치 근거와 조사 범위</span><h2>{candidates.length?'규칙 기반 지역 조사 후보':'저QoE 연결 관측점'}</h2></div><label><input type="checkbox" checked={showDots} onChange={e=>setShowDots(e.target.checked)}/> {candidates.length?'주변 저QoE 도트':'저QoE 관측점'}</label></div><div className={styles.legend}>{candidates.length?<><span><i/>발견 구성 통화</span><span><i className={styles.green}/>검증 신규 고객</span><span><i className={styles.purple}/>검증 기존 고객</span></>:<span>저QoE 관측 {layers.observationPoints.length}통화 · 반복 지역 후보 미선정</span>}<span>● GPS · ◆ 검토 통과 삼각 측량</span></div><CandidateMap candidates={candidates} nearbyPoints={showDots?layers.nearbyPoints:[]} observationPoints={showDots?layers.observationPoints:[]} selectedId={selected?.id??''} onSelect={id=>navigate(scope,{candidate:id})}/></section><CandidatePanel candidates={candidates} selectedId={selected?.id??''} onSelect={id=>navigate(scope,{candidate:id})}/></div>
 <CustomerPanel calls={visibleReport.calls} candidate={selected} availableDates={visibleReport.availableDates} customerId={scope.customerId} hour={scope.hour} onCustomer={customerId=>navigate({...scope,customerId})} onHour={hour=>navigate({...scope,hour})}/>
 <div className={styles.bottomGrid}><ComparisonPanel report={visibleReport}/><FieldPanel scope={scope}/></div><details className={styles.disclosure}><summary>분석 정책과 자료 계보</summary><p>위치 정책: {visibleReport.policy.locationPolicy} · 입력 파일 {visibleReport.inputFiles.length}개 · 입력 해시 {visibleReport.inputHash} · 인벤토리 {visibleReport.inventoryHash}</p><p>같은 통화에서 GPS를 우선하고 검토 통과한 삼각 측량만 추가합니다. BYE 단독 좌표·거친 추정은 지역 후보 입력에 포함하지 않습니다. 지도 표시 범위는 실제 위치 정확도나 통계적 신뢰구간을 뜻하지 않습니다.</p></details></>}
 <footer className={styles.footer}>기존 화면과 분리된 개선 실험입니다. 행정동·후보·지도 레이어는 상세 탐색 조건이며 전체 CDR 분모를 바꾸지 않습니다.<br/>QoE 열화 순간의 좌표·불량 원인·실제 품질 개선 효과는 현장 검증이 필요합니다.</footer>
 </div></main>;
}
