'use client';

import type {MouseEvent,ReactNode} from 'react';
import {Activity,AlertTriangle,BarChart3,Check,ChevronRight,CircleHelp,Download,Layers3,MapPin,MapPinned,PhoneCall,RotateCcw,Search,Users,X} from 'lucide-react';
import type {AnalystDay,OverviewCall,OverviewCallLocation} from '../../lib/analyst/types';
import type {ProposalGradeStats,MosBand} from '../../lib/analyst/quality-proposal-metrics';
import type {HourMosPoint} from '../../lib/analyst/quality-proposal-four';
import type {OverviewAnalytics,ExperienceGroup} from '../../lib/analyst/overview-analytics';
import type {QualityCandidateInvestigation} from '../../lib/analyst/quality-improvement-adapter';
import type {ImprovedLocationFilter} from '../../lib/analyst/improved-overview';
import {fourthMaskedCustomer,fourthMosBand} from '../../lib/analyst/quality-proposal-four';
import {dateOfCall} from '../../lib/analyst/date-range';
import {classifySipReason11,sipReasonLabel,type SipReasonGroup} from '../../lib/analyst/sip-reason';
import {effectiveCallQoe} from '../../lib/analyst/derived-qoe';
import {byeSelectionLabel,byeSelectionDescription} from '../../lib/analyst/bye-selection';
import styles from './quality-proposal-four.module.css';

const DATE='2026-10-30';
const n=(value:number)=>value.toLocaleString('ko-KR');
const number=(v:number|null|undefined,digits=2)=>v==null||!Number.isFinite(v)?'—':v.toFixed(digits);
const fmtTime=(hour:number)=>String(hour).padStart(2,'0');

function PanelHeading({icon:Icon,title,caption,actions,className}:{
  icon:typeof Activity; title:string; caption?:string; actions?:ReactNode;className?:string;
}){
  return <div className={[styles.panelHeading,className].filter(Boolean).join(' ')}>
    <div className={styles.panelTitle}><Icon size={18}/><h2>{title}</h2>
      {caption&&<span className={styles.help} title={caption}><CircleHelp size={14}/></span>}
    </div>
    {actions&&<div className={styles.panelActions}>{actions}</div>}
  </div>;
}

/** Preserve the original improvement-2 cards while accepting server aggregates. */
export function QualitySummaryKpis({grades,mapped,selectedBand}:{
  grades:ProposalGradeStats;mapped:{G:number;T:number;U:number};selectedBand:MosBand|null;
}){
  const ratio=(count:number,total:number)=>total>0?(100*count/total).toFixed(1)+'%':'—';
  const total=grades.evaluated+grades.unavailable,poor=grades.bands[0].count;
  const band=selectedBand??'poor';
  const bandCalls=grades.bands.find(item=>item.id===band)?.count??0;
  const entries=[
    {name:'전체 통화',value:n(total)+'건',sub:`QoE 평가 ${n(grades.evaluated)}건 · 미평가 ${n(grades.unavailable)}건`,icon:PhoneCall,color:'#328ee3',background:'#e4f1ff'},
    {name:'QoE 평가 가능',value:n(grades.evaluated)+'건',sub:`전체의 ${ratio(grades.evaluated,total)}`,icon:Layers3,color:'#12ba9f',background:'#dffaf5'},
    {name:'평균 QoE',value:number(grades.mean),sub:'MOS(v5) 기반',icon:Activity,color:'#8f69e4',background:'#f0eaff'},
    {name:'저품질 통화',value:n(poor)+'건',sub:`전체 대비 ${ratio(poor,total)} · QoE < 3.0`,mosRate:ratio(poor,grades.evaluated),icon:AlertTriangle,color:'#328ee3',background:'#e4f1ff'},
    {name:band==='good'?'양호 QoE 위치 활용':band==='fair'?'보통 QoE 위치 활용':'저품질통화 (위치활용)',value:n(mapped.U)+'건',extraSub:`GPS ${n(mapped.G)}건 · 삼각 측량 근사 ${n(mapped.T)}건`,
      locationRate:ratio(mapped.U,bandCalls),locationRateLabel:band==='good'?'양호 통화 대비':band==='fair'?'보통 통화 대비':'저품질 통화 대비',icon:MapPin,color:'#eb4e5d',background:'#ffeaee'},
  ];
  return <section className={styles.kpis} data-five="true" aria-label="주요 QoE 품질 지표">
    {entries.map(entry=>{
      const Icon=entry.icon,isLocationCard='locationRate' in entry;
      return <div className={[styles.kpi,isLocationCard?styles.locationKpi:''].filter(Boolean).join(' ')} key={entry.name}
        title={isLocationCard?'현재 지도에 표시되는 QoE 등급·기간·시간·고객·지역·위치 유형 기준 GPS + 삼각 측량 근사 위치 합계. 통화별 중복 제외 · BYE 기지국 제외 · 삼각 측량은 단말 실측 좌표가 아닌 RSRP 가중중심 조사 참고 위치':undefined}>
        <div className={styles.kpiSymbol} style={{color:entry.color,background:entry.background}}><Icon size={28}/></div>
        <div className={styles.kpiContent}><span>{entry.name}</span>
          <div className={styles.kpiValueLine}>
            <strong style={isLocationCard?{color:'#cb3546'}:{}}>{entry.value}</strong>
            {entry.mosRate&&<em className={styles.poorTotalRate} title="유효 QoE 평가 통화 대비">QoE 대비 {entry.mosRate}</em>}
            {'locationRate' in entry&&<em className={styles.locationCoverageRate} title="위치 활용 통화 수 ÷ 동일 기간·시간 범위의 해당 등급 통화 수 (지도 추가 필터 적용 시 분자만 감소)">{entry.locationRateLabel} {entry.locationRate}</em>}
          </div>
          {'sub' in entry&&entry.sub&&<small>{entry.sub}</small>}
          {'extraSub' in entry&&entry.extraSub&&<small className={styles.locationBreakdown}>{entry.extraSub}</small>}
        </div>
      </div>;
    })}
  </section>;
}

