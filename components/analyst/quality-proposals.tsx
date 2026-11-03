'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from './document-link';
import {
  Activity, AlertCircle, BadgeCheck, BarChart3, Repeat2, PhoneOff, UsersRound,
  CalendarDays, ChevronRight, CircleHelp, Frown, Headphones,
  ListFilter, Map, MapPin, Meh, Phone, RadioTower, RotateCcw,
  ShieldCheck, Signal, Smile, TrendingDown, Users, Waves,
} from 'lucide-react';
import { loadDataset, loadDay, loadOverview } from '../../lib/analyst/data-loader';
import {
  buildImprovedView, buildOriginalCallLink,
  type ImprovedLocationFilter,
} from '../../lib/analyst/improved-overview';
import { calculateProposalGrades, type ProposalGradeStats } from '../../lib/analyst/quality-proposal-metrics';
import { evaluateCallEvidence } from '../../lib/mos/call-evidence';
import { getOverviewAnalytics, type ExperienceGroup, type OverviewAnalytics } from '../../lib/analyst/overview-analytics';
import type { AnalystDataset, AnalystDay, AnalystOverview, OverviewCall } from '../../lib/analyst/types';
import { AnalystMap } from './analyst-map';
import { MosCallInvestigation } from './mos-call-investigation';
import styles from './quality-proposals.module.css';

type Version = 1 | 2 | 3;
type Loaded = {dataset:AnalystDataset;overview:AnalystOverview};
const fmt = (num:number) => num.toLocaleString('ko-KR');
const rate = (num:number,total:number) => total ? (num / total * 100).toFixed(1) + '%' : '—';
const SOURCE_NAMES:Record<ImprovedLocationFilter,string> = {
  all:'전체 위치', gnss:'GNSS 관측', estimated:'무선 추정', 'bye-cell':'BYE 기지국',
};
const stateIcons = {poor:Frown,fair:Meh,good:Smile};
const dateLabel = (raw:string) => raw.replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$1.$2.$3');
const numeric = (value:number|null|undefined, decimals=2) =>
  value == null || !Number.isFinite(value) ? '—' : value.toFixed(decimals);

type DashboardContext = {
  overview:AnalystOverview;
  model:ReturnType<typeof buildImprovedView>;
  grades:ProposalGradeStats;
  version:Version;
  customerAnalytics?:OverviewAnalytics;
  selectedCustomerGroup?:ExperienceGroup|null;
  onCustomerGroup?:(group:ExperienceGroup|null)=>void;
  chosenDistrict:string|null;
  chosenHour:number|null;
  chosenEvidence:ImprovedLocationFilter;
  callId:string|null;
  selected:OverviewCall|null;
  selectedDetail:AnalystDay|null;
  selectedDayCall:AnalystDay['calls'][number]|null;
  loadingDetail:boolean;
  detailError:string|null;
  showEvidence:boolean;
  limit:number;
  focus:{key:string;lat:number;lon:number}|undefined;
  onDistrict:(id:string|null)=>void;
  onHour:(hour:number)=>void;
  onEvidence:(source:ImprovedLocationFilter)=>void;
  onCall:(id:string)=>void;
  onLimit:()=>void;
  onToggleEvidence:()=>void;
  originalLink:string;
};

function DashboardNav({version, originalLink, date}:{version:Version;originalLink:string;date:string}) {
  return <header className={styles.topNav}>
    <Link href="/" className={styles.brand}><RadioTower size={22}/><span>QoE 분석 <b>· MOS 음성품질</b></span></Link>
    <nav aria-label="분석 화면">
      <Link href={originalLink}><BarChart3 size={15}/>품질 현황</Link>
      <Link href={'/?source=MDT&view=contract&date='+date}><Users size={15}/>고객·통화 분석</Link>
      <Link href="/mos-lab"><Waves size={15}/>MOS 알고리즘 비교</Link>
      <Link href="/overview-proposal-1" className={version===1?styles.selectedNav:''} aria-current={version===1?'page':undefined}>개선1안</Link>
      <Link href="/overview-proposal-2" className={version===2?styles.selectedNav:''} aria-current={version===2?'page':undefined}>개선2안</Link>
      <Link href="/overview-proposal-3" className={version===3?styles.selectedNav:''} aria-current={version===3?'page':undefined}>개선3안</Link>
      <Link href="/overview-proposal-4">개선4안</Link>
    </nav>
    <span className={styles.navSource}><BadgeCheck size={15}/> {dateLabel(date)} · SIP CDR</span>
  </header>;
}

function PanelTitle({icon:Icon,children,aside}:{icon:typeof Map;children:React.ReactNode;aside?:React.ReactNode}) {
  return <div className={styles.panelHeading}>
    <h2><Icon size={17} strokeWidth={2.5}/>{children}<CircleHelp className={styles.helpIcon} size={13}/></h2>
    {aside && <div className={styles.panelAside}>{aside}</div>}
  </div>;
}

