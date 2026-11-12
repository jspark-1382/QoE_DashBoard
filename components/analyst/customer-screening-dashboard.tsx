'use client';

import {lazy,Suspense,useDeferredValue,useEffect,useMemo,useRef,useState} from 'react';
import {useVisibleMap} from '../../lib/analyst/use-visible-map';
import {Activity,AlertTriangle,CalendarDays,ChevronRight,Clock3,Layers3,MapPinned,
  PhoneCall,Repeat2,RotateCcw,Search,ShieldAlert,Target,Users} from 'lucide-react';
import {QualityTopNav} from './quality-top-nav';
import {CustomerScreeningPreview} from './customer-screening-preview';
const CustomerScreeningMap=lazy(()=>import('./customer-screening-map').then(module=>({default:module.CustomerScreeningMap})));
import {number,percent,type CustomerGroup,type ScreeningResult,type ScreeningRow} from '../../lib/analyst/customer-screening';
import {metricLabel,type ScreeningMapMetric,type ScreeningMapView} from '../../lib/analyst/customer-screening-map';
import {screeningQueryRequest,screeningRouteIds,screeningTopRoutes,
  type ScreeningQueryResult,type ScreeningMapQueryResult,type ScreeningRoutesResult,
  type ScreeningRankMode as RankMode,type ScreeningCustomerFilter as CustomerFilter} from '../../lib/analyst/screening-query';
