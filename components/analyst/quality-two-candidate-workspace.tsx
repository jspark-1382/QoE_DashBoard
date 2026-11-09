'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {ChevronRight, CircleHelp, ClipboardList, MapPinned, Users, CheckCircle2, AlertTriangle} from 'lucide-react';
import type {AnalystOverview} from '../../lib/analyst/types';
import type {ImprovementCandidate} from '../../lib/analyst/improvement-candidates';
import type {QualityCandidateDetail,QualityCandidateSummary,QualityObservationPoint} from '../../lib/analyst/quality-improvement-candidates';
import {candidateAdministrativeDong,candidateEvidenceSummary,candidateStatus,candidateTitle,verifyCandidateSummaryConsistency} from '../../lib/analyst/quality-two-candidate-view-model';
import {ImprovementCandidateMap} from './improvement-candidate-map';
import {MapPanelFrame} from './map-panel-frame';
import {CandidateDetail} from './improvement-candidates';
import {CustomerEvidence} from './quality-two-customer-evidence';
import {QualityTwoSimulator} from './quality-two-simulator';
import {QualityInvestigationRail} from './quality-investigation-rail';
import {QualitySimulatorDialog} from './quality-simulator-dialog';
import {QualityTwoAlgorithmGuide} from './quality-two-algorithm-guide';

import styles from './quality-two-candidate-workspace.module.css';

const num=(n:number)=>n.toLocaleString('ko-KR');

interface Props {
 summary:QualityCandidateSummary;
 analysisMode:'all'|'evaluation';
 guideOpenRequest:number;
 mapControls?:(expanded:boolean)=>ReactNode;
 initiallyExpanded?:boolean;
 onFullscreenChange?:(value:boolean)=>void;
 mapped:ImprovementCandidate[];
 selectedId:string|null;
 detail:QualityCandidateDetail|null;
 detailPending:boolean;
 detailError:string|null;
 overview:AnalystOverview;
 observationPoints:QualityObservationPoint[];
 onSelect:(id:string)=>void;
 onInvestigate:()=>void;
}