const KPI_ICONS = [Phone, BadgeCheck, Activity, AlertCircle, Meh, Smile, MapPin];
function KpiCards({ctx}:{ctx:DashboardContext}) {
  const {model,grades} = ctx;
  const bad=grades.bands[0],warn=grades.bands[1],good=grades.bands[2];
  const cards=[
    {label:'전체 CDR 통화',value:fmt(model.globalSummary.total)+'건',sub:dateLabel(ctx.overview.date)+' · 선택 시간대',tone:'blue'},
    {label:'유효 MOS',value:fmt(grades.evaluated)+'건',sub:'미평가 '+fmt(grades.unavailable)+'건',tone:'blue'},
    {label:'평균 MOS',value:grades.mean===null?'—':grades.mean.toFixed(2),sub:'MOS(v5) · 유효 통화 기준',tone:'blue'},
    {label:'불량',value:rate(bad.count,grades.evaluated),sub:fmt(bad.count)+'건 · MOS < 3.0',tone:'poor'},
    {label:'보통',value:rate(warn.count,grades.evaluated),sub:fmt(warn.count)+'건 · 3.0~3.5',tone:'fair'},
    {label:'양호',value:rate(good.count,grades.evaluated),sub:fmt(good.count)+'건 · MOS ≥ 3.5',tone:'good'},
    {label:'위치 연결 저품질',value:fmt(model.locatedPoorCalls)+'건',sub:'저MOS 중심 MDT 부분표본',tone:'location'},
  ];
  return <section className={styles.kpiRow} aria-label="MOS 품질 핵심 성과 지표">
    {cards.map((card,index)=>{
      const Icon=KPI_ICONS[index];
      return <div key={card.label} className={`${styles.kpiCard} ${styles['tone_'+card.tone]}`}>
        <div className={styles.kpiTop}><span className={styles.kpiIcon}><Icon size={20} strokeWidth={2.4}/></span><span>{card.label}</span></div>
        <strong className={styles.kpiNumber}>{card.value}</strong>
        <small>{card.sub}</small>
      </div>;
    })}
  </section>;
}

function ExperienceCard({ctx}:{ctx:DashboardContext}) {
  const {grades}=ctx;
  return <section className={styles.experienceCard} aria-label="고객 체감품질 MOS 등급 요약">
    <PanelTitle icon={Headphones}>고객 체감품질</PanelTitle>
    <p className={styles.experienceDescription}>MOS(v5)로 요약한 통화 품질 수준 · 직접 고객 설문 결과는 아닙니다.</p>
    <div className={styles.phoneIllustration} aria-hidden="true">
      <span><Phone size={36} strokeWidth={1.9}/></span><Waves size={27}/><span className={styles.pulse}>●</span>
    </div>
    <div className={styles.experienceRows}>
      {grades.bands.map((band)=>{
        const Icon=stateIcons[band.id];
        return <div className={`${styles.experienceItem} ${styles['experience_'+band.id]}`} key={band.id}
          title={band.range+' · '+fmt(band.count)+'통화'}>
          <Icon size={24} strokeWidth={2.4}/>
          <span>{band.label}</span>
          <strong>{band.percentage.toFixed(1)}%</strong>
          <small>{fmt(band.count)}건</small>
        </div>;
      })}
    </div>
    <p className={styles.experienceFooter}>불량 &lt; 3.0 · 보통 &lt; 3.5 · 양호 ≥ 3.5</p>
  </section>;
}

function KpiCardsThree({ctx}:{ctx:DashboardContext}) {
  const {model,grades}=ctx;
  const items=[
    {label:'전체 통화',value:fmt(model.globalSummary.total),note:'SIP CDR 통화 기준',icon:Phone,tone:'blue'},
    {label:'MOS 평가 가능',value:fmt(grades.evaluated),note:'미평가 '+fmt(grades.unavailable)+'건',icon:BadgeCheck,tone:'blue'},
    {label:'평균 MOS(v5)',value:numeric(grades.mean),note:'유효 MOS 통화 기준',icon:Activity,tone:'blue'},
    {label:'저품질 통화',value:fmt(grades.bands[0].count),note:rate(grades.bands[0].count,grades.evaluated)+' · MOS < 3.0',icon:AlertCircle,tone:'poor'},
  ];
  return <section className={styles.kpiRow} aria-label="개선3안 주요 품질 지표">
    {items.map(({label,value,note,icon:Icon,tone})=>
      <div key={label} className={`${styles.kpiCard} ${styles['tone_'+tone]}`}>
        <div className={styles.kpiTop}><span className={styles.kpiIcon}><Icon size={20}/></span><span>{label}</span></div>
        <strong className={styles.kpiNumber}>{value}</strong>
        <small>{note}</small>
      </div>)}
  </section>;
}

