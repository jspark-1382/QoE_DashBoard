'use client';

import {useEffect, useState} from 'react';
import {Activity, AudioLines, ClipboardCheck, Database, MapPinned, ShieldCheck, Users} from 'lucide-react';
import type {QualityImprovementMetrics} from '../../lib/analyst/quality-improvement-adapter';
import type {QualityCandidateScope,QualityCandidateSummary,QualityCandidateDetail} from '../../lib/analyst/quality-improvement-candidates';
import {validateImprovementReport,type ImprovementCandidateReport} from '../../lib/analyst/improvement-candidates';
import {compareCandidateLocations} from '../../lib/analyst/quality-improvement-two-comparison';
import {classifySipReason11} from '../../lib/analyst/sip-reason';
import {fourthMaskedCustomer} from '../../lib/analyst/quality-proposal-four';
import styles from './quality-improvement-two.module.css';

const n=(v:number)=>v.toLocaleString('ko-KR');
const pct=(a:number,b:number)=>b>0?(100*a/b).toFixed(2)+'%':'—';
const historicUrl='/qoe/improvement-candidates/2026-10-26_2026-10-30.json';
const completePeriod=(scope:QualityCandidateScope)=>scope.dateStart==='2026-10-26'&&scope.dateEnd==='2026-10-30'&&scope.from==='00:00'&&scope.to==='23:59';

export function QualityTwoHeader({candidate=false,reviewMode=false,onReviewModeChange}:{candidate?:boolean;reviewMode?:boolean;onReviewModeChange?:(value:boolean)=>void}){
 if(candidate)return <section className={styles.compactCandidateHeader} aria-label="개선 2안 분석 안내">
  <div className={styles.candidateHeaderTitle}>
   <span className={styles.eyebrow}>QoE · 개선 2안</span>
   <strong>저품질 조사 후보</strong>
   <small>원본 RTCP QoE(v5) · GPS/삼각 측량 근거 · 현장 원인 미확정</small>
  </div>
  <nav aria-label="개선 2안 섹션 이동">
   <a href="#quality-two-primary">후보 지도</a>
   <a href="#quality-two-evidence">선정 근거</a>
   <a href="#quality-two-field">현장 검증</a>
   <button type="button" className={styles.reviewToggle} aria-pressed={reviewMode} onClick={()=>onReviewModeChange?.(!reviewMode)}>{reviewMode?'보고 강조 끄기':'본부장 요구 강조'}</button>
  </nav>
 </section>;
 return <section className={styles.hero} aria-label="개선 2안 분석 안내">
  <div><span className={styles.eyebrow}>본부장 보고 피드백 기반 · 개선 2안</span>
    <h1>{candidate?'저품질 개선 후보 · 근거 중심 조사':'음성 체감품질 · 데이터 활용 현황'}</h1>
    <p>현재 원본 RTCP QoE(v5)와 검토된 위치 근거로 분석합니다. 원인 확정·QoE 열화 순간 위치·현장 검증을 추정 결과로 대체하지 않습니다.</p>
    <p className={styles.redBorderGuide}>지도에서 후보 지역을 선택하면 오른쪽에 선정 이유와 관련 고객의 실제 통화 근거가 나타납니다. 현장 검증되지 않은 항목은 ‘미검증’으로 구분합니다.</p>
  </div>
  <nav aria-label="개선 2안 섹션 이동">
    <a href="#quality-two-primary">{candidate?'개선 후보 지도':'품질 지표'}</a>
    <a href="#quality-two-evidence">{candidate?'선정 기준·전후 비교':'수집·활용률'}</a>
    <a href="#quality-two-field">현장 검증·로드맵</a>
    <button type="button" className={styles.reviewToggle} aria-pressed={reviewMode} onClick={()=>onReviewModeChange?.(!reviewMode)}>{reviewMode?'보고 강조 끄기':'본부장 요구 강조'}</button>
  </nav>
 </section>;
}

