'use client';
import type { ImprovementReport } from '../../../lib/analyst/voice-improvement-1/types';
import styles from './workspace.module.css';
export function ComparisonPanel({report}:{report:ImprovementReport}){
 const before=report.baselineSpatialCandidates,after=report.improvedSpatialCandidates;
 const beforeCalls=new Set(before.flatMap(c=>c.memberCallIds)),afterCalls=new Set(after.flatMap(c=>c.memberCallIds));
 const removed=[...beforeCalls].filter(id=>!afterCalls.has(id)).length,added=[...afterCalls].filter(id=>!beforeCalls.has(id)).length;
 return <section className={styles.panel} aria-label="같은 조건의 후보 산정 비교"><div className={styles.panelHeading}><div><span className={styles.eyebrow}>동일 조건 재산정 비교</span><h2>현행 후보 산정 방식과 비교</h2><p>같은 원본·기간·시간창·발견/검증 분할</p></div></div><div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>비교 항목</th><th>현행 호환 산정</th><th>개선 방식</th></tr></thead><tbody><tr><td>전체 CDR / 유효 QoE</td><td colSpan={2}>{report.coverage.N.toLocaleString()} / {report.coverage.M.toLocaleString()}통화 · 공통 모집단</td></tr><tr><td>지역 조사 후보</td><td>{before.length}곳</td><td>{after.length}곳</td></tr><tr><td>발견 구성 통화 (중복 제거)</td><td>{beforeCalls.size}통화</td><td>{afterCalls.size}통화</td></tr><tr><td>구성원 변화</td><td colSpan={2}>추가 {added}통화 · 제외 {removed}통화</td></tr><tr><td>위치 입력</td><td>현행 GPS 정책</td><td>GPS 우선 + 엄격 검토 통과 삼각 측량</td></tr><tr><td>BYE 단독 / 미검토 추정</td><td colSpan={2}>지역 후보 입력에서 제외 · 고객 상세 기지국 참고</td></tr></tbody></table></div>
 <details className={styles.disclosure}><summary>후보별 조사 순위와 구성 변화</summary><table className={styles.table}><thead><tr><th>개선 조사 순위</th><th>구성 통화가 가장 많이 겹치는 현행 후보</th><th>공통 통화</th></tr></thead><tbody>{after.map(c=>{const match=before.map(b=>({candidate:b,overlap:b.memberCallIds.filter(id=>c.memberCallIds.includes(id)).length})).sort((a,b)=>b.overlap-a.overlap)[0];return <tr key={c.id}><td>{c.rank??'미부여'}순위</td><td>{match?.overlap?`${match.candidate.rank??'미부여'}순위`:'대응 후보 없음'}</td><td>{match?.overlap??0}통화</td></tr>;})}</tbody></table></details>
 {report.publicationReference&&<p className={styles.note}>게시 기준선은 산출물에 기록된 일치 조건에서만 참고합니다. 공간 후보와 Cell 참고 후보는 별개입니다.</p>}
 <p className={styles.note}>후보 수 감소를 품질 향상률로 해석하지 않습니다. 위치 채택 근거와 구성 통화 변화를 확인하세요.</p></section>;
}