export function QualityMapPanelHeading({band,mode,evidence,onEvidenceChange,stationsVisible,stationCount,onToggleStations,toggleButton}:{
  band:MosBand|null;mode:'mos'|'drop';evidence:ImprovedLocationFilter;
  onEvidenceChange:(evidence:'all'|'gnss'|'estimated')=>void;
  stationsVisible:boolean;stationCount:number|null;onToggleStations:()=>void;toggleButton:ReactNode;
}){
  return <PanelHeading icon={MapPinned} className={styles.mapPanelHeading}
    title={(mode==='drop'?'절단(Drop) · ':'')+(band==='good'?'양호 통화 위치':band==='fair'?'보통 통화 위치':'저품질 통화 위치')}
    caption="GPS 실측과 삼각 측량 근사 조사 위치만 표시합니다. BYE 기지국 참고점은 숨겼으며, 삼각 측량 중심점은 실제 단말 위치나 검증된 정확도가 아닙니다."
    actions={<div className={styles.mapFilters} aria-label="통화 위치 지도 표시 조건">
      <button aria-pressed={evidence==='all'} type="button" onClick={()=>onEvidenceChange('all')}>{evidence==='all'&&<Check size={13}/>} 전체</button>
      <button aria-pressed={evidence==='gnss'} type="button" onClick={()=>onEvidenceChange('gnss')}>GPS</button>
      <button aria-pressed={evidence==='estimated'} type="button" onClick={()=>onEvidenceChange('estimated')}>삼각 측량</button>
      <button type="button" aria-label="기지국 표시 전환" aria-pressed={stationsVisible} disabled={stationCount===null}
        title="GPS 관측 연결 기지국(미확보 시 같은 통화의 BYE 참고 기지국)과 삼각 측량 입력 기지국 · 동일 좌표는 1곳으로 집계"
        onClick={onToggleStations}>기지국 {stationsVisible?'숨기기':'표시'} · {stationCount===null?'확인 중':n(stationCount)+'곳'}</button>
      {toggleButton}
    </div>}/>;
}
function GradeDonut({grades,selected,onSelect,mode,onModeChange}:{
  grades:ProposalGradeStats;
  selected:MosBand|null;onSelect:(band:MosBand|null)=>void;
  mode:'mos'|'drop';onModeChange:(mode:'mos'|'drop')=>void;
}){
  const [bad,mid,good]=grades.bands;
  const stop=bad.percentage+mid.percentage;
  const gradient=grades.evaluated?
    `conic-gradient(#ee5262 0 ${bad.percentage}%, #f3ab24 ${bad.percentage}% ${stop}%, #18b67e ${stop}% 100%)`:
    'conic-gradient(#dfe6ee 0% 100%)';
  const choose=(band:MosBand)=>onSelect(mode==='drop'?band:(selected===band?null:band));
  const fromRing=(event:MouseEvent<HTMLButtonElement>)=>{
    // Keyboard activation has no pointer coordinates; use the first band
    // (all three legend choices remain keyboard accessible).
    if(event.detail===0){
      if(mode==='drop'){if(bad.count>0)choose('poor');else if(mid.count>0)choose('fair');else if(good.count>0)choose('good');}
      else if(selected!==null)onSelect(null);
      else if(bad.count>0)choose('poor');
      return;
    }
    const rect=event.currentTarget.getBoundingClientRect();
    const dx=event.clientX-(rect.left+rect.width/2);
    const dy=event.clientY-(rect.top+rect.height/2);
    if(Math.hypot(dx,dy)<Math.min(rect.width,rect.height)*.35){
      if(mode==='mos'&&selected!==null)onSelect(null);
      return;
    }
    const percentile=((Math.atan2(dy,dx)*180/Math.PI+450)%360)/3.6;
    const band=percentile<bad.percentage?'poor':percentile<stop?'fair':'good';
    if(grades.bands.find(entry=>entry.id===band)?.count)choose(band);
  };
  return <section className={styles.panel}>
    <PanelHeading icon={Activity} title="QoE 분포"
      caption={mode==='drop'?'SIP Drop 통화는 원본 MOS(v5)에서 2.5점을 차감한 QoE로 분류합니다. 미평가는 제외합니다.':'원본 MOS(v5) 기반 QoE · SIP Drop은 −2.5점 적용 · 미평가 제외.'}
      actions={<label className={styles.distributionSelect}>분석 기준
        <select aria-label="QoE 분포 기준" value={mode}
          onChange={e=>onModeChange(e.target.value as 'mos'|'drop')}>
          <option value="mos">QoE</option>
          <option value="drop">절단 (SIP 상태코드)</option>
        </select>
      </label>}/>
    <div className={styles.donutArea}>
      <div className={styles.donut} style={{background:gradient}}
        aria-label={`불량 ${bad.percentage.toFixed(1)}%, 보통 ${mid.percentage.toFixed(1)}%, 양호 ${good.percentage.toFixed(1)}%`}>
        <div className={styles.donutInside}>
          <span>{mode==='drop'?'Drop 평균 QoE':'평균 QoE'}</span>
          <strong>{number(grades.mean)}</strong>
        </div>
        <button className={styles.donutSelect} type="button" onClick={fromRing}
          aria-label={mode==='drop'?'절단(Drop) 통화 QoE 도넛: 색상 구간을 클릭해 해당 절단 통화의 QoE 등급을 조사':'QoE 도넛: 색상 구간을 클릭해 해당 등급의 통화를 조사하고 가운데를 클릭하면 해제'}
          title="색상 구간 선택 → 해당 QoE 등급 통화 필터"/>
      </div>
      <div className={styles.donutList}>
        {grades.bands.map((entry,index)=><button type="button" className={styles.gradeItem} key={entry.id}
          aria-pressed={selected===entry.id} disabled={entry.count===0}
          title={`${entry.label} ${entry.range} · ${n(entry.count)}통화`}
          onClick={()=>choose(entry.id)}>
          <i style={{background:['#ee5262','#f3ab24','#18b67e'][index]}}/>
          <div className={styles.gradeText}>
            <b>{entry.label}</b><small>{entry.range}</small>
          </div>
          <strong>{entry.percentage.toFixed(1)}%</strong>
          <span>{n(entry.count)}건</span>
        </button>)}
      </div>
    </div>
    <p className={styles.donutFooter}>{mode==='drop'?`SIP 11.REASON Drop 전체 ${n(grades.evaluated+grades.unavailable)}건 · QoE 평가 ${n(grades.evaluated)}건 · 미평가 ${n(grades.unavailable)}건 제외 · 등급 선택 → 지도·목록 조사 · 시간대·고객 차트는 전체 QoE 기준`:`유효 ${n(grades.evaluated)}통화 · 미평가 ${n(grades.unavailable)}통화 제외 · ${selected?'선택 구간 다시 클릭 시 해제':'구간 클릭 → 통화 조사'}`}</p>
  </section>;
}

