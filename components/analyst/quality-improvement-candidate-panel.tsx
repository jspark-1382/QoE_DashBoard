'use client';
import {useEffect,useMemo,useState} from 'react';
import {FlaskConical} from 'lucide-react';
import type {AnalystOverview} from '../../lib/analyst/types';
import type {ImprovementCandidateReport} from '../../lib/analyst/improvement-candidates';
import {buildQualityPresentationCandidates} from '../../lib/analyst/quality-candidate-presentation';
import {loadCandidateRoughPoints,type CandidateRoughPoint} from '../../lib/analyst/quality-candidate-rough-points';
import {CandidateWorkspaceView,CandidateDetail} from './improvement-candidates';
import {buildQualityCandidateInvestigation,qualityCandidateRankLabel,buildQualityScopeObservationPoints,loadQualityCandidateDetail,loadQualityCandidateSummary,loadQualityEvidenceIndex,type QualityCandidateDetail,type QualityCandidateScope,type QualityCandidateSummary,type QualityEvidenceIndex} from '../../lib/analyst/quality-improvement-candidates';
import styles from './improvement-candidates.module.css';
import {QualityTwoCandidateAudit,QualityTwoCandidateCustomers} from './quality-improvement-two';
import {QualityTwoCandidateWorkspace} from './quality-two-candidate-workspace';
import {QualityModelAlternativeWorkspace} from './quality-model-alternative-workspace';
import {MODEL_OPTIONS,type QualityModelId,type AlternativeModelId} from '../../lib/analyst/quality-model-alternatives';
import modelStyles from './quality-model-alternative.module.css';
import {useCandidateStationLayer} from './use-candidate-station-layer';
import {coreMinDays,isCandidateShown,type CandidateDisplayMode} from '../../lib/analyst/quality-candidate-visibility';
import {MDT_GRID_MODES,type MdtGridMode} from '../../lib/analyst/mdt-25m-grid';
import {loadCandidateTopTenCustomers,loadDbscanTopTenMatches,type CandidateTopTenMatch,type CandidateTopTenState} from '../../lib/analyst/candidate-top-ten';
export interface QualityCandidateSelection {candidateId:string;callIds:string[];customerIds:string[]}
interface Props {scope:QualityCandidateScope;overview:AnalystOverview;onInvestigate?:(selection:QualityCandidateSelection)=>void;proposalTwo?:boolean;analysisMode?:'all'|'evaluation';onAnalysisModeChange?:(mode:'all'|'evaluation')=>void}
const message=(error:unknown)=>error instanceof Error?error.message:'후보 자료를 확인할 수 없습니다.';
const emptyPoints:[]=[];
const emptyCandidateIds:string[]=[];
const emptyTopTenMatches:CandidateTopTenMatch[]=[];
const emptyTopTen:CandidateTopTenState={status:'idle',customers:[],error:null};
export function QualityImprovementCandidatePanel({scope,overview,onInvestigate,proposalTwo=false,analysisMode:controlledAnalysisMode,onAnalysisModeChange}:Props){
 const [localAnalysisMode,setLocalAnalysisMode]=useState<'all'|'evaluation'>('all');
 const analysisMode=controlledAnalysisMode??localAnalysisMode;
 const setAnalysisMode=onAnalysisModeChange??setLocalAnalysisMode;
 const eligibleEvaluation=(Date.parse(scope.dateEnd+'T00:00:00Z')-Date.parse(scope.dateStart+'T00:00:00Z'))>=2*86400000;
 const effectiveMode=analysisMode==='evaluation'&&eligibleEvaluation?'evaluation':'all';
 const key=JSON.stringify([scope,effectiveMode]);
 const [summaryState,setSummaryState]=useState<{key:string;summary:QualityCandidateSummary|null;error:string|null;loading:boolean}>({key:'',summary:null,error:null,loading:true});
 const [evidenceState,setEvidenceState]=useState<{key:string;value:QualityEvidenceIndex|null;error:string|null}>({key:'',value:null,error:null});
 const [roughState,setRoughState]=useState<{key:string;value:CandidateRoughPoint[];error:string|null}>({key:'',value:[],error:null});
 const stationLayer=useCandidateStationLayer();
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const [selectedModel,setSelectedModel]=useState<QualityModelId>('dbscan');
 const [candidateDisplayMode,setCandidateDisplayMode]=useState<CandidateDisplayMode>('core');
 const topTenScopeKey=JSON.stringify(scope);
 const [topTenStore,setTopTenStore]=useState<{key:string;value:CandidateTopTenState}>({key:'',value:emptyTopTen});
 const [topTenMatches,setTopTenMatches]=useState<{key:string;ids:string[];matches:CandidateTopTenMatch[];status:CandidateTopTenState['status'];error:string|null}>({key:'',ids:[],matches:[],status:'idle',error:null});
 const [mdtGridMode,setMdtGridMode]=useState<MdtGridMode>('top1');
 const [guideOpenRequest,setGuideOpenRequest]=useState(0);
 const [fullscreenActive,setFullscreenActive]=useState(false);
 const [filter,setFilter]=useState<'all'|'spatial'|'cell'>('all');
 const [detailState,setDetailState]=useState<{key:string;id:string;value:QualityCandidateDetail|null;error:string|null}>({key:'',id:'',value:null,error:null});
 const summary=summaryState.key===key?summaryState.summary:null;
 const evidence=evidenceState.key===key?evidenceState.value:null;
 const roughPoints=roughState.key===key?roughState.value:emptyPoints;
 const roughStatus=roughState.key!==key?'loading':roughState.error?'error':'ready';
 const roughError=roughState.key===key?roughState.error:null;
 const minimumDays=coreMinDays(scope.dateStart,scope.dateEnd);
 const storedTopTen=topTenStore.key===topTenScopeKey?topTenStore.value:emptyTopTen;
 const topTen:CandidateTopTenState=storedTopTen.status==='idle'||(storedTopTen.status==='loading'&&candidateDisplayMode!=='top10')
  ?{...emptyTopTen,status:candidateDisplayMode==='top10'?'loading':'idle'}:storedTopTen;
 const topTenMatchKey=JSON.stringify([key,summary?.scopeKey,summary?.locationMode,topTen.customers.map(c=>c.id)]);
 const matchState=topTenMatches.key===topTenMatchKey?topTenMatches:null;
 const dbscanTopTen:CandidateTopTenState={...topTen,
  status:topTen.status==='ready'?(matchState?.status??'loading'):topTen.status,
  error:topTen.error??matchState?.error??null};
 const topTenIds=matchState?.status==='ready'?matchState.ids:emptyCandidateIds;
 const topTenCandidateMatches=matchState?.status==='ready'?matchState.matches:emptyTopTenMatches;
 const displayedSummary=useMemo(()=>summary?{...summary,candidates:!proposalTwo?summary.candidates:
  candidateDisplayMode==='top10'?summary.candidates.filter(c=>dbscanTopTen.status==='ready'&&topTenIds.includes(c.id)):
  summary.candidates.filter(c=>isCandidateShown(c.poorCallCount,c.poorCustomerCount,c.poorDateCount,minimumDays,candidateDisplayMode))}:null,
  [summary,minimumDays,candidateDisplayMode,proposalTwo,dbscanTopTen.status,topTenIds]);
 const activeId=displayedSummary?.candidates.some(c=>c.id===selectedId)?selectedId:displayedSummary?.candidates[0]?.id??null;
 const detail=detailState.key===key&&detailState.id===activeId?detailState.value:null;
 useEffect(()=>{
  if(!proposalTwo||candidateDisplayMode!=='top10')return;
  const controller=new AbortController();
  queueMicrotask(()=>{if(!controller.signal.aborted)setTopTenStore(previous=>previous.key===topTenScopeKey&&previous.value.status==='ready'?previous:{key:topTenScopeKey,value:{...emptyTopTen,status:'loading'}});});
  void loadCandidateTopTenCustomers(scope,controller.signal)
   .then(customers=>{if(!controller.signal.aborted)setTopTenStore({key:topTenScopeKey,value:{status:'ready',customers,error:null}});})
   .catch(error=>{if(!controller.signal.aborted)setTopTenStore({key:topTenScopeKey,value:{...emptyTopTen,status:'error',error:message(error)}});});
  return()=>controller.abort();
 },[proposalTwo,candidateDisplayMode,topTenScopeKey,scope]);
 useEffect(()=>{
  if(!proposalTwo||candidateDisplayMode!=='top10'||selectedModel!=='dbscan'||!summary||topTen.status!=='ready')return;
  const controller=new AbortController();
  queueMicrotask(()=>{if(!controller.signal.aborted)setTopTenMatches(previous=>previous.key===topTenMatchKey&&previous.status==='ready'?previous:{key:topTenMatchKey,ids:[],matches:[],status:'loading',error:null});});
  void loadDbscanTopTenMatches(summary,topTen.customers,effectiveMode,controller.signal)
   .then(matches=>{if(!controller.signal.aborted)setTopTenMatches({key:topTenMatchKey,ids:matches.map(match=>match.candidateId),matches,status:'ready',error:null});})
   .catch(error=>{if(!controller.signal.aborted)setTopTenMatches({key:topTenMatchKey,ids:[],matches:[],status:'error',error:message(error)});});
  return()=>controller.abort();
 },[proposalTwo,candidateDisplayMode,selectedModel,summary,topTen.status,topTen.customers,effectiveMode,topTenMatchKey]);
 useEffect(()=>{
  const controller=new AbortController();
  void loadQualityCandidateSummary(scope,controller.signal,effectiveMode,proposalTwo?'mixed':'strict').then(value=>{if(!controller.signal.aborted){setSummaryState({key,summary:value,error:null,loading:false});setSelectedId(value.candidates[0]?.id??null);}}).catch(error=>{if(!controller.signal.aborted){setSummaryState({key,summary:null,error:message(error),loading:false});setSelectedId(null);}});
  void loadQualityEvidenceIndex(scope,controller.signal).then(value=>{if(!controller.signal.aborted)setEvidenceState({key,value,error:null});}).catch(error=>{if(!controller.signal.aborted)setEvidenceState({key,value:null,error:message(error)});});
  return()=>controller.abort();
 },[key,scope,effectiveMode,proposalTwo]);
 // Display-only approximate coordinates; never feed the candidate algorithm.
 useEffect(()=>{
  const controller=new AbortController();
  void loadCandidateRoughPoints(overview,scope,controller.signal)
    .then(value=>{if(!controller.signal.aborted)setRoughState({key,value,error:null});})
    .catch(error=>{if(!controller.signal.aborted)setRoughState({key,value:[],error:message(error)});});
  return()=>controller.abort();
 },[key,overview,scope]);
 useEffect(()=>{
  if(!summary||!activeId)return;
  const controller=new AbortController();
  void loadQualityCandidateDetail(summary,activeId,controller.signal,effectiveMode).then(value=>{if(!controller.signal.aborted)setDetailState({key,id:activeId,value,error:null});}).catch(error=>{if(!controller.signal.aborted)setDetailState({key,id:activeId,value:null,error:message(error)});});
  return()=>controller.abort();
 },[summary,activeId,key,effectiveMode]);
 const observations=useMemo(()=>evidence?buildQualityScopeObservationPoints(overview,scope,evidence):emptyPoints,[overview,scope,evidence]);
 const mapped=useMemo(()=>displayedSummary?buildQualityPresentationCandidates(displayedSummary,detail):[],[displayedSummary,detail]);
 const investigate=()=>{
  if(!detail)return;
  onInvestigate?.(buildQualityCandidateInvestigation(detail,overview));
 };
 const selected=displayedSummary?.candidates.find(c=>c.id===activeId);
 const nearby=detail?.candidate.nearbyPoints??emptyPoints;
 const mapPoints=detail?nearby:observations;
 const modePicker=proposalTwo?<section className={modelStyles.compactModePicker} aria-label="후보 분석 목적 선택"><label className={modelStyles.mdtGridPicker}>25m 격자 <select aria-label="25m MDT 격자 주파수 선택" title="Top1은 격자별 가장 많은 측정 건수의 EARFCN입니다 (개별 셀 ID 아님). 2026.11.03 자료." value={mdtGridMode} onChange={event=>setMdtGridMode(event.target.value as MdtGridMode)}>{MDT_GRID_MODES.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label><fieldset className={modelStyles.compactModeButtons} aria-label="분석 모드">
    <button type="button" aria-label="전체 기간 후보 분석 (기본)" title="모든 날짜를 후보 산정에 사용합니다" aria-pressed={effectiveMode==='all'} onClick={()=>setAnalysisMode('all')}>전체 기간</button>
    <button type="button" aria-label="알고리즘 성능 검증 (기간 분리)" title={eligibleEvaluation?'마지막 날을 독립적인 후속 평가일로 분리합니다':'최소 3일을 선택해야 사용할 수 있습니다'} aria-pressed={effectiveMode==='evaluation'} disabled={!eligibleEvaluation} onClick={()=>setAnalysisMode('evaluation')}>성능 검증</button>
   </fieldset></section>:null;
 if(!summary)return <>{modePicker}<output className={styles.detail}>{summaryState.key===key&&summaryState.error?summaryState.error:'현재 조건의 후보를 확인하고 있습니다…'}</output></>;
 const candidate=mapped.find(c=>c.id===activeId);
 const report:ImprovementCandidateReport={schemaVersion:'qoe-improvement-candidates-v1',sourceRevision:scope.sourceRevision,
  analysisDates:[...summary.discoveryDates,...summary.validationDates],trainingDates:summary.discoveryDates,verificationDate:summary.validationDates.join(', '),
  analysisWindowNote:scope.dateStart+' ~ '+scope.dateEnd+' · '+scope.from+' ~ '+scope.to,sourceBasis:'원본 CDR / 채택 위치',algorithm:'규칙 기반 후보 산정',
  summary:{cdrCalls:overview.calls.length,mosScored:overview.calls.filter(c=>typeof c.mos==='number'&&c.mos>=1&&c.mos<=5).length,poorCalls:overview.calls.filter(c=>typeof c.mos==='number'&&c.mos>=1&&c.mos<3).length,
   candidateCount:mapped.length,spatialCandidateCount:mapped.length,distinctAffectedCustomers:summary.distinctAffectedCustomers??0,cellCandidateCount:0,mappedCandidates:mapped.filter(c=>c.location).length,independentlyConfirmedRootCauses:0},
  candidates:mapped,limitations:['BYE 기지국 단독 위치는 지역 후보에서 제외하며 Cell 참고 후보는 별도 산정 대상입니다.','관측 위치는 실제 QoE 열화 순간의 확정 좌표가 아닙니다.']};
 // Keep all controls beside the map title, not in a separate block below it.
 // Full semantics are preserved as accessible names and tooltips.
 const mapControls=(expanded:boolean)=><div className={modelStyles.headingControls}
   aria-label={expanded?'전체화면 분석 설정':'개선 2안 분석 설정'}>
  {modePicker}
  <select id={expanded?'quality-model-selector-full':'quality-model-selector'}
   className={modelStyles.headingModelSelect}
   title="개선 후보 산정 모델 선택 · DBSCAN, HDBSCAN, ST-DBSCAN, Adaptive KDE, Spatial Scan, Bayesian"
   aria-label={expanded?'전체화면 개선 후보 알고리즘':'개선 후보 알고리즘'}
   value={selectedModel} onChange={event=>setSelectedModel(event.target.value as QualityModelId)}>
   {MODEL_OPTIONS.map(option=><option key={option.id} value={option.id}>
    {option.id==='dbscan'?'DBSCAN · 100m':option.id==='adaptive_kde'?'KDE':option.name}
   </option>)}
  </select>
  <button type="button" className={modelStyles.headingSimulator}
   title="선택 알고리즘 설명·7단계 시뮬레이션 팝업"
   aria-label="알고리즘 설명·시뮬레이션" onClick={()=>setGuideOpenRequest(n=>n+1)}>
    <FlaskConical size={16} aria-hidden="true"/>
  </button>
 </div>;
 if(proposalTwo)return <>
  {selectedModel==='dbscan'?<>
   <QualityTwoCandidateWorkspace summary={displayedSummary!} fullSummary={summary} topTen={dbscanTopTen} topTenCount={topTenIds.length} topTenMatches={topTenCandidateMatches} mdtGridMode={mdtGridMode} totalCount={summary.candidates.length} minimumDays={minimumDays} displayMode={candidateDisplayMode} onDisplayModeChange={setCandidateDisplayMode} analysisMode={effectiveMode} guideOpenRequest={guideOpenRequest} mapControls={mapControls} initiallyExpanded={fullscreenActive} onFullscreenChange={setFullscreenActive} mapped={mapped} selectedId={activeId} detail={detail}
    detailPending={detailState.key!==key||detailState.id!==activeId}
    detailError={detailState.key===key&&detailState.id===activeId?detailState.error:null}
    overview={overview} observationPoints={observations} roughPoints={roughPoints} roughStatus={roughStatus} roughError={roughError} stationLayer={stationLayer} onSelect={setSelectedId} onInvestigate={investigate}/>
   {effectiveMode==='evaluation'&&<QualityTwoCandidateAudit scope={scope} summary={summary} onSelectCandidate={id=>{if(!displayedSummary?.candidates.some(c=>c.id===id))setCandidateDisplayMode('all');setSelectedId(id);}}/>}
  </>:<QualityModelAlternativeWorkspace key={selectedModel+'|'+key} scope={scope} overview={overview}
   modelId={selectedModel as AlternativeModelId} topTen={topTen} mdtGridMode={mdtGridMode} analysisMode={effectiveMode} locationSource={proposalTwo?'mixed':'strict'} displayMode={candidateDisplayMode} onDisplayModeChange={setCandidateDisplayMode} guideOpenRequest={guideOpenRequest} mapControls={mapControls} initiallyExpanded={fullscreenActive} onFullscreenChange={setFullscreenActive} baselineCount={summary.candidates.length} roughPoints={roughPoints} roughStatus={roughStatus} roughError={roughError} stationLayer={stationLayer} onInvestigate={onInvestigate}/>}
 </>;
 const chooseFilter=(value:'all'|'spatial'|'cell')=>{setFilter(value);if(value==='cell')setSelectedId(null);else if(!selectedId)setSelectedId(summary.candidates[0]?.id??null);};
 return <><CandidateWorkspaceView proposalTwo={proposalTwo} report={report} selectedId={selectedId??''} filter={filter} onFilter={chooseFilter} onSelect={setSelectedId}
  observationPoints={detail?mapPoints.filter((p):p is typeof observations[number]=>p.kind==='reviewed-radio'):observations}
  affectedCustomers={summary.distinctAffectedCustomers??'미산출'} cellCount="미산출"
  rankLabels={Object.fromEntries(summary.candidates.map(c=>[c.id,qualityCandidateRankLabel(c)]))}
  emptyContent={<><strong>{filter==='cell'?'Cell 참고 후보 별도 산정':'현재 조건의 후보 0곳'}</strong><p>{filter==='cell'?'기지국 단독 좌표는 지역 개선 후보에서 제외됩니다.':'채택된 저QoE 관측점은 지도에서 계속 확인할 수 있습니다.'}</p></>}
  detailContent={detail&&candidate?<><CandidateDetail candidate={candidate} all={mapped} quality/>
   {proposalTwo&&<QualityTwoCandidateCustomers detail={detail}/>}
   <button className={styles.callLink} type="button" onClick={investigate}>관련 통화·고객을 아래 통화 목록에서 확인</button>
   {selected?.rangeReviewRequired&&<p className={styles.unknownLocation}>범위 검토 필요 · 개선 순위 확정 보류</p>}</>:<output className={styles.detail}>{detailState.key===key&&detailState.id===selectedId&&detailState.error?detailState.error:'선택 후보 상세를 확인하고 있습니다…'}</output>}
  footerContent={<>발견 {summary.discoveryDates.join(', ')} · 검증 {summary.validationDates.join(', ')||'없음'} · 매일 {scope.from}~{scope.to}. 다른 고객 재관측과 현장 검증을 구분합니다.</>}/>
   {proposalTwo&&<QualityTwoCandidateAudit scope={scope} summary={summary} onSelectCandidate={setSelectedId}/>}</>
}
