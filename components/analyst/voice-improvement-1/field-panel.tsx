'use client';
import type { ImprovementScope } from '../../../lib/analyst/voice-improvement-1/types';
import { scanComparisonEligibility } from '../../../lib/analyst/voice-improvement-1/field-evidence';
import styles from './workspace.module.css';
export function FieldPanel({scope}:{scope:ImprovementScope}){
 const scan=scanComparisonEligibility(null,scope);
 return <section className={styles.panel} aria-label="현장 자료와 SCAN 확인 상태"><div className={styles.panelHeading}><div><span className={styles.eyebrow}>다음 확인 단계</span><h2>현장 검증 자료</h2><p>관측 사실과 원인 가설을 구분합니다.</p></div></div><div className={styles.evidenceGrid}><div className={styles.evidenceItem}><h3>현장 자료 미확보</h3><p>현장 녹음 · 측정 QoE · RF 자료가 제공되지 않았습니다. 확보 후 동일 측정 자료임을 확인해 연결합니다.</p></div><div className={styles.evidenceItem}><h3>SCAN · 자료 미확보</h3><p>{scan.eligible?'같은 조건의 비교 가능':'비교 조건 미충족'} · 기간, 지역, 모집단, 지표 정의를 확인할 자료가 필요합니다.</p></div></div><p className={styles.note}>통화 QoE는 열화 순간의 좌표나 불량 원인을 확정하지 않습니다. 실제 외곽·희소 지역 자료와 현장 확인은 별도 확보가 필요합니다.</p></section>;
}