function HourlyChart({hourly,selected,onChoose}:{
  hourly:HourMosPoint[];selected:number|null;onChoose:(h:number)=>void;
}){
  const width=715,height=188,innerTop=17,innerBottom=166,left=48,right=width-42;
  const usable=right-left;
  const max=Math.max(1,...hourly.map(h=>h.evaluated));
  const maxAxis=Math.ceil(max/500)*500||500;
  const step=usable/24,barWidth=Math.max(9,step*.63);
  const line=hourly.flatMap(h=>h.mean===null?[]:[{
    x:left+step*(h.hour+.5), y:innerBottom-(Math.max(1,Math.min(5,h.mean))-1)/4*(innerBottom-innerTop),
  }]);
  const linePoints=line.map(p=>p.x.toFixed(1)+','+p.y.toFixed(1)).join(' ');
  return <section className={styles.panel}>
    <PanelHeading icon={BarChart3} title="시간대별 통화 품질" caption="통화 시작 시각 기준이며, 빨강은 QoE 3.0 미만, 파랑은 나머지 유효 QoE 통화입니다."
      actions={<div className={styles.legend}><span><i className={styles.red}/>저품질 통화</span><span><i className={styles.blue}/>그 외 통화</span><span><i className={styles.purple}/>평균 QoE</span></div>}/>
    <div className={styles.hourPlot}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%"
        aria-label="시간대별 QoE 유효 통화 누적 막대와 시간대 평균 QoE(Drop −2.5 반영) 추이">
        {[0,1,2,3,4].map(i=>{
          const val=maxAxis*(4-i)/4,y=innerTop+(innerBottom-innerTop)*i/4;
          return <g key={i}><line x1={left} x2={right} y1={y} y2={y} stroke="#e6edf6" strokeWidth="1"/>
            <text x={left-11} y={y+4} textAnchor="end" fill="#71829a" fontSize="11">{n(Math.round(val))}</text></g>;
        })}
        {[3,4,5].map(v=><text key={v} x={width-30}
          y={innerBottom-((v-1)/4)*(innerBottom-innerTop)+4} textAnchor="start" fill="#8b77c5" fontSize="10">{v.toFixed(1)}</text>)}
        {hourly.map(h=>{
          const barH=h.evaluated/maxAxis*(innerBottom-innerTop);
          const poorH=h.poor/maxAxis*(innerBottom-innerTop);
          const x=left+step*h.hour+(step-barWidth)/2;
          return <g key={h.hour}>
            {selected===h.hour&&<rect x={x-6} y={innerTop-3} width={barWidth+12} height={innerBottom-innerTop+14}
              fill="#e2f4f5" rx="4"/>}
            <rect x={x} y={innerBottom-(barH-poorH)} width={barWidth} height={Math.max(0,barH-poorH)} fill="#3d8fe1" rx="1"/>
            {poorH>0&&<rect x={x} y={innerBottom-barH} width={barWidth} height={Math.max(2,poorH)} fill="#ee5262" rx="1"/>}
            <text x={left+step*(h.hour+.5)} y={height-5} textAnchor="middle" fill="#75869a" fontSize="10">{fmtTime(h.hour)}</text>
          </g>;
        })}
        {line.length>1&&<polyline points={linePoints} fill="none" stroke="#8e69d8" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round" pointerEvents="none"/>}
        {line.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r="2.4"
          fill="#fff" stroke="#8e69d8" strokeWidth="1.7" pointerEvents="none"/>)}
      </svg>
      <div className={styles.hourHitboxes}>
        {hourly.map(h=><button key={h.hour} type="button" aria-pressed={selected===h.hour}
          aria-label={`${fmtTime(h.hour)}시 유효 ${n(h.evaluated)}건, 저품질 ${n(h.poor)}건, 평균 QoE ${number(h.mean)}`}
          title={`${fmtTime(h.hour)}시: 불량 ${n(h.poor)} / 유효 ${n(h.evaluated)} · 평균 ${number(h.mean)}`}
          onClick={()=>onChoose(h.hour)}/>)}
      </div>
    </div>
    <div className={styles.plotFoot}>시간대를 선택하면 지도·통화 목록이 해당 시간으로 좁혀집니다. 평균 QoE 선은 유효 통화 기준입니다.</div>
  </section>;
}