export function QualityTwoCoverage({metrics}:{metrics:QualityImprovementMetrics}){
 const c=metrics.coverage, audited=metrics.evidenceStatus==='complete';
 const levels=[
  {key:'N',label:'전체 SIP CDR 통화',value:c.N,base:c.N,note:'선택 기간·시간·고객의 고유 통화'},
  {key:'M',label:'유효 RTCP QoE(v5)',value:c.M,base:c.N,note:'QoE 1~5 평가 가능'},
  {key:'D',label:'MDT 고유 연결',value:c.D,base:c.M,note:'MDT 중복/모호 연결 제외'},
  {key:'G',label:'GPS 실측 채택',value:c.G,base:c.D,note:'MDT 연결 후 승인된 위치'},
  {key:'T',label:'엄격 삼각 측량 채택',value:c.T,base:c.D,note:'GPS와 병렬 분기, 검토 통과만'},
  {key:'U',label:'위치 활용 가능 통화',value:c.U,base:c.N,note:'GPS + 엄격 삼각 측량, 전체 CDR 대비'},
 ] as const;
 return <section id="quality-two-evidence" className={styles.panel+' '+styles.reportMarked} data-request-label="본부장 요구 · 데이터 수집률" aria-label="개선 2안 단계별 데이터 활용률">
  <header className={styles.panelTitle}><Database size={19}/><div><h2>데이터 수집·위치 활용률 검산</h2><p>기간·시간·고객 모집단 동일 · 원본 CDR 기준 통화 단위 집계</p></div><span className={audited?styles.statusOk:styles.statusPending}>{audited?'근거 감사 완료':'근거 '+({partial:'부분 확보',unavailable:'미확보','revision-mismatch':'버전 불일치',complete:'완료'}[metrics.evidenceStatus])}</span></header>
  <div className={styles.coverageRows}>
    {levels.map((stage,index)=><div key={stage.key} className={styles.coverageRow}>
      <span className={styles.stageIndex}>{index+1}</span>
      <div className={styles.coverageLabel}><b>{stage.label}</b><small>{stage.note}</small></div>
      <b className={styles.coverageValue}>{!audited&&index>=2?'미확인':n(stage.value)+'건'}</b>
      <span className={styles.coveragePercent}>{!audited&&index>=2?'—':pct(stage.value,stage.base)}</span>
      <div className={styles.track} aria-hidden="true"><span style={{width:(!audited&&index>=2?0:stage.base>0?100*stage.value/stage.base:0)+'%'}}/></div>
    </div>)}
  </div>
  <div className={styles.basis}>
   <span><b>저품질 QoE &lt; 3.0:</b> 전체 {n(c.poor.N)}건 / MDT 연결 {audited?n(c.poor.D)+'건':'미확인'} / 활용 가능 {audited?n(c.poor.U)+'건':'미확인'}</span>
   <span>모호한 MDT 연결 {n(c.mdtAmbiguous)}건 · 연결 미확인 {n(c.mdtUnknown)}건</span>
   <span>GPS와 엄격 검토 통과 삼각 측량은 병렬이며, <b>U = G + T</b>로 중복 계산하지 않습니다.</span>
  </div>
  {!audited&&<p className={styles.warning}>근거 자료가 불완전합니다. 아직 확인되지 않은 통화를 실제 위치 미확보 또는 연결 실패로 단정하지 않습니다.</p>}
 </section>;
}

