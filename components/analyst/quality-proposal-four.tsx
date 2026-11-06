'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from './document-link';
import {
  Activity, AlertTriangle, BarChart3, CalendarDays, Check, ChevronDown, ChevronRight,
  CircleHelp, Download, Layers3, MapPinned, MapPin, PhoneCall,
  RotateCcw, Search, ShieldCheck, Signal, Users, X,
} from 'lucide-react';
import { loadDataset, loadDay, loadOverview } from '../../lib/analyst/data-loader';
import { indexDataset } from '../../lib/analyst/dataset-index';
import { buildImprovedView, buildOriginalCallLink, type ImprovedLocationFilter } from '../../lib/analyst/improved-overview';
import { getOverviewAnalytics, type ExperienceGroup } from '../../lib/analyst/overview-analytics';
import { calculateProposalGrades, type MosBand } from '../../lib/analyst/quality-proposal-metrics';
import { buildFourthHourly, fourthMaskedCustomer, fourthMosBand, fourthBandCalls, fourthPoorRates } from '../../lib/analyst/quality-proposal-four';
import { evaluateCallEvidence } from '../../lib/mos/call-evidence';
import type { AnalystDataset, AnalystDay, AnalystOverview, OverviewCall, OverviewCallLocation } from '../../lib/analyst/types';
import { AnalystMap } from './analyst-map';
import { overlayThreeSiteRough, type ThreeSiteRoughDataset } from '../../lib/analyst/three-site-rough';
import { adjustDateRange, datesInRange, combineDateOverviews, dateOfCall } from '../../lib/analyst/date-range';
import { MosCallInvestigation } from './mos-call-investigation';
import styles from './quality-proposal-four.module.css';
import { QualityTopNav } from './quality-top-nav';
import { ImprovementCandidateWorkspace } from './improvement-candidates';
import { classifySipReason11,sipReasonLabel,type SipReasonGroup } from '../../lib/analyst/sip-reason';
import { formatMdtObservation } from '../../lib/analyst/mdt-observation';
import { onlyDropCalls } from '../../lib/analyst/sip-drop-overview';
import { QualityCustomerPicker } from './quality-customer-picker';
import { MapPanelFrame } from './map-panel-frame';
import { scopeOverviewToCustomers } from '../../lib/analyst/customer-overview-scope';
import { byeSelectionLabel, byeSelectionDescription } from '../../lib/analyst/bye-selection';

const DATE = '2026-10-30';
const n = (value:number)=>value.toLocaleString('ko-KR');
const number=(v:number|null|undefined, digits=2)=>v==null||!Number.isFinite(v)?'—':v.toFixed(digits);
const ratio=(a:number,b:number)=>b>0?(a/b*100).toFixed(1)+'%':'—';
const fmtTime=(hour:number)=>String(hour).padStart(2,'0');
const csvCell=(value: string|number|null|undefined)=>{
  const raw=String(value??'');
  // Prevent Excel formula execution while preserving numeric negatives.
  const safe=typeof value==='number' ? raw : /^[=+@\-\t\r]/.test(raw) ? ' '+raw : raw;
  return '"'+safe.replace(/"/g,'""')+'"';
};

function MicroChart({data,color}:{data:number[];color:string}) {
  const high=Math.max(1,...data);
  const coords=data.map((val,i)=>`${3+i*4.2},${26-22*val/high}`).join(' ');
  return <svg className={styles.micro} viewBox="0 0 106 30" preserveAspectRatio="none" aria-hidden="true">
    <polyline points={coords} fill="none" stroke={color} strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round"/>
  </svg>;
}

function Topbar({date}:{date:string}){
  return <QualityTopNav active="quality" date={date}/>;
}
function PanelHeading({icon:Icon,title,caption,actions,className}:{
  icon:typeof Activity; title:string; caption?:string; actions?:React.ReactNode;className?:string;
}){
  return <div className={[styles.panelHeading,className].filter(Boolean).join(' ')}>
    <div className={styles.panelTitle}><Icon size={18}/><h2>{title}</h2>
      {caption&&<span className={styles.help} title={caption}><CircleHelp size={14}/></span>}
    </div>
    {actions&&<div className={styles.panelActions}>{actions}</div>}
  </div>;
}
function GradeDonut({grades,selected,onSelect,mode,onModeChange}:{
  grades:ReturnType<typeof calculateProposalGrades>;
  selected:MosBand|null;onSelect:(band:MosBand|null)=>void;
  mode:'mos'|'drop';onModeChange:(mode:'mos'|'drop')=>void;
}){
  const [bad,mid,good]=grades.bands;
  const stop=bad.percentage+mid.percentage;
  const gradient=grades.evaluated?
    `conic-gradient(#ee5262 0 ${bad.percentage}%, #f3ab24 ${bad.percentage}% ${stop}%, #18b67e ${stop}% 100%)`:
    'conic-gradient(#dfe6ee 0% 100%)';
  const choose=(band:MosBand)=>onSelect(mode==='drop'?band:(selected===band?null:band));
  const fromRing=(event:React.MouseEvent<HTMLButtonElement>)=>{
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
    <PanelHeading icon={Activity} title="MOS 점수 분포"
      caption={mode==='drop'?'SIP CDR 11.REASON이 Drop인 통화만 모아 MOS 등급별 비율을 계산합니다. 미평가는 제외합니다.':'유효 MOS(v5) 통화만 분모로 사용합니다. 미평가 통화는 제외합니다.'}
      actions={<label className={styles.distributionSelect}>분석 기준
        <select aria-label="MOS 점수 분포 기준" value={mode}
          onChange={e=>onModeChange(e.target.value as 'mos'|'drop')}>
          <option value="mos">MOS</option>
          <option value="drop">절단 (SIP 상태코드)</option>
        </select>
      </label>}/>
    <div className={styles.donutArea}>
      <div className={styles.donut} style={{background:gradient}}
        aria-label={`불량 ${bad.percentage.toFixed(1)}%, 보통 ${mid.percentage.toFixed(1)}%, 양호 ${good.percentage.toFixed(1)}%`}>
        <div className={styles.donutInside}>
          <span>{mode==='drop'?'Drop 평균 MOS':'평균 MOS'}</span>
          <strong>{number(grades.mean)}</strong>
        </div>
        <button className={styles.donutSelect} type="button" onClick={fromRing}
          aria-label={mode==='drop'?'절단(Drop) 통화 MOS 도넛: 색상 구간을 클릭해 해당 절단 통화의 MOS 등급을 조사':'MOS 도넛: 색상 구간을 클릭해 해당 등급의 통화를 조사하고 가운데를 클릭하면 해제'}
          title="색상 구간 선택 → 해당 MOS 등급 통화 필터"/>
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
    <p className={styles.donutFooter}>{mode==='drop'?`SIP 11.REASON Drop 전체 ${n(grades.evaluated+grades.unavailable)}건 · MOS 평가 ${n(grades.evaluated)}건 · 미평가 ${n(grades.unavailable)}건 제외 · 등급 선택 → 지도·목록 조사 · 시간대·고객 차트는 전체 MOS 기준`:`유효 ${n(grades.evaluated)}통화 · 미평가 ${n(grades.unavailable)}통화 제외 · ${selected?'선택 구간 다시 클릭 시 해제':'구간 클릭 → 통화 조사'}`}</p>
  </section>;
}

function HourlyChart({hourly,selected,onChoose}:{
  hourly:ReturnType<typeof buildFourthHourly>;selected:number|null;onChoose:(h:number)=>void;
}){
  const width=715,height=188,innerTop=17,innerBottom=166,left=48,right=width-42;
  const usable=right-left;
  const max=Math.max(1,...hourly.map(h=>h.evaluated));
  const maxAxis=Math.ceil(max/500)*500||500;
  const step=usable/24,barWidth=Math.max(9,step*.63);
  const line=hourly.flatMap(h=>h.mean===null?[]:[{
    x:left+step*(h.hour+.5), y:innerBottom-((h.mean-1)/4)*(innerBottom-innerTop),
  }]);
  const linePoints=line.map(p=>p.x.toFixed(1)+','+p.y.toFixed(1)).join(' ');
  return <section className={styles.panel}>
    <PanelHeading icon={BarChart3} title="시간대별 통화 품질" caption="통화 시작 시각 기준이며, 빨강은 MOS 3.0 미만, 파랑은 나머지 유효 MOS 통화입니다."
      actions={<div className={styles.legend}><span><i className={styles.red}/>저품질 통화</span><span><i className={styles.blue}/>그 외 통화</span><span><i className={styles.purple}/>평균 MOS</span></div>}/>
    <div className={styles.hourPlot}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%"
        aria-label="시간대별 MOS 유효 통화 누적 막대와 시간대 평균 MOS(v5) 추이">
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
          aria-label={`${fmtTime(h.hour)}시 유효 ${n(h.evaluated)}건, 저품질 ${n(h.poor)}건, 평균 MOS ${number(h.mean)}`}
          title={`${fmtTime(h.hour)}시: 불량 ${n(h.poor)} / 유효 ${n(h.evaluated)} · 평균 ${number(h.mean)}`}
          onClick={()=>onChoose(h.hour)}/>)}
      </div>
    </div>
    <div className={styles.plotFoot}>시간대를 선택하면 지도·통화 목록이 해당 시간으로 좁혀집니다. 평균 MOS 선은 유효 통화 기준입니다.</div>
  </section>;
}

