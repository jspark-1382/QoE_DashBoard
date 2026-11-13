'use client';
import {useState,type ReactNode} from 'react';
import {ChevronRight,ClipboardList} from 'lucide-react';
import {CandidateVisibilityToggle} from './candidate-visibility-toggle';
import type {CandidateDisplayMode} from '../../lib/analyst/quality-candidate-visibility';
import type {CandidateTopTenCustomer,CandidateTopTenMatch,CandidateTopTenMember,CandidateTopTenState} from '../../lib/analyst/candidate-top-ten';
import {CandidateTopTenCoverage,CandidateTopTenMembers} from './candidate-top-ten-members';
import {useCandidateListScroll} from './use-candidate-list-scroll';
import styles from './quality-investigation-rail.module.css';

export interface InvestigationRailCandidate{
 id:string;
 title:string;
 customers:number;
 calls:number;
 days:number;
 radiusM:number;
 rangeReview:boolean;
 maxPairDistanceM?:number|null;
 rank:number|null;
 gnssCalls?:number|null;
 radioCalls?:number|null;
 radioLabel?:string;
 validationNewCustomers?:number;
 basis?:string;
 warning?:string;
 topTenCustomers?:readonly CandidateTopTenMember[];
}

interface Props{
 candidates:readonly InvestigationRailCandidate[];
 totalCount?:number;
 coreCount?:number;
 topTenCount?:number;
 topTenStatus?:CandidateTopTenState['status'];
 topTenCustomers?:readonly CandidateTopTenCustomer[];
 topTenMatches?:readonly CandidateTopTenMatch[];
 minimumDays?:number;
 displayMode?:CandidateDisplayMode;
 onDisplayModeChange?:(mode:CandidateDisplayMode)=>void;
 selectedId:string|null;
 mapPick?:number;
 onSelect:(id:string)=>void;
 onCalls:()=>void;
 analysisMode:'all'|'evaluation';
 modelName:string;
 emptyMessage?:string;
 guidance?:string;
 rsrpChart?:ReactNode;
 aiSummary?:ReactNode;
 onAnalyze?:(id:string)=>void;
 aiLabel?:(id:string)=>string;
}

/** Fullscreen investigation workspace. A map-marker click updates selectedId;
 * only the list container scrolls, never the map or document. */