export function QualityTwoCandidateAudit({scope,summary,onSelectCandidate}:{scope:QualityCandidateScope;summary:QualityCandidateSummary;onSelectCandidate?:(id:string)=>void}){
 const eligible=completePeriod(scope);
 const [historic,setHistoric]=useState<{value:ImprovementCandidateReport|null;error:string;loading:boolean}>({value:null,error:'',loading:eligible});
 useEffect(()=>{
  if(!eligible)return;
  const abort=new AbortController();
  fetch(historicUrl,{signal:abort.signal,cache:'no-cache'})
    .then(r=>{if(!r.ok)throw new Error('기존 후보 자료 미확보');return r.json() as Promise<ImprovementCandidateReport>;})
    .then(value=>{if(!abort.signal.aborted)setHistoric({value,error:'',loading:false});})
    .catch(()=>{if(!abort.signal.aborted)setHistoric({value:null,error:'기존 후보 산출물 확인 불가',loading:false});});
  return ()=>abort.abort();
 },[eligible]);
 const legacy=eligible&&historic.value&&validateImprovementReport(historic.value,scope.sourceRevision)?historic.value:null;
 const locations=legacy?compareCandidateLocations(legacy,summary):[];
 return <section className={styles.panel+' '+styles.reportMarked} data-request-label="본부장 요구 · 후보 선정 검증" id="quality-two-evidence" aria-label="개선 2안 후보 선정 근거와 전후 비교">
   <header className={styles.panelTitle}><MapPinned size={19}/><div><h2>후보 산정 기준 및 변경 전후 비교</h2><p>Rule-based 클러스터 분석 · 현장 원인 확정 아님</p></div></header>
   <div className={styles.compareGrid}>
    <div className={styles.compareCard}><span>기존 분석 (위치 + Cell) · 동일 5일</span>
      <strong>{!eligible?'비교 조건 불일치':historic.loading?'불러오는 중':legacy?n(legacy.summary.candidateCount)+'건':'비교 불가'}</strong>
      <small>{legacy?('위치 '+n(legacy.summary.spatialCandidateCount)+'곳 · Cell '+n(legacy.summary.cellCandidateCount)+'개'):'동일 기간·원본 버전인 경우에만 비교'}</small></div>
    <div className={styles.compareCard}><span>개선 2안 · 엄격 위치 검토</span><strong>{n(summary.candidates.length)}곳</strong>
      <small>GPS 및 승인된 삼각 측량만 · Cell/BYE 단독 좌표 제외</small></div>
    <div className={styles.compareCard}><span>다른 고객 재관측</span>
      <strong>{n(summary.candidates.filter(c=>c.validationStatus==='reobserved').length)}곳</strong>
      <small>별도 검증일이 있을 때만 독립 재관측으로 구분</small></div>
   </div>
   {locations.length>0&&<div className={styles.nearestTable}><h3>기존·신규 위치 후보 대조 (가장 가까운 중심점 참고)</h3><table><thead><tr><th>기존 위치 후보</th><th>가장 가까운 신규 후보</th><th>중심 간 거리</th><th>신규 조사 순위</th></tr></thead><tbody>{locations.map((row,i)=><tr key={row.legacyId}><td>기존 위치 후보 {i+1}</td><td>{row.nearestId?<button type="button" onClick={()=>onSelectCandidate?.(row.nearestId!)}>{summary.candidates.findIndex(c=>c.id===row.nearestId)>=0?'후보 지역 '+(summary.candidates.findIndex(c=>c.id===row.nearestId)+1):'확인 불가'}</button>:'해당 없음'}</td><td>{row.nearestDistanceM===null?'—':Math.round(row.nearestDistanceM).toLocaleString('ko-KR')+'m'}</td><td>{row.newRank}</td></tr>)}</tbody></table><p>가장 가까운 좌표만 참고 매칭합니다. 동일 군집·동일 원인 또는 검증된 위치 정확도는 아닙니다. 기존 Cell 후보 2개는 기지국 참고점으로 분리되어 지역 후보와 위치 일치 판정에 사용하지 않습니다.</p></div>}
   {historic.error&&eligible&&<p className={styles.warning}>{historic.error}</p>}
   <p className={styles.warning}>후보 수의 차이는 위치 입력·필터·군집 정책을 함께 바꾼 결과입니다. 같은 지역이 좋아지거나 나빠졌다는 효과로 해석할 수 없습니다. 후보 간 일대일 매칭·과대 군집 검증 결과는 별도 검증이 필요합니다.</p>
   <div className={styles.policyGrid}>
    <div><b>선정 기준</b><span>DBSCAN 이웃거리 100m · 고유 저QoE 고객 3명 이상 · 관측일 2일 이상 · 최소 2통화</span></div>
    <div><b>반경의 의미</b><span>100m는 DBSCAN 이웃거리이고, 약 1km 언급 값과 동일한 위치오차/클러스터 전체 반경이 아닙니다.</span></div>
    <div><b>위치 검토</b><span>GPS 실측 + 근거 재현을 통과한 삼각 측량. 기지국 BYE/삼각 측량 근사 좌표는 현장 참고용입니다.</span></div>
    <div><b>별도 검증 필요</b><span>강원도 등 저밀도 외곽·산발 불량·연결 사슬·후보 병합/분리 및 SCAN 비교 미완료</span></div>
   </div>
 </section>;
}