const CUSTOMER_KIND = [
  {id:'affected' as const,label:'저품질 경험 고객',description:'불량 통화 1회 이상',color:'#a851d6',icon:Users},
  {id:'repeat' as const,label:'반복 불량 고객',description:'불량 통화 2회 이상',color:'#ed9626',icon:RotateCcw},
  {id:'consecutive' as const,label:'연속 불량 고객',description:'불량 통화 2회 연속',color:'#ef5062',icon:AlertTriangle},
];
function ExperiencePanel({analytics,cohort,onChoose,improvement=false}:{
  analytics:OverviewAnalytics;cohort:ExperienceGroup|null;onChoose:(id:ExperienceGroup|null)=>void;improvement?:boolean;
}){
  return <section className={styles.panel}>
    <PanelHeading icon={Users} title="고객 체감품질" caption={improvement?'고유 고객 기준. 반복은 불량 통화 2회 이상, 연속은 시간순 인접 통화가 모두 불량인 경우입니다. 정상·미평가 통화를 건너뛰지 않습니다. 불량 관측일은 서로 다른 날짜, 연속 관측일은 달력상 인접 날짜입니다.':'고유 고객 기준 QoE 품질 분석입니다. 직접 고객 설문 데이터는 아닙니다.'}/>
    <div className={styles.experienceList}>
      {CUSTOMER_KIND.map((kind)=>{
        const group=analytics.experience.find(g=>g.id===kind.id);
        const Icon=kind.icon,max=Math.max(1,...(group?.hourly??[]));
        return <button type="button" key={kind.id} className={styles.experienceRow}
          aria-pressed={cohort===kind.id} disabled={group?.count==null}
          onClick={()=>onChoose(cohort===kind.id?null:kind.id)}>
          <span className={styles.experienceIcon} style={{color:kind.color,background:kind.color+'19'}}><Icon size={21}/></span>
          <span className={styles.experienceName}><b>{kind.label}</b><small>{kind.description}</small></span>
          <strong>{group?.count==null?'—':n(group.count)}<small>명</small></strong>
          <span className={styles.customerSpark}>
            {group?.hourly?.length===24?<svg viewBox="0 0 96 32" preserveAspectRatio="none" aria-hidden="true">
              {group.hourly.map((v,i)=><rect key={i} x={i*4} y={31-v/max*27} width="3.1"
                height={v/max*27} fill={kind.color} rx=".6" opacity={v===max?1:.62}/>)}
            </svg>:<small>시간 데이터 없음</small>}
          </span>
        </button>;
      })}
    </div>
    <p className={styles.experienceFoot}>{cohort?'고객 유형 필터 적용됨 · 다시 누르면 해제됩니다.':'고객 유형을 선택하면 지도·통화 목록과 연동됩니다.'}</p>
  </section>;
}

