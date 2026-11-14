'use client';

import {lazy,Suspense,useDeferredValue,useEffect,useMemo,useRef,useState} from 'react';
import {useVisibleMap} from '../../lib/analyst/use-visible-map';
import {Activity,AlertTriangle,CalendarDays,ChevronRight,Clock3,Layers3,MapPinned,Maximize2,Minimize2,
  PhoneCall,Repeat2,RotateCcw,Search,ShieldAlert,Target,Users} from 'lucide-react';
import {QualityTopNav} from './quality-top-nav';
import {CustomerScreeningPreview} from './customer-screening-preview';
import {CustomerQoeTimelinePanel} from './customer-qoe-timeline';
import type {CustomerQoeCall} from '../../lib/analyst/customer-qoe-timeline';
import {customerQoeMapFocus} from '../../lib/analyst/customer-qoe-map-focus';
import {customerRouteCountSummary} from '../../lib/analyst/customer-screening-route';
import {MapPanelFrame} from './map-panel-frame';
const CustomerScreeningMap=lazy(()=>import('./customer-screening-map').then(module=>({default:module.CustomerScreeningMap})));
import {number,percent,type CustomerGroup,type ScreeningResult,type ScreeningRow} from '../../lib/analyst/customer-screening';
import {metricLabel,type ScreeningMapMetric,type ScreeningMapView} from '../../lib/analyst/customer-screening-map';
import {screeningQueryRequest,screeningRouteIds,screeningTopRoutes,
  type ScreeningQueryResult,type ScreeningMapQueryResult,type ScreeningRoutesResult,
  type ScreeningRankMode as RankMode,type ScreeningCustomerFilter as CustomerFilter} from '../../lib/analyst/screening-query';
import {voiceQuery} from '../../lib/analyst/server-query';
import styles from './customer-screening.module.css';
import theme from './customer-status-theme.module.css';
import mapFrameStyles from './customer-screening-map-frame.module.css';

