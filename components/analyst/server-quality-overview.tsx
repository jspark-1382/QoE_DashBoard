'use client';
/* oxlint-disable react/react-compiler -- Async request lifecycles and native dialog synchronization deliberately reset local state. */
import {lazy,Suspense,useEffect,useMemo,useRef,useState} from 'react';
import {CalendarDays,ChevronDown,MapPinned,Maximize2,RotateCcw,Signal,Users,X} from 'lucide-react';
import {QualityTopNav} from './quality-top-nav';
import {QualityGradeDonut,QualityHourlyChart,QualityExperiencePanel,QualityCallTable,QualityPanelHeading,QualitySummaryKpis,QualityMapPanelHeading} from './quality-summary-panels';
import {ServerQualityCustomerPicker} from './server-quality-customer-picker';
import {loadVoiceMeta,resetVoiceMeta,voiceQuery,loadVoiceMapStations,type VoiceMeta,type VoiceScope,type VoiceSummary,type VoiceMap,type VoiceMapStations,type VoiceCallPage,type VoiceCustomerDataset} from '../../lib/analyst/server-query';
import {parseQualityComparisonState,qualityComparisonHref,type QualityComparisonState} from '../../lib/analyst/quality-comparison-state';
import {adjustDateRange,datesInRange,dateOfCall} from '../../lib/analyst/date-range';
import {loadDay} from '../../lib/analyst/data-loader';
import {buildOriginalCallLink} from '../../lib/analyst/improved-overview';
import type {AnalystDay,AnalystOverview,OverviewCall,OverviewCallLocation} from '../../lib/analyst/types';
import type {QualityCandidateInvestigation} from '../../lib/analyst/quality-improvement-adapter';
import type {MosBand} from '../../lib/analyst/quality-proposal-metrics';
import type {SipReasonGroup} from '../../lib/analyst/sip-reason';
import styles from './quality-proposal-four.module.css';
import ui from './server-quality-overview.module.css';
import candidateTheme from './kt-candidate-page.module.css';
import DocumentLink from './document-link';
import {useVisibleMap} from '../../lib/analyst/use-visible-map';

const LocationMap=lazy(()=>import('./server-quality-map'));
const SelectedMap=lazy(()=>import('./server-quality-map').then(m=>({default:m.SelectedCallMap})));
const Investigation=lazy(()=>import('./mos-call-investigation').then(m=>({default:m.MosCallInvestigation})));
const Candidates=lazy(()=>import('./quality-improvement-candidate-panel').then(m=>({default:m.QualityImprovementCandidatePanel})));
const n=(v:number)=>v.toLocaleString('ko-KR');
const errorText=(e:unknown)=>e instanceof Error?e.message:'자료를 조회하지 못했습니다.';

function useVoiceResource<T>(op:string,args:Record<string,unknown>,enabled:boolean){
  const key=JSON.stringify([op,args,enabled]);
  const [value,setValue]=useState<{key:string;data:T|null;error:string|null;loading:boolean}>({key:'',data:null,error:null,loading:false});
  useEffect(()=>{
    if(!enabled)return;
    const controller=new AbortController();
    const [,payload]=JSON.parse(key) as [string,Record<string,unknown>];
    setValue({key,data:null,error:null,loading:true});
    const request=op==='map-stations'?loadVoiceMapStations(payload,controller.signal) as Promise<T>:voiceQuery<T>(op,payload,controller.signal);
    void request.then(data=>{
      if(!controller.signal.aborted)setValue({key,data,error:null,loading:false});
    }).catch(error=>{if(!controller.signal.aborted)setValue({key,data:null,error:errorText(error),loading:false});});
    return()=>controller.abort();
  },[op,key,enabled]);
  return enabled&&value.key===key?value:{key,data:null,error:null,loading:enabled};
}