const CUSTOMER_KIND = [
  {id:'affected' as const,label:'저품질 경험 고객',description:'불량 통화 1회 이상',color:'#a851d6',icon:Users},
  {id:'repeat' as const,label:'반복 불량 고객',description:'불량 통화 2회 이상',color:'#ed9626',icon:RotateCcw},
  {id:'consecutive' as const,label:'연속 불량 고객',description:'불량 통화 2회 연속',color:'#ef5062',icon:AlertTriangle},
];
function ExperiencePanel({analytics,cohort,onChoose}:{
  analytics:ReturnType<typeof getOverviewAnalytics>;cohort:ExperienceGroup|null;onChoose:(id:ExperienceGroup|null)=>void;
}){
  return <section className={styles.panel}>
    <PanelHeading icon={Users} title="고객 체감품질" caption="고유 고객 기준 MOS 품질 분석입니다. 직접 고객 설문 데이터는 아닙니다."/>
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
function Table({calls,selectedBand,distributionMode,regionNames,locationByCall,details,selected,onSelect,search,setSearch,sipFilter,setSipFilter,limit,onMore,onCsv}:{
  calls:OverviewCall[];
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
    <PanelHeading icon={PhoneCall} title={selectedBand?
      `${distributionMode==='drop'?'절단(Drop) · ':''}MOS ${{poor:'불량',fair:'보통',good:'양호'}[selectedBand]} 통화 목록`:'통화 상세 목록'}
      caption={selectedBand?
        (distributionMode==='drop'?'원본 SIP CDR 11.REASON Drop 통화 중 ':'')+'선택한 MOS 등급의 CDR 전체 통화 목록입니다. 지도 좌표가 없는 통화도 포함합니다.':
        '위치가 연결된 저MOS 통화 표본입니다. RTP 원본 수치는 고객별 CDR에서 읽으며 단위는 검증 전입니다.'}
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
    {pinned&&<div className={styles.pinnedNotice}>
      <MapPin size={14}/>선택 통화를 목록 최상단에 고정했습니다.
      <button type="button" onClick={()=>onSelect(pinned.id)}>통화 분석 팝업 열기 <ChevronRight size={13}/></button>
    </div>}
    <div className={styles.tableScroller}>
      <table className={styles.table}><thead><tr>
        <th>시작 시간</th><th>종료 시간</th><th>고객 (익명)</th><th>행정동</th>
        <th>MOS</th><th>SIP 상태코드 (11.REASON)</th><th>RTP Loss (원본)</th><th>Jitter (원본)</th>
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
          <td>{fourthMaskedCustomer(call.customerId)}</td>
          <td>{regionNames.get(loc?.areaId??'')??'—'}</td>
          <td><span className={styles.mosBadge} data-band={fourthMosBand(call)} title="원본 RTCP MOS(v5)">{number(call.mos)}</span></td>
          <td><span className={styles.sipBadge} data-reason={classifySipReason11(call.sipCause)}
            title={'원본 SIP CDR 11. REASON: '+(call.sipCause??'미제공')}>
              {sipReasonLabel(classifySipReason11(call.sipCause))}</span></td>
          <td>{number(rtp?.txPacketLoss)}</td><td>{number(rtp?.txJitter)}</td>
          <td>{radio?number(found.call.rsrp,1):'—'}</td>
          <td>{radio?number(found.call.sinr,1):'—'}</td>
          <td>{loc?<span className={styles.coordinates}><MapPin size={14}/>{loc.lat.toFixed(loc.positionQuality==='three-site-rough'?3:5)}, {loc.lon.toFixed(loc.positionQuality==='three-site-rough'?3:5)}
            <small>{loc.evidence==='gnss'?'GNSS':loc.evidence==='bye-cell'?'BYE 기지국(UE 아님)':loc.positionQuality==='three-site-rough'?'3사이트 근사(조사 권역)':'3사이트 추정'}</small>
            {loc.evidence==='bye-cell'&&<small title={`BYE Cell ${loc.byeCellId??''} · RU ${loc.byeRuId??''} · ${byeSelectionDescription(loc)} · 단말 실제 위치 아님`}>{loc.byeTechnology==='NR'?'5G · ':loc.byeTechnology==='LTE'?'LTE · ':''}{byeSelectionLabel(loc)}</small>}
            {loc.secondsBeforeEnd!=null&&<small title="원본 CDR END TIME 기준, 실제 SIP BYE 메시지 시각은 별도 미확인">
              종료 {Math.abs(loc.secondsBeforeEnd).toFixed(1)}초 {loc.secondsBeforeEnd<0?'후':'전'}
            </small>}</span>:'—'}</td>
        </tr>;
      })}
      {!shown.length&&<tr><td colSpan={11} className={styles.noData}>{selectedBand?
        '선택한 MOS 등급·시간·고객·위치 조건에 해당하는 통화가 없습니다.':
        '해당 조건에 위치가 연결된 통화가 없습니다.'}</td></tr>}
      </tbody></table>
    </div>
    <div className={styles.tableFoot}>
      <span>{selectedBand?`${distributionMode==='drop'?'SIP Drop · ':''}MOS ${{poor:'불량',fair:'보통',good:'양호'}[selectedBand]} CDR 통화`:'위치 연계 저MOS 통화'} <b>{n(calls.length)}건</b>
        · 표시 {n(shown.length)}건 · 위치 미제공 통화 포함 가능 · 표의 &apos;—&apos;는 원본 미제공 또는 MDT 미검증</span>
      {calls.length>shown.length&&<button type="button" onClick={onMore}>20건 더 보기 <ChevronRight size={14}/></button>}
    </div>
  </section>;
}

