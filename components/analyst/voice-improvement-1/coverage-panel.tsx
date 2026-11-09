'use client';
import { useState } from 'react';
import type { CoverageSummary } from '../../../lib/analyst/voice-improvement-1/types';
import styles from './workspace.module.css';
const count=(n:number)=>n.toLocaleString('ko-KR');
const rate=(n:number,d:number)=>d?`${(100*n/d).toFixed(1)}%`:'산출 불가';
export function CoveragePanel({coverage}:{coverage:CoverageSummary}){
 const [poor,setPoor]=useState(false);const data=poor?coverage.poor:coverage;
 // branchGNSS and strictRadio are parallel unique-call branches; union U is not their raw sum.
 const branchGNSS=data.G,strictRadio=data.T;
 return <section className={styles.panel} aria-label="위치 근거 확보율"><div className={styles.coverageHeader}><div className={styles.panelHeading}><div><span className={styles.eyebrow}>분석 가능한 통화</span><h2>얼마나 분석할 수 있나요?</h2><p>고유 통화 수 · {poor?'저QoE (1 ≤ QoE < 3)':'선택 기간 전체 CDR'} 기준</p></div></div><div className={styles.toggle} aria-label="퍼널 모집단"><button type="button" aria-pressed={!poor} onClick={()=>setPoor(false)}>전체 통화</button><button type="button" aria-pressed={poor} onClick={()=>setPoor(true)}>저QoE</button></div></div>
 <div className={styles.funnel}><div className={styles.metric}><span>N · 전체 CDR</span><strong>{count(data.N)}</strong><small>분모: 선택 기간 {poor?'저QoE':'전체'} 통화</small></div><span className={styles.arrow}>›</span><div className={styles.metric}><span>M · 유효 QoE</span><strong>{count(data.M)}</strong><small>분모 N · {rate(data.M,data.N)}</small></div><span className={styles.arrow}>›</span><div className={styles.metric}><span>D · MDT 연결</span><strong>{count(data.D)}</strong><small>분모 M · {rate(data.D,data.M)}</small></div><span className={styles.arrow}>›</span><div className={styles.branches}><div className={styles.metric}><span>● G · GPS</span><strong>{count(branchGNSS)}</strong><small>분모 D · {rate(branchGNSS,data.D)}</small></div><div className={styles.metric}><span>◆ T · 검토 통과 삼각 측량</span><strong>{count(strictRadio)}</strong><small>분모 D · {rate(strictRadio,data.D)}</small></div></div><span className={styles.arrow}>›</span><div className={`${styles.metric} ${styles.metricFinal}`}><span>U · 위치 활용 가능</span><strong>{count(data.U)}</strong><small>분모 N · {rate(data.U,data.N)} · G ∪ T</small></div></div>
 <p className={styles.note}>G/T는 통화별 대표 위치 채택 수이며 중복되지 않습니다. 원시 위치 근거의 확보량과 다를 수 있으며 GPS를 우선 채택합니다. 시간대·고객 상세 선택은 이 분모를 바꾸지 않습니다.</p>
 <details className={styles.disclosure}><summary>채택·제외 내역과 분모 확인</summary><p>MDT 연결 모호 {count(coverage.mdtAmbiguous)}통화 · 연결 확인 불가 {count(coverage.mdtUnknown)}통화</p><div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>위치 제외 사유 (중복 가능)</th><th>통화 수</th></tr></thead><tbody>{Object.entries(coverage.excludedReasons).map(([reason,n])=><tr key={reason}><td>{reason}</td><td>{count(n)}</td></tr>)}</tbody></table></div></details>
 </section>;
}
