'use client';
import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {AlertTriangle,ChevronRight,FlaskConical,MapPinned,Layers,Info,Users} from 'lucide-react';
import type {AnalystOverview} from '../../lib/analyst/types';
import type {ImprovementCandidate} from '../../lib/analyst/improvement-candidates';
import type {QualityCandidateScope} from '../../lib/analyst/quality-improvement-candidates';
import {
 loadAlternativeModelReport,MODEL_EXPLANATIONS,MODEL_OPTIONS,
 type AlternativeModelId,type AlternativeModelReport,type AlternativeCandidate
} from '../../lib/analyst/quality-model-alternatives';
import {candidateAdministrativeDong} from '../../lib/analyst/quality-two-candidate-view-model';
import {ImprovementCandidateMap} from './improvement-candidate-map';
import {CandidateTopTenMap} from './candidate-top-ten-map';
import {CandidateTopTenCoverage,CandidateTopTenMembers} from './candidate-top-ten-members';
import {candidateTopTenMembers,includeCandidateTopTenLocations,summarizeCandidateTopTenCoverage,type CandidateTopTenMatch,type CandidateTopTenState} from '../../lib/analyst/candidate-top-ten';
import {useCandidateTopTenLocations} from './use-candidate-top-ten-locations';
import type {CandidateRoughPoint} from '../../lib/analyst/quality-candidate-rough-points';
import {matchCandidateRoughPoints} from '../../lib/analyst/quality-candidate-rough-membership';
import {selectCandidateStationSites} from '../../lib/analyst/station-map-presentation';
import {StationLayerControls} from './station-layer-controls';
import type {StationLayerState} from './use-candidate-station-layer';
import {MapPanelFrame} from './map-panel-frame';
import {QualityModelSimulator} from './quality-model-simulator';
import {QualitySimulatorDialog} from './quality-simulator-dialog';
import {QualityInvestigationRail} from './quality-investigation-rail';
import {CandidateVisibilityToggle} from './candidate-visibility-toggle';
import type {MdtGridMode} from '../../lib/analyst/mdt-25m-grid';
import {coreMinDays,isCandidateShown,type CandidateDisplayMode} from '../../lib/analyst/quality-candidate-visibility';
import {CandidateMdtRsrpChart} from './candidate-mdt-rsrp-chart';
import {candidateAnalysisTarget,isCurrentCandidateAnalysisJob} from '../../lib/analyst/candidate-ai-analysis';
import {CandidateAiDialog,CandidateAiSummary,candidateAiButtonLabel,useCandidateAiAnalysis} from './candidate-ai-analysis';
import styles from './quality-model-alternative.module.css';