type RowData = {day:AnalystDay;call:AnalystDay['calls'][number]};
function Table({calls,totalCount,selectedBand,distributionMode,regionNames,locationByCall,details,selected,onSelect,search,setSearch,sipFilter,setSipFilter,limit,onMore,onCsv,investigation,investigationMode,onInvestigationMode,onClearInvestigation}:{
  calls:OverviewCall[];
  totalCount?:number;
  selectedBand:MosBand|null;
  distributionMode:'mos'|'drop';
  regionNames:Map<string,string>;
  locationByCall:Map<string,OverviewCallLocation>;
  details:Record<string,AnalystDay>;
  selected:string|null;
  onSelect:(id:string)=>void;
  search:string;setSearch:(value:string)=>void;
  sipFilter:SipReasonGroup|'all';setSipFilter:(value:SipReasonGroup|'all')=>void;
  limit:number;onMore:()=>void;onCsv:()=>void;
  investigation:QualityCandidateInvestigation|null;investigationMode:'members'|'customers';
  onInvestigationMode:(mode:'members'|'customers')=>void;onClearInvestigation:()=>void;
}){
  const first=calls.slice(0,limit);
  const pinned=selected?calls.find(call=>call.id===selected):null;
  // Always put the map-selected exact call first, regardless of page position.
  const shown=pinned
    ? [pinned,...first.filter(call=>call.id!==selected).slice(0,Math.max(0,limit-1))]
    : first;
  const lookup=(call:OverviewCall):RowData|null=>{
    const day=details[call.customerId+':'+dateOfCall(call,DATE)];
    const actual=day?.calls.find(c=>c.id===(call.rawCallId??call.id.slice(call.customerId.length+1)));
    return day&&actual?{day,call:actual}:null;
  };
  return <section className={styles.panel} id="qoe-proposal-four-calls">
    <PanelHeading icon={PhoneCall} title={investigation?'개선후보 · 통화 상세 목록':selectedBand?
      `${distributionMode==='drop'?'절단(Drop) · ':''}QoE ${{poor:'불량',fair:'보통',good:'양호'}[selectedBand]} 통화 목록`:'통화 상세 목록'}
      caption={investigation?'후보 관련 통화와 관련 고객의 기간 전체 통화를 구분합니다. 관련 고객 전체에는 정상·미평가·다른 지역 통화가 포함되며 후보 구성 통화 표시는 발견 구성원에만 붙습니다.':selectedBand?
        (distributionMode==='drop'?'원본 SIP CDR 11.REASON Drop 통화 중 ':'')+'선택한 QoE 등급의 CDR 전체 통화 목록입니다. 지도 좌표가 없는 통화도 포함합니다.':
        '위치가 연결된 저QoE 통화 표본입니다. RTP 원본 수치는 고객별 CDR에서 읽으며 단위는 검증 전입니다.'}
      actions={<div className={styles.tableActions}>
        <label className={styles.sipSelect}>SIP 11.REASON
          <select aria-label="SIP 종료 구분 필터" value={distributionMode==='drop'?'drop':sipFilter}
            disabled={distributionMode==='drop'} title={distributionMode==='drop'?'절단 분석에서는 Drop 통화만 표시합니다.':'원본 SIP CDR 11.REASON 기준'}
            onChange={e=>setSipFilter(e.target.value as SipReasonGroup|'all')}>
            <option value="all">전체</option>
            <option value="normal">Normal</option>
            <option value="drop">Drop</option>
            <option value="other">기타</option>
          </select>
        </label>
        <label className={styles.searchBox}><Search size={16}/><input type="search" value={search}
          onChange={e=>setSearch(e.target.value)} placeholder="고객 표시 ID·행정동·시각 검색" aria-label="통화 목록 검색"/></label>
        <button className={styles.csvButton} type="button" onClick={onCsv}><Download size={15}/>CSV 내보내기</button>
      </div>}/>
    {investigation&&<div className={styles.investigationScope} aria-label="개선후보 통화 선택 범위">
      <strong>{investigation.candidateId}</strong>
      <button type="button" aria-pressed={investigationMode==='members'} onClick={()=>onInvestigationMode('members')}>후보 관련 통화</button>
      <button type="button" aria-pressed={investigationMode==='customers'} onClick={()=>onInvestigationMode('customers')}>관련 고객 전체 통화</button>
      <small>전체 통화는 선택 기간·시간의 정상·미평가 및 다른 지역 통화를 포함합니다.</small>
      <button type="button" onClick={onClearInvestigation}>개선 필터 해제 <X size={12}/></button>
    </div>}
    {pinned&&<div className={styles.pinnedNotice}>
      <MapPin size={14}/>선택 통화를 목록 최상단에 고정했습니다.
      <button type="button" onClick={()=>onSelect(pinned.id)}>통화 분석 팝업 열기 <ChevronRight size={13}/></button>
    </div>}
    <div className={styles.tableScroller}>
      <table className={styles.table}><thead><tr>
        <th>시작 시간</th><th>종료 시간</th><th>고객 (익명)</th><th>행정동</th>
        <th>QoE</th><th>SIP 상태코드 (11.REASON)</th><th>RTP Loss (원본)</th><th>Jitter (원본)</th>
        <th>RSRP (dBm)</th><th>SINR (dB)</th><th>종료 대표 위치 (단말/기지국)</th>
      </tr></thead><tbody>
      {shown.map(call=>{
        const loc=locationByCall.get(call.id);
        const found=lookup(call);
        const rtp=found?.call.rtp;
        const radio=found?.call.matchStatus==='MATCHED' && found.call.hasMdt;
        return <tr key={call.id} data-call-id={call.id} className={selected===call.id?styles.selectedRow:''}
          onClick={()=>onSelect(call.id)}>
          <td><button className={styles.rowOpen} type="button"
            aria-label={call.start+' 선택 통화 팝업 열기'}
            onClick={event=>{event.stopPropagation();onSelect(call.id);}}>{dateOfCall(call,DATE).slice(5)} {call.start}</button></td><td>{call.end}</td>
          <td>{fourthMaskedCustomer(call.customerId)}{investigation?.callIds.includes(call.id)&&<small className={styles.candidateMember}>후보 구성 통화</small>}</td>
          <td>{regionNames.get(loc?.areaId??'')??'—'}</td>
          <td><span className={styles.mosBadge} data-band={fourthMosBand(call)} title="원본 MOS(v5), SIP Drop은 QoE −2.5점 반영">{number(effectiveCallQoe(call))}</span></td>
          <td><span className={styles.sipBadge} data-reason={classifySipReason11(call.sipCause)}
            title={'원본 SIP CDR 11. REASON: '+(call.sipCause??'미제공')}>
              {sipReasonLabel(classifySipReason11(call.sipCause))}</span></td>
          <td>{number(rtp?.txPacketLoss)}</td><td>{number(rtp?.txJitter)}</td>
          <td>{radio?number(found.call.rsrp,1):'—'}</td>
          <td>{radio?number(found.call.sinr,1):'—'}</td>
          <td>{loc?<span className={styles.coordinates}><MapPin size={14}/>{loc.lat.toFixed(loc.positionQuality==='three-site-rough'?3:5)}, {loc.lon.toFixed(loc.positionQuality==='three-site-rough'?3:5)}
            <small>{loc.evidence==='gnss'?'GPS':loc.evidence==='bye-cell'?'BYE 기지국(UE 아님)':loc.positionQuality==='three-site-rough'?'삼각 측량 근사(조사 권역)':'삼각 측량'}</small>
            {loc.evidence==='bye-cell'&&<small title={`BYE Cell ${loc.byeCellId??''} · RU ${loc.byeRuId??''} · ${byeSelectionDescription(loc)} · 단말 실제 위치 아님`}>{loc.byeTechnology==='NR'?'5G · ':loc.byeTechnology==='LTE'?'LTE · ':''}{byeSelectionLabel(loc)}</small>}
            {loc.secondsBeforeEnd!=null&&<small title="원본 CDR END TIME 기준, 실제 SIP BYE 메시지 시각은 별도 미확인">
              종료 {Math.abs(loc.secondsBeforeEnd).toFixed(1)}초 {loc.secondsBeforeEnd<0?'후':'전'}
            </small>}</span>:'—'}</td>
        </tr>;
      })}
      {!shown.length&&<tr><td colSpan={11} className={styles.noData}>{investigation?'현재 개선후보 선택 범위와 검색·SIP 조건에 해당하는 통화가 없습니다.':selectedBand?
        '선택한 QoE 등급·시간·고객·위치 조건에 해당하는 통화가 없습니다.':
        '해당 조건에 위치가 연결된 통화가 없습니다.'}</td></tr>}
      </tbody></table>
    </div>
    <div className={styles.tableFoot}>
      <span>{investigation?(investigationMode==='members'?'후보 관련 통화':'관련 고객의 기간 전체 통화'):selectedBand?`${distributionMode==='drop'?'SIP Drop · ':''}QoE ${{poor:'불량',fair:'보통',good:'양호'}[selectedBand]} CDR 통화`:'위치 연계 저QoE 통화'} <b>{n(totalCount??calls.length)}건</b>
        · 표시 {n(shown.length)}건 · 위치 미제공 통화 포함 가능 · 표의 &apos;—&apos;는 원본 미제공 또는 MDT 미검증</span>
      {(totalCount??calls.length)>shown.length&&<button type="button" onClick={onMore}>20건 더 보기 <ChevronRight size={14}/></button>}
    </div>
  </section>;
}

export {GradeDonut as QualityGradeDonut,HourlyChart as QualityHourlyChart,
  ExperiencePanel as QualityExperiencePanel,PanelHeading as QualityPanelHeading,Table as QualityCallTable};
