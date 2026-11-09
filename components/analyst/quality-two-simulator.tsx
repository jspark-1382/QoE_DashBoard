'use client';
import {useMemo,useState} from 'react';
import {ArrowLeft,ArrowRight,RotateCcw,Info,Play} from 'lucide-react';
import type {QualityCandidateSummary} from '../../lib/analyst/quality-improvement-candidates';
import {DEFAULT_SIM_SETTINGS,evaluateCandidateSimulation,SIM_NEIGHBOR_EPS_M,SIM_DISPLAY_MARGIN_M,type SimulationSettings,type SimPoint} from '../../lib/analyst/quality-two-simulation';
import styles from './quality-two-simulator.module.css';

const phases=['조건 선택','저QoE 판정','위치 채택','지역 묶기','범위 판단','재관측','최종 결과'] as const;
const pointX=(p:SimPoint,scale:number,start:number)=>start+p.x*scale;
const outcome=(s:ReturnType<typeof evaluateCandidateSimulation>)=>!s.accepted?'좌표 입력 제외'
 :!s.qualifies?'조사 후보 조건 미충족'
 :s.rangeReviewRequired?'조사 후보 · 범위 검토 필요'
 :s.validationPass?'조사 후보 · 새 고객 재관측'
 :'조사 후보 · 재관측 미충족';