function CustomerExperienceThree({ctx}:{ctx:DashboardContext}) {
  const analytics=ctx.customerAnalytics;
  const appearance={
    affected:{title:'저품질 경험 고객',icon:UsersRound,subtitle:'불량 통화 1회 이상',color:'#a34fd6'},
    repeat:{title:'반복 불량 고객',icon:Repeat2,subtitle:'불량 통화 2회 이상',color:'#e59a35'},
    consecutive:{title:'연속 불량 고객',icon:PhoneOff,subtitle:'불량 통화 2회 연속',color:'#df5d69'},
  };
  return <section className={styles.customerThreeCard} aria-label="고유 고객 기준 체감품질">
    <PanelTitle icon={UsersRound} aside={<span className={styles.panelTag}>고유 고객 {fmt(analytics?.experience[0]?.total??0)}명 기준</span>}>
      고객 체감품질
    </PanelTitle>
    <div className={styles.customerThreeBody}>
      {analytics?.experience.map(group=>{
        const meta=appearance[group.id];
        const Icon=meta.icon;
        const maximum=Math.max(1,...(group.hourly??[]));
        const pressed=ctx.selectedCustomerGroup===group.id;
        return <button key={group.id} type="button" className={styles.customerThreeRow}
          aria-pressed={pressed} disabled={group.count===null}
          aria-label={`${meta.title} ${group.count===null?'집계 불가':fmt(group.count)+'고객'}`}
          onClick={()=>ctx.onCustomerGroup?.(pressed?null:group.id)}>
          <span className={styles.customerThreeIcon} style={{color:meta.color,background:meta.color+'15'}}>
            <Icon size={20}/>
          </span>
          <span className={styles.customerThreeLabels}><b>{meta.title}</b><small>{meta.subtitle}</small></span>
          <span className={styles.customerThreeValue}>
            <strong>{group.count===null?'—':fmt(group.count)}</strong>
            <small>{group.count===null?'집계 불가':(group.percent??0).toFixed(1)+'%'}</small>
          </span>
          {group.hourly && group.count!==null ?
            <svg className={styles.customerSpark} viewBox="0 0 96 31" preserveAspectRatio="none"
              aria-label={meta.title+' 시간대별 고객 수'}>
              {group.hourly.map((val,i)=><rect key={i} x={i*4} y={30-val/maximum*27}
                width="3" height={val/maximum*27} rx=".5" fill={meta.color} opacity={val===maximum?1:.6}/>)}
            </svg>:<span className={styles.customerSparkMissing}>시간 집계 불가</span>}
        </button>;
      })}
    </div>
    <p className={styles.customerThreeFoot}>
      {ctx.selectedCustomerGroup?
        '선택 고객 유형의 통화 위치·목록만 지도에 표시 중 · 다시 선택하면 해제':
        '카드를 선택하면 해당 고객 유형의 위치·통화 목록을 조사합니다.'}
    </p>
  </section>;
}

function Controls({ctx,from,to,setFrom,setTo,reset,dates,onDate}:{
  ctx:DashboardContext;from:string;to:string;
  setFrom:(v:string)=>void;setTo:(v:string)=>void;reset:()=>void;
  dates:string[];onDate:(next:string)=>void;
}) {
  return <div className={styles.filters} aria-label="통화 품질 조사 조건">
    <label className={styles.filterDate}><CalendarDays size={15}/> 분석 일자
      <select aria-label="분석 일자" value={ctx.overview.date} onChange={e=>onDate(e.target.value)}>
        {dates.map(date=><option key={date} value={date}>{dateLabel(date)}</option>)}
      </select>
    </label>
    <label>시작 <input aria-label="시작 시간" type="time" value={from} onChange={(e)=>setFrom(e.target.value)}/></label>
    <label>종료 <input aria-label="종료 시간" type="time" value={to} onChange={(e)=>setTo(e.target.value)}/></label>
    <div className={styles.sourceFilter} aria-label="위치 신뢰도">
      <ListFilter size={15}/>{(['all','gnss','estimated','bye-cell'] as const).map((source)=>
        <button key={source} type="button" aria-pressed={ctx.chosenEvidence===source}
          onClick={()=>ctx.onEvidence(source)}>{SOURCE_NAMES[source]}</button>)}
    </div>
    {ctx.chosenDistrict && <button className={styles.filterTag} onClick={()=>ctx.onDistrict(null)}>
      {ctx.model.regionById.get(ctx.chosenDistrict)?.label ?? '행정동'} ×
    </button>}
    {ctx.chosenHour!==null && <button className={styles.filterTag} onClick={()=>ctx.onHour(ctx.chosenHour!)}>
      {String(ctx.chosenHour).padStart(2,'0')}시 ×
    </button>}
    <button className={styles.resetButton} type="button" onClick={reset}><RotateCcw size={14}/>초기화</button>
  </div>;
}

