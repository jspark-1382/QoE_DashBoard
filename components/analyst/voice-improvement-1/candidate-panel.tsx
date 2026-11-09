'use client';
import type { SpatialCandidate } from '../../../lib/analyst/voice-improvement-1/types';
import styles from './workspace.module.css';
interface Props {candidates:readonly SpatialCandidate[];selectedId:string;onSelect:(id:string)=>void;}
export function CandidatePanel({candidates,selectedId,onSelect}:Props){
 const selected=candidates.find(c=>c.id===selectedId);
 return <aside className={styles.candidatePanel} aria-label="조사 순위와 선정 근거"><div className={styles.panelHeading}><div><span className={styles.eyebrow}>조사 우선순위</span><h2>어디부터 확인할까요?</h2></div><span className={styles.count}>{candidates.length}곳</span></div>
 <p className={styles.muted}>규칙 기반 조사 후보 · 현장 확인 필요</p>
 <div className={styles.candidateList}>{candidates.map(c=><button key={c.id} type="button" onClick={()=>onSelect(c.id)} aria-pressed={c.id===selectedId} className={c.id===selectedId?styles.selectedCandidate:styles.candidate}><span className={styles.rank}>{c.rank}</span><span><strong>지역 후보 {c.rank}</strong><small>고객 {c.poorCustomerCount}명 · {c.poorCallCount}통화 · {c.poorDateCount}일</small></span><span className={styles.tag}>{c.validationNewCustomerIds.length>=2?'재관측 충족':'재관측 미충족'}</span></button>)}</div>
 {!candidates.length&&<div className={styles.empty}>현재 조건에서 반복 지역 후보가 없습니다.<small>0건도 정상적인 분석 결과입니다.</small></div>}
 {selected&&<div className={styles.selectionDetail}><h3>선정 근거</h3><dl className={styles.facts}><div><dt>발견 저QoE 고객</dt><dd>{selected.poorCustomerCount}명</dd></div><div><dt>서로 다른 관측일</dt><dd>{selected.poorDateCount}일</dd></div><div><dt>검증 신규 / 기존 고객</dt><dd>{selected.validationNewCustomerIds.length} / {selected.validationExistingCustomerIds.length}명</dd></div><div><dt>구성점 최대 거리</dt><dd>{Math.round(selected.maxPairDistanceM)}m</dd></div><div><dt>중심에서 최대 거리</dt><dd>{Math.round(selected.maxCenterDistanceM)}m</dd></div><div><dt>조사 표시 반경</dt><dd>{Math.round(selected.displayRadiusM)}m</dd></div></dl>
 {selected.rangeReviewRequired&&<p className={styles.warning}>범위 검토 필요 · 이웃 점이 이어지는 사슬이나 넓은 분포를 현장에서 확인하세요.</p>}
 <p className={styles.note}>순위: 발견 고객 수 → 관측일 수 → 통화 수. 검증일은 중심·범위·순위 계산에 사용하지 않습니다.</p></div>}
 </aside>;
}