export function QualityProposalFour() {
  const [selectedDate,setSelectedDate]=useState(DATE);
  const [mapMode,setMapMode]=useState<'current'|'improvement'>('current');
  const [startDate,setStartDate]=useState(DATE);
  const [loaded,setLoaded]=useState<{loading:boolean;dataset:AnalystDataset|null;overview:AnalystOverview|null;rough:ThreeSiteRoughDataset|null;roughError:string|null;error:string|null}>({
    loading:true,dataset:null,overview:null,rough:null,roughError:null,error:null,
  });
  const [from,setFrom]=useState('00:00'),[to,setTo]=useState('23:59');
  const [evidence,setEvidence]=useState<ImprovedLocationFilter>('all');
  const [selectedHour,setSelectedHour]=useState<number|null>(null);
  const [district,setDistrict]=useState<string|null>(null);
  const [cohort,setCohort]=useState<ExperienceGroup|null>(null);
  const [selectedCustomerIds,setSelectedCustomerIds]=useState<string[]>([]);
  const [selectedBand,setSelectedBand]=useState<MosBand|null>(null);
  const [distributionMode,setDistributionMode]=useState<'mos'|'drop'>('mos');
  const [chosenCall,setChosenCall]=useState<string|null>(null);
  const [dialogOpen,setDialogOpen]=useState(false);
  const dialogCloseRef=useRef<HTMLButtonElement>(null);
  const [detailCache,setDetailCache]=useState<{dataset:AnalystDataset|null;values:Record<string,AnalystDay>}>({dataset:null,values:{}});
  const [more,setMore]=useState(12);
  const [search,setSearch]=useState('');
  const [sipFilter,setSipFilter]=useState<SipReasonGroup|'all'>('all');
  const [deep,setDeep]=useState(false);
  const [focus,setFocus]=useState<{key:string;lat:number;lon:number}|undefined>();
  const overview=loaded.overview, dataset=loaded.dataset;
  // A refreshed manifest may point to a different source revision. Never pair
  // its overview with detail records normalized from an earlier dataset.
  const details=useMemo(()=>detailCache.dataset===dataset?detailCache.values:{},[detailCache,dataset]);
  const datasetIndex=useMemo(()=>dataset?indexDataset(dataset):null,[dataset]);
  const availableDates=[...new Set(dataset?.meta.dates??[])].sort();
  const changePeriod=(start:string,end:string)=>{
    if(start===startDate&&end===selectedDate)return;
    setStartDate(start);setSelectedDate(end);
    setLoaded(prev=>({...prev,loading:true,overview:null,rough:null,roughError:null,error:null}));
    setSelectedHour(null);setDistrict(null);setSelectedBand(distributionMode==='drop'?'poor':null);setCohort(null);
    setChosenCall(null);setDialogOpen(false);setFocus(undefined);setEvidence('all');
    setMore(12);setSearch('');
  };

  useEffect(()=>{
    const controller=new AbortController();
    async function load(){
      try{
        const dataset=await loadDataset('MDT',controller.signal);
        const rangeDates=datesInRange(dataset.meta.dates,startDate,selectedDate);
        if(!rangeDates.length)throw new Error('분석 기간에 해당하는 날짜별 자료를 확인하세요.');
        const summaries=await Promise.all(rangeDates.map(day=>loadOverview(dataset,'MDT',day,controller.signal)));
        const summary=combineDateOverviews(summaries);
        if(!summary.administrativeDongs?.length||!summary.callLocations?.length)
          throw new Error(selectedDate+' 행정동 경계·통화 위치 자료가 없습니다.');
        if(dataset.meta.qoeBasis!=='rtcp-mos-v5')
          throw new Error('원본 RTCP MOS(v5) CDR 데이터가 필요합니다.');
        let rough:ThreeSiteRoughDataset|null=null;
        let roughError:string|null=null;
        try {
          const candidates=await Promise.all(rangeDates.map(async day=>{
            const response=await fetch('/qoe/three-site-rough/'+day+'.json',{
              signal:controller.signal,cache:'no-store',
            });
            if(!response.ok)throw new Error('3사이트 후보 자료 HTTP '+response.status+' ('+day+')');
            const candidate=await response.json() as ThreeSiteRoughDataset;
            if(candidate.sourceRevision!==dataset.meta.revision||candidate.date!==day||
              candidate.schemaVersion!=='coarse-three-site-v1')
              throw new Error(day+' 3사이트 후보 원본 버전이 일치하지 않습니다.');
            return candidate;
          }));
          rough={...candidates[0],date:summary.date,points:candidates.flatMap(c=>c.points)};
        }catch(error){
          if(controller.signal.aborted)return;
          roughError=error instanceof Error?error.message:'3사이트 후보 자료를 읽지 못했습니다.';
        }
        if(!controller.signal.aborted)setLoaded({loading:false,dataset,overview:summary,rough,roughError,error:null});
      }catch(error){
        if(!controller.signal.aborted)setLoaded({loading:false,dataset:null,overview:null,rough:null,roughError:null,
          error:error instanceof Error?error.message:'자료를 불러오지 못했습니다.'});
      }
    }
    void load();
    return ()=>controller.abort();
  },[startDate,selectedDate]);

  const selectedOverview=useMemo(()=>scopeOverviewToCustomers(overview,selectedCustomerIds),[overview,selectedCustomerIds]);
  const metrics=useMemo(()=>selectedOverview?calculateProposalGrades(selectedOverview,from,to):null,[selectedOverview,from,to]);
  const hourly=useMemo(()=>selectedOverview?buildFourthHourly(selectedOverview,from,to):[],[selectedOverview,from,to]);
  const analytics=useMemo(()=>{
    if(!selectedOverview)return null;
    const valid=/^\d\d:\d\d$/;
    if(!valid.test(from)||!valid.test(to))return getOverviewAnalytics([],'mos',3);
    const toMin=(v:string)=>Number(v.slice(0,2))*60+Number(v.slice(3));
    const lower=toMin(from),upper=toMin(to);
    return getOverviewAnalytics(lower<=upper?selectedOverview.calls.filter(call=>{
      const min=Math.floor(call.startSecond/60);
      return min>=lower&&min<=upper;
    }):[],'mos',3);
  },[selectedOverview,from,to]);
  const cohortIds=useMemo(()=>{
    if(!cohort||!analytics)return null;
    return new Set(analytics.experience.find(item=>item.id===cohort)?.customerIds??[]);
  },[cohort,analytics]);
  const customerOverview=useMemo(()=>overview?
    overlayThreeSiteRough(overview,loaded.rough,true):null,[overview,loaded.rough]);
  const selectedCustomerOverview=useMemo(()=>scopeOverviewToCustomers(customerOverview,selectedCustomerIds),[customerOverview,selectedCustomerIds]);
  const displayOverview=evidence==='bye-cell'?selectedOverview:selectedCustomerOverview;
  const customersWithCalls=useMemo(()=>{
    const lower=Number(from.slice(0,2))*60+Number(from.slice(3));
    const upper=Number(to.slice(0,2))*60+Number(to.slice(3));
    return new Set((selectedOverview?.calls??[]).filter(call=>{
      const minute=Math.floor(call.startSecond/60);
      return minute>=lower&&minute<=upper;
    }).map(call=>call.customerId)).size;
  },[selectedOverview,from,to]);
  const customerFocusKey=useMemo(()=>JSON.stringify([...selectedCustomerIds].sort()),[selectedCustomerIds]);
  const dropOverview=useMemo(()=>displayOverview?onlyDropCalls(displayOverview):null,[displayOverview]);
  const dropGrades=useMemo(()=>dropOverview?calculateProposalGrades(dropOverview,from,to):null,[dropOverview,from,to]);
  const scopeOverview=distributionMode==='drop'?dropOverview:displayOverview;
  const model=useMemo(()=>scopeOverview?buildImprovedView(scopeOverview,{
    from,to,hour:selectedHour,districtId:district,evidence,customerIds:cohortIds,
    band:selectedBand??'poor',
  }):null,[scopeOverview,from,to,selectedHour,district,evidence,cohortIds,selectedBand]);

  const regionNames=useMemo(()=>new Map((overview?.administrativeDongs??[]).map(d=>[d.id,d.label])),[overview]);
  // Each selected MOS grade gets its OWN original CDR-end-location subset.
  // No low-MOS location is ever reused to represent a different MOS grade.
  const geographicModel=model;
  const orderedCalls=useMemo(()=>{
    if(!model)return [];
    const population=selectedBand
      ? fourthBandCalls(model.visibleHours,selectedBand,{
          districtId:district,evidence,locations:scopeOverview?.callLocations??[],
        })
      : [...model.focusedCalls];
    return population.sort((a,b)=>(b.startTimestamp??'').localeCompare(a.startTimestamp??'')||b.startSecond-a.startSecond||a.id.localeCompare(b.id));
  },[model,selectedBand,district,evidence,scopeOverview?.callLocations]);
  const dataCalls=useMemo(()=>{
    if(!model)return [];
    let items=orderedCalls;
    const activeSipFilter=distributionMode==='drop'?'drop':sipFilter;
    if(activeSipFilter!=='all')items=items.filter(call=>classifySipReason11(call.sipCause)===activeSipFilter);
    if(!search.trim())return items;
    const query=search.trim().toLowerCase();
    return items.filter(call=>{
      const point=model.markerByCall.get(call.id);
      return (fourthMaskedCustomer(call.customerId)+' '+dateOfCall(call,selectedDate)+' '+call.start+' '+(regionNames.get(point?.areaId??'')??'')).toLowerCase().includes(query);
    });
  },[model,orderedCalls,search,sipFilter,distributionMode,regionNames,selectedDate]);
  const shown=useMemo(()=>dataCalls.slice(0,more),[dataCalls,more]);
  const selectedForFetch=chosenCall?dataCalls.find(call=>call.id===chosenCall)??null:null;

  useEffect(()=>{
    if(!dataset||(!shown.length&&!selectedForFetch))return;
    const controller=new AbortController();
    const unique=new Map([...shown,...(selectedForFetch?[selectedForFetch]:[])].map(c=>[c.customerId+':'+dateOfCall(c,selectedDate),c]));
    const pending=[...unique].filter(([key])=>!details[key])
      .map(([,call])=>datasetIndex?.daysByCustomer.get(call.customerId)?.get(dateOfCall(call,selectedDate)))
      .filter((entry):entry is NonNullable<typeof entry>=>Boolean(entry));
    if(!pending.length)return;
    let active=true;
    // Load only visible CDR detail partitions, not all 17,765 customers.
    void Promise.allSettled(pending.map(entry=>loadDay(dataset,entry,'MDT',controller.signal)))
      .then(outcomes=>{
        if(!active)return;
        const next:Record<string,AnalystDay>={};
        for(const o of outcomes)if(o.status==='fulfilled')next[o.value.customerId+':'+o.value.date]=o.value;
        if(Object.keys(next).length)setDetailCache(prev=>({dataset,
          values:{...(prev.dataset===dataset?prev.values:{}),...next}}));
      });
    return ()=>{active=false;controller.abort();};
  // A populated cache prevents redundant requests. Map-selected calls outside
  // the visible 12-row table still have their detail loaded on demand.
  },[dataset,datasetIndex,shown,selectedForFetch,details,selectedDate]);

  const selected=selectedForFetch;
  // Only the original CDR-end representative position of this exact call.
  // Never borrow an adjacent customer's location or a region centroid.
  const selectedLocation=selected?model?.markerByCall.get(selected.id):undefined;
  const selectedDay=selected?details[selected.customerId+':'+dateOfCall(selected,selectedDate)]:undefined;
  const selectedActual=selectedDay?.calls.find(call=>call.id===(selected?.rawCallId??selected?.id.slice(selected.customerId.length+1)));
  const mdtObserved=selectedActual?.mdtObservation
    ?formatMdtObservation(selectedActual.mdtObservation,selectedActual.matchStatus):null;
  const maxRegion=Math.max(1,...(geographicModel?.regions.map(area=>area.poorCalls)??[]));
  const poorRates=metrics?fourthPoorRates(metrics.bands[0].count,metrics.evaluated+metrics.unavailable,metrics.evaluated):null;
  const chooseBand=(next:MosBand|null)=>{
    setSelectedBand(distributionMode==='drop'?(next??'poor'):next);
    setChosenCall(null);setDialogOpen(false);setDeep(false);setMore(12);setSearch('');setSipFilter('all');
    // Selecting another grade resets geographic drilldowns; its own
    // CDR-backed BYE site anchors can now be mapped independently.
    if(next==='fair'||next==='good'){setDistrict(null);setEvidence('all');}
  };
  const chooseDistributionMode=(mode:'mos'|'drop')=>{
    setDistributionMode(mode);
    setSelectedBand(mode==='drop'?'poor':null);
    setSipFilter('all');setDistrict(null);setEvidence('all');
    setChosenCall(null);setDialogOpen(false);setDeep(false);
    setMore(12);setSearch('');setFocus(undefined);
  };
  const focusDistrict=(id:string|null)=>{
    const next=district===id?null:id;
    setDistrict(next);setChosenCall(null);setDialogOpen(false);setMore(12);
    const item=overview?.administrativeDongs?.find(p=>p.id===next);
    setFocus(prev=>item?{key:String((Number(prev?.key.split(':')[0])||0)+1)+':'+item.id,lat:item.lat,lon:item.lon}:undefined);
  };
  const clear=()=>{
    setFrom('00:00');setTo('23:59');setSelectedHour(null);setEvidence('all');
    setCohort(null);setSelectedBand(null);setDistributionMode('mos');setDistrict(null);setChosenCall(null);setDialogOpen(false);setFocus(undefined);
    setMore(12);setSearch('');setSipFilter('all');setDeep(false);setSelectedCustomerIds([]);
  };
  const applyCustomerIds=(ids:string[])=>{
    setSelectedCustomerIds([...new Set(ids.filter(id=>id.trim()))]);
    setMapMode('current');setSelectedHour(null);setDistrict(null);setCohort(null);
    setSelectedBand(null);setDistributionMode('mos');setEvidence('all');
    setChosenCall(null);setDialogOpen(false);setFocus(undefined);
    setMore(12);setSearch('');setSipFilter('all');setDeep(false);
  };
  const selectCall=(id:string)=>{
    // Clicking a real call on the map opens its evidence dialog immediately.
    setChosenCall(id);setDeep(false);setDialogOpen(true);setSearch('');
  };
  const selectTableCall=(id:string)=>{
    setChosenCall(id);setDeep(false);setDialogOpen(true);
  };
  useEffect(()=>{
    if(!dialogOpen)return;
    const prev=document.body.style.overflow;
    document.body.style.overflow='hidden';
    dialogCloseRef.current?.focus();
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape')setDialogOpen(false);
      if(event.key==='Tab'){
        const dialog=document.getElementById('qoe-call-analysis-dialog');
        const targets=dialog?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled])');
        if(!targets?.length)return;
        const first=targets[0],last=targets[targets.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      }
    };
    window.addEventListener('keydown',onKey);
    return ()=>{document.body.style.overflow=prev;window.removeEventListener('keydown',onKey);};
  },[dialogOpen]);
  const downloadCsv=()=>{
    if(!model||!dataCalls.length)return;
    const head=['시작','종료','고객 익명 표시ID','행정동','MOS(v5)','SIP 구분 (11.REASON)','원본 SIP 11.REASON','RTP Loss 원본','Jitter 원본','RSRP dBm','SINR dB','위도','경도','위치 근거','대표 관측 UTC','CDR 종료 UTC','종료 전 시간차(초)','BYE Cell ID','BYE RU ID','좌표 선정 방식','BYE RU 선택 근거','BYE 후보 수','BYE 선택 MDT 종료 전 시간차(초)'];
    const lines=[head,...dataCalls.map(call=>{
      const place=model.markerByCall.get(call.id);
      const day=details[call.customerId+':'+dateOfCall(call,selectedDate)],found=day?.calls.find(c=>c.id===(call.rawCallId??call.id.slice(call.customerId.length+1)));
      const mdt=found?.matchStatus==='MATCHED'&&found.hasMdt;
      return [dateOfCall(call,selectedDate)+' '+call.start,call.end,fourthMaskedCustomer(call.customerId),regionNames.get(place?.areaId??'')??'',
        call.mos??'',sipReasonLabel(classifySipReason11(call.sipCause)),call.sipCause??'',found?.rtp?.txPacketLoss??'',found?.rtp?.txJitter??'',
        mdt?found.rsrp??'':'',mdt?found.sinr??'':'',place?.lat??'',place?.lon??'',place?.evidence??'',place?.observedAt??'',place?.cdrEndAt??'',place?.secondsBeforeEnd??'',place?.byeCellId??'',place?.byeRuId??'',place?.representativeBasis??'',place?.byeSelectionMethod??'',place?.byeCandidateCount??'',place?.byeSelectionDeltaSeconds??''];
    })].map(row=>row.map(csvCell).join(','));
    const file=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(file);
    const link=document.createElement('a');
    link.href=url;link.download=`voice-${distributionMode==='drop'?'sip-drop':'mos'}-${selectedBand??'located-poor'}-${startDate}_${selectedDate}.csv`;link.click();
    URL.revokeObjectURL(url);
  };

  return <div className={styles.shell}>
    <Topbar date={selectedDate}/>
    <main className={styles.main}>
      <div className={styles.filters} aria-label="품질 현황 분석 조건">
        <label className={styles.dateField}><CalendarDays size={17}/>
          <span>시작일</span>
          <select aria-label="분석 시작일" value={startDate} onChange={event=>{
            const next=adjustDateRange(dataset?.meta.dates??[DATE],startDate,selectedDate,'start',event.target.value);
            changePeriod(next.start,next.end);
          }}>
            {(dataset?.meta.dates??[DATE]).map(date=><option key={date} value={date}>{date}</option>)}
          </select></label>
        <label className={styles.dateField}><span>종료일</span>
          <select aria-label="분석 종료일" value={selectedDate} onChange={event=>{
            const next=adjustDateRange(dataset?.meta.dates??[DATE],startDate,selectedDate,'end',event.target.value);
            changePeriod(next.start,next.end);
          }}>
            {(dataset?.meta.dates??[DATE]).map(date=><option key={date} value={date}>{date}</option>)}
          </select></label>
        <button type="button" className={styles.allDatesButton} aria-label="전체 분석기간 조회"
          disabled={loaded.loading||!availableDates.length}
          aria-pressed={startDate===availableDates[0]&&selectedDate===availableDates.at(-1)}
          onClick={()=>{
            if(availableDates.length)changePeriod(availableDates[0],availableDates.at(-1)!);
          }}>전체 기간</button>
        {dataset&&<span className={styles.rangeHint}>{datesInRange(availableDates,startDate,selectedDate).length}일 선택</span>}
        <label>시간 <input type="time" value={from} aria-label="시작 시간"
          onChange={e=>{setFrom(e.target.value);setSelectedHour(null);}}/></label>
        <span className={styles.separator}>~</span>
        <label><input type="time" value={to} aria-label="종료 시간"
          onChange={e=>{setTo(e.target.value);setSelectedHour(null);}}/></label>
        <div className={styles.filterSpacer}/>
        <fieldset className={styles.mapModeButtons} aria-label="지도 모드">
          <button type="button" aria-pressed={mapMode==='current'}
            onClick={()=>{setMapMode('current');setChosenCall(null);setDialogOpen(false);}}>기존 현황</button>
          <button type="button" aria-pressed={mapMode==='improvement'}
            disabled={selectedCustomerIds.length>0}
            aria-describedby={selectedCustomerIds.length?'customer-filter-candidate-note':undefined}
            title="2026.10.26~10.30 원본 5일로 계산한 반복 불량 조사 후보"
            onClick={()=>{setMapMode('improvement');setChosenCall(null);setDialogOpen(false);}}>개선 후보 분석</button>
        </fieldset>
        <QualityCustomerPicker dataset={loaded.loading?null:dataset} overview={customerOverview} from={from} to={to}
          selectedCustomerIds={selectedCustomerIds} onApplyCustomerIds={applyCustomerIds}/>
        <span className={styles.analysisBasis} title="데이터 출처 MDT · 원본 RTCP MOS(v5) · 저품질 기준 MOS < 3.0">MDT · MOS(v5) · 저품질 &lt; 3.0</span>
        {selectedHour!==null&&<button className={styles.filterApplied} onClick={()=>setSelectedHour(null)}>{selectedHour}시 선택 <X size={13}/></button>}
        {district&&<button className={styles.filterApplied} onClick={()=>focusDistrict(null)}>{regionNames.get(district)} <X size={13}/></button>}
        {selectedBand&&distributionMode==='mos'&&<button className={styles.filterApplied} onClick={()=>chooseBand(null)}
          aria-label={`MOS ${{poor:'불량',fair:'보통',good:'양호'}[selectedBand]} 선택 해제`}>
          MOS ${{poor:'불량',fair:'보통',good:'양호'}[selectedBand]} <X size={13}/>
        </button>}
        {distributionMode==='drop'&&<span className={styles.filterApplied} aria-label="절단 통화 MOS 등급 필터 적용">SIP Drop · MOS {selectedBand?{poor:'불량',fair:'보통',good:'양호'}[selectedBand]:'불량'} <button type="button" aria-label="MOS 모드로 돌아가기" onClick={()=>chooseDistributionMode('mos')}><X size={13}/></button></span>}
        <button className={styles.reset} onClick={clear} title="필터 초기화" aria-label="전체 필터 초기화"><RotateCcw size={18}/></button>
      </div>
      {selectedCustomerIds.length>0&&<section className={styles.customerScope} aria-label="선택 고객 필터" aria-live="polite">
        <div><strong><Users size={16}/>선택 고객 {n(selectedCustomerIds.length)}명 기준</strong>
          <span>지표·그래프·지도·순위·통화 목록에 적용</span>
          {!loaded.loading&&customersWithCalls<selectedCustomerIds.length&&<span>
            현재 기간·시간에 통화가 없는 선택 고객 {n(selectedCustomerIds.length-customersWithCalls)}명
          </span>}
          <small id="customer-filter-candidate-note">개선 후보 분석은 전체 고객으로 미리 계산한 자료입니다. 고객 필터를 해제하면 열 수 있습니다.</small>
        </div>
        <button type="button" onClick={()=>applyCustomerIds([])} aria-label="선택 고객 필터 해제">전체 고객으로 보기 <X size={14}/></button>
      </section>}
      {loaded.loading&&<output className={styles.loadState}>{startDate} ~ {selectedDate} CDR·행정동·MDT 자료를 불러오는 중입니다…</output>}
      {loaded.error&&<div className={styles.loadError} role="alert">{loaded.error}</div>}
      {overview&&metrics&&model&&analytics&&<>
        {!model.validRange&&<div className={styles.loadError}>시간 범위를 확인하세요. 종료 시간이 시작 시간보다 빠릅니다.</div>}
        {mapMode==='current'&&<section className={styles.kpis} aria-label="주요 MOS 품질 지표">
          {[
            {name:'전체 통화',value:n(metrics.evaluated+metrics.unavailable)+'건',sub:`MOS 평가 ${n(metrics.evaluated)}건 · 미평가 ${n(metrics.unavailable)}건`,icon:PhoneCall,color:'#328ee3',background:'#e4f1ff',data:hourly.map(h=>h.total)},
            {name:'MOS 평가 가능',value:n(metrics.evaluated)+'건',sub:`전체의 ${ratio(metrics.evaluated,metrics.evaluated+metrics.unavailable)}`,icon:Layers3,color:'#12ba9f',background:'#dffaf5',data:hourly.map(h=>h.evaluated)},
            {name:'평균 MOS (v5)',value:number(metrics.mean),sub:'유효 통화의 RTCP MOS 원본',icon:Activity,color:'#8f69e4',background:'#f0eaff',data:hourly.map(h=>h.mean??0)},
            {name:'저품질 통화',value:n(metrics.bands[0].count)+'건',
              sub:`유효 MOS 대비 ${poorRates?.evaluated==null?'—':poorRates.evaluated.toFixed(1)+'%'} · MOS < 3.0`,
              totalRate:poorRates?.total==null?'—':poorRates.total.toFixed(1)+'%',
              icon:AlertTriangle,color:'#eb4e5d',background:'#ffeaee',data:hourly.map(h=>h.poor)},
          ].map(entry=>{
            const Icon=entry.icon;
            return <div className={styles.kpi} key={entry.name}>
              <div className={styles.kpiSymbol} style={{color:entry.color,background:entry.background}}><Icon size={28}/></div>
              <div className={styles.kpiContent}><span>{entry.name}</span>
                <div className={styles.kpiValueLine}>
                  <strong style={entry.name==='저품질 통화'?{color:'#cb3546'}:{}}>{entry.value}</strong>
                  {entry.totalRate&&<em className={styles.poorTotalRate} title="미평가 포함, 전체 SIP CDR 통화 대비">전체 대비 {entry.totalRate}</em>}
                </div>
                <small>{entry.sub}</small></div>
              <MicroChart data={entry.data} color={entry.color}/>
            </div>;
          })}
        </section>}
        {mapMode==='current'&&<div className={styles.charts}>
          <GradeDonut grades={distributionMode==='drop'?(dropGrades??metrics):metrics} selected={selectedBand} onSelect={chooseBand}
            mode={distributionMode} onModeChange={chooseDistributionMode}/>
          <HourlyChart hourly={hourly} selected={selectedHour} onChoose={hour=>{setSelectedHour(old=>old===hour?null:hour);setChosenCall(null);setMore(12);}}/>
          <ExperiencePanel analytics={analytics} cohort={cohort}
            onChoose={id=>{setCohort(id);setChosenCall(null);setMore(12);}}/>
        </div>}
        {mapMode==='improvement'
          ? <ImprovementCandidateWorkspace sourceRevision={dataset?.meta.revision??''}/>
          : <div className={styles.geography}>
          <MapPanelFrame className={styles.panel} label="통화 종료 위치 지도" suspended={dialogOpen}>
          {({toggleButton})=><>
            <PanelHeading icon={MapPinned}
              className={styles.mapPanelHeading}
              title={(distributionMode==='drop'?'절단(Drop) · ':'')+(selectedBand==='good'?'양호 통화 종료 위치 지도':selectedBand==='fair'?'보통 통화 종료 위치 지도':'저품질 통화 종료 위치 지도')}
              caption="GNSS 실측 우선 → GNSS가 없는 통화는 3사이트 RSRP 가중중심을 대략적인 조사 권역으로 표시 → BYE 기지국 참고. 3사이트 중심점은 실제 단말 위치나 검증된 정확도가 아닙니다. 기지국 좌표는 단말 실제 위치가 아닙니다."
              actions={<div className={styles.mapFilters}>
                <button aria-pressed={evidence==='all'} type="button" onClick={()=>setEvidence('all')}>
                  {evidence==='all'&&<Check size={13}/>} 전체
                </button>
                <button aria-pressed={evidence==='gnss'} type="button" onClick={()=>setEvidence('gnss')}>
                  GNSS
                </button>
                <button aria-pressed={evidence==='estimated'} type="button" onClick={()=>setEvidence('estimated')}>
                  3사이트 추정
                </button>
                <button aria-pressed={evidence==='bye-cell'} type="button" onClick={()=>setEvidence('bye-cell')}>
                  BYE 기지국
                </button>
                {toggleButton}
              </div>}/>
            <div className={styles.mapHost} data-map-surface>
              <AnalystMap
                source="MDT"
                scoreBand={selectedBand??'poor'}
                administrativeDongs={overview.administrativeDongs}
                cells={geographicModel?.mapCells??[]}
                callLocations={geographicModel?.locations??[]}
                clusterOccurrences
                focusKey={'proposal-four-'+startDate+'-'+selectedDate+'-'+customerFocusKey}
                focusTarget={focus}
                selectedCellId={district}
                onCellSelect={focusDistrict}
                onCallLocationSelect={selectCall}
              />
            </div>
            <div className={styles.mapFoot}><div><span className={styles.gnssDot}/>GNSS {n(geographicModel?.locations.filter(p=>p.evidence==='gnss').length??0)}건</div>
              <div><span className={styles.trilatDot}/>3사이트 대략 위치 후보 {n(geographicModel?.locations.filter(p=>p.evidence==='estimated').length??0)}건</div>
              <div><span className={styles.byeCellDot}/>BYE 기지국 {n(geographicModel?.locations.filter(p=>p.evidence==='bye-cell').length??0)}건 <span title="실제 단말 위치 아님">(UE 위치 아님)</span></div>
              <div><span className={styles.outlineDot}/>행정동 경계</div>
              <small>GNSS 중 종료 60~180초 전 마지막 실측 {n(geographicModel?.locations.filter(p=>p.positionQuality==='gnss-last-known').length??0)}건은 종료 실측 위치가 아닌 참고점입니다.</small>
              <small>{`선택 등급 위치 근거 ${n(geographicModel?.locatedPoorCalls??0)}통화 · 3사이트는 대략적인 조사 영역이며 실제 불량 시점 위치가 아님 · BYE Cell은 기지국 좌표`}</small>
              {loaded.roughError&&<small><output>3사이트 후보 자료 미적용: {loaded.roughError}</output></small>}
            </div>
          </>}
          </MapPanelFrame>
          <section className={styles.panel}>
            <PanelHeading icon={Signal}
              title={(distributionMode==='drop'?'절단(Drop) · ':'')+(selectedBand==='good'?'양호 통화 위치 기준 행정동 순위':selectedBand==='fair'?'보통 통화 위치 기준 행정동 순위':'종료 위치 기준 행정동 저품질 순위')}
              caption="MOS는 CDR 원본 그대로입니다. GNSS는 180초 이내 마지막 실측 시점의 행정동이며 BYE 종료 시점의 실제 위치와 다를 수 있습니다. BYE 기지국 기준 지역도 UE 위치를 의미하지 않습니다."
              actions={<span className={styles.rankingSort}>위치 연결 건수 순 <ChevronDown size={13}/></span>}/>
            <div className={styles.rankingHeader}><span>순위 / 위치 행정동</span><span>연결 통화</span><span>위치 근거</span><span>고객</span></div>
            <div className={styles.rankingList}>
              {(geographicModel?.regions??[]).slice(0,9).map((place,index)=>{
                return <button key={place.id} type="button" className={styles.rank}
                  aria-pressed={place.id===district} onClick={()=>focusDistrict(place.id)}>
                  <span className={styles.rankNo}>{index+1}</span><b>{place.label}</b>
                  <span className={styles.rankCount}>{n(place.poorCalls)}건
                    <span className={styles.rankTrack}><span style={{width:(place.poorCalls/maxRegion*100)+'%'}}/></span>
                  </span>
                  <span className={styles.rankEvidence}>GNSS {n(place.gnssCalls)} / 3사이트 {n(place.estimatedCalls)} / 기지국 {n(place.byeCellCalls)}</span>
                  <b className={styles.rankCustomers}>{n(place.customerCount)}명</b>
                </button>;
              })}
              {!(geographicModel?.regions.length)&&<p className={styles.noResults}>
                해당 MOS 등급·시간·고객·위치 근거 조건의 위치 자료가 없습니다.
              </p>}
            </div>
            <p className={styles.rankingFoot}>통화당 대표 위치 1개 · BYE Cell은 기지국 기준 행정동(실제 단말 위치 아님) · 지역 전체 불량률 미산출</p>
          </section>
        </div>}
        {mapMode==='current'&&<Table calls={dataCalls} selectedBand={selectedBand} distributionMode={distributionMode} regionNames={regionNames} locationByCall={model.markerByCall}
          details={details} selected={chosenCall} onSelect={selectTableCall} search={search} setSearch={setSearch}
          sipFilter={sipFilter} setSipFilter={setSipFilter}
          limit={more} onMore={()=>setMore(v=>v+20)} onCsv={downloadCsv}/>}
        {selected&&dialogOpen&&<div className={styles.modalBackdrop}>
          <button type="button" className={styles.modalBackdropClose}
            aria-label="통화 분석 팝업 바깥 영역 닫기" onClick={()=>setDialogOpen(false)}/>
          <dialog open id="qoe-call-analysis-dialog" className={styles.investigate+' '+styles.analysisModal}
            aria-modal="true" aria-labelledby="qoe-call-analysis-title">
          <div className={styles.investigateHead}>
            <strong id="qoe-call-analysis-title">선택한 통화 분석 · {selected.start} · MOS {number(selected.mos)}</strong>
            <div><Link href={buildOriginalCallLink(selected,dateOfCall(selected,selectedDate))}>고객·통화 분석 원본 <ChevronRight size={14}/></Link>
            <button type="button" onClick={()=>setDeep(v=>!v)}>{deep?'원인 분석 접기':'RTP·무선 근거 자세히'} <ChevronDown size={14}/></button>
            <button type="button" className={styles.dialogClose} ref={dialogCloseRef}
              aria-label="통화 분석 팝업 닫기" onClick={()=>setDialogOpen(false)}><X size={18}/></button></div>
          </div>
          <section className={styles.dialogLocation} aria-label="선택 통화 종료 대표 위치 지도">
            <div className={styles.dialogLocationHead}>
              <strong><MapPin size={16}/>통화 종료 대표 위치</strong>
              {selectedLocation&&<span className={styles.dialogLocationSource} data-evidence={selectedLocation.evidence}>
                {selectedLocation.positionQuality==='gnss-last-known'?'마지막 GNSS 기준 (종료 시점 아님)':
                  selectedLocation.evidence==='gnss'?'GNSS 관측':
                  selectedLocation.evidence==='estimated'?(selectedLocation.positionQuality==='three-site-rough'?'3사이트 대략 위치 후보':'3사이트 이상 무선 추정'):'BYE Cell 기지국'}
              </span>}
            </div>
            {selectedLocation?<>
              <div className={styles.dialogLocationMap}>
                <AnalystMap
                  key={'dialog-'+selected.id}
                  source="MDT"
                  scoreBand={selectedBand??'poor'}
                  callLocations={[selectedLocation]}
                  focusKey={'proposal-four-call-dialog-'+selected.id}
                  focusTarget={selectedLocation.byeRuId&&selectedLocation.byeStationLat!=null&&selectedLocation.byeStationLon!=null
                    ? null : {key:selected.id,lat:selectedLocation.lat,lon:selectedLocation.lon}}
                />
              </div>
              <div className={styles.dialogLocationMeta}>
                <span><MapPin size={13}/>{selectedLocation.lat.toFixed(selectedLocation.positionQuality==='three-site-rough'?3:6)}, {selectedLocation.lon.toFixed(selectedLocation.positionQuality==='three-site-rough'?3:6)}</span>
                <span>{regionNames.get(selectedLocation.areaId)??'행정동 미확인'}</span>
                {selectedLocation.evidence==='bye-cell'
                  ? <span>{selectedLocation.byeTechnology==='NR'?'5G (NR) · ':selectedLocation.byeTechnology==='LTE'?'LTE · ':''}종료 Cell ID {selectedLocation.byeCellId??'미제공'} · RU {selectedLocation.byeRuId??'미제공'}</span>
                  : selectedLocation.secondsBeforeEnd!=null
                    ? <span>CDR 종료 {Math.abs(selectedLocation.secondsBeforeEnd).toFixed(1)}초 {selectedLocation.secondsBeforeEnd<0?'후':'전'} 관측</span>
                    : null}
              </div>
              {selectedLocation.byeRuId&&<p className={styles.dialogLocationNote} data-bye-selection={selectedLocation.byeSelectionMethod??'unknown'}>
                BYE 기지국 선택: {byeSelectionDescription(selectedLocation)}. 기지국 참고 위치입니다.
              </p>}
              <p className={styles.dialogLocationNote}>
                {selectedLocation.evidence==='gnss'&&selectedLocation.possibleRadiusM!=null&&
                  '마지막 실측 GNSS '+(selectedLocation.gnssReferenceAgeSec??0).toFixed(1)+
                  '초 전 · 이동 가능 범위 약 '+Math.round(selectedLocation.possibleRadiusM).toLocaleString()+
                  'm (가정). BYE 종료 위치 실측이 아닙니다. '+
                  (selectedLocation.byeRuId?'종료 BYE 기지국 '+selectedLocation.byeRuId+'은 별도 참고 위치입니다. ':'')}
                {selectedLocation.evidence==='bye-cell'
                  ? '표시된 위치는 BYE Cell 기지국 좌표이며 고객 단말의 실제 위치가 아닙니다.'
                  : selectedLocation.evidence==='estimated'
                    ? selectedLocation.positionQuality==='three-site-rough'
                      ? '3개 이상 독립 기지국의 위치·RSRP를 이용한 대략적인 조사 권역 중심입니다. 조사 반경 약 '+Math.round(selectedLocation.roughSearchRadiusM??0).toLocaleString()+'m는 현장 참고용 가정이며 정확도 또는 신뢰구간이 아닙니다. 실제 통화 저하 시점의 단말 위치를 뜻하지 않습니다.'
                      : '3사이트 이상 무선 측량 기반 추정 좌표입니다. 실제 위치 오차가 검증된 값은 아닙니다.'
                    : 'GNSS 관측 좌표입니다. 측정 정확도 정보는 제공되지 않았습니다.'}
                {' '}통화 종료 대표 위치는 MOS 저하 순간의 위치를 뜻하지 않습니다.
              </p>
            </>:<p className={styles.dialogLocationUnavailable}>
              연결 가능한 GNSS·3사이트 이상 추정 또는 BYE Cell 기지국 참고 좌표가 없습니다.
              위치를 임의로 생성하지 않았습니다.
            </p>}
          </section>
          {selectedActual&&selectedDay?<>
            <div className={styles.selectedMetrics}>
              <div><span>CDR MOS(v5)</span><b>{number(selectedActual.mosV5Original??selectedActual.mos,3)}</b></div>
              <div className={styles.sipResultMetric} data-reason={classifySipReason11(selectedActual.sipCause)}
                title={'원본 SIP CDR 11.REASON: '+(selectedActual.sipCause||'미제공')+' · SIP 응답코드가 아닌 통화 종료 사유입니다.'}>
                <span>상태코드 결과 (11.REASON)</span>
                <b>{sipReasonLabel(classifySipReason11(selectedActual.sipCause))}</b>
                <small>{selectedActual.sipCause||'원본 종료 사유 미제공'}</small>
              </div>
              <div><span>Audio Tx Loss (원본)</span><b>{number(selectedActual.rtp?.txPacketLoss)}</b></div>
              <div><span>Audio Tx Jitter (원본)</span><b>{number(selectedActual.rtp?.txJitter)}</b></div>
              <div className={styles.mdtObservedMetric} data-observation={mdtObserved?.observation??'unverified'}>
                <span>MDT 측정 현황</span><b>{mdtObserved?.headline??'MDT 시각 확인 필요'}</b>
                {mdtObserved&&<small title={mdtObserved.detail+' · '+mdtObserved.timeDetail}>
                  {mdtObserved.detail}</small>}
              </div>
            </div>
            {mdtObserved&&<p className={styles.mdtObservationFoot} data-observation={mdtObserved.observation}>
              <strong>MDT 관측 시각:</strong> {mdtObserved.timeDetail}
              <span> · CDR 통화 시작·종료와 MDT 측정 시각 비교이며 동일 통화·시계 동기화가 독립적으로 확정된 것은 아닙니다.</span>
            </p>}
            {!selectedActual.hasMdt&&<p className={styles.caution}>
              MDT가 없는 통화입니다. 3사이트 RSRP 측량은 수행하지 않습니다.
              {model.markerByCall.get(selected.id)?.evidence==='bye-cell'
                ? ' BYE Cell의 기지국 참고 좌표를 대체 위치로 사용했습니다. 실제 단말 위치가 아닙니다.'
                : ' 종료 Cell ID에 연결 가능한 기지국 좌표가 없어 위치를 제공하지 않습니다.'}
            </p>}
            {deep&&<MosCallInvestigation call={selectedActual} samples={selectedDay.samples}/>}
          </>:<p className={styles.loadingDetail}>선택 통화의 CDR 상세를 불러오는 중입니다…</p>}
          {selectedActual&&selectedDay&&<p className={styles.caution}>{evaluateCallEvidence(selectedActual,selectedDay.samples).conclusion} · RTP Loss/Jitter 원본 단위 및 MDT 연결의 신원 확인은 미검증입니다.</p>}
          </dialog>
        </div>}
        <footer className={styles.footer}><ShieldCheck size={15}/>원본 SIP CDR MOS(v5) 사용 · GNSS/3사이트 추정 또는 CDR BYE Cell 기지국 기반 대체 위치.
          BYE 기지국 좌표는 UE 실제 위치가 아니며, MOS 저하 순간을 나타내지 않습니다. RTP 원본 단위는 검증 전입니다.
          행정동 경계 기준일 {overview.boundaryBaseDate?.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3')??'미제공'}.
        </footer>
      </>}
    </main>
  </div>;
}
