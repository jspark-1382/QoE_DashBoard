'use client';
import type {CandidateDisplayMode} from '../../lib/analyst/quality-candidate-visibility';
import type {CandidateTopTenState} from '../../lib/analyst/candidate-top-ten';
import styles from './candidate-visibility-toggle.module.css';

export function CandidateVisibilityToggle({mode,coreCount,totalCount,minimumDays,topTenCount,topTenStatus,onChange}:{
 mode:CandidateDisplayMode;coreCount:number;totalCount:number;minimumDays:number;
 topTenCount?:number;topTenStatus?:CandidateTopTenState['status'];
 onChange:(mode:CandidateDisplayMode)=>void;
}){
 return <fieldset className={styles.toggle} aria-label="개선후보 표시 기준">
  <button type="button" aria-pressed={mode==='core'} title={`핵심 후보: 저QoE 통화 6건 이상 · 서로 다른 고객 3명 이상 · 관측 ${minimumDays}일 이상`} onClick={()=>onChange('core')}>핵심 {coreCount}</button>
  <button type="button" aria-pressed={mode==='top10'} aria-busy={topTenStatus==='loading'}
   title="고객현황 TOP10 고객의 구성 통화가 있거나 대표 위치가 후보 원 안인 지역 · 미포함 고객도 지도에 표시"
   onClick={()=>onChange('top10')}>고객현황 TOP10{topTenStatus==='ready'?' '+(topTenCount??0):topTenStatus==='loading'?' · 확인 중':topTenStatus==='error'?' · 미확인':''}</button>
  <button type="button" aria-pressed={mode==='all'} title="최소 군집 조건을 통과한 모든 후보 표시 · 숨긴 후보를 복구합니다" onClick={()=>onChange('all')}>전체 {totalCount}</button>
 </fieldset>;
}
