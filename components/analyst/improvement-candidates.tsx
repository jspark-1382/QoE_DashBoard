'use client';
import {useEffect,useState} from 'react';
import Link from './document-link';
import {Activity,ArrowUpRight,ChevronRight,CircleHelp,MapPinned,RadioTower,Users} from 'lucide-react';
import {ImprovementCandidateMap} from './improvement-candidate-map';
import {callEvidenceUrl,validateImprovementReport,
  type ImprovementCandidate,type ImprovementCandidateReport} from '../../lib/analyst/improvement-candidates';
import styles from './improvement-candidates.module.css';

const FILE='/qoe/improvement-candidates/2026-10-26_2026-10-30.json';
const num=(n:number)=>n.toLocaleString('ko-KR');
const radioValue=(n:number|null|undefined,unit:string)=>n==null?'미확보':n.toFixed(1)+unit;

function CandidateDetail({candidate,all}:{candidate:ImprovementCandidate;all:ImprovementCandidate[]}){
  const geo=candidate.kind==='spatial';
  const d=candidate.discovery;
  const loc=candidate.location;
  return <div className={styles.detail} aria-label="선택 개선 후보 상세 근거">
    <div className={styles.detailTitle}>
      <strong>{candidate.label}</strong>
      <span className={styles.evidenceTag}>{geo?'GNSS 연관 위치':'CDR 종료 Cell'}</span>
    </div>
    <p className={styles.keyResult}>
      독립 불량 고객 <b>{d.distinctPoorCustomers}명</b> · {d.days}일 반복
      {' · '}10/30 신규 고객 <b>{candidate.validation.newPoorCustomers}명 재발</b>
    </p>
    <div className={styles.evidenceRow}>
      <div className={styles.stats}>
        <div><small>저MOS 통화</small><b>{num(d.poorCalls)}건</b></div>
        <div><small>Drop (SIP 11.REASON)</small><b data-reason="drop">{num(d.dropCalls)}건</b></div>
        <div><small>{geo?'인접 정상 GNSS 고객':'같은 종료 Cell MOS ≥3 통화'}</small>
          <b>{geo?num(candidate.normalReference.distinctCustomers??0)+'명':num(d.normalCalls??0)+'건'}</b></div>
      </div>
      <div className={styles.radioPanel} aria-label="대표 통화 MDT 무선 측정 참고값">
        <strong><Activity size={13}/>대표 통화 MDT {candidate.radioReference.linkedCdrMdtRepresentativeCalls}건 연결</strong>
        <div className={styles.radioMetrics}>
          <span><small>RSRP</small><b>{radioValue(candidate.radioReference.rsrpMedianDbm,' dBm')}</b></span>
          <span><small>RSRQ</small><b>{radioValue(candidate.radioReference.rsrqMedianDb,' dB')}</b></span>
          <span><small>SINR</small><b>{radioValue(candidate.radioReference.sinrMedianDb,' dB')}</b></span>
        </div>
      </div>
    </div>
    {!geo&&<p className={styles.rateNote}>해당 Cell 유효 MOS {num(d.scoredCalls??0)}건 중 저MOS {d.observedPoorAmongScoredPct?.toFixed(2)}%
      {' · '}전체 유효 MOS 관측 비중 대비 {d.ratioToOverallObserved?.toFixed(2)}배 (수집 편향 주의)</p>}
    {loc?<p className={styles.locationNote}><MapPinned size={14}/>
      {geo
        ? 'GNSS 조사 중심 '+loc.lat.toFixed(4)+', '+loc.lon.toFixed(4)+' · 표시 반경 약 '+loc.radiusM+'m'
        : 'RU '+loc.ruId+' · '+loc.lat.toFixed(4)+', '+loc.lon.toFixed(4)+' (기지국 참고점)'}
    </p>:<p className={styles.unknownLocation}>지도 위치 미표시 · {candidate.locationUnknownReason}</p>}
    {!!candidate.nearbyCandidateIds?.length&&<p className={styles.overlapNote}>
      인접 군집과 중복 가능: {candidate.nearbyCandidateIds.map(id=>all.find(x=>x.id===id)?.label??id).join(', ')}
    </p>}

    <details className={styles.relatedCoordinates}>
      <summary>관련 원본 GNSS 전체 {num(candidate.relatedGnss.length)}개
        <span> · {num(candidate.relatedGnssCallCount)}통화 · 관측 좌표 보기</span></summary>
      {candidate.relatedGnss.length?<div className={styles.coordinateList}>
        {candidate.relatedGnss.map((point,index)=><Link key={point.callId+'-'+point.observedAt+'-'+index}
          href={callEvidenceUrl({date:point.date,customerId:point.customerId,callId:point.callId,mos:0,endCellId:'',start:''})}
          className={styles.coordinateRow}
          title="원본 GNSS 관측 시각과 좌표 · MOS 저하 순간의 위치로 확정되지 않음">
          <span>{point.date.slice(5)} {point.observedAt?.slice(11,19)??'시각 미제공'}
            {point.validationDay?' · 10/30 검증':''}</span>
          <b>{point.lat.toFixed(6)}, {point.lon.toFixed(6)}</b>
          <small>{point.phase??'MDT GNSS'}</small><ArrowUpRight size={12}/>
        </Link>)}
      </div>:<p>관련 저MOS 통화에 원본 GNSS 관측이 없어 좌표를 생성하지 않았습니다.</p>}
    </details>
    <div className={styles.cellLines}><b>관련 종료 Cell</b>
      <span>{candidate.relatedEndCells.slice(0,5).map(c=>c.id+' ('+c.poorCalls+'건)').join(' · ')}</span>
    </div>
    <div className={styles.evidenceCalls}><b>관련 원본 통화</b>
      <div>{candidate.representativeCalls.slice(0,3).map(ref=><Link key={ref.callId}
        href={callEvidenceUrl(ref)} className={styles.callLink}>
        {ref.date.slice(5)} {ref.start} · MOS {ref.mos.toFixed(2)}<ArrowUpRight size={13}/>
      </Link>)}</div>
      {candidate.representativeCalls.length>3&&<details className={styles.moreCalls}>
        <summary>통화 {candidate.representativeCalls.length-3}건 더 보기</summary>
        {candidate.representativeCalls.slice(3).map(ref=><Link key={ref.callId}
          href={callEvidenceUrl(ref)} className={styles.callLink}>
          {ref.date.slice(5)} {ref.start} · MOS {ref.mos.toFixed(2)}<ArrowUpRight size={13}/>
        </Link>)}
      </details>}
    </div>
    <details className={styles.explanation}>
      <summary>원인 가설 및 검증 한계 <ChevronRight size={13}/></summary>
      <ul>{candidate.hypotheses.map((s,i)=><li key={i}>{s}</li>)}</ul>
      <p>{candidate.normalReference.caution}</p>
      <p>{candidate.radioReference.warning}</p>
    </details>
    <details className={styles.explanation}>
      <summary>현장 점검 항목 <ChevronRight size={13}/></summary>
      <ol>{candidate.fieldChecks.map((s,i)=><li key={i}>{s}</li>)}</ol>
    </details>
  </div>;
}