interface Props{
 scope:QualityCandidateScope;overview:AnalystOverview;modelId:AlternativeModelId;analysisMode:'all'|'evaluation';locationSource?:'strict'|'mixed';mdtGridMode:MdtGridMode;displayMode:CandidateDisplayMode;onDisplayModeChange:(mode:CandidateDisplayMode)=>void;guideOpenRequest:number;mapControls?:(expanded:boolean)=>ReactNode;initiallyExpanded?:boolean;onFullscreenChange?:(value:boolean)=>void;
 onInvestigate?:(selection:{candidateId:string;callIds:string[];customerIds:string[]})=>void;
 baselineCount:number;
 topTen:CandidateTopTenState;
 roughPoints:CandidateRoughPoint[];
 roughStatus:'loading'|'ready'|'error';
 roughError:string|null;
 stationLayer:StationLayerState;
}
const n=(v:number)=>v.toLocaleString('ko-KR');
const metricValue=(c:AlternativeCandidate,id:AlternativeModelId):string=>{
 if(id==='adaptive_kde')return '상대 밀도 점수 '+(c.metric.relativeDensity??0).toFixed(3);
 if(id==='spatial_scan')return '조건부 로그우도비 '+(c.metric.scanLlr??0).toFixed(2)+' · 순열 p '+(c.metric.conditionalPermutationP??1).toFixed(2);
 if(id==='bayesian')return '위치확보 표본 사후평균 '+Math.round(100*(c.metric.posteriorMean??0))+'%';
 return c.poorCalls+'건 구성 · '+c.poorCustomers+'명';
};
function mappedCandidate(c:AlternativeCandidate,i:number,modelId:AlternativeModelId,validationDates:string[]):ImprovementCandidate{
 return {
  id:c.id,kind:'spatial',label:'후보 지역 '+(i+1),
  location:{lat:c.lat,lon:c.lon,radiusM:c.radiusM,source:c.medoidKind==='rough'?'TRAINING_MDT_ROUGH_CLUSTER_MEDOID':'TRAINING_GNSS_CLUSTER_MEDOID',meaning:c.medoidKind==='rough'?'MDT RSRP 근사 중심 · 위치 정확도 미검증':'GPS 기반 대표점 · QoE 순간 위치 또는 측위 오차 반경 아님'},
  discovery:{distinctPoorCustomers:c.poorCustomers,poorCalls:c.poorCalls,days:c.days,dropCalls:0},
  validation:{newPoorCustomers:c.validationNewCustomers,newPoorCalls:c.validationPoints.length,date:validationDates.join(', '),definition:'발견기간 신규 고객의 별도 검증일 100m 이내 저QoE 관측'},
  normalReference:{nearbyCalls:null,distinctCustomers:null,caution:'정상 통화 위치 확보 편향 때문에 전체 불량률 분모로 사용하지 않습니다.'},
  relatedEndCells:[],representativeCalls:c.members.map(p=>({date:p.date,customerId:p.customerId,callId:p.callId,mos:p.mos,endCellId:'',start:''})),
  relatedGnss:[],relatedGnssCallCount:c.gnssCalls,
  evidence:c.locationMode?'GNSS_MDT_ROUGH_ASSOCIATION':'GNSS_CDR_ASSOCIATION',verification:'INDEPENDENT_NEXT_DAY_CUSTOMER_REPEAT',
  hypotheses:['후보가 실제 무선 원인이라는 근거는 아직 없습니다.'],
  fieldChecks:['동일 지역의 정상·불량 통화 및 RF 증거 확보','GPS·삼각 측량 위치 오차 점검','검증일 다른 고객 독립 재관측 확인'],
  radioReference:{linkedCdrMdtRepresentativeCalls:0,rsrpMedianDbm:null,rsrqMedianDb:null,sinrMedianDb:null,warning:'실제 RF 원인 분석은 별도'},
 };
}
function CandidateObservationTable({candidate}:{candidate:AlternativeCandidate}){
 const [expanded,setExpanded]=useState(false);
 const people=[...new Set(candidate.members.map(p=>p.customerId))].sort();
 const aliases=new Map(people.map((p,i)=>[p,'고객 '+(i<26?String.fromCharCode(65+i):String(i+1))]));
 const shown=expanded?candidate.members:candidate.members.slice(0,8);
 return <div className={styles.observations} aria-label="선택 모델 후보의 실제 원본 통화">
  <h4>후보를 구성한 원본 저QoE 통화 <span>{candidate.members.length}건</span></h4>
  <p>아래 고객 표기는 익명 별칭입니다. 서로 다른 고객의 공간 중복과 같은 고객의 반복 통화를 구분해야 합니다.</p>
  <div className={styles.tableWrap}>
   <table><thead><tr><th>고객</th><th>날짜</th><th>QoE</th><th>위치 근거</th></tr></thead>
    <tbody>{shown.map(p=><tr key={p.callId}><td>{aliases.get(p.customerId)}</td><td>{p.date.slice(5)}</td><td>{p.mos.toFixed(2)}</td><td>{p.kind==='gnss'?'GPS':p.kind==='rough'?'MDT RSRP 근사 (미검증)':'검토 통과 삼각 측량'}</td></tr>)}</tbody>
   </table>
  </div>
  {candidate.members.length>8&&<button className={styles.more} type="button" onClick={()=>setExpanded(v=>!v)}>
   {expanded?'통화 접기':'나머지 '+(candidate.members.length-8)+'건 펼치기'}
  </button>}
  {candidate.validationPoints.length>0&&<p className={styles.validation}>후속 평가일 이웃 통화 {candidate.validationPoints.length}건 · 신규 고객 {candidate.validationNewCustomers}명 (후보 군집 구성에는 포함하지 않음)</p>}
 </div>;
}
function ModelMethodPanel({modelId,report,actual,actualIndex,view}:{modelId:AlternativeModelId;report:AlternativeModelReport;actual:AlternativeCandidate|null;actualIndex:number;view:'explanation'|'simulator'|'criteria'|'map'}){
 const desc=MODEL_EXPLANATIONS[modelId];
 const record=report.models[modelId];
 const subset=record.status==='exploratory-located-only';
 const mixed=report.locationMode==='gps-mdt-rough-unvalidated-v1';
 return <aside className={styles.methodPanel} aria-label="선택 모델 알고리즘 검증 기준">
  <span className={styles.methodOverline}>모델별 산출 방식</span><h3>{desc.title}</h3>
  <div className={styles.methodScroll}>
   {view==='simulator'&&<QualityModelSimulator modelId={modelId} report={report} actual={actual} actualIndex={actualIndex}/>}
   {(view==='explanation'||view==='criteria')&&<section><h4>① 어떤 원본인가요?</h4>
    <p>원본 버전: {report.sourceRevision.slice(0,10)}…</p>
    <p>{report.analysisMode==='all'?'전체 후보 산정기간':'후보 발견기간'}: {report.discoveryDates.join(', ')}</p>
    <p>후속 평가일: {report.validationDates.join(', ')||'미실시 (전체 기간을 후보 산정에 사용)'}</p>
    <p>{mixed?'GPS·MDT 위치 확보':'위치 승인'} 저QoE: {record.discoveryLocatedPoorCalls??record.discoveryApprovedPoorCalls??0}건 · 정상/주의: {record.discoveryLocatedNormalCalls??record.discoveryApprovedNormalCalls??0}건</p>
   </section>}
   {view==='explanation'&&<section><h4>② 계산 단계</h4><p>{desc.overview}</p><p>{desc.criterion}</p></section>}
   {(view==='explanation'||view==='map')&&<section><h4>③ 지도 원의 의미</h4><p>{desc.meaning}</p></section>}
   {(view==='criteria'||view==='map')&&<section><h4>④ 무엇을 믿으면 안 되나요?</h4><p>{desc.scopeNote}</p>
    <p>표시되는 관측점은 RTCP QoE가 실제로 저하된 순간의 확정된 위치가 아닙니다.</p></section>}
   {(view==='criteria'||view==='explanation')&&subset&&<section className={styles.riskWarning}><h4>탐색용: 위험률 확정 불가</h4>
    <p>{report.selectionBiasWarning}</p>
    <p>전체 QoE 평가 통화 {n(report.coverage.poorScored+report.coverage.normalScored)}건 가운데 저QoE 위치 확보 {report.coverage.poorLocated}건, 나머지 위치 확보 {report.coverage.normalLocated}건입니다.</p>
   </section>}
   {view==='criteria'&&<section><h4>⑤ 현재 하이퍼파라미터</h4>
    <dl>{Object.entries(record.parameters).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{Array.isArray(v)?v.join(', '):String(v)}</dd></div>)}</dl>
   </section>}
   {view==='map'&&<section><h4>관측점과 지도 표시 구분</h4><p>선택 후보는 주황색 중심 마커, 다른 후보는 회청색으로 표시합니다. GPS는 RSRP 색상으로 구분한 원형 마커이며, MDT RSRP 가중중심 근사는 주황색 테두리 원형 마커입니다. 기지국별 RSRP는 근사 좌표를 선택하면 확인할 수 있습니다.</p><p>실제 마커와 표시 원은 후보별 계산 결과를 나타내며 QoE가 나빠진 정확한 순간이나 위치 오차 범위가 아닙니다.</p></section>}
  </div>
  <small>기존 DBSCAN 데이터·원본 자료는 보존됩니다. 모델 교체 시 지도와 후보 목록만 변경됩니다.</small>
 </aside>;
}
export function QualityModelAlternativeWorkspace({scope,overview,modelId,analysisMode,locationSource='strict',mdtGridMode,displayMode,onDisplayModeChange,guideOpenRequest,mapControls,initiallyExpanded,onFullscreenChange,onInvestigate,baselineCount,topTen:rankingTopTen,roughPoints,roughStatus,roughError,stationLayer}:Props){
 const ai=useCandidateAiAnalysis();
 const topTenMode=displayMode==='top10';
 const topTenLocations=useCandidateTopTenLocations(scope,topTenMode&&rankingTopTen.status!=='error');
 const topTen:CandidateTopTenState={...rankingTopTen,
  status:rankingTopTen.status==='ready'?(topTenLocations.status==='ready'?'ready':topTenLocations.status==='error'?'error':topTenMode?'loading':'idle'):rankingTopTen.status,
  error:rankingTopTen.error??topTenLocations.error};
 const key=JSON.stringify([scope,locationSource,analysisMode]);
 const [state,setState]=useState<{key:string;value:AlternativeModelReport|null;error:string|null}>({key:'',value:null,error:null});
 const [chosenId,setChosenId]=useState<string|null>(null);
 const [detailTab,setDetailTab]=useState<'summary'|'calls'|'rf'>('summary');
 const [simulatorOpen,setSimulatorOpen]=useState(false);
 const previousGuideRequest=useRef(guideOpenRequest);
 useEffect(()=>{if(previousGuideRequest.current!==guideOpenRequest){previousGuideRequest.current=guideOpenRequest;setSimulatorOpen(true);}},[guideOpenRequest]);
 const report=state.key===key?state.value:null;
 const error=state.key===key?state.error:null;
 useEffect(()=>{
  const ctrl=new AbortController();
  void loadAlternativeModelReport(scope,ctrl.signal,analysisMode,locationSource).then(value=>{
   if(!ctrl.signal.aborted){setState({key,value,error:null});}
  }).catch(err=>{if(!ctrl.signal.aborted)setState({key,value:null,error:err instanceof Error?err.message:'모델 자료를 불러올 수 없습니다.'});});
  return()=>ctrl.abort();
 },[key,scope,analysisMode,locationSource]);
 const model=report?.models[modelId]??null;
 const allCandidates=useMemo(()=>model?.candidates??[],[model]);
 const minimumDays=coreMinDays(scope.dateStart,scope.dateEnd);
 const coreCount=useMemo(()=>allCandidates.filter(c=>isCandidateShown(c.poorCalls,c.poorCustomers,c.days,minimumDays,'core')).length,[allCandidates,minimumDays]);
 const topTenMatches=useMemo<CandidateTopTenMatch[]>(()=>topTen.status==='ready'&&topTenLocations.value?allCandidates.map((c,index)=>{
  const members=candidateTopTenMembers(c.members,topTen.customers);
  // The same presentation mapper supplies the circle drawn by ImprovementCandidateMap.
  const circle=mappedCandidate(c,index,modelId,report?.validationDates??[]).location;
  return {candidateId:c.id,customers:circle?includeCandidateTopTenLocations(members,topTen.customers,topTenLocations.value!.points,circle):members};
 }):[],[allCandidates,topTen.status,topTen.customers,topTenLocations.value,modelId,report?.validationDates]);
 const topTenMembersByCandidate=useMemo(()=>new Map(topTenMatches.map(match=>[match.candidateId,match.customers])),[topTenMatches]);
 const topTenCandidates=useMemo(()=>allCandidates.filter(c=>(topTenMembersByCandidate.get(c.id)?.length??0)>0),[allCandidates,topTenMembersByCandidate]);
 const topTenCoverage=useMemo(()=>summarizeCandidateTopTenCoverage(topTen.customers,topTenMatches),[topTen.customers,topTenMatches]);
 const topTenCount=topTen.status==='ready'?topTenCandidates.length:undefined;
 const unmatchedTopTen=useMemo(()=>topTenMode&&topTen.status==='ready'&&topTenCandidates.length>0&&topTenCoverage.unmatched.length>0?{scope,customers:topTenCoverage.unmatched}:undefined,[topTenMode,topTen.status,topTenCandidates.length,scope,topTenCoverage.unmatched]);
 const candidates=useMemo(()=>topTenMode?topTenCandidates:allCandidates.filter(c=>isCandidateShown(c.poorCalls,c.poorCustomers,c.days,minimumDays,displayMode)),[allCandidates,minimumDays,displayMode,topTenMode,topTenCandidates]);
 const showTopTenMap=topTenMode&&topTen.status==='ready'&&candidates.length===0;
 const showCandidateMap=!topTenMode||(topTen.status==='ready'&&candidates.length>0);
 const topTenMapHint=unmatchedTopTen?'후보 '+topTenCandidates.length+'곳 · 포함 고객 '+topTenCoverage.included.length+'명 · 미포함 '+topTenCoverage.unmatched.length+'명은 원래 TOP 순위 버블로 함께 표시합니다.':null;
 const candidateCountLabel=topTenMode&&topTen.status!=='ready'?(topTen.status==='error'?'미확인':'확인 중'):candidates.length+'곳';
 const emptyMessage=topTenMode
  ?topTen.status==='error'?(topTen.error??'고객현황 TOP10을 확인하지 못했습니다.')
   :topTen.status!=='ready'?'고객현황 TOP10과 후보 구성 통화·원 안 위치를 확인하는 중입니다.'
   :'고객현황 TOP10 고객이 포함된 후보가 없어 TOP10 고객 위치를 지도에 표시합니다.'
  :displayMode==='core'?'핵심 표시 조건을 충족한 후보가 없습니다. 전체 후보를 선택하면 원래 후보가 표시됩니다.'
   :'현재 모델의 독립 고객 3명·2일 이상 조건을 충족한 후보가 없습니다.';
 const dialogTarget=ai.dialogTarget,closeAiDialog=ai.close;
 const visibleDialogTarget=dialogTarget&&(!topTenMode||candidates.some(c=>c.id===dialogTarget.candidateId))?dialogTarget:null;
 const dialogPoint=visibleDialogTarget ? candidates.find(c=>c.id===visibleDialogTarget.candidateId) : undefined;
 const dialogLocality=dialogPoint ? candidateAdministrativeDong(overview,dialogPoint.lat,dialogPoint.lon) ?? undefined : undefined;
 useEffect(()=>{if(topTenMode&&dialogTarget&&!visibleDialogTarget)closeAiDialog();},[topTenMode,dialogTarget,visibleDialogTarget,closeAiDialog]);
 const active=candidates.find(c=>c.id===chosenId)??candidates[0]??null;
 const activeIndex=active?candidates.findIndex(c=>c.id===active.id):-1;
 const mapCandidates=useMemo(()=>candidates.map((c,i)=>mappedCandidate(c,i,modelId,report?.validationDates??[])),[candidates,modelId,report?.validationDates]);
 const usingMixed=report?.locationMode==='gps-mdt-rough-unvalidated-v1';
 const insideRough=useMemo(()=>matchCandidateRoughPoints(mapCandidates,roughPoints),[mapCandidates,roughPoints]);
 // Display only the selected model candidate's positions and tower references.
 const selectedRough=useMemo(()=>{
  if(!active)return [];
  if(!usingMixed)return insideRough.filter(p=>p.matchingCandidateIds.includes(active.id));
  const memberIds=new Set(active.members.filter(p=>p.kind==='rough').map(p=>p.callId));
  return roughPoints.filter(p=>memberIds.has(p.callId.startsWith(p.date+':')?p.callId:p.date+':'+p.callId))
   .map(p=>({...p,matchingCandidateIds:[active.id]}));
 },[insideRough,active,roughPoints,usingMixed]);
 const selectedInsideRough=selectedRough.length;
 const selectedMapCandidates=useMemo(()=>mapCandidates.filter(c=>c.id===active?.id),[mapCandidates,active?.id]);
 const stationSites=useMemo(()=>selectCandidateStationSites(selectedMapCandidates,stationLayer.catalogs,stationLayer.options,active?.id??null,selectedRough),[selectedMapCandidates,stationLayer.catalogs,stationLayer.options,active?.id,selectedRough]);
 const linkedStationCount=stationSites.filter(s=>s.linkedToSelected).length;
 const points=useMemo(()=>active?[...active.members,...active.validationPoints].filter(p=>p.kind!=='rough').map(p=>({callId:p.callId,customerId:p.customerId,date:p.date,lat:p.lat,lon:p.lon,kind:p.kind as 'gnss'|'reviewed-radio',observedAt:p.observedAt})):[],[active]);
 const method=MODEL_EXPLANATIONS[modelId];
 const option=MODEL_OPTIONS.find(o=>o.id===modelId);
 const legend=<div className={styles.railLegend} aria-label="대안 모델 지도 범례">
  <span><i className={styles.railSelectedDot}/> 선택 지역</span>
  <span><i className={styles.railOtherDot}/> 다른 후보</span>
  {topTenMapHint&&<span aria-label="TOP10 후보와 고객 지도 안내">{topTenMapHint}</span>}

  <span><i style={{background:'#d32f2f'}}/>≤ −105 dBm</span><span><i style={{background:'#138b62'}}/>{'> −105 dBm'}</span>
  {!usingMixed&&<span><i className={styles.railRadioDot}/> 검토 통과 삼각 측량</span>}
  <span title={usingMixed?'선택한 모델 후보의 실제 구성 통화 중 MDT RSRP 근사 좌표 · 정확도 검증 전':'선택 후보 안에 있는 참고 추정 중심'}><i className={styles.railRoughDot}/> MDT 근사 {roughStatus==='ready'?(usingMixed?'· 후보 구성 '+n(active?.roughCalls??0)+'건':'· 선택 '+n(selectedInsideRough)+'건'):'확인 중'}</span>
 </div>;
 if(!report)return <section className={styles.state} role={error?'alert':undefined} aria-label="대안 모델 자료 상태">{error??'실제 원본 기반 대안 모델 결과를 불러오는 중입니다…'}</section>;
 const targetFor=(id:string)=>candidateAnalysisTarget(report,id,analysisMode,modelId);
 const activeAiTarget=active?targetFor(active.id):null;
 const activeAiEntry=activeAiTarget?ai.entry(activeAiTarget):undefined;
 const previousAiEntry=activeAiTarget?ai.previous(activeAiTarget):undefined;
 const aiTitle=(id:string)=>'후보 지역 '+(Math.max(0,candidates.findIndex(c=>c.id===id))+1);
 const analyze=(id:string)=>{const target=targetFor(id),entry=ai.entry(target);setChosenId(id);setDetailTab('summary');ai.open(target,aiTitle(id));if(!isCurrentCandidateAnalysisJob(entry?.job)&&!entry?.pending)ai.start(target);};
 const aiSummary=activeAiTarget?<CandidateAiSummary entry={activeAiEntry??previousAiEntry} stale={ai.changed(activeAiTarget)} onOpen={()=>ai.open((activeAiEntry??previousAiEntry)?.target??activeAiTarget,aiTitle(activeAiTarget.candidateId))} onStart={()=>analyze(activeAiTarget.candidateId)} onCancel={()=>ai.cancel(activeAiTarget)}/>:null;
 const subset=model?.status==='exploratory-located-only';
 const validationCount=candidates.filter(c=>c.validationStatus==='reobserved').length;
 const investigationItems=candidates.map((c,i)=>{
  const dong=candidateAdministrativeDong(overview,c.lat,c.lon);
  return {
   id:c.id,title:'후보 지역 '+(i+1)+(dong?' · '+dong:''),
   customers:c.poorCustomers,calls:c.poorCalls,days:c.days,radiusM:c.radiusM,
   rangeReview:c.rangeReviewRequired,maxPairDistanceM:c.maxPairDistanceM,rank:c.rank,
   gnssCalls:c.gnssCalls,radioCalls:usingMixed?(c.roughCalls??0):Math.max(0,c.poorCalls-c.gnssCalls),radioLabel:usingMixed?'MDT RSRP 근사 (미검증)':'검토 통과 삼각 측량',
   validationNewCustomers:c.validationNewCustomers,
   topTenCustomers:topTenMembersByCandidate.get(c.id),
   basis:metricValue(c,modelId),
   warning:subset?'위치 확보 통화 표본의 탐색 결과이며 전체 망 불량률이나 확정된 위험 우선순위가 아닙니다.':undefined
  };
 });
 const select=(id:string)=>setChosenId(id);
 const investigate=()=>{
  if(!active)return;
  const overviewIds=new Set(overview.calls.map(c=>c.id));
  const callIds=active.members.map(p=>overviewIds.has(p.callId)?p.callId:overviewIds.has(p.callId.slice(11))?p.callId.slice(11):p.callId);
  onInvestigate?.({candidateId:active.id,callIds,customerIds:[...new Set([...active.members,...active.validationPoints].map(p=>p.customerId))]});
 };
 return <section className={styles.workspace} aria-label={'선택 모델 '+option?.name+' 개선 후보'}>
  <div className={styles.modelIntro}>
   <div><span className={styles.eyebrow}><FlaskConical size={15}/> 실제 산출된 대안 모델</span>
    <h2>{option?.name} · {analysisMode==='all'?'전체 기간 개선 후보':'후속 평가 기반 성능 검증'}</h2>
    <p>{method.overview} · {usingMixed?'GPS와 MDT RSRP 가중중심 근사를 DBSCAN과 동일한 저QoE 입력으로 사용합니다. MDT 위치 정확도는 아직 검증되지 않았습니다.':'엄격 위치 근거 기준으로 계산합니다.'}</p>
   </div>
   <span className={subset?styles.experimental:styles.computed}>{subset?'표본 편향 · 탐색 전용':'실제 저QoE 위치 계산'}</span>
  </div>
  {subset&&<p className={styles.alert}><AlertTriangle size={16}/> {report.selectionBiasWarning} 이 결과를 기존 DBSCAN과 동일한 확정 위험 순위로 해석하거나 실제 위험률로 비교하지 마세요.</p>}
  <div className={styles.metrics} aria-label="선택 모델 후보 통계">
   <div><span><MapPinned size={15}/> 개선 후보</span><strong>{candidateCountLabel}</strong><small>{usingMixed?'동일 GPS·MDT 입력 DBSCAN '+baselineCount+'곳 · 모델별 상위 20곳 표시':'DBSCAN '+baselineCount+'곳 · 위치 입력 기준 확인 필요'}</small></div>
   <div><span><Users size={15}/> {analysisMode==='all'?'전체 기간':'발견기간'} 저품질 경험 통화</span><strong>{model?.discoveryLocatedPoorCalls??model?.discoveryApprovedPoorCalls??0}건</strong><small>{usingMixed?'GPS '+(report.inputCounts?.gpsPoor??0)+'건 · MDT 근사 '+(report.inputCounts?.roughPoor??0)+'건 (위치 검증 전)':'위치 승인된 고유 CDR 통화만 사용'}</small></div>
   <div><span><Layers size={15}/> {analysisMode==='all'?'범위 재검토 지역':'후속 평가일 새 고객 재관측'}</span><strong>{topTenMode&&topTen.status!=='ready'?(topTen.status==='error'?'미확인':'확인 중'):(analysisMode==='all'?candidates.filter(c=>c.rangeReviewRequired).length:validationCount)+'곳'}</strong><small>{analysisMode==='all'?'별도 평가일 없이 전체 기간 사용':'후속 평가일의 독립 고객 관측 · 무선 원인 확정 아님'}</small></div>
  </div>
  <div className={styles.layout}>
   <div className={styles.left}>
    <MapPanelFrame className={styles.mapFrame} label="대안 모델 개선 후보 영역" suspended={simulatorOpen||!!visibleDialogTarget} initiallyExpanded={initiallyExpanded} onExpandedChange={onFullscreenChange}>
     {({expanded,toggleButton,close})=><>
      <header className={styles.mapHead}>
       <div className={styles.mapTitleBlock}><h3><MapPinned size={18}/> 개선 후보</h3><p>후보 선택 → 오른쪽 상세·원본 통화 연동</p></div>
       {!expanded&&mapControls?.(false)}
       {toggleButton}
      </header>
      <div className={styles.mapStage} data-map-surface>
       {expanded&&<aside className={styles.railSidebar} aria-label="전체화면 왼쪽 지도 해석 및 모델 시뮬레이션">
         <div className={styles.railFixed}>
          <div className={styles.railTitle}>
           <div className={styles.railTitleRow}>
            <h3><MapPinned size={19}/> 개선 후보</h3>
            {mapControls?.(true)}
           </div>
           <p>후보를 선택하면 해당 지역의 근거가 함께 바뀝니다.</p>
          </div>
          {showCandidateMap&&legend}
         </div>
         <QualityInvestigationRail
          candidates={investigationItems} totalCount={allCandidates.length} coreCount={coreCount} topTenCount={topTenCount} topTenStatus={topTen.status} topTenCustomers={topTen.customers} topTenMatches={topTenMatches} minimumDays={minimumDays} displayMode={displayMode} onDisplayModeChange={onDisplayModeChange} selectedId={active?.id??null} onSelect={select} emptyMessage={emptyMessage}
          onCalls={()=>{setDetailTab('calls');close();}} analysisMode={analysisMode}
          modelName={option?.name??modelId} onAnalyze={analyze} aiLabel={id=>candidateAiButtonLabel(ai.entry(targetFor(id)))} aiSummary={aiSummary}
          rsrpChart={active?<CandidateMdtRsrpChart compact callIds={active.members.map(p=>p.callId)} sourceRevision={report.sourceRevision}/>:null}
          guidance={showTopTenMap?'고객현황과 같은 TOP10 고객의 대표 위치입니다.':topTenMapHint??(subset?'표본 편향: 지도 후보는 탐색용이며 위험률·RF 원인 확정이 아닙니다.':'선정 지역은 실제 QoE 저하 순간 좌표나 RF 원인 확정 장소가 아닙니다.')}
         />
        </aside>}
       <div className={styles.mapView}>
        {!expanded&&showCandidateMap&&legend}
        {showCandidateMap&&<StationLayerControls layer={stationLayer} shown={stationSites.length} related={linkedStationCount}/>}
        {showTopTenMap?<CandidateTopTenMap scope={scope} customers={topTen.customers}/>:showCandidateMap?<ImprovementCandidateMap key={modelId} mdtGridMode={mdtGridMode} candidates={mapCandidates} selectedId={active?.id??''} onSelect={select}
         sourceRevision={overview.sourceRevision} observationPoints={points} roughPoints={selectedRough} stationSites={stationSites} roughUsedForCandidate={usingMixed} presentation="proposal2" fullscreenEnhanced={expanded} unmatchedTopTen={unmatchedTopTen}
         hint={topTenMapHint?topTenMapHint+(roughError?' · MDT 근사 원본 자료 오류: '+roughError:''):roughError?'MDT 근사 원본 자료 오류: '+roughError:'선택 모델의 GPS·MDT 구성 통화와 관련 기지국만 표시 · 근사 좌표는 검증 전 · 원은 정확도 반경이 아닙니다.'}/>:<output className={styles.state} role={topTen.status==='error'?'alert':'status'}>{emptyMessage}</output>}
       </div>
      </div>
     </>}
    </MapPanelFrame>
    <details className={styles.methodDisclosure}><summary><Info size={15}/> 선정 기준·원본·검증 한계 보기</summary>
     <p>{method.criterion}</p><p>{method.scopeNote}</p>
     <p>{report.analysisMode==='all'?'전체 기간':'후보 발견'} {report.discoveryDates.join(', ')} · 후속 평가 {report.validationDates.join(', ')||'미실시'}</p>
    </details>
   </div>
   <aside className={styles.right} data-detail-tab={detailTab} aria-label="모델별 후보 및 선정 근거">
    <section className={styles.list} aria-label="선택 모델 개선 후보 목록">
     <header><div className={styles.listFilterLine}><h3>후보 지역 목록 <span>{candidateCountLabel}</span></h3><CandidateVisibilityToggle mode={displayMode} coreCount={coreCount} topTenCount={topTenCount} topTenStatus={topTen.status} totalCount={allCandidates.length} minimumDays={minimumDays} onChange={onDisplayModeChange}/></div><p>{topTenMode?'TOP10 고객의 구성 통화가 있거나 대표 위치가 후보 원 안이면 포함합니다.':'핵심: 6통화·'+minimumDays+'일 이상(고객 3명). 전체 선택 시 숨긴 후보 표시.'}</p>
      {topTenMode&&topTen.status==='ready'&&<CandidateTopTenCoverage customers={topTen.customers} matches={topTenMatches}/>}
     </header>
     <div className={styles.rows}>
      {candidates.map((c,i)=><div key={c.id} className={styles.aiRow}>
       <button type="button" className={styles.item} aria-pressed={active?.id===c.id} onClick={()=>select(c.id)}>
        <span className={styles.num}>{i+1}</span>
        <span className={styles.itemBody}><strong>후보 지역 {i+1}{candidateAdministrativeDong(overview,c.lat,c.lon)?' · '+candidateAdministrativeDong(overview,c.lat,c.lon):''}</strong>
         <small>고객 {c.poorCustomers}명 · 저QoE {c.poorCalls}건 · {c.days}일{usingMixed?' · GPS '+c.gnssCalls+' / MDT 근사 '+(c.roughCalls??0):''}</small>
         {topTenMode&&topTen.status==='ready'&&<CandidateTopTenMembers customers={topTenMembersByCandidate.get(c.id)??[]}/>}
         {c.rangeReviewRequired&&<span className={styles.aiRangeReview}>범위 검토 필요</span>}
        </span><ChevronRight size={14}/>
       </button>
       <button type="button" className={styles.aiButton} aria-label={'후보 지역 '+(i+1)+' AI 분석'} onClick={()=>analyze(c.id)}>{candidateAiButtonLabel(ai.entry(targetFor(c.id)))}</button>
      </div>)}
      {!candidates.length&&<p className={styles.noCandidates} role={topTenMode&&topTen.status==='error'?'alert':'status'}>{emptyMessage}</p>}
     </div>
    </section>
    {active&&<section className={styles.detail} aria-label="선택 모델 후보 상세 근거">
     <div className={styles.detailTabs} role="tablist" aria-label="모델 후보 상세 정보 선택">
      {([['summary','선정 요약'],['calls','고객·통화'],['rf','위치·무선 근거']] as const).map(([id,label])=>
       <button type="button" key={id} role="tab" aria-selected={detailTab===id} onClick={()=>setDetailTab(id)}>{label}</button>)}
     </div>
     <div className={styles.detailHead}><span>선택 후보</span><h3>후보 지역 {activeIndex+1}</h3>
      <p>{metricValue(active,modelId)}</p></div>
     {detailTab==='summary'&&<div className={styles.detailsGrid}>
      <div><span>고유 고객</span><strong>{active.poorCustomers}명</strong></div><div><span>저QoE 통화</span><strong>{active.poorCalls}건</strong></div>
      <div><span>관측 날짜</span><strong>{active.days}일</strong></div><div><span>{analysisMode==='all'?'후속 평가':'신규 고객 재관측'}</span><strong>{analysisMode==='all'?'미실시':active.validationNewCustomers+'명'}</strong></div>
      <div><span>표시 반경</span><strong>{active.radiusM}m</strong></div><div><span>범위 검토</span><strong>{active.rangeReviewRequired?'필요':'불필요'}</strong></div>
     </div>}
     {detailTab==='summary'&&<><p className={styles.detailNote}>현재 모델의 위치·고객·날짜 조건을 충족한 조사 후보입니다. 범위와 원인은 별도 확인이 필요합니다.</p>
      {topTenMode&&topTen.status==='ready'&&<CandidateTopTenMembers customers={topTenMembersByCandidate.get(active.id)??[]}/>}
      {aiSummary}</>}
     {detailTab==='summary'&&<CandidateMdtRsrpChart callIds={active.members.map(p=>p.callId)} sourceRevision={report.sourceRevision}/>}
     {(detailTab==='summary'||detailTab==='rf')&&modelId==='spatial_scan'&&<p className={styles.riskDetail}>위치확보 표본 내 탐색창: 저QoE {active.metric.locatedPoorInWindow}건 / 나머지 QoE {active.metric.locatedNormalInWindow}건 · 조건부 순열 p={active.metric.conditionalPermutationP}. 망 전체 불량률이나 재현 가능한 유의확률로 확정하지 않습니다.</p>}
     {(detailTab==='summary'||detailTab==='rf')&&modelId==='bayesian'&&<p className={styles.riskDetail}>위치확보 표본 사후평균 {((active.metric.posteriorMean??0)*100).toFixed(1)}% · 95% 신용구간 {((active.metric.credibleLow??0)*100).toFixed(1)}~{((active.metric.credibleHigh??0)*100).toFixed(1)}%. 실제 망 불량률의 신용구간이 아닙니다.</p>}
     {detailTab!=='rf'&&<div className={detailTab==='summary'?styles.shortEvidence:undefined}>
      <CandidateObservationTable key={active.id} candidate={active}/>
     </div>}
     {detailTab==='rf'&&<section className={styles.rfPanel} aria-label="대안 모델 위치 및 무선 근거">
      <h4>위치·무선 근거</h4>
      <p>GPS는 RSRP 색상별 원형 마커, MDT 근사는 주황색 원형 테두리와 사용 기지국·Cell 원본 RSRP로 구분합니다. MDT 좌표 정확도는 검증 전이며, 관측하지 않은 RF 평균값은 표시하지 않습니다.</p>
      <div className={styles.rfFacts}><span>GPS 위치 <b>{active.gnssCalls}건</b></span><span>{usingMixed?'MDT 근사 (미검증)':'삼각 측량'} <b>{usingMixed?(active.roughCalls??0):(active.poorCalls-active.gnssCalls)}건</b></span><span>표시 반경 <b>{active.radiusM}m</b></span></div>
      <p>{method.meaning}</p><p>{method.scopeNote}</p>
     </section>}
     <button type="button" className={styles.investigate} onClick={investigate}>이 후보의 통화 목록 확인 <ChevronRight size={16}/></button>
    </section>}
   </aside>
  </div>
  {visibleDialogTarget&&<CandidateAiDialog key={JSON.stringify(visibleDialogTarget)} target={visibleDialogTarget} title={ai.dialogTitle} locality={dialogLocality} entry={ai.entry(visibleDialogTarget)} onClose={ai.close} onStart={()=>ai.rerun(visibleDialogTarget)} onCancel={()=>ai.cancel(visibleDialogTarget)} onSelectSaved={id=>ai.selectSaved(visibleDialogTarget,id)} onSendPrompt={draft=>ai.sendPrompt(visibleDialogTarget,draft)}/>}
  {simulatorOpen&&<QualitySimulatorDialog title={(option?.name??modelId)+' · 후보 산정 시뮬레이터'}
   onClose={()=>setSimulatorOpen(false)}
   explanation={<ModelMethodPanel modelId={modelId} report={report} actual={active} actualIndex={activeIndex} view="explanation"/>}
   criteria={<ModelMethodPanel modelId={modelId} report={report} actual={active} actualIndex={activeIndex} view="criteria"/>}>
   <QualityModelSimulator modelId={modelId} report={report} actual={active} actualIndex={activeIndex}/>
  </QualitySimulatorDialog>}
  <p className={styles.footer}>선택 모델: {option?.name} · GPS와 MDT 근사를 동일한 산정 입력으로 사용하며 모델별 계산 방식은 다릅니다. MDT 추정 정확도 검증 전입니다. {analysisMode==='all'?'전체 기간을 모두 후보 생성에 사용했습니다. 후속 평가를 시행하지 않았으므로 후보 수는 성능 순위가 아닙니다.':'마지막 날을 후속 평가기간으로 분리했습니다. 새로운 고객의 재관측은 원인 확정이나 모델 정확도와 다릅니다.'} 정상 통화 위치 표본 편향과 현장 RF 근거를 별도로 검증해야 합니다.</p>
 </section>;
}
