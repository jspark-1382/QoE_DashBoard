'use client';
import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {ChevronRight, CircleHelp, ClipboardList, MapPinned, Users, CheckCircle2, AlertTriangle} from 'lucide-react';
import type {AnalystOverview} from '../../lib/analyst/types';
import type {ImprovementCandidate} from '../../lib/analyst/improvement-candidates';
import type {QualityCandidateDetail,QualityCandidateSummary,QualityObservationPoint} from '../../lib/analyst/quality-improvement-candidates';
import {candidateAdministrativeDong,candidateEvidenceSummary,candidateStatus,candidateTitle,verifyCandidateSummaryConsistency} from '../../lib/analyst/quality-two-candidate-view-model';
import {ImprovementCandidateMap} from './improvement-candidate-map';
import {CandidateMdtRsrpChart} from './candidate-mdt-rsrp-chart';
import type {CandidateRoughPoint} from '../../lib/analyst/quality-candidate-rough-points';
import {matchCandidateRoughPoints} from '../../lib/analyst/quality-candidate-rough-membership';
import {selectCandidateStationSites} from '../../lib/analyst/station-map-presentation';
import {StationLayerControls} from './station-layer-controls';
import type {StationLayerState} from './use-candidate-station-layer';
import {MapPanelFrame} from './map-panel-frame';
import {CandidateDetail} from './improvement-candidates';
import {CustomerEvidence} from './quality-two-customer-evidence';
import {QualityTwoSimulator} from './quality-two-simulator';
import {QualityInvestigationRail} from './quality-investigation-rail';
import {useCandidateListScroll} from './use-candidate-list-scroll';
import {CandidateVisibilityToggle} from './candidate-visibility-toggle';
import {CandidateDetailTabs,type CandidateDetailTab} from './candidate-detail-tabs';
import type {MdtGridMode} from '../../lib/analyst/mdt-25m-grid';
import type {CandidateDisplayMode} from '../../lib/analyst/quality-candidate-visibility';
import {summarizeCandidateTopTenCoverage,type CandidateTopTenMatch,type CandidateTopTenState} from '../../lib/analyst/candidate-top-ten';
import {CandidateTopTenCoverage,CandidateTopTenMembers} from './candidate-top-ten-members';
import {CandidateTopTenMap} from './candidate-top-ten-map';
import {QualitySimulatorDialog} from './quality-simulator-dialog';
import {QualityTwoAlgorithmGuide} from './quality-two-algorithm-guide';

import {candidateAnalysisTarget,isCurrentCandidateAnalysisJob} from '../../lib/analyst/candidate-ai-analysis';
import {CandidateAiDialog,CandidateAiSummary,candidateAiButtonLabel,useCandidateAiAnalysis} from './candidate-ai-analysis';
import styles from './quality-two-candidate-workspace.module.css';

const num=(n:number)=>n.toLocaleString('ko-KR');

interface Props {
 summary:QualityCandidateSummary;
 fullSummary:QualityCandidateSummary;
 topTen:CandidateTopTenState;
 topTenCount:number;
 topTenMatches:readonly CandidateTopTenMatch[];
 mdtGridMode:MdtGridMode;
 totalCount:number;
 minimumDays:number;
 displayMode:CandidateDisplayMode;
 onDisplayModeChange:(mode:CandidateDisplayMode)=>void;
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
 roughPoints:CandidateRoughPoint[];
 roughStatus:'loading'|'ready'|'error';
 roughError:string|null;
 stationLayer:StationLayerState;
 onSelect:(id:string)=>void;
 onInvestigate:()=>void;
}