function MapPanel({ctx}:{ctx:DashboardContext}) {
  const {model,overview}=ctx;
  const gnss=model.locations.filter(p=>p.evidence==='gnss').length;
  const estimated=model.locations.length-gnss;
  return <section className={styles.mapCard}>
    <PanelTitle icon={Map} aside={<span className={styles.mapTotal}><MapPin size={14}/>{fmt(model.locations.length)}개 위치 지점</span>}>
      {ctx.version===3?'행정동별 저품질 위치 지도':'행정동 경계 + 저MOS 위치'}
    </PanelTitle>
    <div className={styles.mapViewport}>
      <AnalystMap
        administrativeDongs={overview.administrativeDongs}
        cells={model.mapCells}
        callLocations={model.locations}
        clusterOccurrences={ctx.version===3}
        onCallLocationSelect={ctx.onCall}
        selectedCellId={ctx.chosenDistrict}
        onCellSelect={ctx.onDistrict}
        focusTarget={ctx.focus}
        focusKey={`proposal-${ctx.version}-${overview.date}`}
        source="MDT"
      />
    </div>
    <p className={styles.mapFootnote}>GNSS 위치는 실제 마지막 관측 좌표이며, 종료 시각의 실측 위치를 의미하지 않습니다. BYE 기지국은 별도 참고 좌표입니다.</p>
    <div className={styles.mapLegend}>
      <span><i className={styles.redPin}/> GNSS 관측 {fmt(gnss)}</span>
      <span><i className={styles.amberPin}/> 3사이트 추정 {fmt(estimated)}</span>
      <span>BYE Cell 기지국 {fmt(model.locations.filter(p=>p.evidence==='bye-cell').length)} (단말 좌표 아님)</span>
      <span><i className={styles.boundaryKey}/> 행정동 경계</span>
      <small>GNSS/유효 3사이트 위치 우선 · 없으면 BYE Cell 기지국 위치 대체(UE 실측 위치 아님)</small>
    </div>
  </section>;
}

function RegionsPanel({ctx}:{ctx:DashboardContext}) {
  const {model}=ctx;
  const max=Math.max(1,...model.regions.map(x=>x.poorCalls));
  return <section className={styles.regionsCard}>
    <PanelTitle icon={TrendingDown} aside={<span className={styles.panelTag}>저MOS 발생 건수 순</span>}>
      행정동별 저품질 집중 지역
    </PanelTitle>
    <div className={styles.regionHead}><span>순위 / 행정동</span><span>저MOS 건수</span></div>
    <div className={styles.regionList}>
      {model.regions.length===0 && <p className={styles.noResults}>선택 조건에 해당하는 행정동이 없습니다.</p>}
      {model.regions.slice(0,9).map((region,i)=><button key={region.id} type="button" className={styles.regionRow}
        aria-pressed={ctx.chosenDistrict===region.id} onClick={()=>ctx.onDistrict(region.id)}>
        <span className={styles.regionRank}>{i+1}</span>
        <span className={styles.regionInfo}>
          <b>{region.label}</b>
          <span className={styles.regionBar}><i style={{width:(100*region.poorCalls/max)+'%'}}/></span>
          <small>GNSS {fmt(region.gnssCalls)} · 3사이트 {fmt(region.estimatedCalls)} · BYE 기지국 {fmt(region.byeCellCalls)} · 고객 {fmt(region.customerCount)}</small>
        </span>
        <strong className={styles.regionValue}>{fmt(region.poorCalls)}<small>건</small></strong>
        <ChevronRight size={15} className={styles.regionArrow}/>
      </button>)}
    </div>
    <p className={styles.regionFoot}>GNSS·3사이트 추정·BYE Cell 기지국 위치 혼합 · 기지국 기준 행정동은 UE 실측 지역 아님 · 행정동별 불량률은 계산하지 않음</p>
  </section>;
}

