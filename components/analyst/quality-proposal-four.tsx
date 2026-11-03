'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from './document-link';
import {
  Activity, AlertTriangle, BarChart3, CalendarDays, Check, ChevronDown, ChevronRight,
  CircleHelp, Download, Layers3, MapPinned, MapPin, PhoneCall,
  RadioTower, RotateCcw, Search, ShieldCheck, Signal, Users, Waves, X,
} from 'lucide-react';
import { loadDataset, loadDay, loadOverview } from '../../lib/analyst/data-loader';
import { buildImprovedView, buildOriginalCallLink, type ImprovedLocationFilter } from '../../lib/analyst/improved-overview';
import { getOverviewAnalytics, type ExperienceGroup } from '../../lib/analyst/overview-analytics';
import { calculateProposalGrades, type MosBand } from '../../lib/analyst/quality-proposal-metrics';
import { buildFourthHourly, fourthMaskedCustomer, fourthMosBand, fourthBandCalls, fourthPoorRates } from '../../lib/analyst/quality-proposal-four';
import { evaluateCallEvidence } from '../../lib/mos/call-evidence';
import type { AnalystDataset, AnalystDay, AnalystOverview, OverviewCall, OverviewCallLocation } from '../../lib/analyst/types';
import { AnalystMap } from './analyst-map';
import { MosCallInvestigation } from './mos-call-investigation';
import styles from './quality-proposal-four.module.css';

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
const logoColor='#40d5c7';

function MicroChart({data,color}:{data:number[];color:string}) {
  const high=Math.max(1,...data);
  const coords=data.map((val,i)=>`${3+i*4.2},${26-22*val/high}`).join(' ');
  return <svg className={styles.micro} viewBox="0 0 106 30" preserveAspectRatio="none" aria-hidden="true">
    <polyline points={coords} fill="none" stroke={color} strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round"/>
  </svg>;
}