export function ServerQualityOverview(){
  const [meta,setMeta]=useState<VoiceMeta|null>(null),[state,setState]=useState<QualityComparisonState|null>(null);
  const [initialError,setInitialError]=useState<string|null>(null),[attempt,setAttempt]=useState(0);
  const [mapRequested,setMapRequested]=useState(false),[callsOpen,setCallsOpen]=useState(false);
  const [showMapStations,setShowMapStations]=useState(false);
  const [pager,setPager]=useState({key:'',page:0});
  const [table,setTable]=useState<{key:string;rows:OverviewCall[];locations:OverviewCallLocation[];total:number}>({key:'',rows:[],locations:[],total:0});
  const [details,setDetails]=useState<Record<string,AnalystDay>>({}),[detailError,setDetailError]=useState<string|null>(null);
  const [investigation,setInvestigation]=useState<QualityCandidateInvestigation|null>(null),[investigationMode,setInvestigationMode]=useState<'members'|'customers'>('members');
  const [focus,setFocus]=useState<{key:string;lat:number;lon:number}|null>(null);
  const dialog=useRef<HTMLDialogElement>(null),returnFocus=useRef<HTMLElement|null>(null);
  const [detailMap,setDetailMap]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();setInitialError(null);
    void loadVoiceMeta(controller.signal).then(value=>{
      if(controller.signal.aborted)return;
      const parsed=parseQualityComparisonState(window.location.search,value.dataset.meta.dates);
      if(!parsed.ok)throw new Error(parsed.message);
      setMeta(value);setState({...parsed.state,sourceRevision:value.sourceRevision,
        evidence:parsed.state.evidence==='bye-cell'?'all':parsed.state.evidence});
    }).catch(e=>{if(!controller.signal.aborted)setInitialError(errorText(e));});
    return()=>controller.abort();
  },[attempt]);
  useEffect(()=>{
    if(!meta)return;
    const restore=()=>{const parsed=parseQualityComparisonState(window.location.search,meta.dataset.meta.dates);
      if(parsed.ok){setInvestigation(null);setState({...parsed.state,sourceRevision:meta.sourceRevision});}else setInitialError(parsed.message);};
    window.addEventListener('popstate',restore);return()=>window.removeEventListener('popstate',restore);
  },[meta]);
  useEffect(()=>{
    if(!state)return;
    const href=qualityComparisonHref(state,'improvement2');
    const query=href.slice(href.indexOf('?'));
    if(window.location.search!==query)window.history.replaceState(null,'',window.location.pathname+query);
  },[state]);
  useEffect(()=>{setDetails({});},[meta?.sourceRevision]);
  const update=(patch:Partial<QualityComparisonState>)=>{
    if(['dateStart','dateEnd','from','to','customerIds'].some(key=>key in patch))setInvestigation(null);
    setState(old=>old?{...old,...patch}:old);
  };
  const scope=useMemo<VoiceScope|null>(()=>state?{
    dateStart:state.dateStart,dateEnd:state.dateEnd,from:state.from,to:state.to,customerIds:state.customerIds,
    band:state.selectedBand,distributionMode:state.distributionMode,hour:state.selectedHour,district:state.district,
    evidence:state.evidence,cohort:state.cohort,
  }:null,[state]);
  const valid=!!scope&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(scope.from)&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(scope.to)&&scope.from<=scope.to;
  const queryArgs={sourceRevision:meta?.sourceRevision,scope,retry:attempt};
  const summary=useVoiceResource<VoiceSummary>('summary',queryArgs,!!meta&&valid&&state?.mapMode==='current');
  const mapTrigger=useVisibleMap(!!summary.data&&state?.mapMode==='current'&&!mapRequested,setMapRequested);
  const map=useVoiceResource<VoiceMap>('map',{...queryArgs,includeStations:false},!!meta&&valid&&mapRequested&&state?.mapMode==='current');
  const mapStations=useVoiceResource<VoiceMapStations>('map-stations',queryArgs,!!meta&&valid&&mapRequested&&showMapStations&&state?.mapMode==='current');
  const candidateScope=useMemo(()=>({sourceRevision:meta?.sourceRevision??'',dateStart:state?.dateStart??'',dateEnd:state?.dateEnd??'',from:state?.from??'00:00',to:state?.to??'23:59',policy:'strict-3-site-v1' as const}),[meta?.sourceRevision,state?.dateStart,state?.dateEnd,state?.from,state?.to]);
  const candidateMap=useVoiceResource<VoiceMap>('map',{sourceRevision:meta?.sourceRevision,scope:{dateStart:state?.dateStart,dateEnd:state?.dateEnd,from:state?.from,to:state?.to},allGrades:true,includeStations:false},!!meta&&valid&&state?.mapMode==='improvement');
  const listArgs={...queryArgs,scope:scope?{...scope,
    ...(investigation?{band:null,distributionMode:'mos',hour:null,district:null,evidence:'all',cohort:null}:{}),
    sipFilter:state?.sipFilter??'all',search:state?.search??''}:null,
    ...(investigation?{investigation:{...investigation,mode:investigationMode}}:{})};
  const listKey=JSON.stringify(listArgs),page=pager.key===listKey?pager.page:0;
  const packet=useVoiceResource<VoiceCallPage>('calls',{...listArgs,page,pageSize:20},!!meta&&valid&&callsOpen);
  useEffect(()=>{
    if(!packet.data)return;
    const data=packet.data;
    setTable(previous=>{
      const old=page>0&&previous.key===listKey?previous:{rows:[],locations:[]};
      return {key:listKey,total:data.total,
        rows:[...new Map([...old.rows,...data.rows].map(c=>[c.id,c])).values()],
        locations:[...new Map([...old.locations,...data.locations].map(p=>[p.callId,p])).values()]};
    });
  },[packet.data,listKey,page]);
  const rows=useMemo(()=>table.key===listKey?table.rows:[],[table,listKey]);
  const locations=useMemo(()=>table.key===listKey?table.locations:[],[table,listKey]);
  const currentCalls=useMemo(()=>new Map([...rows,...(map.data?.overview.calls??[])].map(c=>[c.id,c])),[rows,map.data]);
  const directCall=useVoiceResource<VoiceCallPage>('calls',{...queryArgs,callId:state?.chosenCall,allCalls:true,page:0,pageSize:1},
    !!meta&&!!state?.chosenCall&&!currentCalls.has(state.chosenCall));
  const selected=state?.chosenCall?(currentCalls.get(state.chosenCall)??directCall.data?.rows[0]??null):null;
  const selectedLocation=useMemo(()=>{
    if(!selected)return undefined;
    return [...locations,...(map.data?.overview.callLocations??[]),...(directCall.data?.locations??[])].find(p=>p.callId===selected.id);
  },[selected,locations,map.data,directCall.data]);
  const customer=useVoiceResource<VoiceCustomerDataset>('customer',{sourceRevision:meta?.sourceRevision,customerId:selected?.customerId},!!meta&&!!selected);
  const selectedDate=selected?dateOfCall(selected,state?.dateEnd??''):'';
  const detailKey=selected?selected.customerId+':'+selectedDate:'';
  const selectedDay=details[detailKey];
  useEffect(()=>{
    if(!selected||!customer.data||selectedDay)return;
    const controller=new AbortController();setDetailError(null);
    const dataset=customer.data.dataset;
    const entry=dataset.days.find(d=>d.customerId===selected.customerId&&d.date===selectedDate);
    if(!entry){setDetailError('선택한 고객·날짜의 원본 자료를 찾지 못했습니다.');return;}
    void loadDay(dataset,entry,'MDT',controller.signal).then(day=>{
      if(!controller.signal.aborted)setDetails(old=>Object.fromEntries([...Object.entries(old).filter(([k])=>k!==detailKey),[detailKey,day]].slice(-8)));
    }).catch(e=>{if(!controller.signal.aborted)setDetailError(errorText(e));});
    return()=>controller.abort();
  },[selected,customer.data,selectedDate,selectedDay,detailKey]);
  useEffect(()=>{
    setDetailMap(false);setDetailError(null);
    if(state?.chosenCall){
      if(dialog.current&&!dialog.current.open){returnFocus.current=document.activeElement as HTMLElement;dialog.current.showModal();}
    }else if(dialog.current?.open){dialog.current.close();returnFocus.current?.focus();}
  },[state?.chosenCall]);
  const selectedActual=selectedDay?.calls.find(c=>c.id===(selected?.rawCallId??selected?.id.slice((selected?.customerId.length??0)+1)));
  const regionNames=useMemo(()=>new Map<string,string>([
    ...Object.entries(meta?.regionNames??{}),
    ...(summary.data?.regions.map(region=>[region.id,region.label] as [string,string])??[]),
    ...(candidateMap.data?.overview.administrativeDongs?.map(area=>[area.id,area.label] as [string,string])??[]),
  ]),[meta,summary.data,candidateMap.data]);
  const locationByCall=useMemo(()=>new Map(locations.map(p=>[p.callId,p])),[locations]);
  const choose=(band:MosBand|null)=>{setInvestigation(null);setCallsOpen(true);update({selectedBand:band,chosenCall:null,search:'',sipFilter:'all',district:null});};
  const chooseArea=(id:string|null)=>{
    const next=state?.district===id?null:id;update({district:next,chosenCall:null});setCallsOpen(true);setMapRequested(true);
    const area=summary.data?.regions.find(r=>r.id===next);setFocus(area?{key:area.id+'-'+Date.now(),lat:area.lat,lon:area.lon}:null);
  };
  const exportCsv=()=>{
    const form=document.createElement('form');form.method='POST';form.action='/qoe/api/voice/export';
    const input=document.createElement('input');input.type='hidden';input.name='query';input.value=JSON.stringify(listArgs);
    form.appendChild(input);document.body.appendChild(form);form.submit();form.remove();
  };
  const stats=summary.data,dates=meta?.dataset.meta.dates??['2026-10-30'];
  const maxRegion=Math.max(1,...(stats?.regions.map(region=>region.poorCalls)??[]));
  const candidateOverview:AnalystOverview|null=candidateMap.data?.overview??null;
  return <div className={styles.shell+' '+styles.improvementTwo+' '+candidateTheme.page} data-query-mode="server" data-candidate-theme={state?.mapMode==='improvement'?'kt':undefined}>
    <QualityTopNav active="quality" date={state?.dateEnd??dates.at(-1)} qualityHref={state?qualityComparisonHref(state,'improvement2'):undefined}/>
    <main className={styles.main}>
      {state&&<div className={styles.filters} aria-label="품질 현황 분석 조건" data-candidate-toolbar>
        <label className={styles.dateField}><CalendarDays size={17}/>시작일<select aria-label="분석 시작일" value={state.dateStart} onChange={e=>{
          const d=adjustDateRange(dates,state.dateStart,state.dateEnd,'start',e.target.value);update({dateStart:d.start,dateEnd:d.end,chosenCall:null});
        }}>{dates.map(d=><option key={d}>{d}</option>)}</select></label>
        <label className={styles.dateField}>종료일<select aria-label="분석 종료일" value={state.dateEnd} onChange={e=>{
          const d=adjustDateRange(dates,state.dateStart,state.dateEnd,'end',e.target.value);update({dateStart:d.start,dateEnd:d.end,chosenCall:null});
        }}>{dates.map(d=><option key={d}>{d}</option>)}</select></label>
        <button type="button" className={styles.allDatesButton} aria-label="전체 분석기간 조회" aria-pressed={state.dateStart===dates[0]&&state.dateEnd===dates.at(-1)} onClick={()=>update({dateStart:dates[0],dateEnd:dates.at(-1)!,chosenCall:null})}>전체 기간</button>
        <span className={styles.rangeHint}>{datesInRange(dates,state.dateStart,state.dateEnd).length}일 선택</span>
        <label>시간<input aria-label="시작 시간" type="time" value={state.from} onChange={e=>update({from:e.target.value,selectedHour:null,chosenCall:null})}/></label><span className={styles.separator}>~</span>
        <label><input aria-label="종료 시간" type="time" value={state.to} onChange={e=>update({to:e.target.value,selectedHour:null,chosenCall:null})}/></label>
        <div className={styles.filterSpacer}/><fieldset className={styles.mapModeButtons} aria-label="지도 모드">
          <button type="button" aria-pressed={state.mapMode==='current'} onClick={()=>update({mapMode:'current'})}>품질현황</button>
          <button type="button" disabled={state.customerIds.length>0} aria-pressed={state.mapMode==='improvement'} onClick={()=>update({mapMode:'improvement'})}>개선후보</button>
        </fieldset>
        {meta&&scope&&<ServerQualityCustomerPicker scope={scope} sourceRevision={meta.sourceRevision} selectedCustomerIds={state.customerIds} onApplyCustomerIds={customerIds=>{
          setInvestigation(null);update({customerIds,mapMode:'current',chosenCall:null,selectedHour:null,district:null,cohort:null,selectedBand:null,distributionMode:'mos'});
        }}/>}<span className={styles.analysisBasis} title="데이터 출처 MDT · 원본 MOS(v5) 기반 · SIP Drop QoE −2.5점 · 저품질 기준 QoE < 3.0">MDT · QoE · 저품질 &lt; 3.0</span>
        {state.selectedHour!==null&&<button className={styles.filterApplied} onClick={()=>update({selectedHour:null})}>{state.selectedHour}시 선택 <X size={13}/></button>}
        {state.district&&<button className={styles.filterApplied} onClick={()=>chooseArea(null)}>{regionNames.get(state.district)} <X size={13}/></button>}
        {state.selectedBand&&state.distributionMode==='mos'&&<button className={styles.filterApplied} onClick={()=>choose(null)} aria-label={`QoE ${{poor:'불량',fair:'보통',good:'양호'}[state.selectedBand]} 선택 해제`}>QoE ${{poor:'불량',fair:'보통',good:'양호'}[state.selectedBand]} <X size={13}/></button>}
        {state.distributionMode==='drop'&&<span className={styles.filterApplied} aria-label="절단 통화 QoE 등급 필터 적용">SIP Drop · QoE {state.selectedBand?{poor:'불량',fair:'보통',good:'양호'}[state.selectedBand]:'불량'} <button type="button" aria-label="QoE 모드로 돌아가기" onClick={()=>update({distributionMode:'mos',selectedBand:null,chosenCall:null})}><X size={13}/></button></span>}
        <button type="button" className={styles.reset} title="필터 초기화" aria-label="전체 필터 초기화" onClick={()=>{setInvestigation(null);update({from:'00:00',to:'23:59',customerIds:[],selectedBand:null,selectedHour:null,district:null,evidence:'all',cohort:null,distributionMode:'mos',search:'',sipFilter:'all',chosenCall:null});}}><RotateCcw size={18}/></button>
      </div>}
      {state&&state.customerIds.length>0&&<section className={styles.customerScope} aria-label="선택 고객 필터" aria-live="polite"><div><strong><Users size={16}/>선택 고객 {n(state.customerIds.length)}명 기준</strong><span>지표·그래프·지도·순위·통화 목록에 적용</span>{stats&&stats.customerCount<state.customerIds.length&&<span>현재 기간·시간에 통화가 없는 선택 고객 {n(state.customerIds.length-stats.customerCount)}명</span>}<small id="customer-filter-candidate-note">개선후보는 전체 고객으로 미리 계산한 자료입니다. 고객 필터를 해제하면 열 수 있습니다.</small></div><button type="button" aria-label="선택 고객 필터 해제" onClick={()=>update({customerIds:[]})}>전체 고객으로 보기 <X size={14}/></button></section>}
      {(initialError||summary.error)&&<div className={ui.error} role="alert">{initialError??summary.error} <button className={ui.retry} onClick={()=>{resetVoiceMeta();setAttempt(n=>n+1);}}>다시 조회</button></div>}
      {(!meta||summary.loading)&&!initialError&&<output className={ui.loading}>선택한 기간의 품질 요약을 불러오는 중입니다…</output>}
      {state&&!valid&&<p role="alert" className={ui.error}>시작·종료 시간을 확인하세요.</p>}
      {state&&(state.mapMode==='improvement'||stats)&&<>
        {state.mapMode==='current'&&stats&&<>
          <QualitySummaryKpis grades={stats.grades} mapped={stats.mapped} selectedBand={state.selectedBand}/>
          <div className={styles.charts}>
            <QualityGradeDonut grades={state.distributionMode==='drop'?stats.dropGrades:stats.grades} selected={state.selectedBand} onSelect={choose} mode={state.distributionMode} onModeChange={distributionMode=>{setInvestigation(null);update({distributionMode,selectedBand:distributionMode==='drop'?'poor':null,chosenCall:null,sipFilter:'all'});}}/>
            <QualityHourlyChart hourly={stats.hourly} selected={state.selectedHour} onChoose={hour=>{setCallsOpen(true);update({selectedHour:state.selectedHour===hour?null:hour,chosenCall:null});}}/>
            <QualityExperiencePanel analytics={stats.analytics} cohort={state.cohort} improvement onChoose={cohort=>{setCallsOpen(true);update({cohort,chosenCall:null});}}/>
          </div>
          <div className={styles.geography}>
            {mapRequested&&map.data&&scope?<Suspense fallback={<div className={ui.placeholder}>지도를 준비하는 중입니다…</div>}><LocationMap value={map.data} scope={scope} onSelectCall={chosenCall=>update({chosenCall})} onSelectArea={chooseArea} onEvidenceChange={evidence=>update({evidence,chosenCall:null})} stationsVisible={showMapStations} stationLayer={mapStations.data} stationError={mapStations.error} onToggleStations={()=>setShowMapStations(value=>!value)} suspended={!!state.chosenCall} focus={focus}/></Suspense>:
              <section ref={mapTrigger} className={styles.panel}><QualityMapPanelHeading band={state.selectedBand} mode={state.distributionMode} evidence={state.evidence} onEvidenceChange={evidence=>update({evidence,chosenCall:null})} stationsVisible={showMapStations} stationCount={null} onToggleStations={()=>setShowMapStations(value=>!value)} toggleButton={<button type="button" disabled><Maximize2 size={13}/> 지도 전체 화면</button>}/><div className={styles.mapHost+' '+ui.placeholder}><MapPinned size={30}/><output>선택한 조건의 GPS·삼각 측량 지도를 자동으로 불러오는 중입니다…</output>{map.error&&<><p role="alert">{map.error}</p><button type="button" className={ui.primary} onClick={()=>setMapRequested(false)}>지도 다시 불러오기</button></>}</div></section>}
            <section className={styles.panel}><QualityPanelHeading icon={Signal} title={(state.distributionMode==='drop'?'절단(Drop) · ':'')+(state.selectedBand==='good'?'양호 순위':state.selectedBand==='fair'?'보통 순위':'저품질 순위')} caption="QoE는 CDR 원본 그대로입니다. GPS는 180초 이내 마지막 실측 시점의 행정동이며 BYE 종료 시점의 실제 위치와 다를 수 있습니다. BYE 기지국 기준 지역도 UE 위치를 의미하지 않습니다." actions={<span className={styles.rankingSort}>위치 연결 건수 순 <ChevronDown size={13}/></span>}/>
              <div className={styles.rankingHeader}><span>순위 / 위치 행정동</span><span>연결 통화</span><span>위치 근거</span><span>고객</span></div>
              <div className={styles.rankingList}>{stats.regions.slice(0,9).map((r,i)=><button type="button" className={styles.rank} key={r.id} aria-pressed={r.id===state.district} onClick={()=>chooseArea(r.id)}><span className={styles.rankNo}>{i+1}</span><b>{r.label}</b><span className={styles.rankCount}>{n(r.poorCalls)}건<span className={styles.rankTrack}><span style={{width:(100*r.poorCalls/maxRegion)+'%'}}/></span></span><span className={styles.rankEvidence}>GPS {n(r.gnssCalls)} / 삼각 측량 {n(r.estimatedCalls)} / 기지국 {n(r.byeCellCalls)}</span><b className={styles.rankCustomers}>{n(r.customerCount)}명</b></button>)}</div>
              <p className={styles.rankingFoot}>통화당 대표 위치 1개 · BYE Cell은 기지국 기준 행정동(실제 단말 위치 아님) · 지역 전체 불량률 미산출</p>
            </section>
          </div>
        </>}
        {state.mapMode==='improvement'&&(candidateOverview&&meta?<Suspense fallback={<p className={ui.loading}>개선후보를 준비하는 중입니다…</p>}><Candidates proposalTwo scope={candidateScope} overview={candidateOverview} onInvestigate={selection=>{setInvestigation(selection);setInvestigationMode('members');setCallsOpen(true);update({chosenCall:null,selectedBand:null,distributionMode:'mos',selectedHour:null,district:null,evidence:'all',cohort:null,search:'',sipFilter:'all'});}}/></Suspense>:<p className={ui.loading}>{candidateMap.error??'개선후보의 위치 근거를 조회하는 중입니다…'}</p>)}
        {callsOpen?<>
          {packet.error&&<p role="alert" className={ui.error}>{packet.error}</p>}
          <QualityCallTable calls={rows} totalCount={table.key===listKey?table.total:0} selectedBand={state.selectedBand} distributionMode={state.distributionMode} regionNames={regionNames} locationByCall={locationByCall} details={details} selected={state.chosenCall} onSelect={chosenCall=>update({chosenCall})} search={state.search??''} setSearch={search=>update({search})} sipFilter={state.sipFilter??'all'} setSipFilter={(sipFilter:SipReasonGroup|'all')=>update({sipFilter})} limit={rows.length} onMore={()=>{if(!packet.loading&&packet.data?.page===page)setPager({key:listKey,page:page+1});}} onCsv={exportCsv} investigation={investigation} investigationMode={investigationMode} onInvestigationMode={setInvestigationMode} onClearInvestigation={()=>setInvestigation(null)}/>
          {packet.loading&&<output className={ui.loading}>통화 목록을 조회하는 중입니다…</output>}
        </>:<section className={styles.panel}><div className={ui.tableIntro}><div><h2>통화 상세 목록</h2><p className={ui.label}>목록에서 통화를 선택하면 원본 지표와 관측을 확인할 수 있습니다.</p></div><button type="button" className={ui.primary} onClick={()=>setCallsOpen(true)}>통화 목록 보기</button></div></section>}
        <footer className={styles.footer}>원본 MOS(v5)와 기존 SIP Drop 기준을 사용합니다. 원본 통화와 관측 자료는 선택 시 조회합니다.</footer>
      </>}
      <dialog ref={dialog} className={ui.modal} aria-label="선택 통화 상세" onCancel={()=>update({chosenCall:null})} onClose={()=>update({chosenCall:null})}><div className={ui.modalBody}>
        <div className={ui.modalTop}><h2>선택 통화 상세 {selected?.start}</h2><button type="button" aria-label="통화 상세 닫기" onClick={()=>update({chosenCall:null})}><X size={20}/></button></div>
        {(customer.error||directCall.error||detailError)&&<p role="alert" className={ui.error}>{customer.error??directCall.error??detailError}</p>}
        {!selectedActual&&!detailError&&<p>선택한 통화의 원본 관측을 불러오는 중입니다…</p>}
        {selectedActual&&selectedDay&&<Suspense fallback={<p>통화 근거를 준비하는 중입니다…</p>}><Investigation call={selectedActual} samples={selectedDay.samples.filter(s=>s.callId===selectedActual.id)}/>
          <div className={ui.detailActions}><button type="button" className={ui.primary} onClick={()=>setDetailMap(v=>!v)}>{detailMap?'위치 지도 접기':'위치 지도 보기'}</button>{selected&&<DocumentLink href={buildOriginalCallLink(selected,selectedDate)}>고객·통화 분석에서 열기 ↗</DocumentLink>}</div>
          {detailMap&&<SelectedMap day={selectedDay} rawCallId={selectedActual.id} location={selectedLocation}/>}</Suspense>}
      </div></dialog>
    </main>
  </div>;
}