export function ImprovementCandidateWorkspace({sourceRevision}:{sourceRevision:string}){
  const [data,setData]=useState<{loading:boolean;report:ImprovementCandidateReport|null;error:string|null}>({
    loading:true,report:null,error:null,
  });
  const [selectedId,setSelectedId]=useState('spatial-1');
  const [filter,setFilter]=useState<'all'|'spatial'|'cell'>('all');
  useEffect(()=>{
    const ctrl=new AbortController();
    void (async()=>{
      try {
        const response=await fetch(FILE,{signal:ctrl.signal,cache:'no-cache'});
        if(!response.ok)throw new Error('개선 후보 파일 HTTP '+response.status);
        const report=await response.json() as ImprovementCandidateReport;
        if(!validateImprovementReport(report,sourceRevision))
          throw new Error('개선 후보 원본 버전 및 검증 조건이 현재 자료와 맞지 않습니다.');
        if(!ctrl.signal.aborted)setData({loading:false,report,error:null});
      }catch(e){
        if(!ctrl.signal.aborted)setData({loading:false,report:null,error:e instanceof Error?e.message:'후보 파일 오류'});
      }
    })();
    return()=>ctrl.abort();
  },[sourceRevision]);
  if(data.loading)return <div className={styles.loadState} role="status">5일 원본 개선 후보를 확인하고 있습니다…</div>;
  if(!data.report)return <div className={styles.errorState} role="alert">{data.error??'개선 후보 자료가 없습니다.'}</div>;
  const report=data.report;
  const visible=report.candidates.filter(c=>filter==='all'||c.kind===filter);
  const selected=report.candidates.find(c=>c.id===selectedId)??report.candidates[0];
  const chooseFilter=(value:'all'|'spatial'|'cell')=>{
    setFilter(value);
    if(value!=='all'&&selected.kind!==value){
      const next=report.candidates.find(c=>c.kind===value);
      if(next)setSelectedId(next.id);
    }
  };
  return <section className={styles.workspace} aria-label="개선 후보 분석">
    <div className={styles.kpis}>
      <div><Users size={19}/><span>저품질 체감 고객</span><strong>{num(report.summary.distinctAffectedCustomers)}<small>명</small></strong></div>
      <div><MapPinned size={19}/><span>MOS 저하고객 중복 위치</span><strong>{num(report.summary.spatialCandidateCount)}<small>곳</small></strong></div>
      <div><RadioTower size={19}/><span>반복 불량 Cell</span><strong>{num(report.summary.cellCandidateCount)}<small>개</small></strong></div>
    </div>
    <div className={styles.grid}>
      <section className={styles.mapPanel}>
        <div className={styles.panelHeading}><strong><MapPinned size={17}/>반복 불량 후보 지도</strong>
          <span className={styles.legend}><i className={styles.redDot}/>중복 조사 권역 <i className={styles.blueDot}/>기지국 참고점 · 선택 후보 GNSS 관측 표시</span>
        </div>
        <div className={styles.mapHost}>
          <ImprovementCandidateMap candidates={report.candidates} selectedId={selected.id} onSelect={setSelectedId}/>
        </div>
        <p className={styles.mapFoot}>후보 중심 {report.summary.mappedCandidates}곳 · 선택 후보의 원본 GNSS {selected.relatedGnss.length}점 별도 표시 · 기지국 참고 위치는 UE 위치 아님</p>
      </section>
      <section className={styles.listPanel}>
        <div className={styles.panelHeading}><strong>저품질 체감 고객 조사 후보</strong>
          <span className={styles.analysisLabel}>확정 우선순위 아님</span>
        </div>
        <div className={styles.kindFilters} role="group" aria-label="개선 후보 종류">
          {([['all','전체 5건'],['spatial','MOS 중복 위치 3곳'],['cell','Cell 2개']] as const).map(([value,label])=>
            <button type="button" key={value} aria-pressed={filter===value}
              onClick={()=>chooseFilter(value)}>{label}</button>)}
        </div>
        <div className={styles.list} aria-label="저품질 체감 고객 후보 선택">
          {visible.map(c=><button key={c.id} type="button" aria-pressed={c.id===selected.id}
            className={styles.candidateRow} onClick={()=>setSelectedId(c.id)}>
            <span className={c.kind==='spatial'?styles.numberSpatial:styles.numberCell}>{report.candidates.indexOf(c)+1}</span>
            <span><strong>{c.label}</strong>
              <small>불량 고객 {c.discovery.distinctPoorCustomers}명 · 신규 재발 {c.validation.newPoorCustomers}명
                {!c.location?' · 위치 미확인':''}</small>
            </span><ChevronRight size={15}/>
          </button>)}
        </div>
        <CandidateDetail candidate={selected} all={report.candidates}/>
      </section>
    </div>
    <details className={styles.footerDetails}><summary><CircleHelp size={14}/>분석 기준과 주의사항 보기</summary>
      <p>탐색 10/26~29 · 검증 10/30 · 다른 고객 재발 확인. 조사 후보는 원인 확정과 다릅니다.</p>
      <ul>{report.limitations.map((s,i)=><li key={i}>{s}</li>)}</ul>
    </details>
  </section>;
}