function Topbar({date}:{date:string}){
  return <header className={styles.nav}>
    <Link href="/" className={styles.brand}><RadioTower size={24} color={logoColor}/>QoE 분석 <span>· MOS 음성품질</span></Link>
    <nav aria-label="품질 분석 탭">
      <Link href={'/?source=MDT&view=overview&date='+date}><BarChart3 size={15}/>품질 현황</Link>
      <Link href={'/?source=MDT&view=contract&date='+date}><Users size={15}/>고객·통화 분석</Link>
      <Link href="/mos-lab"><Waves size={16}/>MOS 알고리즘 비교</Link>
      <Link href="/overview-proposal-1">개선1안</Link>
      <Link href="/overview-proposal-2">개선2안</Link>
      <Link href="/overview-proposal-3">개선3안</Link>
      <Link className={styles.current} aria-current="page" href="/overview-proposal-4">개선4안</Link>
    </nav>
    <span className={styles.topSource}><CalendarDays size={15}/>{date.replaceAll('-','.')} · MDT (Voice)</span>
  </header>;
}
function PanelHeading({icon:Icon,title,caption,actions}:{
  icon:typeof Activity; title:string; caption?:string; actions?:React.ReactNode;
}){
  return <div className={styles.panelHeading}>
    <div className={styles.panelTitle}><Icon size={18}/><h2>{title}</h2>
      {caption&&<span className={styles.help} title={caption}><CircleHelp size={14}/></span>}
    </div>
    {actions&&<div className={styles.panelActions}>{actions}</div>}
  </div>;
}
function GradeDonut({grades,selected,onSelect}:{
  grades:ReturnType<typeof calculateProposalGrades>;
  selected:MosBand|null;onSelect:(band:MosBand|null)=>void;
}){
  const [bad,mid,good]=grades.bands;
  const stop=bad.percentage+mid.percentage;
  const gradient=grades.evaluated?
    `conic-gradient(#ee5262 0 ${bad.percentage}%, #f3ab24 ${bad.percentage}% ${stop}%, #18b67e ${stop}% 100%)`:
    'conic-gradient(#dfe6ee 0% 100%)';
  const choose=(band:MosBand)=>onSelect(selected===band?null:band);
  const fromRing=(event:React.MouseEvent<HTMLButtonElement>)=>{
    // Keyboard activation has no pointer coordinates; use the first band
    // (all three legend choices remain keyboard accessible).
    if(event.detail===0){
      if(selected!==null)onSelect(null);
      else if(bad.count>0)choose('poor');
      return;
    }
    const rect=event.currentTarget.getBoundingClientRect();
    const dx=event.clientX-(rect.left+rect.width/2);
    const dy=event.clientY-(rect.top+rect.height/2);
    if(Math.hypot(dx,dy)<Math.min(rect.width,rect.height)*.35){
      if(selected!==null)onSelect(null);
      return;
    }
    const percentile=((Math.atan2(dy,dx)*180/Math.PI+450)%360)/3.6;
    const band=percentile<bad.percentage?'poor':percentile<stop?'fair':'good';
    if(grades.bands.find(entry=>entry.id===band)?.count)choose(band);
  };
  return <section className={styles.panel}>
    <PanelHeading icon={Activity} title="MOS 점수 분포" caption="유효 MOS(v5) 통화만 분모로 사용합니다. 미평가 통화는 제외합니다."/>
    <div className={styles.donutArea}>
      <div className={styles.donut} style={{background:gradient}}
        aria-label={`불량 ${bad.percentage.toFixed(1)}%, 보통 ${mid.percentage.toFixed(1)}%, 양호 ${good.percentage.toFixed(1)}%`}>
        <div className={styles.donutInside}>
          <span>평균 MOS</span>
          <strong>{number(grades.mean)}</strong>
        </div>
        <button className={styles.donutSelect} type="button" onClick={fromRing}
          aria-label="MOS 도넛: 색상 구간을 클릭해 해당 등급의 통화를 조사하고 가운데를 클릭하면 해제"
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
    <p className={styles.donutFooter}>유효 {n(grades.evaluated)}통화 · 미평가 {n(grades.unavailable)}통화 제외 · {selected?'선택 구간 다시 클릭 시 해제':'구간 클릭 → 통화 조사'}</p>
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
function Table({calls,selectedBand,regionNames,locationByCall,details,selected,onSelect,search,setSearch,limit,onMore,onCsv}:{
  calls:OverviewCall[];
  selectedBand:MosBand|null;
  regionNames:Map<string,string>;
  locationByCall:Map<string,OverviewCallLocation>;
  details:Record<string,AnalystDay>;
  selected:string|null;
  onSelect:(id:string)=>void;
  search:string;setSearch:(value:string)=>void;
  limit:number;onMore:()=>void;onCsv:()=>void;
}){
  const first=calls.slice(0,limit);
  const pinned=selected?calls.find(call=>call.id===selected):null;
  // Always put the map-selected exact call first, regardless of page position.
  const shown=pinned
    ? [pinned,...first.filter(call=>call.id!==selected).slice(0,Math.max(0,limit-1))]
    : first;
  const lookup=(call:OverviewCall):RowData|null=>{
    const day=details[call.customerId];
    const actual=day?.calls.find(c=>c.id===(call.rawCallId??call.id.slice(call.customerId.length+1)));
    return day&&actual?{day,call:actual}:null;
  };
  return <section className={styles.panel} id="qoe-proposal-four-calls">
    <PanelHeading icon={PhoneCall} title={selectedBand?
      `MOS ${{poor:'불량',fair:'보통',good:'양호'}[selectedBand]} 통화 목록`:'통화 상세 목록'}
      caption={selectedBand?
        '선택한 MOS 등급의 CDR 전체 통화 목록입니다. 지도 좌표가 없는 통화도 포함합니다.':
        '위치가 연결된 저MOS 통화 표본입니다. RTP 원본 수치는 고객별 CDR에서 읽으며 단위는 검증 전입니다.'}
      actions={<div className={styles.tableActions}>
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
        <th>MOS</th><th>RTP Loss (원본)</th><th>Jitter (원본)</th>
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
            onClick={event=>{event.stopPropagation();onSelect(call.id);}}>{call.start}</button></td><td>{call.end}</td>
          <td>{fourthMaskedCustomer(call.customerId)}</td>
          <td>{regionNames.get(loc?.areaId??'')??'—'}</td>
          <td><span className={styles.mosBadge} data-band={fourthMosBand(call)} title="원본 RTCP MOS(v5)">{number(call.mos)}</span></td>
          <td>{number(rtp?.txPacketLoss)}</td><td>{number(rtp?.txJitter)}</td>
          <td>{radio?number(found.call.rsrp,1):'—'}</td>
          <td>{radio?number(found.call.sinr,1):'—'}</td>
          <td>{loc?<span className={styles.coordinates}><MapPin size={14}/>{loc.lat.toFixed(5)}, {loc.lon.toFixed(5)}
            <small>{loc.evidence==='gnss'?'GNSS':loc.evidence==='bye-cell'?'BYE 기지국(UE 아님)':'3사이트 추정'}</small>
            {loc.evidence==='bye-cell'&&<small title={`BYE Cell ${loc.byeCellId??''} · RU ${loc.byeRuId??''} · 단말 실제 위치 아님`}>Cell {loc.byeCellId}</small>}
            {loc.secondsBeforeEnd!=null&&<small title="원본 CDR END TIME 기준, 실제 SIP BYE 메시지 시각은 별도 미확인">
              종료 {Math.abs(loc.secondsBeforeEnd).toFixed(1)}초 {loc.secondsBeforeEnd<0?'후':'전'}
            </small>}</span>:'—'}</td>
        </tr>;
      })}
      {!shown.length&&<tr><td colSpan={10} className={styles.noData}>{selectedBand?
        '선택한 MOS 등급·시간·고객·위치 조건에 해당하는 통화가 없습니다.':
        '해당 조건에 위치가 연결된 통화가 없습니다.'}</td></tr>}
      </tbody></table>
    </div>
    <div className={styles.tableFoot}>
      <span>{selectedBand?`MOS ${{poor:'불량',fair:'보통',good:'양호'}[selectedBand]} CDR 통화`:'위치 연계 저MOS 통화'} <b>{n(calls.length)}건</b>
        · 표시 {n(shown.length)}건 · 위치 미제공 통화 포함 가능 · 표의 &apos;—&apos;는 원본 미제공 또는 MDT 미검증</span>
      {calls.length>shown.length&&<button type="button" onClick={onMore}>20건 더 보기 <ChevronRight size={14}/></button>}
    </div>
  </section>;
}