function HourChart({ctx}:{ctx:DashboardContext}) {
  const max=Math.max(1,...ctx.grades.hours.map(h=>h.evaluated));
  const three=ctx.version===2;
  return <section className={styles.hourCard}>
    <PanelTitle icon={BarChart3} aside={<span className={styles.chartLegend}>
      <i className={styles.legendPoor}/>불량
      {three && <><i className={styles.legendFair}/>보통</>}
      <i className={styles.legendBlue}/>{three?'양호':'그 외 통화'}
    </span>}>시간대별 통화 품질</PanelTitle>
    <div className={styles.barGraph}>
      <div className={styles.hourPlot}>
        {ctx.grades.hours.map(h=>{
          const scale= h.evaluated/max*100;
          const p=h.evaluated?h.poor/h.evaluated*scale:0;
          const w=h.evaluated?h.fair/h.evaluated*scale:0;
          const g=Math.max(0,scale-p-w);
          return <button type="button" key={h.hour} className={styles.hourColumn}
            aria-pressed={ctx.chosenHour===h.hour} onClick={()=>ctx.onHour(h.hour)}
            title={`${String(h.hour).padStart(2,'0')}시: 불량 ${fmt(h.poor)}건 · 보통 ${fmt(h.fair)}건 · 양호 ${fmt(h.good)}건 · 미평가 ${fmt(h.unavailable)}건`}
            aria-label={`${h.hour}시 유효 ${fmt(h.evaluated)}건, 불량 ${fmt(h.poor)}건, 보통 ${fmt(h.fair)}건, 양호 ${fmt(h.good)}건`}>
            <span className={styles.hourBar}>
              <span className={styles.poorPart} style={{height:p+'%'}}/>
              {three && <span className={styles.fairPart} style={{height:w+'%'}}/>}
              <span className={styles.goodPart} style={{height:(three?g:g+w)+'%'}}/>
            </span>
            <span className={styles.hourNumber}>{String(h.hour).padStart(2,'0')}</span>
          </button>;
        })}
      </div>
    </div>
    <div className={styles.chartFoot}>유효 MOS 통화 건수 기준 · 시간 클릭 시 지도·지역·통화 목록 연동{ctx.chosenHour===null?'':` · ${ctx.chosenHour}시 선택`}</div>
  </section>;
}

function Distribution({ctx}:{ctx:DashboardContext}) {
  const {grades}=ctx;
  const [bad,warn,good]=grades.bands;
  const sum=bad.percentage+warn.percentage;
  const colors=ctx.version===2?['#ea5661','#f4b34e','#3489e3']:['#e35d64','#efb444','#26a472'];
  const gradient=grades.evaluated ?
    `conic-gradient(${colors[0]} 0 ${bad.percentage}%, ${colors[1]} ${bad.percentage}% ${sum}%, ${colors[2]} ${sum}% 100%)`:
    'conic-gradient(#e1e7ef 0% 100%)';
  return <section className={styles.distributionCard}>
    <PanelTitle icon={Activity}>MOS 점수 분포</PanelTitle>
    <div className={styles.distributionBody}>
      <div className={styles.donut} style={{background:gradient}} aria-label={`불량 ${bad.percentage.toFixed(1)}%, 보통 ${warn.percentage.toFixed(1)}%, 양호 ${good.percentage.toFixed(1)}%`}>
        <div className={styles.donutHole}>
          <small>{ctx.version===1?'유효 MOS':'평균 MOS'}</small>
          <strong>{ctx.version===1?fmt(grades.evaluated):numeric(grades.mean)}</strong>
          {ctx.version===1 && <small>통화</small>}
        </div>
      </div>
      <div className={styles.gradeLegend}>
        {grades.bands.map((band,i)=><div className={styles.gradeLine} key={band.id}>
          <i style={{background:colors[i]}}/>
          <span>{band.label}<small>{ctx.version===3 ? fmt(band.count)+'건' : band.range}</small></span>
          <strong>{band.percentage.toFixed(1)}%</strong>
          <em>{fmt(band.count)}건</em>
        </div>)}
      </div>
    </div>
    <div className={styles.distributionBar} aria-label="불량 보통 양호 누적 구성비">
      {grades.bands.map((band,i)=><span key={band.id} style={{width:band.percentage+'%',background:colors[i]}}
        title={`${band.label}: ${fmt(band.count)}건`}>{band.percentage>=11?band.percentage.toFixed(1)+'%':''}</span>)}
    </div>
    <p className={styles.distributionNote}>분모: 유효 MOS {fmt(grades.evaluated)}건 · 미평가 {fmt(grades.unavailable)}건 제외</p>
  </section>;
}

