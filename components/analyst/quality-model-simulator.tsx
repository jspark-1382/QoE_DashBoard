'use client';
import {useEffect,useMemo,useState} from 'react';
import {ArrowLeft,ArrowRight,BookOpen,ChartNoAxesColumnIncreasing,Info,Play,Pause,RotateCcw,MapPinned} from 'lucide-react';
import type {AlternativeCandidate,AlternativeModelId,AlternativeModelReport} from '../../lib/analyst/quality-model-alternatives';
import {MODEL_EXPLANATIONS} from '../../lib/analyst/quality-model-alternatives';
import {learningStateKey,loadLearningBundle,
 type LearningManifest,type LearningBundle,type LearningCandidate,type LearningState
} from '../../lib/analyst/quality-model-education';
import styles from './quality-model-simulator.module.css';

const STEP_TITLES=['입력 관측','거리·가중치','핵심 수치','후보 형성','선정 기준','다른 날 검증','최종 비교'] as const;
type Model=AlternativeModelId;
const f=(v:number,d=1)=>Number.isFinite(v)?v.toLocaleString('ko-KR',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
const meta:Record<Model,Array<{title:string;story:string;detail:string}>>={
 hdbscan:[
  {title:'원본 위치를 먼저 준비합니다',story:'발견기간에 승인된 저QoE 위치 관측점만 입력합니다. 각 점은 고객의 한 통화이며 정상/주의 통화는 군집 입력에 사용하지 않습니다.',detail:'현재 예시는 서로 다른 고객·관측일의 점들을 여러 지역에 배치했습니다. 원본 지도와 무관한 가상 데이터입니다.'},
  {title:'점마다 핵심거리(core distance)',story:'각 관측점에서 min_samples번째(자기 자신 포함) 가까운 관측점까지의 거리를 구합니다. 밀집된 지역은 핵심거리가 작아집니다.',detail:'min_samples를 2→3으로 바꿔 각 점의 핵심거리가 어떻게 변하는지 확인하세요.'},
  {title:'상호 도달거리(MRD)',story:'두 점의 직접 거리와 각 점의 핵심거리 중 큰 값을 채택합니다. MRD(i,j)=max(core(i), core(j), distance(i,j)).',detail:'그림의 선은 MRD 가중 최소신장트리의 연결입니다. 트리만으로 최종 HDBSCAN 라벨이 결정되는 것은 아니고, 밀도 계층을 압축하여 안정 군집을 선정합니다.'},
  {title:'밀도 계층에서 군집을 선택',story:'HDBSCAN이 여러 밀도 수준의 연결과 분리를 검토하고 안정된 군집을 선택합니다. 노이즈 점은 후보에 포함되지 않습니다.',detail:'실제 scikit-learn HDBSCAN이 가상 위치를 계산한 라벨을 표시합니다. 단순 DBSCAN을 임계값만 바꾼 결과가 아닙니다.'},
  {title:'고객·관측일 조건 확인',story:'선택된 각 군집은 서로 다른 저QoE 고객 3명 이상과 관측일 2일 이상인지 다시 확인합니다.',detail:'min_cluster_size를 늘려 군집이 사라지거나 여러 지역이 합쳐지는 경우에도 독립 고객·날짜 조건은 유지됩니다.'},
  {title:'새 고객 독립 재관측',story:'군집을 만든 발견기간 관측점 중 어느 하나에서든 100m 이내로, 검증일 새 고객이 2명 이상 나타나는지 확인합니다.',detail:'검증일 V1~V3는 군집을 학습하거나 HDBSCAN을 재계산할 때 포함되지 않습니다.'},
  {title:'최종 후보와 표시 반경',story:'후보 대표점은 실제 구성점 중 최대 거리가 가장 작은 점(Minimax Medoid)입니다. 지도 반경은 max(100, 중심~최원거리+20)을 10m 단위 올림합니다.',detail:'밀도에 의해 선택된 군집과 지도에 그리는 원은 별개이며 원인은 확정되지 않습니다.'},
 ],
 st_dbscan:[
  {title:'공간과 발생 시간 입력',story:'승인된 저QoE 통화 위치와 발생 일자·시각을 함께 사용합니다. 정상 통화는 시공간 군집 입력에 사용하지 않습니다.',detail:'같은 지역에서 발생해도 다른 시각에 관측된 통화는 연결되지 않을 수 있습니다.'},
  {title:'공간 거리와 시간 차이',story:'두 점의 Haversine 거리(m)와 통화 시작 시각 차이(시간)를 각각 계산합니다.',detail:'공간 100m 이내여도 시간 임계값을 넘으면 이웃 관계가 아닙니다. 슬라이더를 조절해 보세요.'},
  {title:'두 조건을 모두 만족하는 이웃',story:'이웃 판정 = (거리 ≤ eps_m) AND (시간차 ≤ eps_hours). 둘 중 하나라도 실패하면 두 점 사이를 직접 연결하지 않습니다.',detail:'그림에서 선으로 표시되는 쌍은 두 조건을 동시에 충족한 관측점입니다.'},
  {title:'연결된 시공간 군집 만들기',story:'자기 자신을 포함한 최소 이웃 2점을 출발점으로 연결 관계를 확장하고 군집을 만듭니다.',detail:'시간 간격이 멀어진 장면에서 같은 공간 군집이 분리되거나 노이즈가 될 수 있습니다.'},
  {title:'독립 고객·2일 게이트',story:'위치와 시간으로 묶여도 고유 고객 3명 이상·서로 다른 관측 2일 이상이어야 조사 후보로 남습니다.',detail:'한 고객의 통화가 여러 건이어도 다른 고객 수가 증가하지 않습니다.'},
  {title:'마지막 검증일 분리',story:'실험용 검증일의 새로운 고객 통화를 군집에 넣지 않고, 발견 구성점과 100m 근접 여부만 검사합니다.',detail:'검증일 고객 2명이 통과해도 무선망 장애 원인을 확정하는 것은 아닙니다.'},
  {title:'시간 차이에 따라 바뀌는 후보',story:'시간과 거리 임계값이 바뀌면 군집 수·구성점과 표시 반경이 달라집니다.',detail:'시간 이웃 거리는 반복 장애 주기 전체를 반영하지 못하므로 장기간 반복성은 별도로 검토합니다.'},
 ],
 adaptive_kde:[
  {title:'저QoE 좌표와 위치 종류 입력',story:'승인된 저QoE 위치를 모읍니다. GPS와 검토 통과 삼각 측량을 구별하고 고객별 반복 통화에 대한 가중치를 적용합니다.',detail:'정상/주의 통화를 넣은 상대 위험 KDE가 아니라 저QoE 관측점의 밀도 탐색입니다.'},
  {title:'각 점에 가우시안 커널 적용',story:'GPS에는 기본 폭 70m, 삼각 측량에는 160m를 가정하고 배수를 곱합니다. 폭이 큰 점은 넓지만 낮은 분포를 만듭니다.',detail:'원은 위치 오차의 실제 확률구간이 아니라 밀도 평활화 가정입니다.'},
  {title:'커널 합으로 밀도 산출',story:'각 점에서 다른 저QoE 관측점들의 기여를 더합니다. 각 기여 = 고객 가중치×exp(−d²/(2h²))/(2πh²).',detail:'가상 관측점에서 계산된 상대 밀도값을 보여줍니다. 커널 폭을 바꾸면 값이 달라집니다.'},
  {title:'가장 높은 피크부터 후보 검색',story:'밀도가 가장 큰 관측점 순서로 살피고 해당 피크 주변 지정 거리 안의 아직 사용하지 않은 관측점을 모읍니다.',detail:'이 데모의 피크 탐색 과정은 현재 Python 산출 코드의 greedy 선택을 그대로 사용합니다. 일반적인 밀도 지도와 후보 목록은 다릅니다.'},
  {title:'고유 고객·2일 조건',story:'피크 주변에 모인 저QoE 통화가 서로 다른 고객 3명 이상과 2일 이상이면 후보로 남습니다.',detail:'피크 중심과 후보 원의 대표점은 다를 수 있습니다. 지도 원의 중심은 구성점 중 Minimax Medoid입니다.'},
  {title:'독립 검증일 고객 확인',story:'검증일 새 고객 관측점이 발견기간 후보 구성점에서 100m 이내인지 확인합니다.',detail:'피크 주변 검색 반경과 별도 검증일 100m 이웃 판단은 서로 다릅니다.'},
  {title:'밀도 후보 vs 위험률',story:'지도 원은 선택된 피크의 검색 반경(기본 180m)으로 표시합니다. 반경은 DBSCAN의 최종 170m 원과 계산 목적이 다릅니다.',detail:'커널 폭 70/160m는 측정으로 확인된 측위 오차가 아닙니다. 실제 망의 불량률을 이 결과로 구할 수 없습니다.'},
 ],
 spatial_scan:[
  {title:'저QoE와 정상/주의 관측 함께 입력',story:'발견기간 중 위치가 승인된 모든 QoE 평가 통화를 두 집단으로 나눕니다.',detail:'전체 CDR 중 위치 확보가 가능한 통화만 포함되므로, 승인 위치 표본의 비율이 실제 망 전체 불량률은 아닙니다.'},
  {title:'원형 검사 창 선택',story:'승인된 모든 위치를 중심 후보로 하여 반경 100·200·400m 원형 창을 검사합니다. 이 체험에서는 한 반경을 골라 비교합니다.',detail:'검사 창은 실제 후보 대표점이 아닌 검사 당시 중심을 기준으로 만들어집니다.'},
  {title:'창 안과 밖의 저QoE 비율',story:'선택 위치 창 안의 저QoE/전체와 바깥의 저QoE/전체를 나눠 계산합니다.',detail:'지역에 저QoE가 많이 모였다는 이유만으로 위험지역을 확정하지 않습니다. 정상/주의 통화도 비교해야 합니다.'},
  {title:'Bernoulli 로그우도비 + 순열',story:'창 안에서 저QoE가 더 많은 경우에만 로그우도비(LLR)를 계산합니다. 승인 표본 라벨을 99회 순열해 각 반복의 최대 LLR을 비교합니다.',detail:'원형 창을 미리 모든 위치에 등록한 뒤 순열의 최대값을 비교합니다. p값은 승인 위치 표본 내 조건부 탐색 수치입니다.'},
  {title:'독립 고객·관측일 심사',story:'LLR이 높은 후보 창에서도 저QoE 고객 3명·관측 2일 이상을 요구하고 서로 크게 겹치는 후보는 정리합니다.',detail:'조건부 순열 p값만으로 망 전체에 대한 통계적 유의성을 주장하지 않습니다.'},
  {title:'검증일 새 고객 재관측',story:'발견기간 후보 창 안의 저QoE 구성점과 100m 이내인 검증일 새 고객 2명을 확인합니다.',detail:'검증일은 창의 LLR과 p값 계산에 포함하지 않습니다.'},
  {title:'탐색용 후보로만 해석',story:'스캔 창 반경은 100/200/400m 중 하나이고, 지도 표시는 대표점 기준으로 그리므로 검사 창과 완전히 같지 않을 수 있습니다.',detail:'위치확보 편향이 큰 현재 데이터에서는 p값이 작아도 실제 통신망 전체의 저QoE 위험률·원인을 뜻하지 않습니다.'},
 ],
 bayesian:[
  {title:'승인 위치 통화 집합 선택',story:'발견기간의 저QoE와 정상/주의 위치 승인 통화로 위치 확보 표본의 기준 저QoE 비율을 계산합니다.',detail:'위치 미확보 통화가 많고 두 집단의 확보율이 달라, 표본 비율을 전체 망 불량률로 볼 수 없습니다.'},
  {title:'위치·시간별 영향도 부여',story:'거리에 따라 exp(−0.5×(d/폭)²), 날짜 차이에 따라 0.7^(날짜차)를 곱해 표본 가중치를 계산합니다.',detail:'공간 폭 200m는 측정 위치 오차가 아니라 위험도를 부드럽게 추정하기 위한 평활화 설정입니다.'},
  {title:'Beta 사전분포 설정',story:'승인 표본의 저QoE 비율 p₀와 사전 강도 s로 α₀=max(0.1,s×p₀), β₀=max(0.1,s×(1−p₀))를 만듭니다.',detail:'사전 강도를 높이면 관측이 적은 지역의 사후평균이 표본 기준 비율 쪽으로 당겨집니다.'},
  {title:'가중 건수로 사후분포 계산',story:'사후 α=α₀+가중 저QoE, β=β₀+가중 정상/주의로 Beta 분포를 계산합니다.',detail:'곡선은 Python SciPy에서 실제 계산한 사전/사후 Beta 확률밀도입니다. 단, 가중 통화가 완전 독립인 베르누이 시행이라는 보장은 없습니다.'},
  {title:'후보 구성과 고객·일자 조건',story:'사후 위험 점수를 계산한 관측점에서 220m 이내 저QoE 구성점이 고객 3명·2일 조건을 충족하는지 확인합니다.',detail:'220m 후보 검색 반경과 공간 가중 폭(100/200/300m)은 전혀 다른 숫자입니다.'},
  {title:'검증일 새 고객 확인',story:'사후분포 계산에는 발견기간 자료만 쓰고, 검증일에는 다른 고객 2명이 100m 이내 다시 나타나는지 확인합니다.',detail:'검증일 결과는 posterior 학습에 누수되지 않습니다.'},
  {title:'사후 확률의 해석 한계',story:'사후평균과 95% 신용구간은 이 선택 표본에 적용한 Empirical Bayes 근사의 값입니다. 정식 BYM2 공간계층모형은 아닙니다.',detail:'지역 전체의 무선 장애 확률·통화 체감품질 확률로 해석하지 말고 현장 확인 대상으로만 사용해야 합니다.'},
 ]
};
interface Props{
 modelId:Model;report:AlternativeModelReport;actual:AlternativeCandidate|null;actualIndex:number;
}
type LearningData={manifest:LearningManifest;bundle:LearningBundle};
function LearningDiagram({state,model,step,selected,focus}:{state:LearningState;model:Model;step:number;selected:LearningCandidate|null;focus:boolean}){
 const main=state.points,others=(model==='spatial_scan'||model==='bayesian')?state.normalPoints:[];
 const validating=step>=5?state.validationPoints:[];
 const all=[...main,...others,...validating];
 const memberIds=new Set(selected?.memberIds??[]);
 const zoomed=focus&&step>=3&&!!selected;
 const included=new Set([...(selected?.memberIds??[]),...(step>=5?(selected?.validationIds??[]):[])]);
 // Scan/Bayes include the normal/attention points inside the selected window.
 // For the other models only the low-MOS members are part of the fitted cluster.
 const shown=zoomed&&selected?all.filter(p=>included.has(p.id)||
   (others.includes(p)&&Math.hypot(p.x-selected.analysisCenterX,p.y-selected.analysisCenterY)<=selected.radiusM+20)):all;
 const keyPt=new Map(shown.map(p=>[p.id,p]));
 const range=selected?.radiusM??((model==='spatial_scan'||model==='bayesian')?250:120);
 const padding=(step>=3&&selected)?range+25:step>=1?model==='spatial_scan'?state.params.radius_m:90:40;
 const buffer=zoomed?Math.min(42,padding):padding;
 const minX=Math.min(...shown.map(p=>p.x),...(zoomed&&selected?[selected.centerX-range,selected.analysisCenterX-range]:[]))-buffer;
 const maxX=Math.max(...shown.map(p=>p.x),...(zoomed&&selected?[selected.centerX+range,selected.analysisCenterX+range]:[]))+buffer;
 const minY=Math.min(...shown.map(p=>p.y),...(zoomed&&selected?[selected.centerY-range,selected.analysisCenterY-range]:[]))-buffer;
 const maxY=Math.max(...shown.map(p=>p.y),...(zoomed&&selected?[selected.centerY+range,selected.analysisCenterY+range]:[]))+buffer;
 const scale=Math.min(350/Math.max(10,maxX-minX),195/Math.max(10,maxY-minY));
 const x=(v:number)=>36+(v-minX)*scale,y=(v:number)=>134-(v-(minY+maxY)/2)*scale;
 const chosen=selected?{x:selected.analysisCenterX,y:selected.analysisCenterY}:null;
 const medoid=selected?{x:selected.centerX,y:selected.centerY}:null;
 const showGroups=step>=3&&!!selected;
 const positiveLinks=model==='hdbscan'?state.details.mst??[]:model==='st_dbscan'?state.details.edges??[]:[];
 return <svg viewBox="0 0 420 280" aria-label={model+' 가상 위치·시간·모델 계산 도식'} data-testid="model-learning-diagram">
  <rect x="0" y="0" width="420" height="280" rx="10" fill="#f7fbff"/>
  {[36,105,174,243,312,381].map(z=><line key={'v'+z} x1={z} y1={24} x2={z} y2={244} stroke="#e1ebf2" strokeDasharray="3 5"/>)}
  {[49,104,159,214].map(z=><line key={'h'+z} x1={26} y1={z} x2={398} y2={z} stroke="#e1ebf2" strokeDasharray="3 5"/>)}
  <text x="14" y="17" fill="#58768c" fontSize="10" fontWeight="800">각 점 = 가상 통화 1건 · 좌표 거리 단위 m</text>
  {(model==='hdbscan'&&step===1)&&state.points.slice(0,4).map(p=><circle key={'core-'+p.id} cx={x(p.x)} cy={y(p.y)} r={Math.max(3,(state.details.coreDistancesM?.[p.id]??0)*scale)} fill="#26b7a4" fillOpacity=".05" stroke="#23a797" strokeDasharray="5 4" strokeWidth="1.4"/>)}
  {(model==='st_dbscan'&&step>=1&&step<=2)&&main.slice(0,5).map(p=><circle key={'st-'+p.id} cx={x(p.x)} cy={y(p.y)} r={state.params.eps_m*scale} fill="#26aa93" fillOpacity=".025" stroke="#28a596" strokeDasharray="4 4"/>)}
  {(model==='adaptive_kde'&&step>=1&&step<=3)&&main.slice(0,7).map(p=><circle key={'kde-'+p.id} cx={x(p.x)} cy={y(p.y)} r={(state.details.kernelWidthByIdM?.[p.id]??70)*scale}
    fill={p.kind==='gnss'?'#24baa4':'#9d82d4'} fillOpacity=".045" stroke={p.kind==='gnss'?'#2caea1':'#9580cb'} strokeOpacity=".6" strokeWidth="1.2"/>)}
  {(model==='bayesian'&&chosen&&step>=1&&step<=3)&&<circle cx={x(chosen.x)} cy={y(chosen.y)} r={state.params.bandwidth_m*scale} fill="#b09bdf" fillOpacity=".11" stroke="#8569b1" strokeDasharray="5 4" strokeWidth="1.6"/>}
  {(model==='spatial_scan'&&chosen&&step>=1||model==='spatial_scan'&&step>=1&&!chosen)&&<circle
    cx={x(chosen?.x??main[0].x)} cy={y(chosen?.y??main[0].y)} r={state.params.radius_m*scale}
    fill="#f3b556" fillOpacity=".09" stroke="#d29027" strokeWidth="1.7" strokeDasharray="5 4"/>}
  {(model==='hdbscan'||model==='st_dbscan')&&step>=2&&step<=4&&positiveLinks.slice(0,70).map((e,i)=>{
   const a=keyPt.get(e.a),b=keyPt.get(e.b);
   return a&&b?<line key={i} x1={x(a.x)} y1={y(a.y)} x2={x(b.x)} y2={y(b.y)}
    stroke={model==='hdbscan'?'#8163b3':'#208a9d'} strokeWidth={model==='hdbscan'?1.5:2}
    strokeOpacity={model==='hdbscan'?.73:.5} strokeDasharray={model==='hdbscan'?'5 3':undefined}/>:null;
  })}
  {showGroups&&selected&&<circle data-circle-kind="learning-candidate" cx={x(medoid!.x)} cy={y(medoid!.y)} r={selected.radiusM*scale}
   stroke="#d98d1e" strokeWidth="2.4" fill="#ffc666" fillOpacity=".1"/>}
  {shown.map(p=>{
   const normal=others.includes(p),verify=validating.includes(p),active=memberIds.has(p.id);
   const showActive=step>=3&&selected;
   const fill=verify?(selected?.validationIds.includes(p.id)?'#1b9c86':'#b88d47')
    :normal?'#98a8b8':showActive?(active?'#e87938':'#bac8d3'):p.kind==='gnss'?'#277fa9':'#8d77bd';
   return <g key={p.id} data-sim-point={p.id}>
    <circle cx={x(p.x)} cy={y(p.y)} r={verify?7:6.5} fill={fill} stroke="white" strokeWidth="1.6"/>
    <text x={x(p.x)} y={y(p.y)-10} fontSize="9" textAnchor="middle" fill={active?'#9a4b22':'#53697b'} fontWeight="800">{p.id}</text>
   </g>;
  })}
  {showGroups&&chosen&&medoid&&(Math.hypot(chosen.x-medoid.x,chosen.y-medoid.y)>1)&&<g>
   <line x1={x(chosen.x)} y1={y(chosen.y)} x2={x(medoid.x)} y2={y(medoid.y)}
    stroke="#8d68bc" strokeWidth="1.4" strokeDasharray="3 3"/>
   <circle cx={x(chosen.x)} cy={y(chosen.y)} r="4.5" fill="#734daa" stroke="white" strokeWidth="1.4"/>
  </g>}
  {showGroups&&medoid&&<g><circle cx={x(medoid.x)} cy={y(medoid.y)} r="5" fill="#07685f" stroke="#fff" strokeWidth="1.5"/>
   <text x={x(medoid.x)+8} y={y(medoid.y)+16} fill="#116d60" fontSize="9" fontWeight="900">대표점</text></g>}
  <rect x="12" y="250" width="396" height="23" rx="6" fill="#eaf1f5"/>
  <text x="21" y="266" fontSize="10" fill="#41667d">
   {model==='hdbscan'?(step<2?'점선 원 = 점별 핵심거리':'선 = 상호 도달거리 최소신장트리')
    :model==='st_dbscan'?'선 = 거리와 시간 두 조건을 모두 만족한 이웃'
    :model==='adaptive_kde'?'원 = 관측점별 커널 폭 · 주황 원 = 탐색 후보 범위'
    :model==='spatial_scan'?'주황 점선 = 검증할 원형 창 (정상/주의 점 회색)'
    :'보라 점선 = 공간 영향 폭 · 주황 원 = 후보 검색 범위'}
  </text>
 </svg>;
}
function BetaCurves({candidate}:{candidate:LearningCandidate|null}){
 const b=candidate?.betaCurves;
 if(!b)return null;
 const W=360,H=110;
 const line=(arr:number[])=>arr.map((value,i)=>(i?'L':'M')+(12+i*(W-24)/(arr.length-1)).toFixed(1)+','+(H-12-value*(H-30)).toFixed(1)).join(' ');
 return <div className={styles.curves}>
  <strong>실제 Beta 분포 계산 곡선</strong>
  <svg viewBox={'0 0 '+W+' '+H} aria-label="가중 Beta 사전분포와 사후분포의 확률 밀도">
   <path d={'M12 '+(H-12)+' H'+(W-12)} stroke="#8ea3b1" strokeWidth="1"/>
   <path d={line(b.prior)} fill="none" stroke="#7589b7" strokeWidth="2.3"/>
   <path d={line(b.posterior)} fill="none" stroke="#d7872d" strokeWidth="2.6"/>
   <text x="14" y="108" fontSize="9" fill="#698095">0%</text>
   <text x="175" y="108" textAnchor="middle" fontSize="9" fill="#698095">50%</text>
   <text x="347" y="108" textAnchor="end" fontSize="9" fill="#698095">100%</text>
  </svg>
  <p><span className={styles.priorDot}/> 사전분포 <span className={styles.posteriorDot}/> 사후분포 · 가중 관측에 따른 분포 변화를 보여줍니다.</p>
 </div>;
}
function Calculation({state,model,step,selected}:{state:LearningState;model:Model;step:number;selected:LearningCandidate|null}){
 const d=state.details,m=selected?.metrics??{},p=state.params;
 let title='단계별 계산';
 let formula='실제 Python 모델로 계산한 가상 결과입니다.';
 let example='설정값을 바꿔 계산 결과를 확인해 보세요.';
 if(model==='hdbscan'){
  title=step<=1?'핵심거리(core distance)':step===2?'상호 도달거리':'선택된 안정 군집';
  formula='MRD(A,B) = max(core(A), core(B), 거리(A,B))';
  example='A~B '+f(d.pairABDistanceM)+'m · core(A) '+f(d.coreDistancesM?.A??0)+'m · core(B) '+f(d.coreDistancesM?.B??0)+'m → MRD(A,B) '+f(d.mutualReachabilityABM??0)+'m';
 }else if(model==='st_dbscan'){
  title='시간과 거리 이웃 조건';
  formula='이웃 = 거리 ≤ '+p.eps_m+'m AND 시간차 ≤ '+p.eps_hours+'시간';
  example='A~B 실제 거리 '+f(d.pairABDistanceM)+'m · 시간차 '+f(d.pairABHours??0)+'시간 · 조건을 충족하는 연결 '+(d.edges?.length??0)+'개';
 }else if(model==='adaptive_kde'){
  title='가우시안 커널 합';
  formula='밀도(x) = Σ 고객가중치 × exp(−d²/(2h²)) / (2πh²)';
  example='GPS h = '+f(70*p.bandwidth_scale,0)+'m · 삼각 측량 h = '+f(160*p.bandwidth_scale,0)+'m · 최대 상대 밀도 '+f(d.peakDensity??0,4);
 }else if(model==='spatial_scan'){
  title='승인 위치 표본의 스캔 LLR';
  formula='LLR = log(지역 내부 위험 모형의 우도 / 공통 위험 모형의 우도)';
  example=selected?'원 안 저QoE '+m.locatedPoorInWindow+'건 / 정상·주의 '+m.locatedNormalInWindow+'건 · 내부 '+f(100*(m.locatedWindowPoorRate??0),1)+'% · 전체 승인 표본 '+f(100*(d.approvedSubsetPoorRate??0),1)+'% · LLR '+f(m.scanLlr??0,3)+' · 조건부 순열 p '+f(m.conditionalPermutationP??1,2):'현재 반경에서 고객·관측일 조건을 충족하는 우도비 탐색 후보가 없습니다.';
 }else {
  title=step<=2?'베타 사전분포':step===3?'가중 사후분포':'위치 확보 표본 사후 요약';
  formula='α = max(0.1, s×p₀) + 가중 저QoE · β = max(0.1, s×(1−p₀)) + 가중 정상';
  example=selected?'승인 표본 p₀ '+f(100*(m.locatedSubsetPriorPoorRate??0),1)+'% · α '+f(m.posteriorAlpha??0,2)+' · β '+f(m.posteriorBeta??0,2)+' · 사후 평균 '+f(100*(m.posteriorMean??0),1)+'% · 95% 구간 '+f(100*(m.credibleLow??0),1)+'~'+f(100*(m.credibleHigh??0),1)+'%':'현재 설정에서는 후보 조건을 충족하는 가상 지역이 없습니다.';
 }
 return <div className={styles.calculation} aria-label="단계별 공식과 실제 계산값">
  <div><span>계산식</span><strong>{title}</strong></div>
  <code>{formula}</code><p>{example}</p>
  {model==='bayesian'&&step>=3&&<BetaCurves candidate={selected}/>}
  {(model==='spatial_scan'||model==='bayesian')&&<small>주의: 승인 위치 표본이 실제 망 전체를 대표하지 않으므로 위험률이나 통계적 유의성을 확정할 수 없습니다.</small>}
 </div>;
}
function ActualGeometry({candidate,model}:{candidate:AlternativeCandidate;model:Model}){
 const members=candidate.members;
 if(!members.length)return null;
 const rad=candidate.lat*Math.PI/180;
 const loc=members.map(p=>({id:p.callId,x:(p.lon-candidate.lon)*111320*Math.cos(rad),y:(p.lat-candidate.lat)*111320}));
 const padding=Math.max(candidate.radiusM,...loc.map(p=>Math.hypot(p.x,p.y)))+30;
 const scale=Math.min(143/padding,1.7);
 const x=(v:number)=>191+v*scale,y=(v:number)=>150-v*scale;
 const metric=candidate.metric;
 const lat=metric.peakLat??metric.windowCenterLat??metric.posteriorCenterLat;
 const lon=metric.peakLon??metric.windowCenterLon??metric.posteriorCenterLon;
 const trueCenter=(lat!==undefined&&lon!==undefined)?{x:(lon-candidate.lon)*111320*Math.cos(rad),y:(lat-candidate.lat)*111320}:null;
 return <svg viewBox="0 0 382 315" aria-label={model+' 실제 후보 구성 통화 위치와 모델 탐색 중심'} data-testid="model-actual-geometry">
  <rect width="382" height="315" fill="#f7fbfd" rx="10"/>
  <path d="M13 150 H369 M191 23 V274" stroke="#dae8ef" strokeDasharray="4 5"/>
  <circle cx="191" cy="150" r={candidate.radiusM*scale} stroke="#d38a26" strokeWidth="2.2" fill="#ffc96d" fillOpacity=".12"/>
  {loc.map((p,i)=><g key={p.id}>
    <circle cx={x(p.x)} cy={y(p.y)} r="6.5" stroke="#fff" strokeWidth="1.7" fill="#287fa5"/>
    <text x={x(p.x)+8} y={y(p.y)-7} fontSize="10" fill="#42677d">{i+1}</text>
   </g>)}
  {trueCenter&&Math.hypot(trueCenter.x,trueCenter.y)>3&&<g>
   <line x1="191" y1="150" x2={x(trueCenter.x)} y2={y(trueCenter.y)} stroke="#976ab7" strokeWidth="1.8" strokeDasharray="4 3"/>
   <circle cx={x(trueCenter.x)} cy={y(trueCenter.y)} r="5" fill="#9167b4" stroke="white" strokeWidth="1.5"/>
   <text x={x(trueCenter.x)+7} y={y(trueCenter.y)+10} fontSize="9" fill="#7e56a0">실제 탐색 중심</text>
  </g>}
  <circle cx="191" cy="150" r="5" fill="#006d65" stroke="#fff" strokeWidth="1.8"/>
  <text x="199" y="145" fontSize="10" fill="#166b62" fontWeight="800">지도 표시 중심</text>
  <rect x="10" y="279" width="362" height="28" rx="6" fill="#e9f1f5"/>
  <text x="19" y="297" fontSize="10" fill="#526f80">파랑 점 = 승인 저QoE 통화 · 주황 원 = 지도 표시 반경</text>
 </svg>;
}
function ActualExample({model,candidate,index,report}:{model:Model;candidate:AlternativeCandidate|null;index:number;report:AlternativeModelReport}){
 if(!candidate)return <div className={styles.realExample}><h4>현재 실제 후보가 없습니다</h4><p>선택 기간에 이 모델의 독립 고객·관측일 조건을 통과한 후보가 없습니다. 가상 시뮬레이터는 계속 사용할 수 있습니다.</p></div>;
 const d=MODEL_EXPLANATIONS[model];
 const metric=candidate.metric;
 return <section className={styles.realExample} aria-label="현재 선택 실제 후보에 모델 적용">
  <div className={styles.realHeading}><MapPinned size={15}/><div><span>실제 데이터 대입 · 지도 선택과 연동</span><h4>후보 지역 {index+1}</h4></div></div>
  <ActualGeometry candidate={candidate} model={model}/>
  <div className={styles.realMetrics}>
   <div><b>{candidate.poorCustomers}명</b><span>발견기간 고유 고객</span></div>
   <div><b>{candidate.poorCalls}건</b><span>저QoE 구성 통화</span></div>
   <div><b>{candidate.days}일</b><span>발견 관측일</span></div>
   <div><b>{report.analysisMode==='all'?'미실시':candidate.validationNewCustomers+'명'}</b><span>후속 평가일 신규 고객</span></div>
   <div><b>{candidate.radiusM}m</b><span>현재 지도 표시 반경</span></div>
   <div><b>{f(candidate.maxPairDistanceM)}m</b><span>구성점 최대 점간 거리</span></div>
  </div>
  <p><strong>이 후보의 계산 근거</strong> {d.meaning}</p>
  {(model==='spatial_scan')&&<p>위치 승인 표본 내부 LLR {f(metric.scanLlr??0,3)} · 순열 p {f(metric.conditionalPermutationP??1,2)} · 원 안 저QoE {metric.locatedPoorInWindow??0}건 / 정상·주의 {metric.locatedNormalInWindow??0}건</p>}
  {(model==='bayesian')&&<p>선택 표본의 사후평균 {f((metric.posteriorMean??0)*100)}%, 95% 신용구간 {f((metric.credibleLow??0)*100)}~{f((metric.credibleHigh??0)*100)}%</p>}
  <p>{report.analysisMode==='all'?'전체 후보 산정기간 ':'후보 발견기간 '}{report.discoveryDates.join(', ')} · 후속 평가 {report.validationDates.join(', ')||'미실시'} · 실제 후보의 값을 바꾸려면 모델 자체를 다시 계산해야 합니다. 위 시뮬레이터의 조작은 이 숫자를 변경하지 않습니다.</p>
  {['spatial_scan','bayesian'].includes(model)&&<p className={styles.alert}>현재 정상/저QoE의 위치 확보 편향이 심하므로 전체 망의 불량 위험도 또는 통계적 확정 결과로 해석할 수 없습니다.</p>}
 </section>;
}
export function QualityModelSimulator({modelId,report,actual,actualIndex}:Props){
 const [data,setData]=useState<LearningData|null>(null);
 const [error,setError]=useState<string|null>(null);
 const [scenario,setScenario]=useState('focused');
 const [params,setParams]=useState<Record<string,number>>({});
 const [step,setStep]=useState(0);
 const [candidateIndex,setCandidateIndex]=useState(0);
 const [playing,setPlaying]=useState(false);
 const [focus,setFocus]=useState(true);
 useEffect(()=>{
  const ctrl=new AbortController();
  void loadLearningBundle(modelId,ctrl.signal).then(value=>{
   if(!ctrl.signal.aborted){setData(value);setError(null);setScenario('focused');setParams(value.manifest.defaults[modelId]);setStep(0);setCandidateIndex(0);}
  }).catch(e=>{if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:'교육용 계산을 불러오지 못했습니다.');});
  return()=>ctrl.abort();
 },[modelId]);
 useEffect(()=>{
  if(!playing||step>=6)return;
  const t=window.setInterval(()=>setStep(current=>Math.min(6,current+1)),1700);
  return()=>window.clearInterval(t);
 },[playing,step]);
 const state=useMemo(()=>data?.bundle.states[learningStateKey(scenario,params)]??null,[data,scenario,params]);
 const chosen=state?.candidates[Math.min(candidateIndex,state.candidates.length-1)]??null;
 const stepContent=meta[modelId][step];
 const desc=MODEL_EXPLANATIONS[modelId];
 const reset=()=>{if(data){setParams({...data.manifest.defaults[modelId]});setScenario('focused');setStep(0);setCandidateIndex(0);setPlaying(false);}};
 if(error)return <div className={styles.error} role="alert">모델 시뮬레이터: {error}</div>;
 if(!data||!state)return <output className={styles.loading}>선택 모델의 Python 계산 예제를 불러오는 중입니다…</output>;
 const controls=data.manifest.controls[modelId];
 return <section className={styles.simulator} aria-label={modelId+' 상세 가상 시뮬레이터'}>
  <div className={styles.top}><div><span><BookOpen size={14}/> 직접 조작하는 모델 학습</span><h4>{desc.title.split(' · ')[0]}는 왜 이렇게 계산하나요?</h4></div>
   <button type="button" onClick={reset}><RotateCcw size={14}/> 초기화</button></div>
  <p className={styles.banner}><Info size={14}/> <strong>가상 학습 데이터입니다.</strong> 실제 Python 산출 코드를 사용한 사전 계산 예제이며 슬라이더를 바꿔도 실제 후보 지도·원본 통화·후보 순위는 변하지 않습니다.</p>
  <div className={styles.scenarios} aria-label="모델 학습용 상황 선택">
   {Object.entries(data.manifest.cases).map(([key,cs])=><button key={key} type="button" aria-pressed={scenario===key}
     onClick={()=>{setScenario(key);setCandidateIndex(0);setPlaying(false);}}>{cs.name}</button>)}
  </div>
  <p className={styles.caseNote}>{data.manifest.cases[scenario].note}</p>
  <nav className={styles.phases} aria-label={modelId+' 알고리즘 단계'}>
   {STEP_TITLES.map((name,i)=><button type="button" key={name} aria-current={step===i?'step':undefined}
    onClick={()=>{setStep(i);setPlaying(false);}}><span>{i+1}</span>{name}</button>)}
  </nav>
  <div className={styles.stepTitle}><div><span>STEP {step+1} / 7</span><h5>{stepContent.title}</h5></div><b>{state.candidates.length}개 후보</b></div>
  <p className={styles.stepStory}>{stepContent.story}</p>
  <div className={styles.learningBody}>
   <div className={styles.visualColumn}>
    <div className={styles.zoomBar} aria-label="가상 관측점 확대 방식">
   <span>{step>=3?'선택 후보에 가까이 확대하면 구성 점의 거리·범위를 보기 쉽습니다.':'현재 단계는 전체 관측점을 보여줍니다.'}</span>
   <div><button type="button" disabled={step<3||!chosen} aria-pressed={!focus} onClick={()=>setFocus(false)}>전체 관측</button>
    <button type="button" disabled={step<3||!chosen} aria-pressed={focus} onClick={()=>setFocus(true)}>선택 후보 확대</button></div>
  </div>
  <div className={styles.figure}><LearningDiagram state={state} model={modelId} step={step} selected={chosen} focus={focus}/></div>
  <div className={styles.legend}>
   <span><i className={styles.gnss}/> GPS 저QoE</span><span><i className={styles.radio}/> 승인 삼각 측량 저QoE</span>
   {['spatial_scan','bayesian'].includes(modelId)&&<span><i className={styles.normal}/> 정상·주의(QoE≥3)</span>}
   {step>=5&&<span><i className={styles.validation}/> 검증일 신규 고객</span>}
  </div>
   </div>
   <div className={styles.parameterColumn}>
    <div className={styles.controls} aria-label={modelId+' 모델 파라미터 조정'}>
   <h5><ChartNoAxesColumnIncreasing size={14}/> 직접 변경 가능한 계산 조건</h5>
   {Object.entries(controls).map(([key,options])=>{
    const selectedIndex=options.findIndex(v=>v===params[key]);
    return <div key={key} className={styles.slider}>
     <label htmlFor={'model-sim-'+key}><span>{data.manifest.labels[modelId][key]}</span><strong>{key==='bandwidth_scale'?f(params[key],1)+'배':params[key]+(key==='eps_m'||key==='support_m'||key==='radius_m'||key==='bandwidth_m'?'m':key==='eps_hours'?'시간':'')}</strong></label>
     <input id={'model-sim-'+key} type="range" min={0} max={options.length-1} step={1}
      aria-label={data.manifest.labels[modelId][key]} value={Math.max(0,selectedIndex)}
      onChange={e=>{setParams(v=>({...v,[key]:options[Number(e.target.value)]}));setCandidateIndex(0);setPlaying(false);}}/>
     <div className={styles.marks}>{options.map(v=><span key={v}>{v}</span>)}</div>
    </div>;
   })}
  </div>
  <Calculation state={state} model={modelId} step={step} selected={chosen}/>
   </div>
  </div>
  {(step>=3)&&<div className={styles.candidatePicker}><span>가상 후보 선택</span>
   <div>{state.candidates.slice(0,6).map((c,i)=><button type="button" key={c.id} aria-pressed={c.id===chosen?.id} onClick={()=>setCandidateIndex(i)}>지역 {i+1}</button>)}</div>
   {!state.candidates.length&&<p>현재 임계값에서 고유 고객 3명·2일을 만족하는 조사 후보가 없습니다. 슬라이더 또는 상황을 바꿔보세요.</p>}
  </div>}
  {(step>=4)&&<div className={styles.criteria}>
   <div><span>고유 고객 ≥3</span><strong>{chosen?chosen.customerCount+'명':'후보 없음'}</strong></div>
   <div><span>서로 다른 관측 ≥2일</span><strong>{chosen?chosen.dayCount+'일':'후보 없음'}</strong></div>
   <div><span>검증일 새 고객 ≥2명</span><strong>{chosen?chosen.newCustomers+'명':'후보 없음'}</strong></div>
   <div><span>표시 반경 / 범위 검토</span><strong>{chosen?chosen.radiusM+'m · '+(chosen.rangeReview?'검토 필요':'범위 내'):'—'}</strong></div>
  </div>}
  <p className={styles.why}><Info size={13}/> {stepContent.detail}</p>
  {step===6&&<div className={styles.final}>
   <strong>결과 해석: {state.candidates.length}곳</strong>
   <p>가상 통화 저QoE {state.points.length}건, 정상·주의 위치 {state.normalPoints.length}건 중 {state.candidates.length}곳이 해당 모델의 후보 구성과 독립 고객·일자 기준을 통과했습니다.</p>
   <p>실제 모델의 후보 수는 현재 화면 오른쪽에 표시된 결과이며, 이 가상 연습에서 변경되지 않습니다.</p>
  </div>}
  <div className={styles.progress}><span style={{width:((step+1)/7*100)+'%'}}/></div>
  <div className={styles.actions}>
   <button type="button" disabled={step===0} onClick={()=>{setStep(s=>Math.max(0,s-1));setPlaying(false);}}><ArrowLeft size={13}/> 이전</button>
   <button type="button" aria-label={playing&&step<6?'자동 재생 중지':'단계 자동 재생'} onClick={()=>{if(step===6){setStep(0);setPlaying(true);}else setPlaying(v=>!v);}}>{playing&&step<6?<Pause size={13}/>:<Play size={13}/>} {playing&&step<6?'일시정지':'자동 재생'}</button>
   <button type="button" disabled={step===6} onClick={()=>{setStep(s=>Math.min(6,s+1));setPlaying(false);}}>다음 <ArrowRight size={13}/></button>
  </div>
  <details className={styles.actualDisclosure}>
   <summary>실제 선택 후보 분석 근거 펼치기 (가상 시뮬레이션과 별도)</summary>
   <ActualExample model={modelId} candidate={actual} index={actualIndex} report={report}/>
  </details>
 </section>;
}
