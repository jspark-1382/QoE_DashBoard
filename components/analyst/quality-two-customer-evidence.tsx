'use client';
import {ChevronDown, Users} from 'lucide-react';
import type {QualityCandidateDetail} from '../../lib/analyst/quality-improvement-candidates';
import {buildCandidateCustomerRows,repeatedCustomerCount} from '../../lib/analyst/quality-two-candidate-view-model';
import styles from './quality-two-candidate-workspace.module.css';

export function CustomerEvidence({detail}:{detail:QualityCandidateDetail}){
 const rows=buildCandidateCustomerRows(detail);
 const repeated=repeatedCustomerCount(rows);
 const hasEvaluation=detail.candidate.validationStatus!=='not-applicable';
 const discovery=rows.filter(row=>row.discoveryCalls>0).length;
 const newlyVerified=rows.filter(row=>row.discoveryCalls===0&&row.verificationCalls>0).length;
 return <div className={styles.customerEvidence} aria-label="선택 후보 고객 통화 근거">
  <div className={styles.customerCounts}>
   <div><span>후보 구성 고객</span><strong>{discovery}명</strong></div>
   <div><span>{hasEvaluation?'후속 평가일 신규 고객':'별도 성능 평가'}</span><strong>{hasEvaluation?newlyVerified+'명':'미실시'}</strong></div>
   <div><span>같은 고객의 지역 내 저QoE 2회 이상</span><strong>{repeated}명</strong></div>
  </div>
  <p className={styles.customerNote}><Users size={14}/> 고객 A/B/C는 익명 표기입니다. 서로 다른 고객이 같은 지역에서 관측된 것은 각 고객의 반복 불량과 다릅니다.</p>
  <div className={styles.customerRows}>
   {rows.map(row=><details key={row.customerId} className={styles.customerRow}>
    <summary>
     <span className={styles.customerAlias}>{row.alias}</span>
     <span className={styles.customerFacts}>{hasEvaluation?'발견':'전체 기간'} {row.discoveryCalls}통화{hasEvaluation?' · 평가 '+row.verificationCalls+'통화':''}
       <small>저QoE 관측 {row.poorDates}일 · Drop {row.dropCalls}통화</small>
     </span>
     <span className={styles.customerRepeat}>{row.calls.length>1?'저QoE 2건 이상':'저QoE 1건'}</span>
     <ChevronDown size={14}/>
    </summary>
    <div className={styles.customerDetails}>
     {row.calls.map(call=><div key={call.callId} className={styles.customerCall}>
      <b>{call.date.slice(5)} {call.start}</b>
      <span>QoE {call.mos===null?'미평가':call.mos.toFixed(2)}</span>
      <span>{call.drop?'SIP Drop':call.sip==='normal'?'정상 종료':'종료 사유 기타/미확인'}</span>
      <small>{call.isDiscovery?'선정 근거':call.isVerification?'검증일 관측':'관련 관측'} · {call.kind==='gnss'?'GPS 실측':call.kind==='reviewed-radio'?'검토 통과 삼각 측량':'위치 미확인'}</small>
     </div>)}
    </div>
   </details>)}
   {!rows.length&&<p className={styles.empty}>선택 후보에 연결된 저QoE 고객별 원본 자료가 없습니다.</p>}
  </div>
  <p className={styles.evidenceNotice}>{hasEvaluation?'표는 후보 구성 통화와 별도 후속 평가일 관측을 표시합니다.':'표는 선택한 전체 기간의 후보 구성 통화를 표시합니다. 별도 평가일은 분리하지 않았습니다.'} 정상/미평가 통화까지 조사하려면 아래 ‘이 지역 통화 목록’을 이용하세요.</p>
 </div>;
}