export function QualityTwoCandidateWorkspace({summary,fullSummary,topTen,topTenCount,topTenMatches,mdtGridMode,totalCount,minimumDays,displayMode,onDisplayModeChange,analysisMode,guideOpenRequest,mapControls,initiallyExpanded,onFullscreenChange,mapped,selectedId,detail,detailPending,detailError,overview,observationPoints,roughPoints,roughStatus,roughError,stationLayer,onSelect,onInvestigate}:Props){
 const ai=useCandidateAiAnalysis();
 const [detailTab,setDetailTab]=useState<CandidateDetailTab>('summary');
 const [simulatorOpen,setSimulatorOpen]=useState(false);
 const previousGuideRequest=useRef(guideOpenRequest);
 const topTenMode=displayMode==='top10';
 const pendingTopTenLabel=topTenMode&&topTen.status!=='ready'?(topTen.status==='error'?'미확인':'확인 중'):null;
 const topTenMembers=useMemo(()=>new Map(topTenMatches.map(match=>[match.candidateId,match.customers])),[topTenMatches]);
 const topTenCoverage=useMemo(()=>summarizeCandidateTopTenCoverage(topTen.customers,topTenMatches),[topTen.customers,topTenMatches]);
 const unmatchedTopTen=useMemo(()=>topTenMode&&topTen.status==='ready'&&topTenCoverage.unmatched.length
  ?{scope:fullSummary.scope,customers:topTenCoverage.unmatched}:undefined,[topTenMode,topTen.status,topTenCoverage,fullSummary.scope]);
 const coreCount=fullSummary.candidates.filter(c=>c.poorCallCount>=6&&c.poorCustomerCount>=3&&c.poorDateCount>=minimumDays).length;
 const showTopTenMap=topTenMode&&topTen.status==='ready'&&summary.candidates.length===0;
 const showCandidateMap=!topTenMode||(topTen.status==='ready'&&summary.candidates.length>0);
 const topTenMessage=topTen.status==='error'?(topTen.error??'고객현황 TOP10을 확인하지 못했습니다.'):
  topTen.status!=='ready'?'고객현황 TOP10과 후보 통화·위치를 확인하는 중입니다.':
  '고객현황 TOP10 고객이 포함된 후보가 없어 TOP10 고객 위치를 지도에 표시합니다.';
 const visibleDialogTarget=ai.dialogTarget&&(!topTenMode||summary.candidates.some(c=>c.id===ai.dialogTarget?.candidateId))?ai.dialogTarget:null;
 const dialogTarget=ai.dialogTarget,closeAi=ai.close;
 const dialogPoint=visibleDialogTarget ? fullSummary.candidates.find(c=>c.id===visibleDialogTarget.candidateId)?.medoid : undefined;
 const dialogLocality=dialogPoint ? candidateAdministrativeDong(overview,dialogPoint.lat,dialogPoint.lon) ?? undefined : undefined;
 useEffect(()=>{if(topTenMode&&dialogTarget&&!visibleDialogTarget)closeAi();},[topTenMode,dialogTarget,visibleDialogTarget,closeAi]);
 useEffect(()=>{if(previousGuideRequest.current!==guideOpenRequest){previousGuideRequest.current=guideOpenRequest;setSimulatorOpen(true);}},[guideOpenRequest]);
 const activeCard=summary.candidates.find(c=>c.id===selectedId)??summary.candidates[0];
 const [mapPick,setMapPick]=useState(0);
 const [listFocusRequest,setListFocusRequest]=useState<{id:string}>();
 const rows=useCandidateListScroll<HTMLDivElement>(activeCard?.id,mapPick,displayMode,summary.candidates.length);
 const selectFromMap=(id:string)=>{onSelect(id);setMapPick(pick=>pick+1);};
 const selectFromList=(id:string)=>{onSelect(id);setListFocusRequest({id});};
 const selected=activeCard?.id===detail?.candidate.id?detail:null;
 const mappedSelected=mapped.find(c=>c.id===activeCard?.id);
 const activeAiTarget=activeCard?candidateAnalysisTarget(fullSummary,activeCard.id,analysisMode):null;
 const activeAiEntry=activeAiTarget?ai.entry(activeAiTarget):undefined;
 const previousAiEntry=activeAiTarget?ai.previous(activeAiTarget):undefined;
 const aiTitle=(id:string)=>{const position=summary.candidates.findIndex(c=>c.id===id);return candidateTitle(Math.max(0,position));};
 const analyze=(id:string)=>{const target=candidateAnalysisTarget(fullSummary,id,analysisMode),entry=ai.entry(target);onSelect(id);setDetailTab('summary');ai.open(target,aiTitle(id));if(!isCurrentCandidateAnalysisJob(entry?.job)&&!entry?.pending)ai.start(target);};
 const aiSummary=activeAiTarget?<CandidateAiSummary entry={activeAiEntry??previousAiEntry} stale={ai.changed(activeAiTarget)} onOpen={()=>ai.open((activeAiEntry??previousAiEntry)?.target??activeAiTarget,aiTitle(activeAiTarget.candidateId))} onStart={()=>analyze(activeAiTarget.candidateId)} onCancel={()=>ai.cancel(activeAiTarget)}/>:null;
 const index=activeCard?summary.candidates.findIndex(c=>c.id===activeCard.id):-1;
 const status=activeCard?candidateStatus(activeCard):null;
 const evidence=selected?candidateEvidenceSummary(selected):null;
 const inconsistency=selected?verifyCandidateSummaryConsistency(summary,selected):[];
 const validatedCount=summary.candidates.filter(c=>c.validationStatus==='reobserved').length;
 // The summary's affected customers means distinct customers with low MOS, NOT customers with multiple failed calls.
 const affected=summary.distinctAffectedCustomers;
 const usingMixed=summary.locationMode==='gps-mdt-rough-unvalidated-v1';
 const insideRough=useMemo(()=>matchCandidateRoughPoints(mapped,roughPoints),[mapped,roughPoints]);
 // Map GPS behavior: only evidence for the currently selected candidate is visible.
 const selectedRough=useMemo(()=>{
  const inCircle=insideRough.filter(p=>p.matchingCandidateIds.includes(activeCard?.id??''));
  if(!usingMixed)return inCircle;
  if(!selected)return [];
  const members=new Set(selected.candidate.nearbyPoints.filter(p=>p.kind==='rough'&&p.role==='discovery-member').map(p=>p.callId));
  return inCircle.filter(p=>members.has(p.callId.startsWith(p.date+':')?p.callId:p.date+':'+p.callId));
 },[insideRough,activeCard?.id,usingMixed,selected]);
 const selectedInsideRough=selectedRough.length;
 const selectedMapCandidates=useMemo(()=>mapped.filter(c=>c.id===activeCard?.id),[mapped,activeCard?.id]);
 const stationSites=useMemo(()=>selectCandidateStationSites(selectedMapCandidates,stationLayer.catalogs,stationLayer.options,activeCard?.id??null,selectedRough),[selectedMapCandidates,stationLayer.catalogs,stationLayer.options,activeCard?.id,selectedRough]);
 const linkedStationCount=stationSites.filter(s=>s.linkedToSelected).length;
 const mapLegend=<div className={styles.mapLegend} aria-label="지도 위치 범례">
  <span><i className={styles.selectedDot}/>선택 지역</span><span><i className={styles.otherDot}/>다른 후보</span>
  {unmatchedTopTen&&<span><i className={styles.unmatchedDot}/>후보 미포함 TOP10 고객 {unmatchedTopTen.customers.length}명 · 순위/저품질 건수</span>}

  <span><i className={styles.rsrpRed}/>≤ −105</span>
  <span><i className={styles.rsrpGreen}/>{'> −105'}</span>
  {!usingMixed&&<span><i className={styles.radioDot}/>검토 통과 삼각 측량</span>}<span title="기지국 등록 좌표, 고객 위치 아님">♜ 기지국 타워</span>
  <span title={usingMixed?'선택 후보의 DBSCAN 구성 통화 중 MDT RSRP 가중중심 좌표 · 위치 정확도 미검증':'후보 원 안에 위치한 참고 근사 좌표'}><i className={styles.roughDot}/>{usingMixed?'MDT 근사 · 후보 구성 ':'삼각 측량 근사 · 선택 '}{roughStatus==='ready'?num(usingMixed?(activeCard?.roughCallCount??selectedInsideRough):selectedInsideRough)+'건':roughStatus==='loading'?'확인 중':'미확인'}</span>
 </div>;
 const investigationItems=summary.candidates.map((c,i)=>{
  const dong=candidateAdministrativeDong(overview,c.medoid.lat,c.medoid.lon);
  const detailForRow=c.id===selected?.candidate.id?selected:null;
  const proof=detailForRow?candidateEvidenceSummary(detailForRow):null;
  return {
   id:c.id,title:candidateTitle(i)+(dong?' · '+dong:''),customers:c.poorCustomerCount,
   calls:c.poorCallCount,days:c.poorDateCount,radiusM:c.displayRadiusM,
   rangeReview:c.rangeReviewRequired,rank:c.rank,
   maxPairDistanceM:detailForRow?.candidate.maxPairDistanceM??null,
   gnssCalls:usingMixed?(c.gnssCallCount??proof?.gnss??0):(proof?.gnss??null),radioCalls:usingMixed?(c.roughCallCount??proof?.rough??0):(proof?.radio??null),radioLabel:usingMixed?'MDT RSRP 근사 (미검증)':'검토 통과 삼각 측량',
   validationNewCustomers:c.validationNewCustomers,topTenCustomers:topTenMode?topTenMembers.get(c.id):undefined
  };
 });
 const displayPoints=useMemo(()=>selected
  ?selected.candidate.nearbyPoints.filter((p):p is typeof selected.candidate.nearbyPoints[number]&{kind:'reviewed-radio'}=>p.kind==='reviewed-radio'&&(p.role==='discovery-member'||p.role==='validation-new'||p.role==='validation-existing')).map(p=>({callId:p.callId,customerId:p.customerId,date:p.date,lat:p.lat,lon:p.lon,kind:p.kind,observedAt:p.observedAt,candidateId:selected.candidate.id}))
  :activeCard?observationPoints:[],[selected,activeCard,observationPoints]);

 return <section id="quality-two-primary" className={styles.workspace} aria-label="개선후보 분석">
  <div className={styles.kpis} aria-label="개선 후보 핵심 현황">
   <div><span><Users size={16}/> 저품질 경험 고객</span><strong>{affected==null?'미산출':num(affected)+'명'}</strong><small>선택 기간의 서로 다른 저QoE 고객 · 고객별 반복 여부 아님</small></div>
   <div><span><MapPinned size={16}/> 개선 후보 지역</span><strong>{pendingTopTenLabel??num(summary.candidates.length)+'곳'}</strong><small>서로 다른 고객·날짜의 위치 기반 반복 관측</small></div>
   <div><span><CheckCircle2 size={16}/> {analysisMode==='all'?'범위 재검토 지역':'새 고객 재관측 지역'}</span><strong>{pendingTopTenLabel??num(analysisMode==='all'?summary.candidates.filter(c=>c.rangeReviewRequired).length:validatedCount)+'곳'}</strong><small>{analysisMode==='all'?'전체 기간 저QoE 관측점 중 군집 최대 점간 거리 200m 초과':'별도 검증일의 신규 고객 관측 · 원인 확정 아님'}</small></div>
  </div>
  <div className={styles.workspaceGrid}>
   <div className={styles.mapColumn}>
    <MapPanelFrame className={styles.mapPanel} label="개선 후보 영역" suspended={simulatorOpen||!!visibleDialogTarget} initiallyExpanded={initiallyExpanded} onExpandedChange={onFullscreenChange}>
     {({toggleButton,expanded,close})=><>
      <div className={styles.mapHeading}>
       <div className={styles.mapTitleBlock}><h2><MapPinned size={18}/> 개선 후보</h2><p>지역을 선택하면 오른쪽의 근거와 고객 목록이 함께 바뀝니다.</p></div>
       {!expanded&&mapControls?.(false)}
       {toggleButton}
      </div>
      <div className={styles.fullscreenWorkspace} data-map-surface data-expanded={expanded?'true':'false'}>
       <aside className={styles.algorithmRail} hidden={!expanded} aria-label="전체화면 왼쪽 지도 해석 및 알고리즘 설명">
        {expanded&&<>
         <div className={styles.railFixed}>
          <div className={styles.railTitle}>
           <div className={styles.railTitleRow}>
            <h2><MapPinned size={19}/> 개선 후보</h2>
            {mapControls?.(true)}
           </div>
           <p>지역을 선택하면 해당 후보의 근거가 함께 바뀝니다.</p>
          </div>
          {showCandidateMap?mapLegend:<p role={topTen.status==='error'?'alert':'status'}>{topTenMessage}</p>}
         </div>
         <QualityInvestigationRail mapPick={mapPick}
          candidates={investigationItems} totalCount={totalCount} coreCount={coreCount} topTenCount={topTenCount} topTenStatus={topTen.status} topTenCustomers={topTen.customers} topTenMatches={topTenMatches} minimumDays={minimumDays} displayMode={displayMode} onDisplayModeChange={onDisplayModeChange} selectedId={activeCard?.id??null} onSelect={selectFromList} emptyMessage={topTenMode?topTenMessage:undefined}
          onCalls={()=>{setDetailTab('calls');close();}} analysisMode={analysisMode}
          modelName="DBSCAN" onAnalyze={analyze} aiLabel={id=>candidateAiButtonLabel(ai.entry(candidateAnalysisTarget(fullSummary,id,analysisMode)))} aiSummary={aiSummary} rsrpChart={selected?<CandidateMdtRsrpChart compact callIds={selected.candidate.memberCallIds} sourceRevision={summary.scope.sourceRevision}/>:null} guidance="군집 중심은 참고 추정 좌표이며, 통화 열화 순간 위치가 아닙니다."
         />
        </>}
       </aside>
       <div className={styles.fullscreenMapArea}>
        {!expanded&&showCandidateMap&&mapLegend}
        {showCandidateMap&&<StationLayerControls layer={stationLayer} shown={stationSites.length} related={linkedStationCount}/>}
        <div className={styles.mapSurface}>
         {showTopTenMap?<CandidateTopTenMap scope={fullSummary.scope} customers={topTen.customers}/>:!showCandidateMap?
          <p className={styles.empty} role={topTen.status==='error'?'alert':'status'}>{topTenMessage}</p>:
         <ImprovementCandidateMap candidates={mapped} mdtGridMode={mdtGridMode} selectedId={activeCard?.id??''} listFocusRequest={listFocusRequest} sourceRevision={overview.sourceRevision} onSelect={selectFromMap} unmatchedTopTen={unmatchedTopTen}
          observationPoints={displayPoints} roughPoints={selectedRough} stationSites={stationSites} roughUsedForCandidate={usingMixed} presentation="proposal2" fullscreenEnhanced={expanded}
          hint="후보 원은 개선 후보의 참고 범위이며 실제 QoE 열화 순간 좌표 또는 위치 오차 반경이 아닙니다."/>}
        </div>
        {!expanded&&<p className={styles.mapBottom}>{topTenMode&&!showCandidateMap?topTenMessage:<>{usingMixed?'GPS와 MDT RSRP 가중중심을 DBSCAN 후보에 함께 사용했습니다. MDT 근사의 위치 정확도는 아직 검증되지 않아 후보 원·순위·고객 수는 개선 검토용 결과입니다.':'GPS와 승인 좌표만 후보에 사용합니다.'} 측위 근거 기지국은 후보 원 밖에도 존재할 수 있습니다.{roughError?' · MDT 좌표 자료 오류: '+roughError:''}</>}</p>}
       </div>
      </div>
     </>}
    </MapPanelFrame>
    <details className={styles.mapHelp}>
     <summary><CircleHelp size={15}/> 선정 기준과 위치 표시 의미</summary>
     <p>{usingMixed?'GPS 실측과 MDT 다중 기지국 RSRP 가중중심 근사를 함께 DBSCAN에 입력합니다. 근사 위치는 GPS 수준으로 검증되지 않았으며 후보 수와 순위·고객 수는 탐색 결과입니다.':'GPS와 엄격 승인 좌표만 후보에 입력합니다.'} BYE 기지국 단독 위치는 고객 좌표로 사용하지 않습니다.</p>
     <p>DBSCAN 100m는 군집 이웃 거리이며 지도 원의 크기나 GPS 측위 오차와 같지 않습니다.</p>
    </details>
   </div>
   <aside className={styles.inspectPanel} data-detail-tab={detailTab} aria-label="선택 지역 개선 내용">
    <section className={styles.regionList} aria-label="개선 후보 지역 목록">
     <header><div className={styles.regionFilterLine}><h2>개선 후보 지역 목록 <span>{topTenMode&&topTen.status!=='ready'?(topTen.status==='error'?'미확인':'확인 중'):summary.candidates.length+'곳'}</span></h2><CandidateVisibilityToggle mode={displayMode} coreCount={coreCount} totalCount={totalCount} minimumDays={minimumDays} topTenCount={topTenCount} topTenStatus={topTen.status} onChange={onDisplayModeChange}/></div><p>{topTenMode?'TOP10 고객의 구성 통화가 있거나 고객현황 대표 위치가 후보 원 안인 지역입니다.':'핵심: 6통화·'+minimumDays+'일 이상(고객 3명). 전체 선택 시 숨긴 후보 표시.'}</p></header>
     {topTenMode&&topTen.status==='ready'&&<CandidateTopTenCoverage customers={topTen.customers} matches={topTenMatches}/>}
     <div className={styles.regionRows} ref={rows} data-candidate-list="normal">
      {summary.candidates.map((candidate,i)=>{
       const active=candidate.id===activeCard?.id, state=candidateStatus(candidate);
       const dong=candidateAdministrativeDong(overview,candidate.medoid.lat,candidate.medoid.lon);
       return <div key={candidate.id} className={styles.regionRowGroup}>
        <button type="button" className={styles.regionRow} data-candidate-id={candidate.id} aria-pressed={active} onClick={()=>selectFromList(candidate.id)}>
         <span className={styles.regionNo}>{i+1}</span>
         <span className={styles.regionCopy}><b>{candidateTitle(i)}{dong?' · '+dong:''}</b>
          <small>저QoE 고객 {candidate.poorCustomerCount}명 · {candidate.poorCallCount}통화 · {candidate.poorDateCount}일{usingMixed?' · GPS '+num(candidate.gnssCallCount??0)+' / MDT 근사 '+num(candidate.roughCallCount??0):''}</small>
          {topTenMode&&<CandidateTopTenMembers customers={topTenMembers.get(candidate.id)??[]}/>}
          <span className={styles.regionState} data-tone={state.tone}>{state.label}</span>
         </span>
         <ChevronRight size={14} className={styles.rowArrow}/>
        </button>
        <button type="button" className={styles.aiButton} aria-label={candidateTitle(i)+' AI 분석'} onClick={()=>analyze(candidate.id)}>{candidateAiButtonLabel(ai.entry(candidateAnalysisTarget(fullSummary,candidate.id,analysisMode)))}</button>
       </div>;
      })}
      {!summary.candidates.length&&<p className={styles.empty} role={topTenMode&&topTen.status==='error'?'alert':'status'}>{topTenMode?topTenMessage:'현재 조건에서 개선 후보 지역이 없습니다. 관측 위치가 없다는 뜻은 아닙니다.'}</p>}
     </div>
    </section>
    {activeCard&&<CandidateDetailTabs value={detailTab} onChange={setDetailTab} label="후보 상세 정보 선택" className={styles.detailTabs} panelClassName={styles.tabContent}>
    {activeCard&&detailTab==='summary'&&<section className={styles.selectedRegion} aria-label="선택 후보 지역 요약">
     <div className={styles.selectedHeading}><div><small>선택한 개선 대상</small><h2>{candidateTitle(index)}{candidateAdministrativeDong(overview,activeCard.medoid.lat,activeCard.medoid.lon)?' · '+candidateAdministrativeDong(overview,activeCard.medoid.lat,activeCard.medoid.lon):''}</h2></div>
      {status&&<span className={styles.regionState} data-tone={status.tone}>{status.label}</span>}
     </div>
     {topTenMode&&<CandidateTopTenMembers customers={topTenMembers.get(activeCard.id)??[]}/>}
     <div className={styles.summaryMetrics}>
      <div><span>서로 다른 고객</span><strong>{activeCard.poorCustomerCount}명</strong></div>
      <div><span>저QoE 통화</span><strong>{activeCard.poorCallCount}건</strong></div>
      <div><span>관측된 날짜</span><strong>{activeCard.poorDateCount}일</strong></div>
      <div><span>{analysisMode==='all'?'별도 평가':'새 고객 재관측'}</span><strong>{analysisMode==='all'?'미실시':activeCard.validationNewCustomers+'명'}</strong></div>
     </div>
     <details className={styles.summaryEvidence}><summary>후보 선정·위치 근거</summary>
     {evidence?<p className={styles.locationSource}>후보 구성 위치 근거: GPS {evidence.gnss}통화 · {usingMixed?'MDT 근사 '+evidence.rough+'통화 (위치 미검증)':'검토 통과 삼각 측량 '+evidence.radio+'통화'} {analysisMode==='evaluation'&&<small>· 후속 평가일 관측 {evidence.verificationCalls}통화</small>}</p>
      :<p className={styles.locationSource}>위치 근거: 후보 상세 확인 중</p>}
     <p className={styles.interpretation}><strong>선정 이유</strong> 서로 다른 고객·날짜의 저QoE 위치가 함께 관측된 조사 후보입니다. {activeCard.rangeReviewRequired?'범위 검토가 필요합니다.':'원인은 별도 확인이 필요합니다.'}</p>
     </details>
     {aiSummary}
     {selected&&<CandidateMdtRsrpChart callIds={selected.candidate.memberCallIds} sourceRevision={summary.scope.sourceRevision}/>}
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
      <p>{usingMixed?'GPS와 MDT RSRP 가중중심 근사 위치를 함께 사용했습니다. 근사 위치의 정확도·군집 원인 검증은 아직 수행하지 않았습니다.':'GPS와 엄격 검토 위치를 사용합니다.'} RF 중앙값은 별도 산정하지 않았습니다.</p>
      {evidence&&<div className={styles.rfFacts}><span>GPS 근거 <b>{evidence.gnss}건</b></span><span>{usingMixed?'MDT 근사':'검토 통과 삼각 측량'} <b>{usingMixed?evidence.rough:evidence.radio}건</b></span><span>표시 반경 <b>{activeCard?.displayRadiusM??'—'}m</b></span></div>}
      {mappedSelected&&<CandidateDetail candidate={mappedSelected} all={mapped} quality/>}
      {selected&&inconsistency.length===0&&<button type="button" className={styles.investigate} onClick={onInvestigate}>관련 통화 상세 보기 <ChevronRight size={16}/></button>}
    </section>}</CandidateDetailTabs>}
   </aside>
  </div>
  {visibleDialogTarget&&<CandidateAiDialog key={JSON.stringify(visibleDialogTarget)} target={visibleDialogTarget} title={ai.dialogTitle} locality={dialogLocality} entry={ai.entry(visibleDialogTarget)} onClose={ai.close} onStart={()=>ai.rerun(visibleDialogTarget)} onCancel={()=>ai.cancel(visibleDialogTarget)} onSelectSaved={id=>ai.selectSaved(visibleDialogTarget,id)} onSendPrompt={draft=>ai.sendPrompt(visibleDialogTarget,draft)}/>}
  {simulatorOpen&&<QualitySimulatorDialog title="DBSCAN · 후보 산정 시뮬레이터"
   onClose={()=>setSimulatorOpen(false)}
   explanation={<QualityTwoAlgorithmGuide summary={fullSummary} selectedCard={activeCard} selectedDetail={selected} selectedIndex={index} view="explanation"/>}
   criteria={<QualityTwoAlgorithmGuide summary={fullSummary} selectedCard={activeCard} selectedDetail={selected} selectedIndex={index} view="criteria"/>}>
   <QualityTwoSimulator summary={fullSummary}/>
  </QualitySimulatorDialog>}
  <p className={styles.explain}>GPS·MDT 원본 저QoE 통화로 개선 후보를 계산했습니다. MDT 기반 위치 정확도와 RF 원인은 독립 검증 전이며, 후보 숫자·순위는 확정된 불량 위치나 장애 원인이 아닙니다.</p>
 </section>;
}