const GROUPS:{id:CustomerGroup;label:string;color:string}[]=[
  {id:'concentrated',label:'저품질 집중',color:'#e84d64'},
  {id:'repeat',label:'반복 불량',color:'#f5a436'},
  {id:'drop',label:'Drop 다발',color:'#a174e5'},
  {id:'temporary',label:'일시적 불량',color:'#7dbaf5'},
  {id:'good',label:'양호 또는 미평가',color:'#18b88a'},
];
function SummaryCard({icon:Icon,label,num,description,accent,unit='명'}:{icon:typeof Users;label:string;num:number;description:string;accent?:string;unit?:string}){
  return <div className={styles.kpi}>
    <span className={styles.kpiIcon}><Icon size={25}/></span>
    <div className={styles.kpiText}><div className={styles.kpiLabel}>{label}</div>
      <strong className={styles.kpiNum} style={{color:accent}}>{number(num)}<small style={{fontSize:12,marginLeft:3}}>{unit}</small></strong>
      <div className={styles.kpiSub}>{description}</div>
    </div>
  </div>;
}
function Heading({icon:Icon,children,actions}:{icon:typeof Users;children:React.ReactNode;actions?:React.ReactNode}){
  return <div className={styles.panelHead}>
    <div className={styles.panelTitle}><Icon size={19}/><h2>{children}</h2></div>
    {actions&&<div className={styles.panelActions}>{actions}</div>}
  </div>;
}
function CustomerGroups({report}:{report:Omit<ScreeningResult,'rows'>}) {
  // 전체 고객에서 저품질 경험 비중은 약 3%이므로 작은 도넛 조각 대신
  // 가로 비율바와 실제 데이터의 조건별 고객 수로 보여줍니다.
  const affectedRate=report.total?Math.min(100,100*report.affected/report.total):0;
  const cards=[
    {label:'저품질 집중',count:report.concentrated,color:'#e84d64'},
    {label:'반복 불량',count:report.repeat,color:'#f5a436'},
    {label:'Drop 다발',count:report.dropHeavy,color:'#a174e5'},
    {label:'일시적 불량',count:report.groups.temporary,color:'#7dbaf5'},
  ];
  return <section className={styles.panel}>
    <Heading icon={Users}>고객군 분포</Heading>
    <div className={styles.customerDistribution}>
      <div className={styles.customerDistributionHeadline}>
        <div className={styles.customerDistributionMetric}>
          <span>저품질 경험 고객</span>
          <strong className={styles.red}>{number(report.affected)}<small>명</small></strong>
        </div>
        <span className={styles.customerDistributionRate}>전체의 <b>{percent(report.affected,report.total)}</b></span>
      </div>
      <div className={styles.customerProgress} aria-label={'저품질 경험 고객 '+percent(report.affected,report.total)}>
        <span className={styles.customerProgressLow} style={{width:affectedRate+'%'}}/>
        <span className={styles.customerProgressRest} style={{width:(100-affectedRate)+'%'}}/>
      </div>
      <div className={styles.customerProgressLabels}>
        <span><i className={styles.customerBadDot}/> 저품질 경험 {percent(report.affected,report.total)}</span>
        <span><i className={styles.customerOtherDot}/> 기타(양호·미평가 포함) {percent(report.total-report.affected,report.total)}</span>
      </div>
      <div className={styles.customerSegmentCards}>
        {cards.map(card=><div className={styles.customerSegmentCard} key={card.label}>
          <span className={styles.segmentTitle}>
            <i style={{backgroundColor:card.color}}/>{card.label}
          </span>
          <strong>{number(card.count)}<small>명</small></strong>
        </div>)}
      </div>
      <div className={styles.distributionCaption}>조건별 고객 수는 서로 중복될 수 있습니다.</div>
    </div>
  </section>;
}
function RankingTable({rows,selected,onPick,sortMode,setSortMode,onAll}:{rows:ScreeningRow[];selected:string;
  onPick:(s:string)=>void;sortMode:RankMode;setSortMode:(s:RankMode)=>void;onAll:()=>void}) {
  return <section className={styles.panel} data-screening-ranking>
    <Heading icon={Target} actions={<div className={styles.panelActions}>
      {([['poor','저품질 건수'],['drop','Drop 기준'],['repeat','반복 기준']] as const).map(([id,text])=>
        <button key={id} type="button" className={styles.tabButton+' '+(sortMode===id?styles.active:'')} onClick={()=>setSortMode(id)}>{text}</button>)}
      <button type="button" className={styles.tabButton+' '+styles.rankingListButton} onClick={onAll}>{rows.length>10?'목록 접기':'전체 목록'} <ChevronRight size={12}/></button>
    </div>}>저품질 통화 집중 고객 TOP 10</Heading>
    <div className={styles.ranking}>
      <div className={styles.tableScroll}>
        <table className={styles.rankTable}>
          <thead><tr><th>순위</th><th>서비스계약번호</th><th title="선택 기간의 SIP 원본에서 확인한 고객 단말입니다. 복수 기종이면 최근 관측 기종과 추가 기종 수를 표시합니다.">단말</th><th>총 통화</th><th>저품질 통화</th><th>저품질 비율*</th>
            <th>발생일</th><th>Drop</th><th>주요 행정동</th><th>최근 발생</th><th>분류</th></tr></thead>
          <tbody>{rows.map((r,i)=><tr key={r.id} aria-selected={r.id===selected} onClick={()=>onPick(r.id)}>
            <td><span className={styles.rankNumber}>{i+1}</span></td>
            <td><button type="button" onClick={()=>onPick(r.id)}>{r.number}</button></td>
            <td data-device-cell><span className={styles.deviceModel} data-customer-device data-device-count={r.deviceModels?.length??0}
              title={r.deviceModels?.length?'SIP 원본 · 최근 관측순: '+r.deviceModels.join(' · '):'선택 기간의 고객 단말 기종을 확인할 수 없습니다.'}>
              <span>{r.deviceModels?.[0]??'미확인'}</span>{(r.deviceModels?.length??0)>1&&<small>+{r.deviceModels!.length-1}</small>}
            </span></td>
            <td>{number(r.total)}건</td>
            <td data-low-quality-calls><div className={styles.barCell}>{number(r.poor)}건
              <span className={styles.rateBar}><i style={{width:(rows[0]?.poor?Math.min(100,r.poor/Math.max(1,...rows.slice(0,10).map(x=>x.poor))*100):0)+'%'}}/></span>
            </div></td>
            <td>{percent(r.poor,r.eligible)}</td><td>{r.repeatedDays}일</td><td>{r.drop}건</td>
            <td>{r.mainArea}</td><td>{r.latestDate || '—'}</td>
            <td style={{color:GROUPS.find(g=>g.id===r.group)?.color,fontWeight:800}}>{GROUPS.find(g=>g.id===r.group)?.label}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>
  </section>;
}
export function CustomerScreeningDashboard(){
  const [data,setData]=useState<ScreeningQueryResult|null>(null);
  const [resolvedRequestKey,setResolvedRequestKey]=useState('');
  const source=data?.source;
  const sourceRevision=useRef('');
  const [page,setPage]=useState(0);
  const [mapEnabled,setMapEnabled]=useState(false);
  const [mapOpenRequest,setMapOpenRequest]=useState(0);
  const [mapData,setMapData]=useState<ScreeningMapQueryResult|null>(null);
  const mapDataScope=useRef('');
  const [routeData,setRouteData]=useState<ScreeningRoutesResult|null>(null);
  const [mapError,setMapError]=useState<string|null>(null);
  const [queryLoading,setQueryLoading]=useState(true);
  const [loadError,setLoadError]=useState<string|null>(null);
  const [start,setStart]=useState('2026-10-26'),[end,setEnd]=useState('2026-10-30');
  const [from,setFrom]=useState('00:00'),[to,setTo]=useState('23:59');
  const [query,setQueryState]=useState(''),[filter,setFilter]=useState<CustomerFilter>('all');
  const [sortMode,setSortMode]=useState<RankMode>('poor');
  const [mapView,setMapView]=useState<ScreeningMapView>('top10');
  const [mapMetric,setMapMetric]=useState<ScreeningMapMetric>('customers');
  const [selectedAreaId,setSelectedAreaId]=useState(''),[selectedCellId,setSelectedCellId]=useState('');
  const [selectedId,setSelectedId]=useState(''),[showAll,setShowAll]=useState(false);
  const [routeDay,setRouteDay]=useState('all');
  const [timelineSelection,setTimelineSelection]=useState<{key:string;call:CustomerQoeCall}|null>(null);
  const listDialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    if(showAll&&!listDialog.current?.open)listDialog.current?.showModal();
    if(!showAll&&listDialog.current?.open)listDialog.current.close();
  },[showAll]);
  const setQuery=(value:string)=>{setPage(0);setQueryState(value);};
  const deferredQuery=useDeferredValue(query.trim());
  const scope=useMemo(()=>({dateStart:start,dateEnd:end,from,to}),[start,end,from,to]);
  const request=useMemo(()=>screeningQueryRequest(scope,{query:deferredQuery,filter,sort:sortMode,page,
    selectedId,areaId:selectedAreaId,cellId:selectedCellId}),
    [scope,deferredQuery,filter,sortMode,page,selectedId,selectedAreaId,selectedCellId]);
  const requestKey=JSON.stringify(request);
  useEffect(()=>{
    const controller=new AbortController();
    queueMicrotask(()=>{if(!controller.signal.aborted){setQueryLoading(true);setLoadError(null);}});
    voiceQuery<ScreeningQueryResult>('screening',{...request,sourceRevision:sourceRevision.current||undefined},controller.signal).then(value=>{
      if(!controller.signal.aborted){sourceRevision.current=value.sourceRevision;setData(value);setResolvedRequestKey(requestKey);setQueryLoading(false);}
    }).catch(error=>{if(!controller.signal.aborted){setLoadError(error instanceof Error?error.message:String(error));setQueryLoading(false);}});
    return()=>controller.abort();
  },[request,requestKey]);
  const report=data?.report;
  const mapTrigger=useVisibleMap<HTMLDivElement>(!!report&&!queryLoading&&!mapEnabled,setMapEnabled);
  const ranking=data?.topRows??[];
  const affectedCallTotal=data?.affectedCallTotal??0;
  const topCustomers=mapData?.topCustomers??{total:0,unlocated:0,points:[]};
  const geography=mapData?.geography;
  const selected=data?.selected??null;
  const timelineKey=JSON.stringify([data?.sourceRevision,selected?.id,scope,selectedAreaId,selectedCellId]);
  const timelinePending=queryLoading||resolvedRequestKey!==requestKey;
  const focusedCall=!timelinePending&&timelineSelection?.key===timelineKey
    &&(routeDay==='all'||timelineSelection.call.date===routeDay)?timelineSelection.call:null;
  useEffect(()=>{
    if(!mapEnabled)return;
    const controller=new AbortController();
    const scopeKey=JSON.stringify([sourceRevision.current,scope]);
    queueMicrotask(()=>{if(!controller.signal.aborted){if(mapDataScope.current!==scopeKey)setMapData(null);setMapError(null);}});
    voiceQuery<ScreeningMapQueryResult>('screening-map',{sourceRevision:sourceRevision.current,scope,query:deferredQuery,filter,sort:sortMode},controller.signal)
      .then(value=>{if(!controller.signal.aborted){
        const sameScope=mapDataScope.current===scopeKey;mapDataScope.current=scopeKey;
        setMapData(previous=>sameScope&&previous?{...value,geography:previous.geography}:value);
      }})
      .catch(error=>{if(!controller.signal.aborted)setMapError(error instanceof Error?error.message:String(error));});
    return()=>controller.abort();
  },[mapEnabled,scope,deferredQuery,filter,sortMode]);
  const routeIds=JSON.stringify(screeningRouteIds(mapEnabled&&!timelinePending,mapView,selected?.id??'',ranking));
  useEffect(()=>{
    const controller=new AbortController();
    queueMicrotask(()=>{if(!controller.signal.aborted)setRouteData(null);});
    if(routeIds==='[]')return()=>controller.abort();
    voiceQuery<ScreeningRoutesResult>('routes',{sourceRevision:sourceRevision.current,scope,customerIds:JSON.parse(routeIds) as string[],day:mapView==='route'?routeDay:'all'},controller.signal)
      .then(value=>{if(!controller.signal.aborted)setRouteData(value);})
      .catch(error=>{if(!controller.signal.aborted)setMapError(error instanceof Error?error.message:String(error));});
    return()=>controller.abort();
  },[routeIds,scope,mapView,routeDay]);
  const topCustomerRoutes=screeningTopRoutes(ranking,routeData?.routes??[]);
  const route=routeData?.routes.find(item=>item.customerId===selected?.id)??null;
  const pickCustomer=(id:string)=>{
    setTimelineSelection(null);
    setSelectedId(id);setMapView('route');setMapEnabled(true);setRouteDay('all');
    setSelectedAreaId('');setSelectedCellId('');setShowAll(false);setQuery('');
  };
  const selectedRegion=data?.selectedRegion??'';
  const clearMapSelection=()=>{setSelectedAreaId('');setSelectedCellId('');setSelectedId('');setTimelineSelection(null);};
  const selectTimelineCall=(call:CustomerQoeCall|null)=>{
    setTimelineSelection(call?{key:timelineKey,call}:null);
    if(call&&customerQoeMapFocus(call)){setMapView('route');setMapEnabled(true);setRouteDay('all');}
  };
  const showRows=ranking.slice(0,10);
  const reset=()=>{if(!source)return;setStart(source.dates[0]);setEnd(source.dates.at(-1)!);setFrom('00:00');setTo('23:59');
    setFilter('all');setQuery('');setSortMode('poor');setMapView('top10');setMapMetric('customers');
    setSelectedAreaId('');setSelectedCellId('');setSelectedId('');setTimelineSelection(null);setShowAll(false);setRouteDay('all');setPage(0);setMapEnabled(false);};
  return <div className={styles.shell+' '+theme.page} data-customer-screening>
    <QualityTopNav active="customer-screening" date={end} sourceLabel={(end||'2026-10-30').replaceAll('-','.')+' · MDT (Voice)'}/>
    <main className={styles.main+' '+theme.main}>
      <div className={styles.filters+' '+theme.toolbar}>
        <label className={styles.field}><CalendarDays size={16}/>시작일
          <select aria-label="고객현황 시작일" value={start} onChange={e=>{const d=e.target.value;setPage(0);setStart(d);if(d>end)setEnd(d);}}>
            {(source?.dates??['2026-10-26']).map(d=><option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className={styles.field}>종료일
          <select aria-label="고객현황 종료일" value={end} onChange={e=>{const d=e.target.value;setPage(0);setEnd(d);if(d<start)setStart(d);}}>
            {(source?.dates??['2026-10-30']).map(d=><option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <button className={styles.primary} type="button" aria-pressed={!!source&&start===source.dates[0]&&end===source.dates.at(-1)} onClick={()=>{if(source){setPage(0);setStart(source.dates[0]);setEnd(source.dates.at(-1)!);}}}>전체 기간</button>
        <label className={styles.field}><Clock3 size={15}/>시간 <input aria-label="고객현황 시작 시간" type="time" value={from} onChange={e=>{setPage(0);setFrom(e.target.value);}}/></label>
        <span>~</span>
        <label className={styles.field} aria-label="종료 시간"><input aria-label="종료 시간" type="time" value={to} onChange={e=>{setPage(0);setTo(e.target.value);}}/></label>
        <label className={styles.field}>고객 조건
          <select aria-label="고객현황 조건" value={filter} onChange={e=>{setPage(0);setFilter(e.target.value as CustomerFilter);setShowAll(false);}}>
            <option value="all">전체 고객</option><option value="affected">저품질 경험</option>
            <option value="repeat">반복 불량 (2일+)</option><option value="concentrated">저품질 집중</option><option value="drop">Drop 다발</option>
          </select>
        </label>
        <label className={styles.field}><Search size={15}/>
          <input type="search" aria-label="서비스계약번호 검색" placeholder="서비스계약번호 검색" value={query} onChange={e=>setQuery(e.target.value)}/>
        </label>
        <button className={styles.secondary} type="button" onClick={()=>setShowAll(true)}>고객 목록</button>
        <button className={styles.secondary} type="button" title="필터 초기화" aria-label="고객현황 필터 초기화" onClick={reset}><RotateCcw size={17}/></button>
        <span className={styles.hint}>MOS(v5) · QoE &lt; 3.0 · Drop 포함</span>
      </div>
      <dialog ref={listDialog} aria-label="고객 목록에서 선택" className={styles.customerListDialog}
        onCancel={()=>setShowAll(false)} onClose={()=>setShowAll(false)}>
          <div className={styles.customerListHeader}>
            <span>고객 목록 · 계약번호 선택 → 지도 위치 흐름</span>
            <button type="button" className={styles.secondary} onClick={()=>setShowAll(false)}>닫기 ×</button>
          </div>
          <div className={styles.customerListControls}>
            <input type="search" className={styles.customerListSearch} aria-label="목록 내 서비스계약번호 검색"
              placeholder="서비스계약번호로 검색 (전체 고객 대상)" value={query} onChange={e=>setQuery(e.target.value)}/>
            <small>{number(data?.total??0)}명 검색됨 · 선택하면 GPS 및 BYE Cell 참고 위치를 시간순으로 표시합니다.</small>
          </div>
          <div className={styles.customerListResults}>
            <table className={styles.customerListTable}>
              <thead><tr><th>순위</th><th>서비스계약번호</th><th>총 통화</th><th>저품질</th><th>Drop</th><th>주요 지역</th></tr></thead>
              <tbody>{(data?.rows??[]).map((row,i)=><tr key={row.id}>
                <td>{(data?.page??0)*25+i+1}</td><td><button type="button" onClick={()=>pickCustomer(row.id)}>{row.number}</button></td>
                <td>{row.total}건</td><td>{row.poor}건</td><td>{row.drop}건</td><td>{row.mainArea}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className={styles.customerListHint}>
            <button type="button" className={styles.secondary} disabled={queryLoading||!data?.page} onClick={()=>setPage(p=>Math.max(0,p-1))}>이전</button>
            <span aria-live="polite"> {data?.total?((data.page+1)+' / '+data.pages+' 페이지 · '):''}25명씩 표시 · 전체 고객 검색 </span>
            <button type="button" className={styles.secondary} disabled={queryLoading||!data||data.page+1>=data.pages} onClick={()=>setPage(p=>p+1)}>다음</button>
          </div>
      </dialog>
      {loadError?<div className={styles.loading} role="alert">{loadError}</div>:!report?
        <div className={styles.loading}>{source?'조회 기간 또는 시간 범위를 확인하세요.':'전체 고객 집계를 조회하는 중…'}</div>:<>
        <div className={styles.kpis+' '+theme.kpis} aria-busy={queryLoading}>
          <SummaryCard icon={Users} label="전체 고객" num={report.total} description="선택 기간 통화가 있는 고객"/>
          <SummaryCard icon={PhoneCall} label="전체 통화" num={report.calls} unit="건" description="전체 고객의 SIP CDR 통화"/>
          <SummaryCard icon={AlertTriangle} label="저품질 고객" num={report.affected} description={'QoE < 3.0 경험 · 전체 '+percent(report.affected,report.total)} accent="#d93855"/>
          <SummaryCard icon={Layers3} label="총통화 수" num={affectedCallTotal} unit="건" description="저품질 경험 고객의 전체 통화"/>
        </div>
        <div className={styles.contentTop+' '+theme.contentTop}>
          <CustomerGroups report={report}/>
          <RankingTable rows={showRows} selected={selected?.id??''} onPick={pickCustomer}
            sortMode={sortMode} setSortMode={mode=>{setPage(0);setSortMode(mode);}} onAll={()=>setShowAll(s=>!s)}/>
          <section className={styles.panel}>
            <Heading icon={ShieldAlert}>선별 기준 요약</Heading>
            <div className={styles.miniStack}>
              <div className={styles.miniRow}><span className={styles.miniIcon}><AlertTriangle size={20}/></span>
                <div><strong>저품질 집중 고객</strong><small>유효 5건 중 50% 이상 또는 10건 이상</small></div><b>{number(report.concentrated)}명</b></div>
              <div className={styles.miniRow}><span className={styles.miniIcon}><Repeat2 size={20}/></span>
                <div><strong>2일 이상 반복 고객</strong><small>다른 날짜에 저품질 발생</small></div><b>{number(report.repeat)}명</b></div>
              <div className={styles.miniRow}><span className={styles.miniIcon}><MapPinned size={20}/></span>
                <div><strong>동일 행정동 반복 고객</strong><small>같은 행정동에서 2일 이상 불량</small></div><b>{number(report.locationRepeat)}명</b></div>
            </div>
          </section>
        </div>
        <div className={styles.investigationGrid+' '+theme.investigation}>
          <MapPanelFrame label="문제 고객 분석 지도" className={styles.panel+' '+mapFrameStyles.panel}
            openRequest={mapOpenRequest}>{({expanded,close})=><>
            <div className={mapFrameStyles.heading}>
              <h2 className={mapFrameStyles.title}><MapPinned size={15} aria-hidden="true"/>문제 고객 분석 지도</h2>
              <div className={styles.mapControls+' '+mapFrameStyles.controls} aria-label="고객 지도 표시 설정">
              {([['top10','TOP 10','저품질 고객 TOP 10'],['dong','행정동','행정동별 고객'],['cell','기지국·셀','기지국·셀별 고객'],['gnss','GPS 실측','GPS 실측']] as const).map(([view,text,label])=>
                <button key={view} type="button" className={styles.tabButton+' '+(mapView===view?styles.active:'')}
                  aria-label={label} title={label} aria-pressed={mapView===view}
                  onClick={()=>{setMapView(view);setMapEnabled(true);clearMapSelection();}}>{text}</button>)}
               {(selectedId||mapView==='route'&&selected)&&<button type="button" aria-label="선택 고객 위치흐름" className={styles.tabButton+' '+(mapView==='route'?styles.active:'')}
                title="선택 고객 위치흐름" aria-pressed={mapView==='route'}
                onClick={()=>{setMapView('route');setMapEnabled(true);}}>고객 경로</button>}
              {mapView==='route'?<select aria-label="고객 위치흐름 날짜" className={styles.mapMetricSelect}
                 value={routeDay} onChange={e=>{setRouteDay(e.target.value);setTimelineSelection(null);}}>
                <option value="all">전체 날짜</option>
                {source?.dates.filter(d=>d>=start&&d<=end).map(d=><option key={d} value={d}>{d.slice(5)}</option>)}
              </select>:mapView!=='top10'&&<select aria-label="고객 지도 집계 지표" className={styles.mapMetricSelect} value={mapMetric}
                onChange={event=>setMapMetric(event.target.value as ScreeningMapMetric)}>
                {([['customers','저품질 고객 수'],['repeat','반복 불량 고객'],['poorCalls','저품질 통화 수'],['drops','Drop 수']] as const)
                  .map(([key,label])=><option key={key} value={key}>{label}</option>)}
              </select>}
              </div>
              <button type="button" className={mapFrameStyles.expandButton}
                aria-expanded={expanded} aria-label={expanded?'전체 화면 닫기':'전체 지도'}
                onClick={()=>{if(expanded)close();else{setMapEnabled(true);setMapOpenRequest(value=>value+1);}}}>
                {expanded?<Minimize2 size={13} aria-hidden="true"/>:<Maximize2 size={13} aria-hidden="true"/>}
                {expanded?'전체 화면 닫기':'전체 지도'}
              </button>
            </div>
            <div className={mapFrameStyles.surface} data-map-surface>
            {!mapEnabled?<div ref={mapTrigger} className={styles.mapPlaceholder}>
              <MapPinned size={30}/><strong>문제 고객 위치와 경로</strong>
              <output>선택 기간의 지도를 자동으로 불러오는 중입니다…</output>
            </div>:mapError?<div className={styles.mapPlaceholder} role="alert">{mapError}<button className={styles.primary} type="button" onClick={()=>setMapEnabled(false)}>지도 다시 불러오기</button></div>:!geography?
              <output className={styles.mapPlaceholder}>지도 집계를 조회하는 중…</output>:null}
            {mapEnabled&&geography&&source&&<Suspense fallback={<output className={styles.mapPlaceholder}>지도를 준비하는 중…</output>}><CustomerScreeningMap geography={geography} mode={mapView} metric={mapMetric}
              topCustomers={topCustomers}
              topCustomerRoutes={topCustomerRoutes}
               sourceRevision={source.sourceRevision} selectedAreaId={selectedAreaId} selectedCellId={selectedCellId} customerRoute={route} focusedCall={focusedCall}
               onSelectArea={area=>{setSelectedAreaId(area);setSelectedCellId('');setSelectedId('');setTimelineSelection(null);}}
               onSelectCell={cell=>{setSelectedCellId(cell);setSelectedAreaId('');setSelectedId('');setTimelineSelection(null);}}
              onSelectCustomer={pickCustomer}/></Suspense>}
            </div>
            <div className={styles.scatterNote+(mapView==='route'? ' '+styles.routeCountsNote:'')}
              aria-label={mapView==='route'?'선택 고객 지도 표시 집계':undefined}>
              {!mapEnabled?'요약 표시 후 지도 영역이 보이면 자동으로 조회합니다.':!geography?'지도 집계를 조회하는 중…':mapView==='top10'?`상단 TOP 10과 동일한 고객 · 위치 표시 ${topCustomers.points.length}명 / ${topCustomers.total}명 · 최대 확대 시 전체 고객 통화 위치 흐름 자동 표시 · 위치 미확보 ${topCustomers.unlocated}명`:
               mapView==='route'?route?
                customerRouteCountSummary(route):
                '고객을 선택하면 GPS와 서빙 기지국 기준 통화 위치 흐름이 표시됩니다.':
               mapView==='dong'?'행정동별 '+metricLabel(mapMetric)+' · 행정동 경계(SHP) 및 BYE Cell 참고 권역':
                mapView==='cell'?'BYE Cell별 '+metricLabel(mapMetric)+' · 지도 좌표는 기지국 참고 위치':
                'GPS 실측 저품질 관측 '+(geography?.gnssPoorCalls??0)+'건 · 실측 약 200m 격자 · GPS 미확보 통화 제외'}
            </div>
          </>}</MapPanelFrame>
          <div className={styles.insightStack+' '+theme.insight}>
            <CustomerQoeTimelinePanel customer={selected} dates={source!.dates} scope={scope}
              sourceRevision={data!.sourceRevision} areaId={selectedAreaId} cellId={selectedCellId}
              selectedRegion={selectedRegion} onClearRegion={clearMapSelection}
              onSelectCall={selectTimelineCall} pending={timelinePending}/>
            <section className={styles.panel} data-customer-preview-panel>
              <Heading icon={Activity}>{selectedRegion?selectedRegion+' · 선택 고객 상세':'선택 고객 상세 미리보기'}</Heading>
              {selected?<CustomerScreeningPreview row={selected} key={[selected.id,start,end,from,to,data!.sourceRevision].join('|')} dates={source!.dates} scope={scope} sourceRevision={data!.sourceRevision}/>:<div className={styles.empty}>선택된 고객이 없습니다.</div>}
            </section>
          </div>
        </div>
        <details className={styles.note+' '+theme.sourceNote}>
          <summary>집계·위치 기준</summary>
          <p>
          원본 리비전 {source!.sourceRevision} · {start} ~ {end} · 통화 {number(report.calls)}건 /
          QoE 평가 {number(report.eligible)}건 / 저품질 {number(report.poor)}건 / SIP Drop {number(report.drop)}건.
          고객군 분류는 집중 → 반복 → Drop → 일시적 순서이며 KPI별 고객은 중복될 수 있습니다.
          행정동은 BYE Cell 기준 참고 권역, 셀은 기지국 좌표, GPS만 실측 위치입니다. 위치와 원인은 확정되지 않았습니다.
          </p>
        </details>
      </>}
    </main>
  </div>;
}