function DetailCard({ctx}:{ctx:DashboardContext}) {
  const call=ctx.selected;
  const point=call?ctx.model.markerByCall.get(call.id):undefined;
  const district=point?ctx.model.regionById.get(point.areaId)?.label:'';
  const callEvidence=ctx.selectedDayCall&&ctx.selectedDetail?
    evaluateCallEvidence(ctx.selectedDayCall,ctx.selectedDetail.samples):null;
  const valueByKey=(key:string)=>callEvidence?.evidence.find(item=>item.key===key)?.value??'—';
  const metrics=[
    {name:'MOS(v5)',value:call?numeric(call.mos):'—',icon:Activity,hint:'원본 CDR 점수'},
    {name:'RTP Loss',value:valueByKey('txPacketLoss'),icon:TrendingDown,hint:'원본 수치 · 단위 확인 필요'},
    {name:'Jitter',value:valueByKey('txJitter'),icon:Waves,hint:'원본 수치 · 단위 확인 필요'},
    {name:'RSRP',value:valueByKey('rsrp'),icon:Signal,hint:'MDT 연계된 경우만'},
    {name:'SINR',value:valueByKey('sinr'),icon:RadioTower,hint:'MDT 연계된 경우만'},
  ];
  return <section className={styles.detailCard} id={`proposal-${ctx.version}-detail`}>
    <PanelTitle icon={Phone} aside={<span className={styles.detailSubtitle}>
      {call ? `${call.start} · ${district || '행정동 미확인'} · ${point?.evidence==='gnss'?'GNSS':'추정'}`:'위치 연계 통화 선택 대기'}
    </span>}>선택 통화 상세</PanelTitle>
    <div className={styles.detailInner}>
      <div className={styles.detailMetrics}>
        {metrics.map(({name,value,icon:Icon,hint},index)=><div key={name} className={`${styles.detailMetric} ${index===0?styles.highlightMetric:''}`}>
          <Icon size={18}/>
          <span>{name}</span>
          <strong>{value}</strong>
          <small>{ctx.loadingDetail&&index>0?'근거 조회 중':hint}</small>
        </div>)}
        {ctx.detailError && <p className={styles.inlineError}>{ctx.detailError}</p>}
        <div className={styles.detailLinks}>
          {call && <Link href={buildOriginalCallLink(call,ctx.overview.date)}>고객·통화 분석 원본 <ChevronRight size={14}/></Link>}
          {ctx.selectedDayCall&&<button type="button" onClick={ctx.onToggleEvidence}>
            {ctx.showEvidence?'원인 근거 접기':'원인 근거 자세히'} <ChevronRight size={14}/>
          </button>}
        </div>
      </div>
      <div className={styles.callsTableBox}>
        <div className={styles.callListTitle}><b>저MOS 통화 목록</b><small>위치 연계 {fmt(ctx.model.focusedCalls.length)}건 · 최대 8행</small></div>
        <div className={styles.tableScroll}><table><thead><tr><th>No.</th><th>통화 시각</th><th>행정동</th><th>위치 근거</th><th>MOS</th><th>선택</th></tr></thead>
          <tbody>{ctx.model.focusedCalls.slice(0,ctx.limit).map((row,index)=>{
            const loc=ctx.model.markerByCall.get(row.id);
            return <tr key={row.id} className={call?.id===row.id?styles.currentRow:undefined}>
              <td>{index+1}</td><td>{row.start}</td>
              <td>{loc?ctx.model.regionById.get(loc.areaId)?.label??'—':'—'}</td>
              <td><span className={loc?.evidence==='gnss'?styles.gnssTag:styles.radioTag}>{loc?.evidence==='gnss'?'GNSS':'추정'}</span></td>
              <td><b className={styles.tableMos}>{numeric(row.mos)}</b></td>
              <td><button type="button" className={styles.rowAction} aria-pressed={call?.id===row.id}
                onClick={()=>ctx.onCall(row.id)}>분석 <ChevronRight size={12}/></button></td>
            </tr>;
          })}</tbody>
        </table></div>
        {ctx.model.focusedCalls.length===0&&<p className={styles.noResults}>조건에 맞는 위치 연계 통화가 없습니다.</p>}
        {ctx.model.focusedCalls.length>ctx.limit&&<button className={styles.moreButton}
          onClick={ctx.onLimit}>더 보기 ({fmt(ctx.model.focusedCalls.length-ctx.limit)}건)</button>}
      </div>
    </div>
    {ctx.showEvidence && ctx.selectedDayCall && ctx.selectedDetail &&
      <div className={styles.evidenceExpanded}><MosCallInvestigation
        call={ctx.selectedDayCall} samples={ctx.selectedDetail.samples}/></div>}
  </section>;
}