function ScoreDiagram({mos}:{mos:number}){
 const x=30+(mos-1)*80;
 return <svg viewBox="0 0 390 168" aria-label={'QoE '+mos.toFixed(1)+' 기준 판정 그림'}>
  <rect width="390" height="168" rx="10" fill="#f7fafc"/>
  <text x="25" y="25" fontSize="12" fontWeight="700" fill="#25465f">현재 통화의 QoE(v5)</text>
  <rect x="30" y="48" width="160" height="40" rx="7" fill="#ee7479"/>
  <rect x="190" y="48" width="40" height="40" fill="#efb75b"/>
  <rect x="230" y="48" width="120" height="40" rx="7" fill="#34b88c"/>
  <text x="110" y="72" textAnchor="middle" fontSize="12" fill="#fff" fontWeight="800">저품질</text>
  <text x="210" y="72" textAnchor="middle" fontSize="10" fill="#4c4236" fontWeight="700">주의</text>
  <text x="290" y="72" textAnchor="middle" fontSize="12" fill="#fff" fontWeight="800">양호</text>
  <path d={`M${x} 91 L${x-9} 106 L${x+9} 106 Z`} fill="#173c58"/>
  <text x={x} y="125" fontSize="16" textAnchor="middle" fontWeight="850" fill="#183e5e">{mos.toFixed(1)}</text>
  <text x="30" y="147" fontSize="11" fill="#7e92a5">1.0</text>
  <text x="190" y="147" fontSize="11" fill="#7e92a5">3.0</text>
  <text x="230" y="147" fontSize="11" fill="#7e92a5">3.5</text>
  <text x="350" y="147" textAnchor="end" fontSize="11" fill="#7e92a5">5.0</text>
 </svg>;
}
function DateDiagram({summary}:{summary:QualityCandidateSummary}){
 const discovery=summary.discoveryDates,validation=summary.validationDates;
 const all=[...discovery,...validation];
 return <svg viewBox="0 0 390 169" aria-label="발견 날짜와 검증 날짜를 구별한 일정 그림">
  <rect width="390" height="169" rx="10" fill="#f7fafc"/>
  <text x="16" y="24" fontSize="12" fill="#224a62" fontWeight="800">선택 기간을 발견 / 검증으로 구분</text>
  {all.slice(0,8).map((date,i)=>{
   const x=18+i*(354/Math.max(1,all.length));
   const isTest=validation.includes(date);
   return <g key={date} transform={`translate(${x},45)`}>
    <rect width={Math.min(63,354/all.length-5)} height="64" rx="8" fill={isTest?'#fff0d6':'#ddf2ed'} stroke={isTest?'#d9a24f':'#8bd0be'}/>
    <text x={Math.min(63,354/all.length-5)/2} y="24" textAnchor="middle" fill="#284963" fontSize="12" fontWeight="800">{date.slice(5)}</text>
    <text x={Math.min(63,354/all.length-5)/2} y="46" textAnchor="middle" fill={isTest?'#986a29':'#197d6b'} fontSize="10" fontWeight="800">{isTest?'검증':'발견'}</text>
   </g>;
  })}
  <text x="18" y="132" fill="#5b788e" fontSize="11">발견일의 저QoE 위치로 후보를 생성</text>
  <text x="18" y="150" fill="#5b788e" fontSize="11">검증일에는 새로운 고객이 다시 관측되는지 확인</text>
 </svg>;
}
function EvidenceDiagram({s}:{s:SimulationSettings}){
 const selected=s.locationKind==='gnss'?'GPS':s.locationKind==='reviewed-radio'?'삼각 측량':'BYE Cell';
 return <svg viewBox="0 0 390 165" aria-label={'위치 증거 '+selected+' 채택 경로'}>
  <rect width="390" height="165" rx="10" fill="#f7fafc"/>
  <rect x="11" y="18" width="106" height="39" rx="8" fill="#e9f1f8" stroke="#b9cfdd"/>
  <text x="64" y="41" textAnchor="middle" fontSize="12" fontWeight="800" fill="#315d76">SIP + RTCP</text>
  <path d="M117 38 H148" stroke="#86a7b9" strokeWidth="2" strokeDasharray="4 3"/>
  <rect x="149" y="18" width="96" height="39" rx="8" fill={s.uniqueMdt?'#dcf5e8':'#fff0e9'} stroke={s.uniqueMdt?'#69bea2':'#e7a48d'}/>
  <text x="197" y="41" textAnchor="middle" fontSize="11" fontWeight="800" fill="#315c61">{s.uniqueMdt?'MDT 고유 연결':'연결 모호'}</text>
  <path d="M245 38 H275" stroke="#86a7b9" strokeWidth="2" strokeDasharray="4 3"/>
  <rect x="276" y="18" width="102" height="39" rx="8" fill={s.locationKind==='bye-cell'?'#fff0e9':'#ddf4ed'} stroke={s.locationKind==='bye-cell'?'#e7a48d':'#75bea8'}/>
  <text x="327" y="41" textAnchor="middle" fontSize="11" fontWeight="800" fill="#315c61">{selected}</text>
  <path d="M327 59 V91" stroke="#8aa8b8" strokeWidth="2"/>
  <rect x="200" y="92" width="178" height="51" rx="9" fill={s.uniqueMdt&&s.locationKind!=='bye-cell'?'#d8f6e9':'#fff0ec'} stroke={s.uniqueMdt&&s.locationKind!=='bye-cell'?'#44ad86':'#e4a396'}/>
  <text x="289" y="113" textAnchor="middle" fontSize="13" fill="#30536a" fontWeight="900">{s.uniqueMdt&&s.locationKind!=='bye-cell'?'위치 채택':'위치 제외'}</text>
  <text x="289" y="130" textAnchor="middle" fontSize="10" fill="#658193">{s.locationKind==='bye-cell'?'기지국 ≠ 고객 위치':s.uniqueMdt?'지도 군집 입력 가능':'연결 확인 필요'}</text>
  <text x="11" y="100" fontSize="11" fill="#658093">원본에만 있을 경우</text>
  <text x="11" y="119" fontSize="11" fill="#658093">후보로 추정하지 않음</text>
 </svg>;
}
function ClusterDiagram({result,phase}:{result:ReturnType<typeof evaluateCandidateSimulation>;phase:number}){
 const displayed=result.points.length?result.points:Array.from({length:5},(_,i)=>({id:'D'+(i+1),customer:String.fromCharCode(65+i),day:1,x:i*45,y:0}));
 const showNeighbors=phase>=3&&result.points.length>0;
 const showFinal=phase>=4&&result.qualifies&&result.medoid!==null;
 const showValidation=phase>=5;
 const medoid=result.medoid;
 const maxRadiusM=Math.max(SIM_NEIGHBOR_EPS_M,showFinal?result.displayRadiusM:0);
 const left=Math.min(...displayed.map(p=>p.x-(showNeighbors?SIM_NEIGHBOR_EPS_M:25)),showFinal&&medoid?medoid.x-result.displayRadiusM:Infinity);
 const right=Math.max(...displayed.map(p=>p.x+(showNeighbors?SIM_NEIGHBOR_EPS_M:25)),showFinal&&medoid?medoid.x+result.displayRadiusM:-Infinity,
  ...((showValidation?result.validationPoints:[]).map(p=>p.x+18)));
 // Fit EVERY individual 100m circle and the one final display circle into the SVG.
 // This is a local-meter illustration, not an inaccurate fixed-pixel radius.
 const scale=Math.min(326/Math.max(1,right-left),112/maxRadiusM);
 const startX=(390-(right-left)*scale)/2-left*scale;
 const y=149,px=(p:SimPoint)=>pointX(p,scale,startX);
 const members=new Set(result.members.map(p=>p.id));
 let farthest:SimPoint|null=null, maxFar=-1;
 if(medoid)for(const p of result.members){
  const d=Math.hypot(p.x-medoid.x,p.y-medoid.y);
  if(d>maxFar){maxFar=d;farthest=p;}
 }
 const pair=result.members.flatMap((p,i)=>result.members.slice(i+1).map(q=>({p,q,d:Math.hypot(p.x-q.x,p.y-q.y)})))
  .sort((a,b)=>b.d-a.d)[0]??null;
 return <svg viewBox="0 0 390 326" aria-label={'가상 통화 관측점별 100m 이웃 원과 대표점의 최종 조사 원 '+outcome(result)}>
   <rect width="390" height="326" rx="10" fill="#f8fafc"/>
   <text x="14" y="19" fontSize="11" fill="#34586e" fontWeight="750">점 = 저QoE 통화 1건 · A~E = 고객 (관측점별 검색)</text>
   {[0,100,200,300,400,500].filter(t=>t>=left&&t<=right).map(t=><g key={t}>
     <line x1={startX+t*scale} y1="36" x2={startX+t*scale} y2="267" stroke="#dfe8ef" strokeDasharray="3 5"/>
     <text x={startX+t*scale} y="283" textAnchor="middle" fontSize="10" fill="#71899e">{t}m</text>
    </g>)}
   {showNeighbors&&result.points.map(p=><circle key={'eps-'+p.id} data-circle-kind="neighbor" data-point-id={p.id}
    cx={px(p)} cy={y} r={SIM_NEIGHBOR_EPS_M*scale} fill="#35b4a3" fillOpacity="0.035"
    stroke="#2aa58f" strokeOpacity="0.73" strokeDasharray="4 4" strokeWidth="1.25"/>)}
   {showFinal&&medoid&&<circle data-circle-kind="final" cx={px(medoid)} cy={y} r={result.displayRadiusM*scale}
    fill="#f5b041" fillOpacity="0.085" stroke="#d97706" strokeWidth="2.4"/>}
   {result.points.length>0&&result.points.flatMap((p,i)=>result.points.slice(i+1)
    .filter(q=>Math.hypot(p.x-q.x,p.y-q.y)<=SIM_NEIGHBOR_EPS_M+1e-8)
    .map(q=><line key={p.id+'-'+q.id} x1={px(p)} y1={y} x2={px(q)} y2={y}
     stroke="#278b99" strokeWidth="3.1" strokeOpacity=".63"/>))}
   {phase===4&&pair&&<g>
     <path d={'M'+px(pair.p)+' '+(y-15)+' V56 H'+px(pair.q)+' V'+(y-15)}
      fill="none" stroke="#7851a2" strokeWidth="1.8" strokeDasharray="5 3"/>
     <text x={(px(pair.p)+px(pair.q))/2} y="51" textAnchor="middle" fontSize="11" fill="#704996" fontWeight="800">최대 점간 {result.maxPairDistanceM.toFixed(0)}m</text>
    </g>}
   {phase===4&&medoid&&farthest&&<g>
     <path d={'M'+px(medoid)+' '+(y+17)+' V240 H'+px(farthest)+' V'+(y+17)}
      fill="none" stroke="#c67919" strokeWidth="2.1" strokeDasharray="4 3"/>
     <text x={(px(medoid)+px(farthest))/2} y="256" textAnchor="middle" fontSize="10" fill="#9b621c" fontWeight="800">중심~최원 {result.maxCenterDistanceM.toFixed(0)}m</text>
    </g>}
   {displayed.map(p=>{
    const active=members.has(p.id),ghost=result.points.length===0;
    const representative=showFinal&&medoid?.id===p.id;
    return <g key={p.id} data-observation-point={p.id}>
      <circle cx={px(p)} cy={y} r={representative?14:11}
       fill={ghost?'#cbd6dd':representative?'#086b66':active?'#218db5':'#d99975'}
       stroke="#fff" strokeWidth="2.2"/>
      <text x={px(p)} y={y+4} textAnchor="middle" fontSize="11" fill="#fff" fontWeight="850">{p.customer}</text>
      <text x={px(p)} y={y+27} textAnchor="middle" fontSize="10" fill="#48647d">{p.id}</text>
     </g>;
   })}
   {showValidation&&result.validationPoints.map(v=><g key={v.id}>
    <circle cx={px(v)} cy={y-43+(Number(v.id.slice(1))-1)*8} r="10"
     fill={result.validationNear.some(p=>p.id===v.id)?'#10a985':'#d29a48'}
     stroke="#fff" strokeWidth="2"/>
    <text x={px(v)} y={y-39+(Number(v.id.slice(1))-1)*8} fontWeight="750" textAnchor="middle"
     fontSize="10" fill="#fff">{v.customer}</text>
   </g>)}
   {phase===4&&showFinal&&medoid&&<text x={px(medoid)} y={y+47} textAnchor="middle" fontSize="11" fontWeight="800" fill="#07675d">대표점</text>}
   <text x="14" y="305" fontSize="10" fill="#5d7a8b">
    {phase===3?'각 통화 관측점마다 100m 이웃 검색 (고객 1명당 원 1개가 아님)'
     :phase===4?'청록 점선 = 이웃 100m · 주황 실선 = 최종 조사 원 1개'
     :phase===5?'A~E = 발견기간 관측 · F~H = 검증일 새 고객'
     :'100m 이웃 검색 원과 대표점 기준 최종 조사 원을 구분하세요'}
   </text>
 </svg>;
}
export function QualityTwoSimulator({summary}:{summary:QualityCandidateSummary}){
 const [phase,setPhase]=useState(0);
 const [settings,setSettings]=useState<SimulationSettings>(DEFAULT_SIM_SETTINGS);
 const result=useMemo(()=>evaluateCandidateSimulation(settings),[settings]);
 const change=<K extends keyof SimulationSettings>(key:K,value:SimulationSettings[K])=>setSettings(v=>({...v,[key]:value}));
 const reset=()=>{setSettings(DEFAULT_SIM_SETTINGS);setPhase(0);};
 const presets=[
  {name:'기준 통과',step:6,settings:DEFAULT_SIM_SETTINGS},
  {name:'지역 범위 초과',step:4,settings:{...DEFAULT_SIM_SETTINGS,spacingM:65}},
  {name:'한 고객만',step:3,settings:{...DEFAULT_SIM_SETTINGS,uniqueCustomers:1}},
  {name:'Cell만 존재',step:2,settings:{...DEFAULT_SIM_SETTINGS,locationKind:'bye-cell' as const}},
  {name:'재관측 거리 밖',step:5,settings:{...DEFAULT_SIM_SETTINGS,validationDistanceM:145}},
 ];
 const phaseTitle=phases[phase];
 const next=()=>setPhase(p=>Math.min(6,p+1));
 const previous=()=>setPhase(p=>Math.max(0,p-1));
 const reason=phase===0?'선택한 날짜 중 발견기간/검증일을 분리합니다.'
  :phase===1?result.accepted?'QoE가 저품질 기준에 들어오면 위치 검토로 진행합니다.':settings.mos>=3?'QoE 3.0 이상은 저QoE 후보 입력에서 제외합니다.':'1.0 미만은 유효하지 않습니다.'
  :phase===2?result.rejectReason:phase===3?result.points.length===0?'채택된 점이 없어 군집을 만들지 않습니다.'
   :result.clusters.length===0?'100m 이내 이웃 관측점이 없어 모두 노이즈입니다.'
   :result.qualifies?'고객 3명·관측 2일을 충족해 지역 후보가 생성됩니다.':'군집은 있지만 고유 고객 3명·2일 중 하나가 부족합니다.'
  :phase===4?!result.qualifies?'각 관측점의 100m 이웃 원은 계산하지만, 군집 후보 기준을 충족하지 않아 최종 조사 원은 그리지 않습니다.':result.rangeReviewRequired?'관측점별 100m 점선 원은 이웃 검색용이고 주황 실선은 대표점 기준 최종 조사 범위입니다. 전체 최대 점간 거리가 200m를 초과해 조사 순위를 보류합니다.':'관측점별 100m 점선 원과 대표점 기준 최종 조사 원은 서로 다릅니다. 최대 점간 거리는 200m 이하입니다.'
  :phase===5?!result.qualifies?'후보 지역이 없어 재관측을 검사할 수 없습니다.':result.validationPass?'새 고객 2명 이상이 100m 이내 재관측돼 기준을 통과했습니다.':'새 고객 2명 이상이 가까운 곳에 관측되지 않아 기준 미충족입니다.'
  :result.qualifies?'각 관측점은 100m 이웃을 검사합니다. 대표점에서 최원거리 '+result.maxCenterDistanceM.toFixed(1)+'m + 여유 20m를 더해 최소 100m를 적용하고 10m 단위 올림 → 최종 조사 원 '+result.displayRadiusM+'m입니다. 전체 최대 점간 거리 '+result.maxPairDistanceM.toFixed(1)+'m와는 구분합니다.':outcome(result);
 const currentStatus=phase<3?result.accepted?'입력 가능':'입력 제외'
  :phase===3?result.qualifies?'후보 생성':'후보 미생성'
  :phase===4?result.rangeReviewRequired?'범위 검토':result.qualifies?'범위 통과':'후보 없음'
  :phase===5?result.validationPass?'재관측 인정':'재관측 미충족'
  :outcome(result);
 return <section className={styles.simulator} aria-label="후보 산정 가상 시뮬레이터">
  <div className={styles.top}>
   <div><span className={styles.eyebrow}><Play size={13}/> 직접 바꿔보는 체험</span><h4>내가 조건을 바꾸면 후보가 생길까?</h4></div>
   <button type="button" className={styles.reset} onClick={reset} aria-label="가상 시뮬레이션 초기화"><RotateCcw size={13}/> 초기화</button>
  </div>
  <p className={styles.simWarning}><Info size={14}/> <b>가상 연습용입니다.</b> 수치를 바꿔도 실제 지도·원본 데이터·7개 후보는 변하지 않습니다.</p>
  <div className={styles.presetRow} aria-label="시뮬레이션 상황 선택">
   {presets.map(p=><button key={p.name} type="button" onClick={()=>{setSettings(p.settings);setPhase(p.step);}}>{p.name}</button>)}
  </div>
  <div className={styles.phaseNav} aria-label="알고리즘 단계 선택">
   {phases.map((name,i)=><button key={name} type="button" aria-current={phase===i?'step':undefined} onClick={()=>setPhase(i)}>
    <span>{i+1}</span>{name}
   </button>)}
  </div>
  <div className={styles.phaseHeading}><div><span>STEP {phase+1} / 7</span><h5>{phaseTitle}</h5></div><strong data-result={currentStatus.includes('미')||currentStatus.includes('제외')||currentStatus.includes('검토')?'warn':'pass'}>{currentStatus}</strong></div>
  <div className={styles.learningBody}>
  <div className={styles.drawing} data-testid="simulation-diagram">
   {phase===0?<DateDiagram summary={summary}/>:phase===1?<ScoreDiagram mos={settings.mos}/>:phase===2?<EvidenceDiagram s={settings}/>:<ClusterDiagram phase={phase} result={result}/>}
   {phase>=3&&<div className={styles.circleLegend} aria-label="DBSCAN 이웃 원과 최종 조사 원 범례">
    <span><i className={styles.neighborCircle}/> 각 저QoE 관측점마다 100m 이웃 검색 원</span>
    {phase>=4&&<span><i className={styles.finalCircle}/> 대표점 기준 최종 조사 범위 원 (후보당 1개)</span>}
    {phase>=4&&<span><i className={styles.repPoint}/> 실제 구성 관측점에서 고른 대표점</span>}
    <span><i className={styles.obsPoint}/> 저QoE 통화 관측점 · 한 고객이 여러 점일 수 있음</span>
   </div>}
  </div>
  <div className={styles.controls} aria-label="시뮬레이터 조건 조절">
   {phase===0&&<div className={styles.conditionBox}>
    <div><span>시작~종료</span><b>{summary.scope.dateStart} ~ {summary.scope.dateEnd}</b></div>
    <div><span>시간 범위</span><b>{summary.scope.from} ~ {summary.scope.to}</b></div>
    <small>날짜는 위쪽 실제 분석 필터에서 선택합니다. 이 연습은 결과를 저장하지 않습니다.</small>
   </div>}
   {phase===1&&<div className={styles.rangeControl}><label htmlFor="sim-mos">QoE 점수 <strong>{settings.mos.toFixed(1)}</strong></label>
    <input id="sim-mos" aria-label="가상 QoE 점수" type="range" min="1" max="5" step="0.1" value={settings.mos} onChange={e=>change('mos',Number(e.target.value))}/>
    <small>3.0 이상으로 올려서 후보 입력이 제외되는 모습을 확인하세요.</small></div>}
   {phase===2&&<><fieldset className={styles.radioField}><legend>위치 근거를 선택하세요</legend>
    {([['gnss','GPS 실측'],['reviewed-radio','검토 통과 삼각 측량'],['bye-cell','BYE Cell 위치']] as const).map(([value,label])=>
     <label key={value}><input type="radio" name="sim-kind" value={value} checked={settings.locationKind===value} onChange={()=>change('locationKind',value)}/>{label}</label>)}</fieldset>
    <label className={styles.checkbox}><input aria-label="MDT 고유 연결" type="checkbox" checked={settings.uniqueMdt} onChange={e=>change('uniqueMdt',e.target.checked)}/>CDR ↔ MDT 고유 연결 성공</label>
    <small>기지국 주소는 UE 좌표가 아니므로 BYE Cell 단독으로는 후보 생성이 불가합니다.</small></>}
   {(phase===3||phase===4)&&<div className={styles.sliders}>
    <div className={styles.rangeControl}><label htmlFor="sim-spacing">관측점 사이 거리 <strong>{settings.spacingM}m</strong></label><input id="sim-spacing" aria-label="가상 관측점 간격" type="range" min="20" max="120" step="5" value={settings.spacingM} onChange={e=>change('spacingM',Number(e.target.value))}/></div>
    {phase===3&&<><div className={styles.rangeControl}><label htmlFor="sim-customers">서로 다른 고객 <strong>{settings.uniqueCustomers}명</strong></label><input id="sim-customers" aria-label="가상 고유 고객 수" type="range" min="1" max="5" step="1" value={settings.uniqueCustomers} onChange={e=>change('uniqueCustomers',Number(e.target.value))}/></div>
     <div className={styles.rangeControl}><label htmlFor="sim-days">관측된 날짜 <strong>{settings.observedDays}일</strong></label><input id="sim-days" aria-label="가상 관측일 수" type="range" min="1" max="3" step="1" value={settings.observedDays} onChange={e=>change('observedDays',Number(e.target.value))}/></div></>}
   </div>}
   {phase===4&&<div className={styles.circleMath} aria-label="대표점과 조사 반경 계산 과정">
    <strong>두 원의 계산 목적이 다릅니다.</strong>
    <span>점선 원: 각 통화 관측점에서 {SIM_NEIGHBOR_EPS_M}m 이내 이웃 검사</span>
    <span>실선 원: 대표점에서 가장 먼 구성점 + {SIM_DISPLAY_MARGIN_M}m 여유</span>
    {result.qualifies&&<b>{result.maxCenterDistanceM.toFixed(1)}m + {SIM_DISPLAY_MARGIN_M}m → 10m 올림 → {result.displayRadiusM}m</b>}
    <small>최소 {SIM_NEIGHBOR_EPS_M}m 적용. 모든 고객에게 최종 원을 따로 그리지 않습니다.</small>
   </div>}
   {phase===5&&<div className={styles.sliders}><div className={styles.rangeControl}><label htmlFor="sim-new">검증일 새로운 고객 <strong>{settings.newCustomers}명</strong></label><input id="sim-new" aria-label="검증일 신규 고객 수" type="range" min="0" max="3" step="1" value={settings.newCustomers} onChange={e=>change('newCustomers',Number(e.target.value))}/></div>
    <div className={styles.rangeControl}><label htmlFor="sim-gap">발견 관측점과 검증점 거리 <strong>{settings.validationDistanceM}m</strong></label><input id="sim-gap" aria-label="검증일 거리" type="range" min="20" max="160" step="5" value={settings.validationDistanceM} onChange={e=>change('validationDistanceM',Number(e.target.value))}/></div></div>}
   {phase===6&&<div className={styles.resultGrid}>
     <div><span>이웃 검색 반경</span><b>{SIM_NEIGHBOR_EPS_M}m</b></div><div><span>군집 구성 관측점</span><b>{result.members.length}개</b></div>
     <div><span>군집</span><b>{result.clusters.length}개</b></div><div><span>고유 고객</span><b>{result.customers}명</b></div>
     <div><span>관측일</span><b>{result.days}일</b></div><div><span>최대 점간 거리</span><b>{result.qualifies?result.maxPairDistanceM+'m':'—'}</b></div>
     <div><span>대표점→최원거리</span><b>{result.qualifies?result.maxCenterDistanceM.toFixed(1)+'m':'—'}</b></div><div><span>최종 표시 반경</span><b>{result.qualifies?result.displayRadiusM+'m':'—'}</b></div>
     <div><span>범위 검토</span><b>{result.qualifies?(result.rangeReviewRequired?'필요':'불필요'):'판정 불가'}</b></div><div><span>재관측 신규 고객</span><b>{result.nearbyNewCustomers}명</b></div>
    </div>}
   {phase===6&&result.qualifies&&<div className={styles.circleMath} aria-label="최종 조사 원 반경 계산식">
    <span>각 관측점마다 100m 이웃 검색 → 군집 대표점에서 하나의 최종 원 계산</span>
    <b>max(100, {result.maxCenterDistanceM.toFixed(1)} + {SIM_DISPLAY_MARGIN_M}) = {Math.max(SIM_NEIGHBOR_EPS_M,result.maxCenterDistanceM+SIM_DISPLAY_MARGIN_M).toFixed(1)}m → 10m 올림 = {result.displayRadiusM}m</b>
   </div>}
  </div>
 </div>
  <output className={styles.verdict} aria-live="polite"><span>이 단계에서 보이는 결과</span><b>{reason}</b></output>
  <div className={styles.progressBar}><span style={{width:((phase+1)/7*100)+'%'}}/></div>
  <div className={styles.stepActions}>
   <button type="button" onClick={previous} disabled={phase===0}><ArrowLeft size={14}/> 이전 단계</button>
   <button type="button" onClick={next} disabled={phase===6}>다음 단계 <ArrowRight size={14}/></button>
  </div>
  <p className={styles.accuracy}>이 시뮬레이터는 계산 순서·기준을 설명하기 위해 단순한 직선 좌표를 사용합니다. 실제 산출은 GPS 위경도의 Haversine 거리와 원본 통화별 위치 증거로 수행합니다.</p>
 </section>;
}
