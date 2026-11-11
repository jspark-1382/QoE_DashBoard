'use client';
import type {CandidateDisplayMode} from '../../lib/analyst/quality-candidate-visibility';
import styles from './candidate-visibility-toggle.module.css';

export function CandidateVisibilityToggle({mode,coreCount,totalCount,minimumDays,onChange}:{
 mode:CandidateDisplayMode;coreCount:number;totalCount:number;minimumDays:number;
 onChange:(mode:CandidateDisplayMode)=>void;
}){
 return <div className={styles.toggle} role="group" aria-label="개선후보 표시 기준">
  <button type="button" aria-pressed={mode==='core'} title={`핵심 후보: 저QoE 통화 6건 이상 · 서로 다른 고객 3명 이상 · 관측 ${minimumDays}일 이상`} onClick={()=>onChange('core')}>핵심 {coreCount}</button>
  <button type="button" aria-pressed={mode==='all'} title="최소 군집 조건을 통과한 모든 후보 표시 · 숨긴 후보를 복구합니다" onClick={()=>onChange('all')}>전체 {totalCount}</button>
 </div>;
}