export function QualityProposalFour() {
  const [selectedDate,setSelectedDate]=useState(DATE);
  const [loaded,setLoaded]=useState<{loading:boolean;dataset:AnalystDataset|null;overview:AnalystOverview|null;error:string|null}>({
    loading:true,dataset:null,overview:null,error:null,
  });
  const [from,setFrom]=useState('00:00'),[to,setTo]=useState('23:59');
  const [evidence,setEvidence]=useState<ImprovedLocationFilter>('all');
  const [selectedHour,setSelectedHour]=useState<number|null>(null);
  const [district,setDistrict]=useState<string|null>(null);
  const [cohort,setCohort]=useState<ExperienceGroup|null>(null);
  const [selectedBand,setSelectedBand]=useState<MosBand|null>(null);
  const [chosenCall,setChosenCall]=useState<string|null>(null);
  const [dialogOpen,setDialogOpen]=useState(false);
  const dialogCloseRef=useRef<HTMLButtonElement>(null);
  const [details,setDetails]=useState<Record<string,AnalystDay>>({});
  const [more,setMore]=useState(12);
  const [search,setSearch]=useState('');
  const [deep,setDeep]=useState(false);
  const [focus,setFocus]=useState<{key:string;lat:number;lon:number}|undefined>();
  const overview=loaded.overview, dataset=loaded.dataset;

  useEffect(()=>{
    const controller=new AbortController();
    async function load(){
      try{
        const dataset=await loadDataset('MDT',controller.signal);
        if(!dataset.meta.dates.includes(selectedDate))throw new Error('선택 일자 자료가 없습니다: '+selectedDate);
        const summary=await loadOverview(dataset,'MDT',selectedDate,controller.signal);
        if(!summary.administrativeDongs?.length||!summary.callLocations?.length)
          throw new Error(selectedDate+' 행정동 경계·통화 위치 자료가 없습니다.');
        if(dataset.meta.qoeBasis!=='rtcp-mos-v5')
          throw new Error('원본 RTCP MOS(v5) CDR 데이터가 필요합니다.');
        if(!controller.signal.aborted)setLoaded({loading:false,dataset,overview:summary,error:null});
      }catch(error){
        if(!controller.signal.aborted)setLoaded({loading:false,dataset:null,overview:null,
          error:error instanceof Error?error.message:'자료를 불러오지 못했습니다.'});
      }
    }
    void load();
    return ()=>controller.abort();
  },[selectedDate]);

  const metrics=useMemo(()=>overview?calculateProposalGrades(overview,from,to):null,[overview,from,to]);
  const hourly=useMemo(()=>overview?buildFourthHourly(overview,from,to):[],[overview,from,to]);
  const analytics=useMemo(()=>{
    if(!overview)return null;
    const valid=/^\d\d:\d\d$/;
    if(!valid.test(from)||!valid.test(to))return getOverviewAnalytics([],'mos',3);
    const toMin=(v:string)=>Number(v.slice(0,2))*60+Number(v.slice(3));
    const lower=toMin(from),upper=toMin(to);
    return getOverviewAnalytics(lower<=upper?overview.calls.filter(call=>{
      const min=Math.floor(call.startSecond/60);
      return min>=lower&&min<=upper;
    }):[],'mos',3);
  },[overview,from,to]);
  const cohortIds=useMemo(()=>{
    if(!cohort||!analytics)return null;
    return new Set(analytics.experience.find(item=>item.id===cohort)?.customerIds??[]);
  },[cohort,analytics]);
  const model=useMemo(()=>overview?buildImprovedView(overview,{
    from,to,hour:selectedHour,districtId:district,evidence,customerIds:cohortIds,
    band:selectedBand??'poor',
  }):null,[overview,from,to,selectedHour,district,evidence,cohortIds,selectedBand]);

  const regionNames=useMemo(()=>new Map((overview?.administrativeDongs??[]).map(d=>[d.id,d.label])),[overview]);
  // Each selected MOS grade gets its OWN original CDR-end-location subset.
  // No low-MOS location is ever reused to represent a different MOS grade.
  const geographicModel=model;
  const dataCalls=useMemo(()=>{
    if(!model)return [];
    const population=selectedBand
      ? fourthBandCalls(model.visibleHours,selectedBand,{
          districtId:district,evidence,locations:overview?.callLocations??[],
        })
      : [...model.focusedCalls];
    const items=population.sort((a,b)=>b.startSecond-a.startSecond||a.id.localeCompare(b.id));
    if(!search.trim())return items;
    const query=search.trim().toLowerCase();
    return items.filter(call=>{
      const point=model.markerByCall.get(call.id);
      return (fourthMaskedCustomer(call.customerId)+' '+call.start+' '+(regionNames.get(point?.areaId??'')??'')).toLowerCase().includes(query);
    });
  },[model,selectedBand,district,evidence,overview?.callLocations,search,regionNames]);
  const shown=useMemo(()=>dataCalls.slice(0,more),[dataCalls,more]);
  const selectedForFetch=chosenCall?dataCalls.find(call=>call.id===chosenCall)??null:null;

  useEffect(()=>{
    if(!dataset||(!shown.length&&!selectedForFetch))return;
    const controller=new AbortController();
    const unique=new Set([...shown,...(selectedForFetch?[selectedForFetch]:[])].map(c=>c.customerId));
    const pending=[...unique].filter(id=>!details[id])
      .map(id=>dataset.days.find(d=>d.customerId===id&&d.date===DATE))
      .filter((entry):entry is NonNullable<typeof entry>=>Boolean(entry));
    if(!pending.length)return;
    let active=true;
    // Load only visible CDR detail partitions, not all 17,765 customers.
    void Promise.allSettled(pending.map(entry=>loadDay(dataset,entry,'MDT',controller.signal)))
      .then(outcomes=>{
        if(!active)return;
        const next:Record<string,AnalystDay>={};
        for(const o of outcomes)if(o.status==='fulfilled')next[o.value.customerId]=o.value;
        if(Object.keys(next).length)setDetails(prev=>({...prev,...next}));
      });
    return ()=>{active=false;controller.abort();};
  // A populated cache prevents redundant requests. Map-selected calls outside
  // the visible 12-row table still have their detail loaded on demand.
  },[dataset,shown,selectedForFetch,details]);

  const selected=selectedForFetch;
  // Only the original CDR-end representative position of this exact call.
  // Never borrow an adjacent customer's location or a region centroid.
  const selectedLocation=selected?model?.markerByCall.get(selected.id):undefined;
  const selectedDay=selected?details[selected.customerId]:undefined;
  const selectedActual=selectedDay?.calls.find(call=>call.id===(selected?.rawCallId??selected?.id.slice(selected.customerId.length+1)));
  const maxRegion=Math.max(1,...(geographicModel?.regions.map(area=>area.poorCalls)??[]));
  const poorRates=metrics?fourthPoorRates(metrics.bands[0].count,metrics.evaluated+metrics.unavailable,metrics.evaluated):null;
  const chooseBand=(next:MosBand|null)=>{
    setSelectedBand(next);
    setChosenCall(null);setDialogOpen(false);setDeep(false);setMore(12);setSearch('');
    // Selecting another grade resets geographic drilldowns; its own
    // CDR-backed BYE site anchors can now be mapped independently.
    if(next==='fair'||next==='good'){setDistrict(null);setEvidence('all');}
  };
  const focusDistrict=(id:string|null)=>{
    const next=district===id?null:id;
    setDistrict(next);setChosenCall(null);setDialogOpen(false);setMore(12);
    const item=overview?.administrativeDongs?.find(p=>p.id===next);
    setFocus(prev=>item?{key:String((Number(prev?.key.split(':')[0])||0)+1)+':'+item.id,lat:item.lat,lon:item.lon}:undefined);
  };
  const clear=()=>{
    setFrom('00:00');setTo('23:59');setSelectedHour(null);setEvidence('all');
    setCohort(null);setSelectedBand(null);setDistrict(null);setChosenCall(null);setDialogOpen(false);setFocus(undefined);
    setMore(12);setSearch('');setDeep(false);
  };
  const selectCall=(id:string)=>{
    // Map popup -> pin the exact call to row 1; open modal only from the table.
    setChosenCall(id);setDeep(false);setDialogOpen(false);setSearch('');
  };
  const selectTableCall=(id:string)=>{
    setChosenCall(id);setDeep(false);setDialogOpen(true);
  };
  useEffect(()=>{
    if(chosenCall&&!dialogOpen)
      document.getElementById('qoe-proposal-four-calls')?.scrollIntoView({behavior:'smooth',block:'start'});
  },[chosenCall,dialogOpen]);
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
    const head=['시작','종료','고객 익명 표시ID','행정동','MOS(v5)','RTP Loss 원본','Jitter 원본','RSRP dBm','SINR dB','위도','경도','위치 근거','대표 관측 UTC','CDR 종료 UTC','종료 전 시간차(초)','BYE Cell ID','BYE RU ID','좌표 선정 방식'];
    const lines=[head,...dataCalls.map(call=>{
      const place=model.markerByCall.get(call.id);
      const day=details[call.customerId],found=day?.calls.find(c=>c.id===(call.rawCallId??call.id.slice(call.customerId.length+1)));
      const mdt=found?.matchStatus==='MATCHED'&&found.hasMdt;
      return [call.start,call.end,fourthMaskedCustomer(call.customerId),regionNames.get(place?.areaId??'')??'',
        call.mos??'',found?.rtp?.txPacketLoss??'',found?.rtp?.txJitter??'',
        mdt?found.rsrp??'':'',mdt?found.sinr??'':'',place?.lat??'',place?.lon??'',place?.evidence??'',place?.observedAt??'',place?.cdrEndAt??'',place?.secondsBeforeEnd??'',place?.byeCellId??'',place?.byeRuId??'',place?.representativeBasis??''];
    })].map(row=>row.map(csvCell).join(','));
    const file=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(file);
    const link=document.createElement('a');
    link.href=url;link.download=`voice-mos-${selectedBand??'located-poor'}-${selectedDate}.csv`;link.click();
    URL.revokeObjectURL(url);
  };

  return <div className={styles.shell}>
    <Topbar date={selectedDate}/>
    <main className={styles.main}>
      <div className={styles.filters} aria-label="개선4안 분석 조건">
        <label className={styles.dateField}><CalendarDays size={17}/>
          <span>분석 일자</span>
          <select aria-label="분석 일자" value={selectedDate} onChange={event=>{
            setSelectedDate(event.target.value);
            setLoaded(prev=>({...prev,loading:true,overview:null,error:null}));
            setSelectedHour(null);setDistrict(null);setSelectedBand(null);setCohort(null);
            setChosenCall(null);setDialogOpen(false);setFocus(undefined);setEvidence('all');
            setMore(12);setSearch('');
          }}>
            {(dataset?.meta.dates??[DATE]).map(date=><option key={date} value={date}>{date}</option>)}
          </select></label>
        <label>시간 <input type="time" value={from} aria-label="시작 시간"
          onChange={e=>{setFrom(e.target.value);setSelectedHour(null);}}/></label>
        <span className={styles.separator}>~</span>
        <label><input type="time" value={to} aria-label="종료 시간"
          onChange={e=>{setTo(e.target.value);setSelectedHour(null);}}/></label>
        <div className={styles.filterSpacer}/>
        <span className={styles.staticField}>데이터 출처 <b>MDT</b><ChevronDown size={13}/></span>
        <span className={styles.staticField}>평가 지표 <b>MOS(v5)</b><ChevronDown size={13}/></span>
        <span className={styles.staticField}>저품질 기준 <b>MOS &lt; 3.0</b></span>
        {selectedHour!==null&&<button className={styles.filterApplied} onClick={()=>setSelectedHour(null)}>{selectedHour}시 선택 <X size={13}/></button>}
        {district&&<button className={styles.filterApplied} onClick={()=>focusDistrict(null)}>{regionNames.get(district)} <X size={13}/></button>}
        {selectedBand&&<button className={styles.filterApplied} onClick={()=>chooseBand(null)}
          aria-label={`MOS ${{poor:'불량',fair:'보통',good:'양호'}[selectedBand]} 선택 해제`}>
          MOS ${{poor:'불량',fair:'보통',good:'양호'}[selectedBand]} <X size={13}/>
        </button>}
        <button className={styles.reset} onClick={clear} title="필터 초기화" aria-label="전체 필터 초기화"><RotateCcw size={18}/></button>
      </div>
      {loaded.loading&&<output className={styles.loadState}>{selectedDate} CDR·행정동·MDT 자료를 불러오는 중입니다…</output>}
      {loaded.error&&<div className={styles.loadError} role="alert">{loaded.error}</div>}
      {overview&&metrics&&model&&analytics&&<>
        {!model.validRange&&<div className={styles.loadError}>시간 범위를 확인하세요. 종료 시간이 시작 시간보다 빠릅니다.</div>}
        <section className={styles.kpis} aria-label="주요 MOS 품질 지표">
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
        </section>
        <div className={styles.charts}>
          <GradeDonut grades={metrics} selected={selectedBand} onSelect={chooseBand}/>
          <HourlyChart hourly={hourly} selected={selectedHour} onChoose={hour=>{setSelectedHour(old=>old===hour?null:hour);setChosenCall(null);setMore(12);}}/>
          <ExperiencePanel analytics={analytics} cohort={cohort}
            onChoose={id=>{setCohort(id);setChosenCall(null);setMore(12);}}/>
        </div>
        <div className={styles.geography}>
          <section className={styles.panel}>
            <PanelHeading icon={MapPinned}
              title={selectedBand==='good'?'양호 통화 종료 위치 지도':selectedBand==='fair'?'보통 통화 종료 위치 지도':'저품질 통화 종료 위치 지도'}
              caption="GNSS → 기본 검토 기준 통과 3사이트 추정 → BYE Cell 기지국. 기지국 좌표는 단말 실제 위치가 아닙니다."
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
              </div>}/>
            <div className={styles.mapHost}>
              <AnalystMap
                source="MDT"
                scoreBand={selectedBand??'poor'}
                administrativeDongs={overview.administrativeDongs}
                cells={geographicModel?.mapCells??[]}
                callLocations={geographicModel?.locations??[]}
                clusterOccurrences
                focusKey={'proposal-four-'+selectedDate}
                focusTarget={focus}
                selectedCellId={district}
                onCellSelect={focusDistrict}
                onCallLocationSelect={selectCall}
              />
            </div>
            <div className={styles.mapFoot}><div><span className={styles.gnssDot}/>GNSS {n(geographicModel?.locations.filter(p=>p.evidence==='gnss').length??0)}건</div>
              <div><span className={styles.trilatDot}/>3사이트 이상 무선 추정 {n(geographicModel?.locations.filter(p=>p.estimationMethod==='MULTILATERATION'&&(p.usedSiteCount??0)>=3).length??0)}건</div>
              <div><span className={styles.byeCellDot}/>BYE 기지국 {n(geographicModel?.locations.filter(p=>p.evidence==='bye-cell').length??0)}건 <span title="실제 단말 위치 아님">(UE 위치 아님)</span></div>
              <div><span className={styles.outlineDot}/>행정동 경계</div>
              <small>GNSS 중 종료 60~180초 전 마지막 실측 {n(geographicModel?.locations.filter(p=>p.positionQuality==='gnss-last-known').length??0)}건은 종료 실측 위치가 아닌 참고점입니다.</small>
              <small>{`선택 등급 위치 근거 ${n(geographicModel?.locatedPoorCalls??0)}통화 · BYE Cell은 기지국 위치이며 실제 단말 좌표가 아님`}</small>
            </div>
          </section>
          <section className={styles.panel}>
            <PanelHeading icon={Signal}
              title={selectedBand==='good'?'양호 통화 위치 기준 행정동 순위':selectedBand==='fair'?'보통 통화 위치 기준 행정동 순위':'종료 위치 기준 행정동 저품질 순위'}
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
        </div>
        <Table calls={dataCalls} selectedBand={selectedBand} regionNames={regionNames} locationByCall={model.markerByCall}
          details={details} selected={chosenCall} onSelect={selectTableCall} search={search} setSearch={setSearch}
          limit={more} onMore={()=>setMore(v=>v+20)} onCsv={downloadCsv}/>
        {selected&&dialogOpen&&<div className={styles.modalBackdrop}>
          <button type="button" className={styles.modalBackdropClose}
            aria-label="통화 분석 팝업 바깥 영역 닫기" onClick={()=>setDialogOpen(false)}/>
          <dialog open id="qoe-call-analysis-dialog" className={styles.investigate+' '+styles.analysisModal}
            aria-modal="true" aria-labelledby="qoe-call-analysis-title">
          <div className={styles.investigateHead}>
            <strong id="qoe-call-analysis-title">선택한 통화 분석 · {selected.start} · MOS {number(selected.mos)}</strong>
            <div><Link href={buildOriginalCallLink(selected,DATE)}>고객·통화 분석 원본 <ChevronRight size={14}/></Link>
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
                  selectedLocation.evidence==='estimated'?'3사이트 이상 무선 추정':'BYE Cell 기지국'}
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
                <span><MapPin size={13}/>{selectedLocation.lat.toFixed(6)}, {selectedLocation.lon.toFixed(6)}</span>
                <span>{regionNames.get(selectedLocation.areaId)??'행정동 미확인'}</span>
                {selectedLocation.evidence==='bye-cell'
                  ? <span>종료 Cell ID {selectedLocation.byeCellId??'미제공'} · RU {selectedLocation.byeRuId??'미제공'}</span>
                  : selectedLocation.secondsBeforeEnd!=null
                    ? <span>CDR 종료 {Math.abs(selectedLocation.secondsBeforeEnd).toFixed(1)}초 {selectedLocation.secondsBeforeEnd<0?'후':'전'} 관측</span>
                    : null}
              </div>
              <p className={styles.dialogLocationNote}>
                {selectedLocation.evidence==='gnss'&&selectedLocation.possibleRadiusM!=null&&
                  '마지막 실측 GNSS '+(selectedLocation.gnssReferenceAgeSec??0).toFixed(1)+
                  '초 전 · 이동 가능 범위 약 '+Math.round(selectedLocation.possibleRadiusM).toLocaleString()+
                  'm (가정). BYE 종료 위치 실측이 아닙니다. '+
                  (selectedLocation.byeRuId?'종료 BYE 기지국 '+selectedLocation.byeRuId+'은 별도 참고 위치입니다. ':'')}
                {selectedLocation.evidence==='bye-cell'
                  ? '표시된 위치는 BYE Cell 기지국 좌표이며 고객 단말의 실제 위치가 아닙니다.'
                  : selectedLocation.evidence==='estimated'
                    ? '3사이트 이상 무선 측량 기반 추정 좌표입니다. 실제 위치 오차가 검증된 값은 아닙니다.'
                    : 'GNSS 관측 좌표입니다. 측정 정확도 정보는 제공되지 않았습니다.'}
                {' '}통화 종료 대표 위치는 MOS 저하 순간의 위치를 뜻하지 않습니다.
              </p>
            </>:<p className={styles.dialogLocationUnavailable}>
              연결 가능한 GNSS·3사이트 이상 추정 또는 유일한 BYE Cell 기지국 좌표가 없습니다.
              위치를 임의로 생성하지 않았습니다.
            </p>}
          </section>
          {selectedActual&&selectedDay?<>
            <div className={styles.selectedMetrics}>
              <div><span>CDR MOS(v5)</span><b>{number(selectedActual.mosV5Original??selectedActual.mos,3)}</b></div>
              <div><span>Audio Tx Loss (원본)</span><b>{number(selectedActual.rtp?.txPacketLoss)}</b></div>
              <div><span>Audio Tx Jitter (원본)</span><b>{number(selectedActual.rtp?.txJitter)}</b></div>
              <div><span>MDT 연계 상태</span><b>{selectedActual.matchStatus==='MATCHED'?'시각 단독 후보':selectedActual.matchStatus==='AMBIGUOUS'?'중복 후보':'미연계'}</b></div>
            </div>
            {!selectedActual.hasMdt&&<p className={styles.caution}>
              MDT가 없는 통화입니다. 3사이트 RSRP 측량은 수행하지 않습니다.
              {model.markerByCall.get(selected.id)?.evidence==='bye-cell'
                ? ' BYE Cell의 유일한 기지국 좌표만 대체 위치로 사용했습니다. 실제 단말 위치가 아닙니다.'
                : ' 종료 Cell ID만으로 기지국을 유일하게 식별할 수 없어 위치를 제공하지 않습니다.'}
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