export function QualityProposal({version}:{version:Version}) {
  const [selectedDate,setSelectedDate]=useState('2026-10-30');
  const [loaded,setLoaded]=useState<{loading:boolean; data:Loaded|null; error:string|null}>({
    loading:true,data:null,error:null,
  });
  const [from,setFrom]=useState('00:00');
  const [to,setTo]=useState('23:59');
  const [hour,setHour]=useState<number|null>(null);
  const [district,setDistrict]=useState<string|null>(null);
  const [evidence,setEvidence]=useState<ImprovedLocationFilter>('all');
  const [chosenCall,setChosenCall]=useState<string|null>(null);
  const [detail,setDetail]=useState<{key:string;day:AnalystDay|null;loading:boolean;error:string|null}>({
    key:'',day:null,loading:false,error:null,
  });
  const [showEvidence,setShowEvidence]=useState(false);
  const [limit,setLimit]=useState(6);
  const [customerGroup,setCustomerGroup]=useState<ExperienceGroup|null>(null);
  const [focus,setFocus]=useState<{key:string;lat:number;lon:number}|undefined>(undefined);

  useEffect(()=>{
    const controller=new AbortController();
    const load=async()=>{
      try{
        const dataset=await loadDataset('MDT',controller.signal);
        if(dataset.meta.qoeBasis!=='rtcp-mos-v5')throw Error('원본 RTCP MOS(v5) 데이터가 필요합니다.');
        const date=selectedDate;
        if(!dataset.meta.dates.includes(date))throw Error('선택 일자 자료가 없습니다: '+date);
        const overview=await loadOverview(dataset,'MDT',date,controller.signal);
        if(overview.spatialUnit!=='administrative-dong'||!overview.callLocations?.length)
          throw Error('행정동·통화 위치 데이터가 없습니다. npm run data:overview -- MDT를 실행하세요.');
        if(!controller.signal.aborted)setLoaded({loading:false,data:{dataset,overview},error:null});
      }catch(err){
        if(!controller.signal.aborted)setLoaded({
          loading:false,data:null,error:err instanceof Error?err.message:'데이터 로드 실패',
        });
      }
    };
    void load();
    return ()=>controller.abort();
  },[selectedDate]);

  const overview=loaded.data?.overview;
  const dataset=loaded.data?.dataset;
  const customerAnalytics=useMemo(()=>{
    if (!overview || version!==3) return null;
    const start=from.match(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
    const end=to.match(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
    if(!start||!end)return getOverviewAnalytics([],'mos',3);
    const toMinute=(v:string)=>Number(v.slice(0,2))*60+Number(v.slice(3));
    const begin=toMinute(from), stop=toMinute(to);
    return getOverviewAnalytics(
      begin>stop?[]:overview.calls.filter(call=>{
        const minute=Math.floor(call.startSecond/60);
        return minute>=begin&&minute<=stop;
      }), 'mos', 3);
  },[overview,from,to,version]);
  const customerIds=useMemo(()=>{
    if(!customerGroup||!customerAnalytics)return null;
    const group=customerAnalytics.experience.find(item=>item.id===customerGroup);
    return new Set(group?.customerIds??[]);
  },[customerAnalytics,customerGroup]);
  const model=useMemo(()=>overview?buildImprovedView(overview,{
    from,to,hour,districtId:district,evidence,
    customerIds:version===3?customerIds:null,
  }):null,[overview,from,to,hour,district,evidence,version,customerIds]);
  const grades=useMemo(()=>overview?calculateProposalGrades(overview,from,to):null,[overview,from,to]);
  const selected=model?(model.focusedCalls.find(call=>call.id===chosenCall)??model.focusedCalls[0]??null):null;
  const actualId=selected?.id??null;

  useEffect(()=>{
    const controller=new AbortController();
    const call=selected;
    if(!call||!dataset)return;
    const key=call.customerId+':'+(overview?.date??'2026-10-30');
    const entry=dataset.days.find(d=>d.customerId===call.customerId&&d.date===overview?.date);
    queueMicrotask(()=>setDetail({key,day:null,loading:!!entry,error:entry?null:'고객 통화 상세를 찾지 못했습니다.'}));
    if(entry)loadDay(dataset,entry,'MDT',controller.signal).then(
      day=>{if(!controller.signal.aborted)setDetail({key,day,loading:false,error:null});},
      error=>{if(!controller.signal.aborted)setDetail({
        key,day:null,loading:false,error:error instanceof Error?error.message:'통화 상세 오류',
      });},
    );
    return ()=>controller.abort();
  },[selected,dataset,overview?.date]);

  const dayCall=selected&&detail.day&&detail.key===selected.customerId+':'+overview?.date?
    detail.day.calls.find(call=>call.id===(selected.rawCallId??selected.id.slice(selected.customerId.length+1)))??null:null;
  const loadingDetail=detail.loading||Boolean(selected&&detail.key!==selected.customerId+':'+overview?.date);
  const date=overview?.date??'2026-10-30';
  const originalParams=new URLSearchParams({
    source:'MDT',view:'overview',date,from,to,poor:'1',sort:'poor',page:'0',metric:'mos',
  });
  if(district)originalParams.set('cell',district);
  if(hour!==null)originalParams.set('hour',String(hour));
  const originalLink='/?'+originalParams.toString();
  const onDistrict=(id:string|null)=>{
    const next=id===district?null:id;
    setDistrict(next);setChosenCall(null);setLimit(6);setShowEvidence(false);
    const place=overview?.administrativeDongs?.find(item=>item.id===next);
    if(place)setFocus(previous=>({
      key:String((Number(previous?.key.split(':')[0]) || 0) + 1) + ':' + next,
      lat:place.lat,lon:place.lon,
    }));
    else setFocus(undefined);
  };
  const onHour=(value:number)=>{
    setHour(prev=>prev===value?null:value);
    setChosenCall(null);setShowEvidence(false);setLimit(6);
  };
  const onCall=(id:string)=>{
    setChosenCall(id);setShowEvidence(false);
    document.getElementById('proposal-'+version+'-detail')?.scrollIntoView({behavior:'smooth',block:'center'});
  };
  const reset=()=>{
    setFrom('00:00');setTo('23:59');setHour(null);setDistrict(null);
    setEvidence('all');setChosenCall(null);setFocus(undefined);setLimit(6);setCustomerGroup(null);
    setShowEvidence(false);
  };
  const context:DashboardContext|null=overview&&model&&grades?{
    overview,model,grades,version,customerAnalytics:customerAnalytics??undefined,
    selectedCustomerGroup:customerGroup,onCustomerGroup:(next)=>{setCustomerGroup(next);setChosenCall(null);setLimit(6);},
    chosenDistrict:district,chosenHour:hour,
    chosenEvidence:evidence,callId:actualId,selected,
    selectedDetail:detail.day,selectedDayCall:dayCall,loadingDetail,
    detailError:detail.error,showEvidence,limit,focus,onDistrict,onHour,
    onEvidence:(next)=>{setEvidence(next);setChosenCall(null);setLimit(6);},
    onCall,onLimit:()=>setLimit(value=>value+6),
    onToggleEvidence:()=>setShowEvidence(value=>!value),originalLink,
  }:null;

  return <div className={`${styles.shell} ${version===1?styles.proposalOne:version===2?styles.proposalTwo:styles.proposalThree}`}>
    <DashboardNav version={version} originalLink={originalLink} date={selectedDate}/>
    <main className={styles.main}>
      {version!==3&&<div className={styles.pageHeader}>
        <div><div className={styles.eyebrow}>DESIGN PROPOSAL {version===1?'01 · 모니터링 집중형':version===2?'02 · 고객 체감 중심형':'03 · 품질 분석 통합형'}</div>
          <h1>품질현황_개선{version}안 <small>{version===1?'정밀 모니터링형 대시보드':version===2?'고객 체감형 대시보드':'통합 품질 분석형 대시보드'}</small></h1>
          <p>행정동 경계와 저MOS 위치를 함께 살펴보는 독립 비교 화면 · 실제 {dateLabel(selectedDate)} 자료</p></div>
        <div className={styles.pageActions}>
          <Link href={version===1?'/overview-proposal-2':version===2?'/overview-proposal-1':'/overview-proposal-2'}><ChevronRight size={15}/>개선{version===1?2:version===2?1:2}안 비교</Link>
          <Link href={originalLink}>기존 품질 현황</Link>
        </div>
      </div>}
      {context&&<Controls ctx={context} from={from} to={to}
        dates={dataset?.meta.dates??[selectedDate]}
        onDate={next=>{setSelectedDate(next);setLoaded(prev=>({...prev,loading:true,data:null,error:null}));reset();}}
        setFrom={(v)=>{setFrom(v);setHour(null);setChosenCall(null);}}
        setTo={(v)=>{setTo(v);setHour(null);setChosenCall(null);}} reset={reset}/>}
      {loaded.loading&&<output className={styles.loadingState}>{dateLabel(selectedDate)} RTCP MOS(v5) 데이터를 불러오는 중…</output>}
      {loaded.error&&<div className={styles.errorState} role="alert">{loaded.error}</div>}
      {context&&<>
        {!context.model.validRange&&<div className={styles.errorState}>시작 시간이 종료 시간보다 늦습니다. 필터를 확인하세요.</div>}
        {version===3?<>
          <KpiCardsThree ctx={context}/>
          <div className={styles.chartsThree}>
            <Distribution ctx={context}/>
            <HourChart ctx={context}/>
            <CustomerExperienceThree ctx={context}/>
          </div>
          <div className={styles.investigationThree}>
            <MapPanel ctx={context}/>
            <RegionsPanel ctx={context}/>
          </div>
        </>:version===1?<>
          <KpiCards ctx={context}/>
          <div className={styles.heroOne}>
            <ExperienceCard ctx={context}/>
            <MapPanel ctx={context}/>
            <RegionsPanel ctx={context}/>
          </div>
        </>:<>
          <div className={styles.headlineTwo}>
            <KpiCards ctx={context}/>
            <ExperienceCard ctx={context}/>
          </div>
          <div className={styles.heroTwo}>
            <MapPanel ctx={context}/>
            <RegionsPanel ctx={context}/>
          </div>
        </>}
        {version!==3&&<div className={styles.chartsRow}><HourChart ctx={context}/><Distribution ctx={context}/></div>}
        <DetailCard ctx={context}/>
        <p className={styles.disclaimer}><ShieldCheck size={15}/>
          원본 CDR 통화 1건당 MOS(v5) 1개 기준 · GNSS/무선 추정 위치 구분 · 저MOS 중심 MDT 부분표본으로 행정동 불량률은 계산하지 않습니다.
          RTP 값의 단위는 원본 정의 확인 전입니다. 경계 기준일 {overview?.boundaryBaseDate??'미제공'}.
        </p>
      </>}
    </main>
  </div>;
}