export function QualityTwoCandidateWorkspace({summary,analysisMode,guideOpenRequest,mapControls,initiallyExpanded,onFullscreenChange,mapped,selectedId,detail,detailPending,detailError,overview,observationPoints,onSelect,onInvestigate}:Props){
 const [detailTab,setDetailTab]=useState<'summary'|'calls'|'rf'>('summary');
 const [simulatorOpen,setSimulatorOpen]=useState(false);
 const previousGuideRequest=useRef(guideOpenRequest);
 useEffect(()=>{if(previousGuideRequest.current!==guideOpenRequest){previousGuideRequest.current=guideOpenRequest;setSimulatorOpen(true);}},[guideOpenRequest]);
 const activeCard=summary.candidates.find(c=>c.id===selectedId)??summary.candidates[0];
 const selected=activeCard?.id===detail?.candidate.id?detail:null;
 const mappedSelected=mapped.find(c=>c.id===activeCard?.id);
 const index=activeCard?summary.candidates.findIndex(c=>c.id===activeCard.id):-1;
 const status=activeCard?candidateStatus(activeCard):null;
 const evidence=selected?candidateEvidenceSummary(selected):null;
 const inconsistency=selected?verifyCandidateSummaryConsistency(summary,selected):[];
 const validatedCount=summary.candidates.filter(c=>c.validationStatus==='reobserved').length;
 // The summary's affected customers means distinct customers with low MOS, NOT customers with multiple failed calls.
 const affected=summary.distinctAffectedCustomers;
 const mapLegend=<div className={styles.mapLegend} aria-label="지도 위치 범례"><span><i className={styles.selectedDot}/>선택 지역</span><span><i className={styles.otherDot}/>다른 후보</span><span><i className={styles.gnssDot}/>GPS 관측</span>{analysisMode==='evaluation'&&<span><i className={styles.verifiedDot}/>후속 평가일 관측</span>}<span><i className={styles.radioDot}/>검토 통과 삼각 측량</span></div>;
 const investigationItems=summary.candidates.map((c,i)=>{
  const dong=candidateAdministrativeDong(overview,c.medoid.lat,c.medoid.lon);
  const detailForRow=c.id===selected?.candidate.id?selected:null;
  const proof=detailForRow?candidateEvidenceSummary(detailForRow):null;
  return {
   id:c.id,title:candidateTitle(i)+(dong?' · '+dong:''),customers:c.poorCustomerCount,
   calls:c.poorCallCount,days:c.poorDateCount,radiusM:c.displayRadiusM,
   rangeReview:c.rangeReviewRequired,rank:c.rank,
   maxPairDistanceM:detailForRow?.candidate.maxPairDistanceM??null,
   gnssCalls:proof?.gnss??null,radioCalls:proof?.radio??null,
   validationNewCustomers:c.validationNewCustomers
  };
 });
 const displayPoints=selected
  ?selected.candidate.nearbyPoints.filter(p=>p.kind==='reviewed-radio'&&(p.role==='discovery-member'||p.role==='validation-new'||p.role==='validation-existing')).map(p=>({callId:p.callId,customerId:p.customerId,date:p.date,lat:p.lat,lon:p.lon,kind:p.kind,observedAt:p.observedAt}))
  :observationPoints;

 return <section id="quality-two-primary" className={styles.workspace} aria-label="개선 2안 조사 후보 분석">
  <div className={styles.kpis} aria-label="조사 후보 핵심 현황">
   <div><span><Users size={16}/> 저품질 영향 고객</span><strong>{affected==null?'미산출':num(affected)+'명'}</strong><small>선택 기간의 서로 다른 저QoE 고객 · 고객별 반복 여부 아님</small></div>
   <div><span><MapPinned size={16}/> 조사 후보 지역</span><strong>{num(summary.candidates.length)}곳</strong><small>서로 다른 고객·날짜의 위치 기반 반복 관측</small></div>
   <div><span><CheckCircle2 size={16}/> {analysisMode==='all'?'범위 재검토 지역':'새 고객 재관측 지역'}</span><strong>{num(analysisMode==='all'?summary.candidates.filter(c=>c.rangeReviewRequired).length:validatedCount)}곳</strong><small>{analysisMode==='all'?'전체 기간 저QoE 관측점 중 군집 최대 점간 거리 200m 초과':'별도 검증일의 신규 고객 관측 · 원인 확정 아님'}</small></div>
  </div>
  <div className={styles.workspaceGrid}>
   <div className={styles.mapColumn}>
    <MapPanelFrame className={styles.mapPanel} label="개선 2안 조사 후보 지도" suspended={simulatorOpen} initiallyExpanded={initiallyExpanded} onExpandedChange={onFullscreenChange}>
     {({toggleButton,expanded,close})=><>
      <div className={styles.mapHeading}>
       <div className={styles.mapTitleBlock}><h2><MapPinned size={18}/> 조사 후보 지도</h2><p>지역을 선택하면 오른쪽의 근거와 고객 목록이 함께 바뀝니다.</p></div>
       {!expanded&&mapControls?.(false)}
       {toggleButton}
      </div>
      <div className={styles.fullscreenWorkspace} data-map-surface data-expanded={expanded?'true':'false'}>
       <aside className={styles.algorithmRail} hidden={!expanded} aria-label="전체화면 왼쪽 지도 해석 및 알고리즘 설명">
        {expanded&&<>
         <div className={styles.railFixed}>
          <div className={styles.railTitle}>
           <div className={styles.railTitleRow}>
            <h2><MapPinned size={19}/> 조사 후보 지도</h2>
            {mapControls?.(true)}
           </div>
           <p>지역을 선택하면 해당 후보의 근거가 함께 바뀝니다.</p>
          </div>
          {mapLegend}
         </div>
         <QualityInvestigationRail
          candidates={investigationItems} selectedId={activeCard?.id??null} onSelect={onSelect}
          onCalls={()=>{setDetailTab('calls');close();}} analysisMode={analysisMode}
          modelName="DBSCAN" guidance="군집 중심은 조사 참고 좌표이며, 통화 열화 순간 위치가 아닙니다."
         />
        </>}
       </aside>
       <div className={styles.fullscreenMapArea}>
        {!expanded&&mapLegend}
        <div className={styles.mapSurface}>
         <ImprovementCandidateMap candidates={mapped} selectedId={activeCard?.id??''} onSelect={onSelect}
          observationPoints={displayPoints} presentation="proposal2" fullscreenEnhanced={expanded}
          hint="원은 조사 참고 범위이며 실제 QoE 열화 순간 좌표 또는 위치 오차 반경이 아닙니다."/>
        </div>
        {!expanded&&<p className={styles.mapBottom}>지도의 중심점은 저QoE 연계 위치의 대표점입니다. GPS/삼각 측량 관측 위치가 통화 중 실제 음성이 나빠진 정확한 시점임을 뜻하지 않습니다.</p>}
       </div>
      </div>
     </>}
    </MapPanelFrame>
    <details className={styles.mapHelp}>
     <summary><CircleHelp size={15}/> 선정 기준과 지도 표시 의미</summary>
     <p>GPS 및 엄격 검토를 통과한 삼각 측량만 후보 지역 산정에 사용합니다. BYE 기지국 참고 좌표는 UE 위치가 아니므로 후보 산정에서 제외합니다.</p>
     <p>DBSCAN 100m는 군집 이웃 거리이며 지도 원의 크기나 GPS 측위 오차와 같지 않습니다.</p>
    </details>
   </div>
   <aside className={styles.inspectPanel} data-detail-tab={detailTab} aria-label="선택 지역 조사 내용">
    <section className={styles.regionList} aria-label="조사 후보 지역 목록">
     <header><h2>조사 후보 지역 목록 <span>{summary.candidates.length}곳</span></h2><p>한 지역을 선택하면 지도·고객 근거가 함께 변경됩니다.</p></header>
     <div className={styles.regionRows}>
      {summary.candidates.map((candidate,i)=>{
       const active=candidate.id===activeCard?.id, state=candidateStatus(candidate);
       const dong=candidateAdministrativeDong(overview,candidate.medoid.lat,candidate.medoid.lon);
       return <button type="button" key={candidate.id} className={styles.regionRow} aria-pressed={active} onClick={()=>onSelect(candidate.id)}>
        <span className={styles.regionNo}>{i+1}</span>
        <span className={styles.regionCopy}><b>{candidateTitle(i)}{dong?' · '+dong:''}</b>
         <small>저QoE 고객 {candidate.poorCustomerCount}명 · {candidate.poorCallCount}통화 · {candidate.poorDateCount}일</small>
        </span>
        <span className={styles.regionState} data-tone={state.tone}>{state.label}</span>
        <ChevronRight size={14} className={styles.rowArrow}/>
       </button>;
      })}
      {!summary.candidates.length&&<p className={styles.empty}>현재 조건에서 조사 후보 지역이 없습니다. 관측 위치가 없다는 뜻은 아닙니다.</p>}
     </div>
    </section>
    <div className={styles.detailTabs} role="tablist" aria-label="후보 상세 정보 선택">
      {([['summary','선정 요약'],['calls','고객·통화'],['rf','위치·무선 근거']] as const).map(([id,label])=>
       <button key={id} type="button" role="tab" aria-selected={detailTab===id} onClick={()=>setDetailTab(id)}>{label}</button>)}
    </div>
    {activeCard&&detailTab==='summary'&&<section className={styles.selectedRegion} aria-label="선택 후보 지역 요약">
     <div className={styles.selectedHeading}><div><small>선택한 조사 대상</small><h2>{candidateTitle(index)}{candidateAdministrativeDong(overview,activeCard.medoid.lat,activeCard.medoid.lon)?' · '+candidateAdministrativeDong(overview,activeCard.medoid.lat,activeCard.medoid.lon):''}</h2></div>
      {status&&<span className={styles.regionState} data-tone={status.tone}>{status.label}</span>}
     </div>
     <div className={styles.summaryMetrics}>
      <div><span>서로 다른 고객</span><strong>{activeCard.poorCustomerCount}명</strong></div>
      <div><span>저QoE 통화</span><strong>{activeCard.poorCallCount}건</strong></div>
      <div><span>관측된 날짜</span><strong>{activeCard.poorDateCount}일</strong></div>
      <div><span>{analysisMode==='all'?'별도 평가':'새 고객 재관측'}</span><strong>{analysisMode==='all'?'미실시':activeCard.validationNewCustomers+'명'}</strong></div>
     </div>
     {evidence?<p className={styles.locationSource}>후보 구성 위치 근거: GPS {evidence.gnss}통화 · 삼각 측량 {evidence.radio}통화 {analysisMode==='evaluation'&&<small>· 후속 평가일 관측 {evidence.verificationCalls}통화</small>}</p>
      :<p className={styles.locationSource}>위치 근거: 후보 상세 확인 중</p>}
     <p className={styles.interpretation}>
      <strong>선정 이유</strong> {activeCard.poorDateCount}일 동안 서로 다른 고객 {activeCard.poorCustomerCount}명에게 저QoE가 관측된 <b>조사 대상 지역</b>입니다.
      {activeCard.rangeReviewRequired?' 후보 범위가 다른 후보와 겹칠 수 있어 순위 확정을 보류했습니다.':' 분석 순위는 현장 원인 확정 순위가 아닙니다.'}
     </p>
     <small className={styles.coordinate}>중심점 기준 행정동 참고 · 대표 좌표 {activeCard.medoid.lat.toFixed(5)}, {activeCard.medoid.lon.toFixed(5)}</small>
     {inconsistency.length>0&&<div className={styles.error} role="alert"><AlertTriangle size={14}/>{inconsistency.join(' ')}</div>}
    </section>}
    {detailTab!=='rf'&&<section className={styles.customerPanel}>
      <header><h2><ClipboardList size={17}/> 선택 지역의 고객별 통화</h2><p>‘지역에 여러 고객이 반복 등장’과 ‘동일 고객이 여러 번 불량’을 구분합니다.</p></header>
      {selected?<CustomerEvidence detail={selected}/>
       :<output className={styles.loading}>{detailError??(detailPending?'관련 고객·통화 근거를 읽는 중입니다.':'후보를 선택해 주세요.')}</output>}
      {selected&&inconsistency.length===0&&<button type="button" className={styles.investigate} onClick={onInvestigate}>이 지역 통화 목록에서 자세히 보기 <ChevronRight size={16}/></button>}
      {detailTab==='calls'&&mappedSelected&&<details className={styles.rawDetail}><summary>원본 근거·Cell·RF 점검 항목 펼치기</summary><CandidateDetail candidate={mappedSelected} all={mapped} quality/></details>}
    </section>}
    {detailTab==='rf'&&<section className={styles.rfPanel} aria-label="선택 후보 위치 및 무선 근거">
      <h3>위치·무선 근거</h3>
      <p>승인된 GPS 또는 엄격 검토된 삼각 측량 관측점으로 후보를 산정합니다. 후보 RF 중앙값은 별도 산정하지 않았으며, 근거 없는 값을 표시하지 않습니다.</p>
      {evidence&&<div className={styles.rfFacts}><span>GPS 근거 <b>{evidence.gnss}건</b></span><span>삼각 측량 근거 <b>{evidence.radio}건</b></span><span>표시 반경 <b>{activeCard?.displayRadiusM??'—'}m</b></span></div>}
      {mappedSelected&&<CandidateDetail candidate={mappedSelected} all={mapped} quality/>}
      {selected&&inconsistency.length===0&&<button type="button" className={styles.investigate} onClick={onInvestigate}>관련 통화 상세 보기 <ChevronRight size={16}/></button>}
    </section>}

   </aside>
  </div>
  {simulatorOpen&&<QualitySimulatorDialog title="DBSCAN · 후보 산정 시뮬레이터"
   onClose={()=>setSimulatorOpen(false)}
   explanation={<QualityTwoAlgorithmGuide summary={summary} selectedCard={activeCard} selectedDetail={selected} selectedIndex={index} view="explanation"/>}
   criteria={<QualityTwoAlgorithmGuide summary={summary} selectedCard={activeCard} selectedDetail={selected} selectedIndex={index} view="criteria"/>}>
   <QualityTwoSimulator summary={summary}/>
  </QualitySimulatorDialog>}
  <p className={styles.explain}>후보의 숫자와 순위는 확인된 통화 근거에 한정됩니다. 저QoE와 실제 무선 장애 원인이 같다는 보장은 없으며 현장 조사로 검증해야 합니다.</p>
 </section>;
}