export function QualityInvestigationRail({candidates,totalCount,coreCount,topTenCount,topTenStatus,topTenCustomers,topTenMatches,minimumDays=3,displayMode,onDisplayModeChange,selectedId,mapPick=0,onSelect,onCalls,analysisMode,modelName,emptyMessage,guidance,rsrpChart,aiSummary,onAnalyze,aiLabel}:Props){
 const [filter,setFilter]=useState<'all'|'review'>('all');
 const active=candidates.find(c=>c.id===selectedId)??candidates[0]??null;
 const reviewCount=candidates.filter(c=>c.rangeReview).length;
 const visibleFilter=filter==='review'&&(!reviewCount||!active?.rangeReview)?'all':filter;
 const shown=visibleFilter==='review'?candidates.filter(c=>c.rangeReview):candidates;
 const rows=useCandidateListScroll<HTMLFieldSetElement>(active?.id,mapPick,[displayMode,visibleFilter].join('/'),shown.length);
 return <div className={styles.root} data-has-rsrp={rsrpChart?'true':'false'} data-top-ten={displayMode==='top10'?'true':'false'} aria-label="전체화면 개선 후보 탐색">
  <section className={styles.listCard} aria-label="전체화면 개선 후보 지역 목록" data-candidate-list-viewport>
   <header className={styles.listHeading}>
    <div><h3>개선 후보 지역 <span>{displayMode==='top10'&&topTenStatus!=='ready'?(topTenStatus==='error'?'미확인':'확인 중'):candidates.length+'곳'}</span></h3>
    <p>목록과 지도 마커를 선택하면 같은 후보로 이동합니다.</p></div>
    <fieldset className={styles.filter} aria-label="후보 목록 필터">
     {displayMode&&onDisplayModeChange?<CandidateVisibilityToggle mode={displayMode} coreCount={coreCount??(displayMode==='core'?candidates.length:candidates.filter(c=>c.calls>=6&&c.customers>=3&&c.days>=minimumDays).length)} totalCount={totalCount??candidates.length} minimumDays={minimumDays} topTenCount={topTenCount} topTenStatus={topTenStatus} onChange={mode=>{setFilter('all');onDisplayModeChange(mode);}}/>:<button type="button" aria-pressed={visibleFilter==='all'} onClick={()=>setFilter('all')}>전체 {candidates.length}</button>}
     <button type="button" disabled={!reviewCount} aria-pressed={visibleFilter==='review'} onClick={()=>{const first=candidates.find(c=>c.rangeReview);setFilter('review');if(first&&!active?.rangeReview)onSelect(first.id);}}>범위 검토 {reviewCount}</button>
    </fieldset>
   </header>
   {displayMode==='top10'&&topTenStatus==='ready'&&topTenCustomers&&topTenMatches&&<CandidateTopTenCoverage customers={topTenCustomers} matches={topTenMatches}/>}
   <fieldset ref={rows} className={styles.rows} data-candidate-list="fullscreen" aria-label="후보 선택 목록">
    {shown.map(candidate=>{
     const index=candidates.findIndex(item=>item.id===candidate.id);
     const selected=active?.id===candidate.id;
     return <div key={candidate.id} className={styles.rowGroup}>
      <button type="button" data-candidate-id={candidate.id} className={styles.row}
       aria-pressed={selected} aria-label={candidate.title+' 선택'} onClick={()=>onSelect(candidate.id)}>
        <span className={styles.number}>{index+1}</span>
        <span className={styles.rowCopy}><b>{candidate.title}</b>
         <small>고객 {candidate.customers}명 · 저QoE {candidate.calls}건 · {candidate.days}일 · {candidate.radiusM}m</small>
         {displayMode==='top10'&&<CandidateTopTenMembers customers={candidate.topTenCustomers??[]}/>}
         {candidate.rangeReview&&<span className={styles.reviewLabel}>범위 검토</span>}
        </span>
        <ChevronRight size={14} aria-hidden="true"/>
      </button>
      {onAnalyze&&<button type="button" className={styles.aiButton} aria-label={candidate.title+' AI 분석'} onClick={()=>onAnalyze(candidate.id)}>{aiLabel?.(candidate.id)??'AI 분석'}</button>}
     </div>;
    })}
    {shown.length===0&&<p className={styles.empty}>{visibleFilter==='review'?'현재 모델에 범위 검토 대상이 없습니다.':emptyMessage??'현재 조건을 만족하는 개선 후보가 없습니다.'}</p>}
   </fieldset>
  </section>
  <section className={styles.detailCard} aria-label="전체화면 선택 후보 상세">
   <header className={styles.detailHeading}>
    <div><span>선택 후보 근거</span><h3>{active?.title??'선택된 후보 없음'}</h3></div>


   </header>
   {active?<div className={styles.details}>
    {displayMode==='top10'&&<CandidateTopTenMembers customers={active.topTenCustomers??[]}/>}
    <div className={styles.metrics}>
     <div><span>독립 저QoE 고객</span><b>{active.customers}명</b></div>
     <div><span>저QoE 통화</span><b>{active.calls}건</b></div>
     <div><span>관측일</span><b>{active.days}일</b></div>
     <div><span>표시 반경</span><b>{active.radiusM}m</b></div>
    </div>
    <p className={styles.reason}>서로 다른 고객·날짜의 저QoE 위치를 바탕으로 <strong>{modelName}</strong> 조사 후보를 산정했습니다.</p>
    {aiSummary}










    {analysisMode==='evaluation'&&<p className={styles.rank}>후속 평가일 새 고객 관측: {active.validationNewCustomers??0}명 (독립 원인 검증과 다름)</p>}
    {active.basis&&<p className={styles.modelBasis}>{active.basis}</p>}
    {active.warning&&<p className={styles.warning}>{active.warning}</p>}
    {rsrpChart}
   </div>:<p className={styles.empty}>후보를 선택하면 실제 증거가 표시됩니다.</p>}
  </section>
  {guidance&&<p className={styles.guidance}>{guidance}</p>}
  <footer className={styles.actions}>
   <button type="button" onClick={onCalls} disabled={!active}><ClipboardList size={15}/> 선택 후보 고객·통화 보기</button>
   <small>목록 번호는 후보 표기 순서이며 개선 우선순위가 아닙니다.</small>
  </footer>
 </div>;
}