import {voiceQuery} from '../../lib/analyst/server-query';
import styles from './customer-screening.module.css';

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
  return <section className={styles.panel}>
    <Heading icon={Target} actions={<div className={styles.panelActions}>
      {([['poor','저품질 건수'],['drop','Drop 기준'],['repeat','반복 기준']] as const).map(([id,text])=>
        <button key={id} type="button" className={styles.tabButton+' '+(sortMode===id?styles.active:'')} onClick={()=>setSortMode(id)}>{text}</button>)}
      <button type="button" className={styles.tabButton} onClick={onAll}>{rows.length>10?'목록 접기':'전체 목록'} <ChevronRight size={12}/></button>
    </div>}>저품질 통화 집중 고객 TOP 10</Heading>
    <div className={styles.ranking}>
      <div className={styles.tableScroll}>
        <table className={styles.rankTable}>
          <thead><tr><th>순위</th><th>서비스계약번호</th><th>총 통화 건수</th><th>저품질 통화 수</th><th>저품질 비율*</th>
            <th>발생 일수</th><th>Drop</th><th>주요 행정동</th><th>최근 발생</th><th>분류</th></tr></thead>
          <tbody>{rows.map((r,i)=><tr key={r.id} aria-selected={r.id===selected} onClick={()=>onPick(r.id)}>
            <td><span className={styles.rankNumber}>{i+1}</span></td>
            <td><button type="button" onClick={()=>onPick(r.id)}>{r.number}</button></td>
            <td>{number(r.total)}건</td>
            <td><div className={styles.barCell}>{number(r.poor)}건
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
  const source=data?.source;
  const sourceRevision=useRef('');
  const [page,setPage]=useState(0);
  const [mapEnabled,setMapEnabled]=useState(false);
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
  useEffect(()=>{
    const controller=new AbortController();
    queueMicrotask(()=>{if(!controller.signal.aborted){setQueryLoading(true);setLoadError(null);}});
    voiceQuery<ScreeningQueryResult>('screening',{...request,sourceRevision:sourceRevision.current||undefined},controller.signal).then(value=>{
      if(!controller.signal.aborted){sourceRevision.current=value.sourceRevision;setData(value);setQueryLoading(false);}
    }).catch(error=>{if(!controller.signal.aborted){setLoadError(error instanceof Error?error.message:String(error));setQueryLoading(false);}});
    return()=>controller.abort();
  },[request]);
  const report=data?.report;
  const mapTrigger=useVisibleMap<HTMLDivElement>(!!report&&!queryLoading&&!mapEnabled,setMapEnabled);
  const ranking=data?.topRows??[];
  const affectedCallTotal=data?.affectedCallTotal??0;
  const topCustomers=mapData?.topCustomers??{total:0,unlocated:0,points:[]};
  const geography=mapData?.geography;
  const selected=data?.selected??null;
  const comparable=data?.comparable??[];
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
  const routeIds=JSON.stringify(screeningRouteIds(mapEnabled,mapView,selectedId,ranking));
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
  const route=routeData?.routes.find(item=>item.customerId===selectedId)??null;
  const pickCustomer=(id:string)=>{
    setSelectedId(id);setMapView('route');setMapEnabled(true);setRouteDay('all');
    setSelectedAreaId('');setSelectedCellId('');setShowAll(false);setQuery('');
  };
  const selectedRegion=data?.selectedRegion??'';
  const clearMapSelection=()=>{setSelectedAreaId('');setSelectedCellId('');setSelectedId('');};
  const showRows=ranking.slice(0,10);
  const reset=()=>{if(!source)return;setStart(source.dates[0]);setEnd(source.dates.at(-1)!);setFrom('00:00');setTo('23:59');
    setFilter('all');setQuery('');setSortMode('poor');setMapView('top10');setMapMetric('customers');
    setSelectedAreaId('');setSelectedCellId('');setSelectedId('');setShowAll(false);setRouteDay('all');setPage(0);setMapEnabled(false);};
  return <div className={styles.shell}>
    <QualityTopNav active="customer-screening" date={end} sourceLabel={(end||'2026-10-30').replaceAll('-','.')+' · MDT (Voice)'}/>
    <main className={styles.main}>
      <div className={styles.filters}>
        <label className={styles.field}><CalendarDays size={16}/>시작일
          <select value={start} onChange={e=>{const d=e.target.value;setPage(0);setStart(d);if(d>end)setEnd(d);}}>
            {(source?.dates??['2026-10-26']).map(d=><option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className={styles.field}>종료일
          <select value={end} onChange={e=>{const d=e.target.value;setPage(0);setEnd(d);if(d<start)setStart(d);}}>
            {(source?.dates??['2026-10-30']).map(d=><option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <button className={styles.primary} type="button" onClick={()=>{if(source){setPage(0);setStart(source.dates[0]);setEnd(source.dates.at(-1)!);}}}>전체 기간</button>
        <label className={styles.field}><Clock3 size={15}/>시간 <input type="time" value={from} onChange={e=>{setPage(0);setFrom(e.target.value);}}/></label>
        <span>~</span>
        <label className={styles.field} aria-label="종료 시간"><input aria-label="종료 시간" type="time" value={to} onChange={e=>{setPage(0);setTo(e.target.value);}}/></label>
        <label className={styles.field}>고객 조건
          <select aria-label="고객 선별 조건" value={filter} onChange={e=>{setPage(0);setFilter(e.target.value as CustomerFilter);setShowAll(false);}}>
            <option value="all">전체 고객</option><option value="affected">저품질 경험</option>
            <option value="repeat">반복 불량 (2일+)</option><option value="concentrated">저품질 집중</option><option value="drop">Drop 다발</option>
          </select>
        </label>
        <div className={styles.spacer}/>
        <label className={styles.field}><Search size={15}/>
          <input type="search" aria-label="서비스계약번호 검색" placeholder="서비스계약번호 검색" value={query} onChange={e=>setQuery(e.target.value)}/>
        </label>
        <button className={styles.secondary} type="button" onClick={()=>setShowAll(true)}>고객 목록</button>
        <button className={styles.secondary} type="button" title="필터 초기화" onClick={reset}><RotateCcw size={17}/></button>
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
        <div className={styles.kpis} aria-busy={queryLoading}>
          <SummaryCard icon={Users} label="전체 고객" num={report.total} description="선택 기간 통화가 있는 고객"/>
          <SummaryCard icon={PhoneCall} label="전체 통화" num={report.calls} unit="건" description="전체 고객의 SIP CDR 통화"/>
          <SummaryCard icon={AlertTriangle} label="저품질 고객" num={report.affected} description={'QoE < 3.0 경험 · 전체 '+percent(report.affected,report.total)} accent="#d93855"/>
          <SummaryCard icon={Layers3} label="총통화 수" num={affectedCallTotal} unit="건" description="저품질 경험 고객의 전체 통화"/>
        </div>
        <div className={styles.contentTop}>
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
        <div className={styles.investigationGrid}>
          <section className={styles.panel}>
            <Heading icon={MapPinned} actions={<div className={styles.mapControls}>
              {([['top10','저품질 고객 TOP 10'],['dong','행정동별 고객'],['cell','기지국·셀별'],['gnss','GPS 실측']] as const).map(([view,label])=>
                <button key={view} type="button" className={styles.tabButton+' '+(mapView===view?styles.active:'')}
                  aria-pressed={mapView===view}
                  onClick={()=>{setMapView(view);setMapEnabled(true);clearMapSelection();}}>{label}</button>)}
              {selectedId&&<button type="button" aria-label="선택 고객 위치흐름" className={styles.tabButton+' '+(mapView==='route'?styles.active:'')}
                onClick={()=>{setMapView('route');setMapEnabled(true);}}>고객 경로</button>}
              {mapView==='route'?<select aria-label="고객 위치흐름 날짜" className={styles.mapMetricSelect}
                value={routeDay} onChange={e=>setRouteDay(e.target.value)}>
                <option value="all">전체 날짜</option>
                {source?.dates.filter(d=>d>=start&&d<=end).map(d=><option key={d} value={d}>{d.slice(5)}</option>)}
              </select>:mapView!=='top10'&&<select aria-label="고객 지도 집계 지표" className={styles.mapMetricSelect} value={mapMetric}
                onChange={event=>setMapMetric(event.target.value as ScreeningMapMetric)}>
                {([['customers','저품질 고객 수'],['repeat','반복 불량 고객'],['poorCalls','저품질 통화 수'],['drops','Drop 수']] as const)
                  .map(([key,label])=><option key={key} value={key}>{label}</option>)}
              </select>}
            </div>}>문제 고객 분석 지도</Heading>
            {!mapEnabled?<div ref={mapTrigger} className={styles.mapPlaceholder}>
              <MapPinned size={30}/><strong>문제 고객 위치와 경로</strong>
              <output>선택 기간의 지도를 자동으로 불러오는 중입니다…</output>
            </div>:mapError?<div className={styles.mapPlaceholder} role="alert">{mapError}<button className={styles.primary} type="button" onClick={()=>setMapEnabled(false)}>지도 다시 불러오기</button></div>:!geography?
              <output className={styles.mapPlaceholder}>지도 집계를 조회하는 중…</output>:null}
            {mapEnabled&&geography&&source&&<Suspense fallback={<output className={styles.mapPlaceholder}>지도를 준비하는 중…</output>}><CustomerScreeningMap geography={geography} mode={mapView} metric={mapMetric}
              topCustomers={topCustomers}
              topCustomerRoutes={topCustomerRoutes}
              sourceRevision={source.sourceRevision} selectedAreaId={selectedAreaId} selectedCellId={selectedCellId} customerRoute={route}
              onSelectArea={area=>{setSelectedAreaId(area);setSelectedCellId('');setSelectedId('');}}
              onSelectCell={cell=>{setSelectedCellId(cell);setSelectedAreaId('');setSelectedId('');}}
              onSelectCustomer={pickCustomer}/></Suspense>}
            <div className={styles.scatterNote}>
              {!mapEnabled?'요약 표시 후 지도 영역이 보이면 자동으로 조회합니다.':!geography?'지도 집계를 조회하는 중…':mapView==='top10'?`상단 TOP 10과 동일한 고객 · 위치 표시 ${topCustomers.points.length}명 / ${topCustomers.total}명 · 최대 확대 시 전체 고객 통화 위치 흐름 자동 표시 · 위치 미확보 ${topCustomers.unlocated}명`:
               mapView==='route'?route?
                '선택 '+route.name+' · GPS '+route.gnssCount+'건 / BYE Cell 참고 '+route.cellReferenceCount+
                '건 · 시간순 점선은 관측점 연결(실제 이동경로 아님)':
                '고객을 선택하면 GPS와 서빙 기지국 기준 통화 위치 흐름이 표시됩니다.':
               mapView==='dong'?'행정동별 '+metricLabel(mapMetric)+' · 행정동 경계(SHP) 및 BYE Cell 참고 권역':
                mapView==='cell'?'BYE Cell별 '+metricLabel(mapMetric)+' · 지도 좌표는 기지국 참고 위치':
                'GPS 실측 저품질 관측 '+(geography?.gnssPoorCalls??0)+'건 · 실측 약 200m 격자 · GPS 미확보 통화 제외'}
            </div>
          </section>
          <div className={styles.insightStack}>
            <section className={styles.panel}>
              <Heading icon={Users} actions={selectedRegion?<button className={styles.tabButton} type="button"
                onClick={clearMapSelection}>선택 해제 ×</button>:undefined}>
                {selectedRegion?'선택 고객 비교 · '+selectedRegion:'선택 고객 비교 (주요 후보 4명)'}
              </Heading>
              <div className={styles.compareGrid}>
                {comparable.map((row,i)=><button type="button" key={row.id} className={styles.compareCard}
                  aria-pressed={row.id===selected?.id} onClick={()=>pickCustomer(row.id)}>
                  <div className={styles.compareHead}>{i+1}. {row.number}</div>
                  <div className={styles.compareLine}><span>전체 통화</span><b>{row.total}건</b></div>
                  <div className={styles.compareLine}><span>저품질 통화</span><b className={styles.red}>{row.poor}건</b></div>
                  <div className={styles.compareLine}><span>저품질 비율</span><b>{percent(row.poor,row.eligible)}</b></div>
                  <div className={styles.compareLine}><span>발생 일수</span><b>{row.repeatedDays}일</b></div>
                  <div className={styles.compareLine}><span>주요 행정동</span><b>{row.mainArea}</b></div>
                  <div className={styles.compareLine}><span>BYE Cell</span><b>{row.mainCell||'—'}</b></div>
                </button>)}
              </div>
            </section>
            <section className={styles.panel}>
              <Heading icon={Activity}>{selectedRegion?selectedRegion+' · 선택 고객 상세':'선택 고객 상세 미리보기'}</Heading>
              {selected?<CustomerScreeningPreview row={selected} key={[selected.id,start,end,from,to,data!.sourceRevision].join('|')} dates={source!.dates} scope={scope} sourceRevision={data!.sourceRevision}/>:<div className={styles.empty}>선택된 고객이 없습니다.</div>}
            </section>
          </div>
        </div>
        <div className={styles.note}>
          원본 리비전 {source!.sourceRevision} · {start} ~ {end} · 통화 {number(report.calls)}건 /
          QoE 평가 {number(report.eligible)}건 / 저품질 {number(report.poor)}건 / SIP Drop {number(report.drop)}건.
          고객군 분류는 집중 → 반복 → Drop → 일시적 순서이며 KPI별 고객은 중복될 수 있습니다.
          행정동은 BYE Cell 기준 참고 권역, 셀은 기지국 좌표, GPS만 실측 위치입니다. 위치와 원인은 확정되지 않았습니다.
        </div>
      </>}
    </main>
  </div>;
}
