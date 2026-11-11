'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {ChevronRight,ClipboardList} from 'lucide-react';
import {CandidateVisibilityToggle} from './candidate-visibility-toggle';
import type {CandidateDisplayMode} from '../../lib/analyst/quality-candidate-visibility';
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
}

interface Props{
 candidates:readonly InvestigationRailCandidate[];
 totalCount?:number;
 minimumDays?:number;
 displayMode?:CandidateDisplayMode;
 onDisplayModeChange?:(mode:CandidateDisplayMode)=>void;
 selectedId:string|null;
 onSelect:(id:string)=>void;
 onCalls:()=>void;
 analysisMode:'all'|'evaluation';
 modelName:string;
 emptyMessage?:string;
 guidance?:string;
 rsrpChart?:ReactNode;
}

/** Fullscreen investigation workspace. A map-marker click updates selectedId;
 * only the list container scrolls, never the map or document. */
export function QualityInvestigationRail({candidates,totalCount,minimumDays=3,displayMode,onDisplayModeChange,selectedId,onSelect,onCalls,analysisMode,modelName,emptyMessage,guidance,rsrpChart}:Props){
 const [filter,setFilter]=useState<'all'|'review'>('all');
 const [reviewAnchorId,setReviewAnchorId]=useState<string|null>(null);
 const rows=useRef<HTMLFieldSetElement|null>(null);
 const active=candidates.find(c=>c.id===selectedId)??candidates[0]??null;
 const visibleFilter=filter==='review'&&active&&!active.rangeReview&&active.id!==reviewAnchorId?'all':filter;
 const shown=visibleFilter==='review'?candidates.filter(c=>c.rangeReview):candidates;
 const reviewCount=candidates.filter(c=>c.rangeReview).length;
 useEffect(()=>{
  const list=rows.current;
  const target=[...list?.querySelectorAll<HTMLButtonElement>('button[data-candidate-id]')??[]]
   .find(button=>button.dataset.candidateId===active?.id);
  if(!list||!target)return;
  const top=target.getBoundingClientRect().top-list.getBoundingClientRect().top+list.scrollTop;
  const bottom=top+target.offsetHeight;
  if(top<list.scrollTop)list.scrollTop=Math.max(0,top-6);
  else if(bottom>list.scrollTop+list.clientHeight)list.scrollTop=bottom-list.clientHeight+6;
 },[active?.id,visibleFilter,shown.length]);
 return <div className={styles.root} data-has-rsrp={rsrpChart?'true':'false'} aria-label="전체화면 개선 후보 탐색">
  <section className={styles.listCard} aria-label="전체화면 개선 후보 지역 목록">
   <header className={styles.listHeading}>
    <div><h3>개선 후보 지역 <span>{candidates.length}곳</span></h3>
    <p>목록과 지도 마커를 선택하면 같은 후보로 이동합니다.</p></div>
    <fieldset className={styles.filter} aria-label="후보 목록 필터">
     {displayMode&&onDisplayModeChange?<CandidateVisibilityToggle mode={displayMode} coreCount={displayMode==='core'?candidates.length:candidates.filter(c=>c.calls>=6&&c.customers>=3&&c.days>=minimumDays).length} totalCount={totalCount??candidates.length} minimumDays={minimumDays} onChange={mode=>{setFilter('all');onDisplayModeChange(mode);}}/>:<button type="button" aria-pressed={visibleFilter==='all'} onClick={()=>setFilter('all')}>전체 {candidates.length}</button>}
     <button type="button" aria-pressed={visibleFilter==='review'} onClick={()=>{const first=candidates.find(c=>c.rangeReview);setFilter('review');setReviewAnchorId(first?.id??active?.id??null);if(first&&!active?.rangeReview)onSelect(first.id);}}>범위 검토 {reviewCount}</button>
    </fieldset>
   </header>
   <fieldset ref={rows} className={styles.rows} aria-label="후보 선택 목록">
    {shown.map(candidate=>{
     const index=candidates.findIndex(item=>item.id===candidate.id);
     const selected=active?.id===candidate.id;
     return <button type="button" key={candidate.id}
      data-candidate-id={candidate.id} className={styles.row}
      aria-pressed={selected} aria-label={candidate.title+' 선택'}
      onClick={()=>onSelect(candidate.id)}>
       <span className={styles.number}>{index+1}</span>
       <span className={styles.rowCopy}>
        <b>{candidate.title}</b>
        <small>고객 {candidate.customers}명 · 저QoE {candidate.calls}건 · {candidate.days}일 · {candidate.radiusM}m</small>
       </span>
       {candidate.rangeReview&&<span className={styles.reviewLabel}>범위 검토</span>}
       <ChevronRight size={14} aria-hidden="true"/>
      </button>;
    })}
    {shown.length===0&&<p className={styles.empty}>{visibleFilter==='review'?'현재 모델에 범위 검토 대상이 없습니다.':emptyMessage??'현재 조건을 만족하는 개선 후보가 없습니다.'}</p>}
   </fieldset>
  </section>
  <section className={styles.detailCard} aria-label="전체화면 선택 후보 상세">
   <header className={styles.detailHeading}>
    <div><span>선택 후보 근거</span><h3>{active?.title??'선택된 후보 없음'}</h3></div>


   </header>
   {active?<div className={styles.details}>
    <div className={styles.metrics}>
     <div><span>독립 저QoE 고객</span><b>{active.customers}명</b></div>
     <div><span>저QoE 통화</span><b>{active.calls}건</b></div>
     <div><span>관측일</span><b>{active.days}일</b></div>
     <div><span>표시 반경</span><b>{active.radiusM}m</b></div>
    </div>
    <p className={styles.reason}>
     {active.days}일 동안 서로 다른 고객 {active.customers}명의 저QoE 통화 {active.calls}건이 위치 근거로 연결되어 <strong>{modelName}</strong> 후보로 산정됐습니다.
    </p>










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