export function QualityTwoCandidateCustomers({detail}:{detail:QualityCandidateDetail}){
 const members=new Set(detail.candidate.memberCallIds);
 const calls=detail.calls.filter(c=>members.has(c.callId)||detail.candidate.nearbyPoints.some(p=>p.callId===c.callId&&p.role.startsWith('validation')));
 const byCustomer=new Map<string,typeof calls>();
 for(const call of calls){if(!byCustomer.has(call.customerId))byCustomer.set(call.customerId,[]);byCustomer.get(call.customerId)!.push(call);}
 const sorted=[...byCustomer.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
 return <section className={styles.customerProof+' '+styles.reportMarked} data-request-label="본부장 요구 · 고객별 반복 불량" aria-label="후보별 고객 통화 및 반복 검증">
  <h3><Users size={16}/> 후보 고객별 통화 증거</h3>
  <p>고객 A/B/C는 원본 고객 ID를 익명 그룹으로 나눈 표시입니다. 발견 구성 통화와 별도 검증 통화를 구분합니다.</p>
  <div className={styles.customerList}>{sorted.slice(0,15).map(([customer,records],i)=>{
   const poor=records.filter(c=>typeof c.mos==='number'&&c.mos<3);
   return <details key={customer}><summary><b>고객 {String.fromCharCode(65+i)} · {fourthMaskedCustomer(customer)}</b><span>저QoE {poor.length}통화 · 관측 {new Set(poor.map(c=>c.date)).size}일</span></summary>
    <div className={styles.customerCalls}>{records.map(c=><div key={c.callId}>
      <span>{c.date} · {members.has(c.callId)?'발견 구성':'별도 검증'}</span>
      <b>QoE {c.mos==null?'미평가':c.mos.toFixed(2)}</b>
      <span>SIP {classifySipReason11(c.sipReason)==='drop'?'Drop':classifySipReason11(c.sipReason)==='normal'?'Normal':'기타/미확인'}</span>
     </div>)}</div>
   </details>;
  })}</div>
  {sorted.length>15&&<p>추가 고객 {sorted.length-15}명은 아래 관련 고객 전체 통화 조사에서 확인할 수 있습니다.</p>}
  <p className={styles.minor}>개별 통화의 QoE는 전체 Call 단위 원본 값입니다. 연속 불량/열화 시점은 별도 시간 단위 관측 없이 확정하지 않습니다.</p>
 </section>;
}

const verificationRows=[
 {name:'개포동 현장 실제 음성 및 QoE·RF',status:'자료 미확보',detail:'원본 녹음·실측 QoE·RSRP/SINR을 같은 통화/지역/시각에 매칭한 뒤 증거로 제시'},
 {name:'연구소 SCAN과 동일 조건 비교',status:'미검증',detail:'기간·지역·모집단·절단/QoE 분석 범위가 같은 자료 확보 필요'},
 {name:'저밀도 외곽 지역 클러스터 시험',status:'미검증',detail:'강원도 등 희소 지역의 병합·분리·연결 사슬·과대 권역 검증'},
 {name:'음성 실제 열화 시점',status:'원본 한계',detail:'통화당 QoE 1개. 10/30초 QoE 원본 및 MDT 정렬 없이는 열화 구간 확정 불가'},
];
const roadmap=[
 ['단기 · 코드/데이터','후보 전후 비교, 수집률 검증, 고객 이력, 위치 근거 구분','현재 자료로 일부 구현 · 현장/외곽 검증은 별도 확보'],
 ['중기 · 위치 확보 확대','단말 GPS 제약, 내부 위치 시스템·외부 데이터 검토','동의·개인정보·법률 검토 및 추가 확보율·비용 미산정'],
 ['중장기 · 세분화 QoE','10초/30초 QoE, MDT 시간 동기화','데이터 원천·개발비·부하·저장량·기간 미산정'],
 ['시스템 적용','NQI·WING 기능 범위, 데이터 보관·격자 집계','연계 일정·예산 미확정'],
];
export function QualityTwoFieldRoadmap(){
 return <section id="quality-two-field" className={styles.field} aria-label="개선 2안 현장 검증 및 개발 로드맵">
  <div className={styles.panel+' '+styles.reportMarked} data-request-label="본부장 요구 · 현장 검증"><header className={styles.panelTitle}><ClipboardCheck size={19}/><div><h2>현장 검증 · 보고 증거</h2><p>실제 확인 자료를 확보하기 전에는 검증 완료로 표시하지 않습니다.</p></div></header>
   <div className={styles.reviewRows}>{verificationRows.map(row=><div key={row.name}><b>{row.name}</b><span className={styles.statusPending}>{row.status}</span><p>{row.detail}</p></div>)}</div>
   <p className={styles.minor}><AudioLines size={14}/> 실제 불량 음성 재생은 사용 권한과 검증된 녹음 파일이 확보된 경우에만 추가합니다. 임의 음성을 증거로 생성하지 않습니다.</p>
  </div>
  <div className={styles.panel+' '+styles.reportMarked} data-request-label="본부장 요구 · 고도화 로드맵"><header className={styles.panelTitle}><ShieldCheck size={19}/><div><h2>단계별 고도화 로드맵</h2><p>단기 구현과 추가 데이터/투자 과제 구분 · 확정 일정·예산 없음</p></div></header>
   <div className={styles.roadmap}>{roadmap.map(row=><div key={row[0]}><b>{row[0]}</b><strong>{row[1]}</strong><p>{row[2]}</p></div>)}</div>
   <p className={styles.minor}><Activity size={14}/> 분석 방식은 현재 Rule-based입니다. AI 기반 원인 추론·원인 확정으로 표시하지 않습니다.</p>
  </div>
 </section>;
}
