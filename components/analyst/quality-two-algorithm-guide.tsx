'use client';
import {BookOpen,CheckCircle2,Info,MapPinned,SlidersHorizontal,Database,Filter,ScanSearch,Map as MapIcon,Users,AlertTriangle,Layers} from 'lucide-react';
import type {QualityCandidateSummary,QualityCandidateCard,QualityCandidateDetail} from '../../lib/analyst/quality-improvement-candidates';
import {candidateTitle,candidateEvidenceSummary,candidateStatus} from '../../lib/analyst/quality-two-candidate-view-model';
import styles from './quality-two-algorithm-guide.module.css';
import {QualityTwoSimulator} from './quality-two-simulator';
import {QualityTwoRealGeometry} from './quality-two-real-geometry';

type Props={summary:QualityCandidateSummary;selectedCard?:QualityCandidateCard;selectedDetail:QualityCandidateDetail|null;selectedIndex:number;view?:'all'|'explanation'|'simulator'|'criteria'};
const n=(value:number)=>value.toLocaleString('ko-KR');
const dates=(values:string[])=>values.length?values.join(', '):'별도 없음';
const E=({children}:{children:React.ReactNode})=><em className={styles.em}>{children}</em>;

export function QualityTwoAlgorithmGuide({summary,selectedCard,selectedDetail,selectedIndex,view='all'}:Props){
 const mixed=summary.locationMode==='gps-mdt-rough-unvalidated-v1';
 const card=selectedCard;
 const validDetail=card?.id===selectedDetail?.candidate.id?selectedDetail:null;
 const r=validDetail?candidateEvidenceSummary(validDetail):null;
 const range=validDetail?.candidate.maxPairDistanceM;
 const maxCenter=validDetail?.candidate.maxCenterDistanceM;
 const status=card?candidateStatus(card):null;
 return <aside className={styles.guide} aria-label="개선 후보 알고리즘 설명">
  {(view==='all'||view==='explanation')&&<div className={styles.stickyTitle}>
   <span className={styles.kicker}><BookOpen size={14}/> 처음부터 이해하는 산정 과정</span>
   <h3>개선 후보는 어떻게 만들어지나요?</h3>
   <p>상단 조건 선택부터 GPS·MDT 위치의 개선 후보 산정, 날짜별 재관측, 지도 표기까지 실제 코드 기준으로 설명합니다. MDT 위치 정확도 검증은 후속 과제입니다.</p>
   <p className={styles.scrollCue}>시뮬레이터 탭은 가상 연습용입니다. 단계 버튼과 슬라이더로 그림의 변화를 확인하세요. 실제 후보 데이터와는 분리됩니다.</p>
   <div className={styles.miniFlow} aria-label="알고리즘 요약 흐름">
    <span>조건</span><b>›</b><span>저QoE</span><b>›</b><span>위치</span><b>›</b><span>군집</span><b>›</b><span>검증</span>
   </div>
  </div>}
  <div className={styles.articles}>
   {(view==='all'||view==='simulator')&&<QualityTwoSimulator summary={summary}/>}
   {(view==='all'||view==='explanation'||view==='criteria')&&<details className={styles.referenceToggle}>
    <summary>계산 규칙 · 단계별 상세 설명 펼치기</summary>
    <div className={styles.referenceBody}>
   <section className={styles.step}>
    <h4><span className={styles.stepNum}>01</span><SlidersHorizontal size={15}/> 먼저 무엇을 선택하나요?</h4>
    <p>상단 <E>개선 2안</E>에서 시작일·종료일, 시작 시간·종료 시간을 정한 뒤 <E>개선 후보 분석</E>을 누릅니다. 고객을 한 명으로 제한한 분석이 아니라 전체 고객 기준으로 미리 계산된 조건을 불러옵니다.</p>
    <div className={styles.actual}>
     <b>지금 조회 중인 조건</b>
     <dl><div><dt>분석 기간</dt><dd>{summary.scope.dateStart} ~ {summary.scope.dateEnd}</dd></div>
      <div><dt>시간 범위</dt><dd>{summary.scope.from} ~ {summary.scope.to}</dd></div>
      <div><dt>기준 데이터</dt><dd>MDT 연계 SIP CDR + RTCP QoE(v5)</dd></div>
      <div><dt>위치 정책</dt><dd>{mixed?'GPS + MDT RSRP 가중중심 근사 (위치 검증 전)':'GPS + 검토 통과 삼각 측량'}</dd></div></dl>
    </div>
    <p className={styles.note}><Info size={13}/> 상단 조건을 바꾸면 일치하는 사전 산출 후보를 읽습니다. 후보 지역을 클릭하는 행위는 알고리즘 재학습·새 계산을 뜻하지 않습니다.</p>
   </section>

   <section className={styles.step}>
    <h4><span className={styles.stepNum}>02</span><Database size={15}/> 어떤 원본 통화를 사용하나요?</h4>
    <p>날짜·시간 범위에 있는 <E>SIP CDR 통화</E>를 기준으로 RTCP QoE(v5)를 연결합니다. 고객 ID와 원본 통화 ID는 구분해서 보존하며, 날짜가 같다는 이유만으로 다른 고객 통화를 합치지 않습니다.</p>
    <div className={styles.rule}><b>저품질 판정</b><strong>1.0 ≤ QoE(v5) &lt; 3.0</strong><span>QoE 3.0 이상은 후보 구성 저품질 통화가 아니며, QoE 누락·무효도 제외합니다.</span></div>
    <p>예를 들어 고객 A의 10월 27일 통화 QoE가 <E>2.70</E>이면 저QoE 후보 입력이지만, QoE <E>3.60</E>이면 이 단계에서는 후보를 만드는 불량점이 아닙니다.</p>
   </section>

   <section className={styles.step}>
    <h4><span className={styles.stepNum}>03</span><Filter size={15}/> 모든 저QoE 위치를 표시하나요?</h4>
    <p>{mixed?'GPS 실측뿐 아니라 GPS가 없는 저QoE 통화의 MDT 다중 기지국 RSRP 근사 위치도 후보 군집에 넣습니다. 근사는 정확도가 검증되지 않아 탐색용이며 실제 단말 위치로 확정하지 않습니다.':'CDR↔MDT 고유 연결과 엄격 검토 위치를 사용합니다.'}</p>
    <div className={styles.compare}>
     <div className={styles.accept}><CheckCircle2 size={14}/><b>사용</b><span>{mixed?'GPS 실측 / MDT 다중 기지국 근사':'GPS 실측 / 승인된 삼각 측량'}</span></div>
     <div className={styles.reject}><AlertTriangle size={14}/><b>제외</b><span>유효 좌표 없는 통화 / 기지국 BYE Cell 위치 단독 / 증거 연결 모호</span></div>
    </div>
    <p className={styles.note}><Info size={13}/> 기지국 위치는 고객의 위치가 아닙니다. 채택한 점도 ‘음성이 저하된 정확한 순간의 좌표’라고 확정할 수 없습니다.</p>
   </section>

   <section className={styles.step}>
    <h4><span className={styles.stepNum}>04</span><ScanSearch size={15}/> 위치가 모이면 왜 지역 후보가 되나요?</h4>
    <p><E>DBSCAN</E>으로 지구 곡률을 반영한 Haversine 거리를 계산합니다. 기준 거리 <E>100m 이내 이웃</E>과 최소 2개 관측점을 출발점으로 연결된 군집을 만들고, 아래 조건을 다시 심사합니다.</p>
    <div className={styles.ruleGrid}>
     <div><b>100m</b><span>DBSCAN 이웃 거리 (eps)</span></div>
     <div><b>2점</b><span>군집 시작 최소 관측점</span></div>
     <div><b>3명↑</b><span>서로 다른 저QoE 고객</span></div>
     <div><b>2일↑</b><span>저QoE 관측 날짜</span></div>
    </div>
    <p><b>가상의 계산 예시:</b> A·B·C 고객의 저QoE 관측점이 같은 주변에서 발견되고 관측일이 2일 이상이면 후보가 될 수 있습니다. 반면 하루 동안 고객 한 명이 5통화를 했다면 고유 고객 3명 조건을 만족하지 못합니다.</p>
    <p className={styles.note}><Info size={13}/> 100m는 군집의 두 점 사이에서 이웃을 판단하는 거리이지, 지도에 그리는 모든 후보 원의 반경이나 GPS 오차 한계가 아닙니다. 연결 사슬로 군집이 커질 수도 있습니다.</p>
   </section>

   <section className={styles.step}>
    <h4><span className={styles.stepNum}>05</span><MapIcon size={15}/> 후보 원의 중심·반경·순위는?</h4>
    <p>군집 안의 각 실제 채택점에서 나머지 점까지 거리를 계산해 <E>가장 먼 점까지의 거리가 최소가 되는 실제 관측점</E>을 대표 중심으로 선택합니다. 지도 반경은 <code>max(100m, 중심에서 가장 먼 점 거리 + 20m)</code>를 10m 단위로 올림한 <E>표시용 후보 반경</E>입니다.</p>
    <div className={styles.rule}><b>범위 검토 조건</b><strong>군집 내 최대 점간 거리 &gt; 200m</strong><span>100m 이웃 거리의 2배 초과 시 범위 검토 필요. 원인 확정·개선 순위 부여를 보류합니다.</span></div>
    <p>후보 목록의 <E>후보 지역 1·2·3</E>은 화면 표기 순서입니다. 기본 정렬은 고객 수 → 관측일 → 통화 수 → GPS 통화 수 순이며, <E>범위 검토 후보는 개선 순위가 비어 있을 수 있습니다.</E></p>
   </section>

   <section className={styles.step}>
    <h4><span className={styles.stepNum}>06</span><Users size={15}/> 새 고객 재관측은 어떻게 검증하나요?</h4>
    <p>{summary.validationDates.length?'성능 검증 모드에서는 마지막 날을 빼고 후보를 생성하고 후속 평가일의 새 고객 저QoE 위치를 확인합니다.':'현재는 전체 기간 후보 분석 모드이므로 마지막 날까지 모두 후보 생성에 포함합니다. 별도 평가일을 만들지 않으며, 여러 날짜와 독립 고객의 반복 관측으로 개선 후보의 근거를 판단합니다.'}</p>
    <div className={styles.actual}>
     <b>{summary.validationDates.length?'현재 자료의 발견·평가 분리':'현재 전체 기간의 후보 산정 날짜'}</b>
     <dl><div><dt>{summary.validationDates.length?'후보 발견':'후보 산정'}</dt><dd>{dates(summary.discoveryDates)}</dd></div>
      <div><dt>후속 평가일</dt><dd>{dates(summary.validationDates)}</dd></div></dl>
    </div>
    <div className={styles.rule}><b>재관측 판단</b><strong>발견기간에 없던 고객 2명 이상</strong><span>검증일의 새 고객 저QoE가 후보 구성점 근처에 관측되면 ‘새 고객 재관측’으로 표시합니다. 같은 고객만 재관측되거나 1명뿐이면 해당 기준 미충족입니다.</span></div>
    <p className={styles.note}><Info size={13}/> 1~2일 분석이나 검증일이 분리되지 않은 조건에서는 이 독립 재관측을 주장할 수 없습니다. 재관측은 RF 원인 확인이나 현장 검증 완료와 다릅니다.</p>
   </section>

    </div>
   </details>}
   {(view==='all'||view==='explanation')&&<section className={styles.example} aria-label="현재 선택 후보 알고리즘 적용 예시" aria-live="polite">
    <div className={styles.exampleHeading}><MapPinned size={17}/><div><span>실제 데이터에 대입해 보기</span><h4>{card?candidateTitle(selectedIndex):'선택된 후보 없음'}</h4></div></div>
    {card?<div className={styles.exampleBody}>
      <div className={styles.exampleStats}>
       <div><b>{n(card.poorCustomerCount)}명</b><span>고유 저QoE 고객</span></div>
       <div><b>{n(card.poorCallCount)}건</b><span>후보 구성 저QoE 통화</span></div>
       <div><b>{n(card.poorDateCount)}일</b><span>발견기간 관측 날짜</span></div>
       <div><b>{summary.validationDates.length?n(card.validationNewCustomers)+'명':'미실시'}</b><span>후속 평가일 신규 고객</span></div>
      </div>
      <p>① 서로 다른 고객 {card.poorCustomerCount}명과 {card.poorDateCount}일을 확인하므로 고객 3명·2일 이상 조건에 {card.poorCustomerCount>=3&&card.poorDateCount>=2?'부합합니다.':'미달합니다.'}</p>
      <p>② 후보 대표 중심 ({card.medoid.lat.toFixed(5)}, {card.medoid.lon.toFixed(5)})에 <b>표시용 반경 {card.displayRadiusM}m</b> 원을 그립니다.</p>
      {validDetail&&<QualityTwoRealGeometry detail={validDetail}/>}
      {validDetail?<><p>③ 실제 후보 구성 근거: GPS {r?.gnss??0}통화, {mixed?'MDT 근사 '+(r?.rough??0)+'통화 (정확도 미검증)':'검토 통과 삼각 측량 '+(r?.radio??0)+'통화'}. 중심~최원거리 <b>{maxCenter?.toFixed(1)}m</b>, 두 구성점 간 최대거리 <b>{range?.toFixed(1)}m</b>입니다.</p>
       <p>④ {summary.validationDates.length?'평가일 새 고객 '+card.validationNewCustomers+'명 · '+(card.validationNewCustomers>=2?'재관측 충족':'재관측 기준 미충족'):'전체 기간을 사용했으며 별도 평가일은 적용하지 않았습니다.'} {card.rangeReviewRequired?'최대 점간 거리가 200m를 초과하므로 개선 순위를 보류합니다.':'최대 점간 거리는 200m 이하입니다.'}</p>
      </>:<p>③ 구성 GPS/MDT 위치와 실제 최대 점간 거리는 해당 후보 상세 데이터를 읽은 후 표시합니다.</p>}
      <div className={styles.statusRow}>결과: <strong>{status?.label??'확인 중'}</strong> · 개선 순위 <strong>{card.rank??'미확정'}</strong></div>
    </div>:<p>지도의 후보를 선택하면 해당 후보의 실제 수치로 계산 과정을 설명합니다.</p>}
    <p className={styles.exampleHelp}>오른쪽 지도의 후보를 클릭하면 이 예시도 함께 바뀝니다. 후보 순번은 개선 순위와 다릅니다.</p>
   </section>}

   {(view==='all'||view==='criteria')&&<details className={styles.referenceToggle}>
    <summary>후보를 현장에서 어떻게 해석하나요?</summary>
    <section className={styles.step}>
    <h4><span className={styles.stepNum}>07</span><Layers size={15}/> 마지막으로 무엇을 해석해야 하나요?</h4>
    <p>지도에는 <E>후보 중심과 표시 반경</E>, 원본 GPS 관측 및 {mixed?'검증 전 MDT RSRP 근사 위치':'승인된 삼각 측량 위치'}를 구별해 그립니다. 클릭하면 오른쪽 일반 화면의 후보 요약·고객별 원본 통화와 연결됩니다.</p>
    <div className={styles.conclusion}><b>실무 판단</b><span>후보 지역 = 현장 개선 대상으로 검토할 장소</span><span>재관측 = 다른 고객에게도 비슷한 관측이 있었음</span><span>범위 검토 = 연결 사슬·범위 과대 여부를 다시 확인해야 함</span><span>원인 확정 = 현재 결과만으로는 불가, 현장 RF·음성·SCAN 비교 필요</span></div>
   </section>
   </details>}
  </div>
  {(view==='all'||view==='simulator')&&<p className={styles.source}>체험 그림은 가상의 거리·고객이며 실제 후보를 수정하지 않습니다. 아래 ‘실제 데이터에 대입해 보기’는 선택한 후보 원본 자료만 사용합니다.</p>}
 </aside>;
}
