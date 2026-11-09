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
import {MapPanelFrame} from './map-panel-frame';
import {QualityModelSimulator} from './quality-model-simulator';
import {QualitySimulatorDialog} from './quality-simulator-dialog';
import {QualityInvestigationRail} from './quality-investigation-rail';
import styles from './quality-model-alternative.module.css';

interface Props{
 scope:QualityCandidateScope;overview:AnalystOverview;modelId:AlternativeModelId;analysisMode:'all'|'evaluation';guideOpenRequest:number;mapControls?:(expanded:boolean)=>ReactNode;initiallyExpanded?:boolean;onFullscreenChange?:(value:boolean)=>void;
 onInvestigate?:(selection:{candidateId:string;callIds:string[];customerIds:string[]})=>void;
 baselineCount:number;
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
  location:{lat:c.lat,lon:c.lon,radiusM:c.radiusM,source:'TRAINING_GNSS_CLUSTER_MEDOID',meaning:'모델별 대표점 · RTCP QoE 순간 위치 또는 측위 오차 반경 아님'},
  discovery:{distinctPoorCustomers:c.poorCustomers,poorCalls:c.poorCalls,days:c.days,dropCalls:0},
  validation:{newPoorCustomers:c.validationNewCustomers,newPoorCalls:c.validationPoints.length,date:validationDates.join(', '),definition:'발견기간 신규 고객의 별도 검증일 100m 이내 저QoE 관측'},
  normalReference:{nearbyCalls:null,distinctCustomers:null,caution:'정상 통화 위치 확보 편향 때문에 전체 불량률 분모로 사용하지 않습니다.'},
  relatedEndCells:[],representativeCalls:c.members.map(p=>({date:p.date,customerId:p.customerId,callId:p.callId,mos:p.mos,endCellId:'',start:''})),
  relatedGnss:[],relatedGnssCallCount:c.gnssCalls,
  evidence:'GNSS_CDR_ASSOCIATION',verification:'INDEPENDENT_NEXT_DAY_CUSTOMER_REPEAT',
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
    <tbody>{shown.map(p=><tr key={p.callId}><td>{aliases.get(p.customerId)}</td><td>{p.date.slice(5)}</td><td>{p.mos.toFixed(2)}</td><td>{p.kind==='gnss'?'GPS':'삼각 측량'}</td></tr>)}</tbody>
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
 return <aside className={styles.methodPanel} aria-label="선택 모델 알고리즘 검증 기준">
  <span className={styles.methodOverline}>모델별 산출 방식</span><h3>{desc.title}</h3>
  <div className={styles.methodScroll}>
   {view==='simulator'&&<QualityModelSimulator modelId={modelId} report={report} actual={actual} actualIndex={actualIndex}/>}
   {(view==='explanation'||view==='criteria')&&<section><h4>① 어떤 원본인가요?</h4>
    <p>원본 버전: {report.sourceRevision.slice(0,10)}…</p>
    <p>{report.analysisMode==='all'?'전체 후보 산정기간':'후보 발견기간'}: {report.discoveryDates.join(', ')}</p>
    <p>후속 평가일: {report.validationDates.join(', ')||'미실시 (전체 기간을 후보 산정에 사용)'}</p>
    <p>위치 승인 저QoE: {record.discoveryApprovedPoorCalls}건 · 위치 승인 정상/주의: {record.discoveryApprovedNormalCalls}건</p>
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
   {view==='map'&&<section><h4>관측점과 지도 표시 구분</h4><p>선택한 후보는 주황색 중심 마커로, 다른 후보는 회청색으로 표시합니다. GPS 관측은 주황색 점, 검토 통과한 삼각 측량 관측은 보라색 점입니다.</p><p>실제 마커와 조사 원은 후보별 계산 결과를 나타내며 QoE가 나빠진 정확한 순간이나 위치 오차 범위가 아닙니다.</p></section>}
  </div>
  <small>기존 DBSCAN 데이터·원본 자료는 보존됩니다. 모델 교체 시 지도와 후보 목록만 변경됩니다.</small>
 </aside>;
}
export function QualityModelAlternativeWorkspace({scope,overview,modelId,analysisMode,guideOpenRequest,mapControls,initiallyExpanded,onFullscreenChange,onInvestigate,baselineCount}:Props){
 const key=JSON.stringify(scope);
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
  void loadAlternativeModelReport(scope,ctrl.signal,analysisMode).then(value=>{
   if(!ctrl.signal.aborted){setState({key,value,error:null});}
  }).catch(err=>{if(!ctrl.signal.aborted)setState({key,value:null,error:err instanceof Error?err.message:'모델 자료를 불러올 수 없습니다.'});});
  return()=>ctrl.abort();
 },[key,scope,analysisMode]);
 const model=report?.models[modelId]??null;
 const candidates=useMemo(()=>model?.candidates??[],[model]);
 const active=candidates.find(c=>c.id===chosenId)??candidates[0]??null;
 const activeIndex=active?candidates.findIndex(c=>c.id===active.id):-1;
 const mapCandidates=useMemo(()=>candidates.map((c,i)=>mappedCandidate(c,i,modelId,report?.validationDates??[])),[candidates,modelId,report?.validationDates]);
 const points=useMemo(()=>active?[...active.members,...active.validationPoints].map(p=>({callId:p.callId,customerId:p.customerId,date:p.date,lat:p.lat,lon:p.lon,kind:p.kind,observedAt:p.observedAt})):[],[active]);
 const method=MODEL_EXPLANATIONS[modelId];
 const option=MODEL_OPTIONS.find(o=>o.id===modelId);
 const legend=<div className={styles.railLegend} aria-label="대안 모델 지도 범례">
  <span><i className={styles.railSelectedDot}/> 선택 지역</span>
  <span><i className={styles.railOtherDot}/> 다른 후보</span>
  <span><i className={styles.railGnssDot}/> GPS 관측</span>
  <span><i className={styles.railRadioDot}/> 검토 통과 삼각 측량</span>
 </div>;
 if(!report)return <section className={styles.state} role={error?'alert':undefined} aria-label="대안 모델 자료 상태">{error??'실제 원본 기반 대안 모델 결과를 불러오는 중입니다…'}</section>;
 const subset=model?.status==='exploratory-located-only';
 const validationCount=candidates.filter(c=>c.validationStatus==='reobserved').length;
 const investigationItems=candidates.map((c,i)=>{
  const dong=candidateAdministrativeDong(overview,c.lat,c.lon);
  return {
   id:c.id,title:'후보 지역 '+(i+1)+(dong?' · '+dong:''),
   customers:c.poorCustomers,calls:c.poorCalls,days:c.days,radiusM:c.radiusM,
   rangeReview:c.rangeReviewRequired,maxPairDistanceM:c.maxPairDistanceM,rank:c.rank,
   gnssCalls:c.gnssCalls,radioCalls:Math.max(0,c.poorCalls-c.gnssCalls),
   validationNewCustomers:c.validationNewCustomers,
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
 return <section className={styles.workspace} aria-label={'선택 모델 '+option?.name+' 조사 후보'}>
  <div className={styles.modelIntro}>
   <div><span className={styles.eyebrow}><FlaskConical size={15}/> 실제 산출된 대안 모델</span>
    <h2>{option?.name} · {analysisMode==='all'?'전체 기간 조사 후보':'후속 평가 기반 성능 검증'}</h2>
    <p>{method.overview}</p>
   </div>
   <span className={subset?styles.experimental:styles.computed}>{subset?'표본 편향 · 탐색 전용':'실제 저QoE 위치 계산'}</span>
  </div>
  {subset&&<p className={styles.alert}><AlertTriangle size={16}/> {report.selectionBiasWarning} 이 결과를 기존 DBSCAN과 동일한 확정 위험 순위로 해석하거나 실제 위험률로 비교하지 마세요.</p>}
  <div className={styles.metrics} aria-label="선택 모델 후보 통계">
   <div><span><MapPinned size={15}/> 조사 후보</span><strong>{candidates.length}곳</strong><small>기존 DBSCAN {baselineCount}곳 (산정 방식이 달라 직접 우열 비교 불가)</small></div>
   <div><span><Users size={15}/> {analysisMode==='all'?'전체 기간':'발견기간'} 위치 승인 저QoE</span><strong>{model?.discoveryApprovedPoorCalls??0}건</strong><small>원본 승인 위치·고유 CDR 연결만 사용</small></div>
   <div><span><Layers size={15}/> {analysisMode==='all'?'범위 재검토 지역':'후속 평가일 새 고객 재관측'}</span><strong>{analysisMode==='all'?candidates.filter(c=>c.rangeReviewRequired).length:validationCount}곳</strong><small>{analysisMode==='all'?'별도 평가일 없이 전체 기간 사용':'후속 평가일의 독립 고객 관측 · 무선 원인 확정 아님'}</small></div>
  </div>
  <div className={styles.layout}>
   <div className={styles.left}>
    <MapPanelFrame className={styles.mapFrame} label="대안 모델 조사 후보 지도" suspended={simulatorOpen} initiallyExpanded={initiallyExpanded} onExpandedChange={onFullscreenChange}>
     {({expanded,toggleButton,close})=><>
      <header className={styles.mapHead}>
       <div className={styles.mapTitleBlock}><h3><MapPinned size={18}/> 조사 후보 지도</h3><p>후보 선택 → 오른쪽 상세·원본 통화 연동</p></div>
       {!expanded&&mapControls?.(false)}
       {toggleButton}
      </header>
      <div className={styles.mapStage} data-map-surface>
       {expanded&&<aside className={styles.railSidebar} aria-label="전체화면 왼쪽 지도 해석 및 모델 시뮬레이션">
         <div className={styles.railFixed}>
          <div className={styles.railTitle}>
           <div className={styles.railTitleRow}>
            <h3><MapPinned size={19}/> 조사 후보 지도</h3>
            {mapControls?.(true)}
           </div>
           <p>후보를 선택하면 해당 지역의 근거가 함께 바뀝니다.</p>
          </div>
          {legend}
         </div>
         <QualityInvestigationRail
          candidates={investigationItems} selectedId={active?.id??null} onSelect={select}
          onCalls={()=>{setDetailTab('calls');close();}} analysisMode={analysisMode}
          modelName={option?.name??modelId}
          guidance={subset?'표본 편향: 지도 후보는 탐색용이며 위험률·RF 원인 확정이 아닙니다.':'선정 지역은 실제 QoE 저하 순간 좌표나 RF 원인 확정 장소가 아닙니다.'}
         />
        </aside>}
       <div className={styles.mapView}>
        <ImprovementCandidateMap key={modelId} candidates={mapCandidates} selectedId={active?.id??''} onSelect={select}
         observationPoints={points} presentation="proposal2" fullscreenEnhanced={expanded}
         hint="모델별 조사 참고 범위 · 위치 오차반경이나 QoE 저하 순간 확정 좌표가 아닙니다."/>
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
    <section className={styles.list} aria-label="선택 모델 조사 후보 목록">
     <header><h3>후보 지역 목록 <span>{candidates.length}곳</span></h3><p>지도 마커를 클릭해도 이 지역이 선택됩니다.</p></header>
     <div className={styles.rows}>
      {candidates.map((c,i)=><button type="button" key={c.id} className={styles.item} aria-pressed={active?.id===c.id} onClick={()=>select(c.id)}>
        <span className={styles.num}>{i+1}</span>
        <span className={styles.itemBody}><strong>후보 지역 {i+1}{candidateAdministrativeDong(overview,c.lat,c.lon)?' · '+candidateAdministrativeDong(overview,c.lat,c.lon):''}</strong>
         <small>고객 {c.poorCustomers}명 · 저QoE {c.poorCalls}건 · {c.days}일</small></span>
        <ChevronRight size={14}/>
       </button>)}
      {!candidates.length&&<p className={styles.noCandidates}>현재 모델의 독립 고객 3명·2일 이상 검증 조건을 충족한 후보가 없습니다. 계산 오류가 아니라 모델별 결과가 0곳입니다.</p>}
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
      <div><span>지도 표시 반경</span><strong>{active.radiusM}m</strong></div><div><span>범위 검토</span><strong>{active.rangeReviewRequired?'필요':'불필요'}</strong></div>
     </div>}
     {detailTab==='summary'&&<p className={styles.detailNote}>{method.meaning}</p>}
     {(detailTab==='summary'||detailTab==='rf')&&modelId==='spatial_scan'&&<p className={styles.riskDetail}>위치확보 표본 내 탐색창: 저QoE {active.metric.locatedPoorInWindow}건 / 나머지 QoE {active.metric.locatedNormalInWindow}건 · 조건부 순열 p={active.metric.conditionalPermutationP}. 망 전체 불량률이나 재현 가능한 유의확률로 확정하지 않습니다.</p>}
     {(detailTab==='summary'||detailTab==='rf')&&modelId==='bayesian'&&<p className={styles.riskDetail}>위치확보 표본 사후평균 {((active.metric.posteriorMean??0)*100).toFixed(1)}% · 95% 신용구간 {((active.metric.credibleLow??0)*100).toFixed(1)}~{((active.metric.credibleHigh??0)*100).toFixed(1)}%. 실제 망 불량률의 신용구간이 아닙니다.</p>}
     {detailTab!=='rf'&&<div className={detailTab==='summary'?styles.shortEvidence:undefined}>
      <CandidateObservationTable key={active.id} candidate={active}/>
     </div>}
     {detailTab==='rf'&&<section className={styles.rfPanel} aria-label="대안 모델 위치 및 무선 근거">
      <h4>위치·무선 근거</h4>
      <p>GPS 및 검토 통과 삼각 측량을 구분합니다. 이 모델은 RF 중앙값을 계산하지 않았으므로 임의의 RSRP·RSRQ·SINR 값을 표시하지 않습니다.</p>
      <div className={styles.rfFacts}><span>GPS 위치 <b>{active.gnssCalls}건</b></span><span>삼각 측량 위치 <b>{active.poorCalls-active.gnssCalls}건</b></span><span>조사 표시 반경 <b>{active.radiusM}m</b></span></div>
      <p>{method.meaning}</p><p>{method.scopeNote}</p>
     </section>}
     <button type="button" className={styles.investigate} onClick={investigate}>이 후보의 통화 목록 조사 <ChevronRight size={16}/></button>
    </section>}
   </aside>
  </div>
  {simulatorOpen&&<QualitySimulatorDialog title={(option?.name??modelId)+' · 후보 산정 시뮬레이터'}
   onClose={()=>setSimulatorOpen(false)}
   explanation={<ModelMethodPanel modelId={modelId} report={report} actual={active} actualIndex={activeIndex} view="explanation"/>}
   criteria={<ModelMethodPanel modelId={modelId} report={report} actual={active} actualIndex={activeIndex} view="criteria"/>}>
   <QualityModelSimulator modelId={modelId} report={report} actual={active} actualIndex={activeIndex}/>
  </QualitySimulatorDialog>}
  <p className={styles.footer}>선택 모델: {option?.name} · {analysisMode==='all'?'전체 기간을 모두 후보 생성에 사용했습니다. 후속 평가를 시행하지 않았으므로 후보 수는 성능 순위가 아닙니다.':'마지막 날을 후속 평가기간으로 분리했습니다. 새로운 고객의 재관측은 원인 확정이나 모델 정확도와 다릅니다.'} 정상 통화 위치 표본 편향과 현장 RF 근거를 별도로 검증해야 합니다.</p>
 </section>;
}
