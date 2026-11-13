/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Interactive SVG observations need ARIA roles because HTML buttons cannot be SVG children. */
import {useEffect,useId,useRef,useState} from 'react';
import {Activity,RotateCcw} from 'lucide-react';
import type {AnalysisScope} from '../../lib/analyst/customer-ai-analysis';
import type {ScreeningRow} from '../../lib/analyst/customer-screening';
import {loadCustomerQoeTimeline,type CustomerQoeCall,type CustomerQoeTimeline} from '../../lib/analyst/customer-qoe-timeline';
import {buildCustomerQoeChart,type CustomerQoeChartMode} from '../../lib/analyst/customer-qoe-chart';
import Link from './document-link';
import styles from './customer-qoe-timeline.module.css';

export type CustomerQoeTimelinePanelProps={
  customer:ScreeningRow|null;scope:AnalysisScope;sourceRevision:string;dates:string[];
  areaId?:string;cellId?:string;selectedRegion?:string;onClearRegion?:()=>void;
  onSelectCall?:(call:CustomerQoeCall|null)=>void;pending?:boolean;
};
export type CustomerQoeTimelineChartProps={
  calls:CustomerQoeCall[];customerId:string;scope:AnalysisScope;mode?:CustomerQoeChartMode;
  date?:string;selectedCallId?:string;onSelectCall?:(call:CustomerQoeCall|null)=>void;
};
const rangeLabel=(score:number|null)=>score!==null&&score<1?'표시 범위 밖 · 1 미만':score!==null&&score>5?'표시 범위 밖 · 5 초과':'';
const scoreLabel=(score:number|null)=>{
  if(score===null)return '미평가';
  const rounded=score.toFixed(2);
  return score<1&&Number(rounded)>=1||score>5&&Number(rounded)<=5?String(score):rounded;
};
const callLabel=(call:CustomerQoeCall)=>`${call.date} ${call.start} · QoE ${scoreLabel(call.qoe)}${call.drop?' · Drop':''} · BYE Cell ${call.cell||'미확인'}${rangeLabel(call.qoe)?' · '+rangeLabel(call.qoe):''}`;
const detailHref=(customerId:string,call:CustomerQoeCall)=>'/?'+new URLSearchParams({source:'MDT',view:'contract',date:call.date,customer:customerId,call:call.rawCallId}).toString();

/** Fetch-free renderer: useful for previews, SSR and deterministic chart checks. */
export function CustomerQoeTimelineChart({calls,customerId,scope,mode='all',date,selectedCallId,onSelectCall}:CustomerQoeTimelineChartProps){
  const chart=buildCustomerQoeChart(calls,{scope,mode,date});
  const [selected,setSelected]=useState<string|null>(selectedCallId??null);
  const [hovered,setHovered]=useState<string|null>(null);
  const pointRefs=useRef<(SVGGElement|null)[]>([]);
  const descriptionId=useId();
  const active=chart.points.find(point=>point.call.id===(hovered??selected))?.call;
  const tabStopIndex=Math.max(0,chart.points.findIndex(point=>point.call.id===selected));
  const select=(call:CustomerQoeCall)=>{setSelected(call.id);onSelectCall?.(call);};
  const axisScores=[5,4,3,2,1];
  return <div className={styles.chartWrap} data-timeline-total={calls.length}>
    <div className={styles.legend}><span><i className={styles.blueDot}/>통화 QoE</span><span><i className={styles.redDot}/>저품질 (3 미만)</span><span><i className={styles.diamond}/>Drop</span>{chart.points.some(point=>point.outOfRange)&&<span>△▽ 범위 밖</span>}<span>전체 {calls.length.toLocaleString('ko-KR')}건 · 표시 {chart.points.length.toLocaleString('ko-KR')}건</span></div>
    {chart.points.length?<>
      <svg className={styles.chart} viewBox={`0 0 ${chart.width} ${chart.height}`} data-qoe-min={chart.min} data-qoe-max={chart.max} role="group" aria-label="선택 고객 통화별 QoE 추이" aria-describedby={descriptionId}>
        <rect data-poor-region="true" x={chart.left} y={chart.y(3)} width={chart.right-chart.left} height={chart.bottom-chart.y(3)} fill="#fff0f3"/>
        {axisScores.map(score=><g key={score} aria-hidden="true"><line x1={chart.left} x2={chart.right} y1={chart.y(score)} y2={chart.y(score)} stroke="#e4eaf2"/><text data-axis-score={score} x={chart.left-9} y={chart.y(score)+4} textAnchor="end" className={styles.axis}>{score}</text></g>)}
        <line data-threshold="3" x1={chart.left} x2={chart.right} y1={chart.y(3)} y2={chart.y(3)} stroke="#d85e7a" strokeDasharray="5 4"/>
        <g aria-hidden="true"><rect x={chart.right-117} y={chart.y(3)-21} width={117} height={17} rx={3} fill="#fff" fillOpacity=".94"/><text x={chart.right-6} y={chart.y(3)-9} textAnchor="end" className={styles.thresholdLabel}>저품질 기준 3.0</text></g>
        {chart.dayBreaks.map(x=><line key={x} x1={x} x2={x} y1={chart.top} y2={chart.bottom} stroke="#dfe5ee" strokeDasharray="3 4"/>)}
        <rect x={chart.left} y={chart.unscoredY-12} width={chart.right-chart.left} height={24} rx={4} fill="#f1f4f9"/>
        <text x={chart.left-9} y={chart.unscoredY+4} textAnchor="end" className={styles.axis}>미평가</text>
        {chart.segments.map((segment,index)=><polyline key={index} data-observation-connector="true" points={segment.map(point=>`${point.x},${point.y}`).join(' ')} fill="none" stroke="#408dde" strokeWidth="1.6" strokeLinejoin="round"/>)}
        {chart.points.map(({call,x,y,outOfRange},index)=><g key={call.id} ref={node=>{pointRefs.current[index]=node;}}
          className={styles.point} role="button" tabIndex={index===tabStopIndex?0:-1} aria-label={callLabel(call)} aria-pressed={selected===call.id}
          data-call-id={call.id} data-qoe={call.qoe??''} data-unscored={call.qoe===null?'true':undefined} data-drop={call.drop?'true':'false'} data-out-of-range={outOfRange??undefined}
          onMouseEnter={()=>setHovered(call.id)} onMouseLeave={()=>setHovered(null)} onFocus={()=>select(call)} onClick={()=>select(call)}
          onKeyDown={event=>{
            let next=index;
            if(event.key==='ArrowRight'||event.key==='ArrowDown')next=Math.min(chart.points.length-1,index+1);
            else if(event.key==='ArrowLeft'||event.key==='ArrowUp')next=Math.max(0,index-1);
            else if(event.key==='Home')next=0;
            else if(event.key==='End')next=chart.points.length-1;
            else if(event.key==='Enter'||event.key===' '){event.preventDefault();select(call);return;}
            else return;
            event.preventDefault();pointRefs.current[next]?.focus();
          }}>
          <title>{callLabel(call)}</title>
          <circle cx={x} cy={y} r={8} fill="transparent"/>
          {outOfRange&&<path data-range-marker="true" d={outOfRange==='below'?`M ${x-8} ${y-5} L ${x+8} ${y-5} L ${x} ${y+8} Z`:`M ${x-8} ${y+5} L ${x+8} ${y+5} L ${x} ${y-8} Z`} fill="none" stroke="#a94365" strokeWidth="1.3"/>}
          {call.drop?<path d={`M ${x} ${y-5} L ${x+5} ${y} L ${x} ${y+5} L ${x-5} ${y} Z`} fill="#885ac8" stroke="#fff" strokeWidth="1"/>:
            <circle cx={x} cy={y} r={3.4} fill={call.qoe===null?'#8895a9':call.qoe<3?'#ec5368':'#408dde'} stroke="#fff" strokeWidth=".8"/>}
          {selected===call.id&&<circle cx={x} cy={y} r={8} fill="none" stroke="#132d51" strokeWidth="1.5"/>}
        </g>)}
        {chart.ticks.map((tick,index)=><text key={index} x={tick.x} y={227} textAnchor="middle" className={styles.axis}>{tick.label}</text>)}
      </svg>
      <div className={styles.tooltip} aria-live="polite">{active?<><strong>{active.date} {active.start}</strong><span>QoE {scoreLabel(active.qoe)}{active.drop?' · Drop':''}</span>{rangeLabel(active.qoe)&&<span>{rangeLabel(active.qoe)}</span>}<span>BYE Cell {active.cell||'미확인'}</span>{!active.location&&<span>위치 정보 없음</span>}<Link href={detailHref(customerId,active)}>통화 상세 →</Link></>:<span>통화 점을 선택하면 QoE와 BYE Cell을 확인할 수 있습니다.</span>}</div>
    </>:<output className={styles.status}>{mode==='day'?'선택한 날짜에 통화가 없습니다.':'선택한 범위에 통화가 없습니다.'}</output>}
    <p id={descriptionId} className={styles.caption}>세로축 1~5 · 점 1개 = 통화 1건 · 선은 같은 날의 관측값만 연결합니다. 미평가는 하단에 별도 표시합니다.{chart.points.some(point=>point.outOfRange)&&' 범위 밖 값은 경계에 표시하며 선택 시 실제 값을 확인할 수 있습니다.'} 점 선택 후 방향키로 이동할 수 있습니다.</p>
  </div>;
}

export function CustomerQoeTimelinePanel({customer,scope,sourceRevision,dates,areaId,cellId,selectedRegion,onClearRegion,onSelectCall,pending=false}:CustomerQoeTimelinePanelProps){
  const [mode,setMode]=useState<CustomerQoeChartMode>('all');
  const [chosenDate,setChosenDate]=useState(scope.dateStart);
  const [attempt,setAttempt]=useState(0);
  const [result,setResult]=useState<{key:string;data?:CustomerQoeTimeline;error?:string}|null>(null);
  const customerId=customer?.id??'';
  const availableDates=dates.filter(date=>date>=scope.dateStart&&date<=scope.dateEnd);
  const date=availableDates.includes(chosenDate)?chosenDate:(availableDates[0]??scope.dateStart);
  const requestKey=JSON.stringify([customerId,sourceRevision,scope.dateStart,scope.dateEnd,scope.from,scope.to,areaId??'',cellId??'']);
  useEffect(()=>{
    if(!customerId||pending)return;
    const controller=new AbortController();
    let current=true;
    void loadCustomerQoeTimeline({customerId,sourceRevision,scope:{dateStart:scope.dateStart,dateEnd:scope.dateEnd,from:scope.from,to:scope.to},areaId,cellId},controller.signal).then(data=>{
      if(current&&!controller.signal.aborted)setResult({key:requestKey,data});
    }).catch((error:unknown)=>{
      if(current&&!controller.signal.aborted)setResult({key:requestKey,error:error instanceof Error?error.message:'통화 정보를 불러오지 못했습니다.'});
    });
    return ()=>{current=false;controller.abort();};
  },[requestKey,attempt,pending,customerId,sourceRevision,scope.dateStart,scope.dateEnd,scope.from,scope.to,areaId,cellId]);
  const current=!pending&&result?.key===requestKey?result:null;
  const busy=pending||(!!customer&&!current);
  const changeView=(next:CustomerQoeChartMode)=>{setMode(next);onSelectCall?.(null);};
  return <section className={styles.panel} aria-label="선택 고객 통화 품질 추이" data-timeline-customer={customer?.id??''} aria-busy={busy}>
    <div className={styles.heading}><h3><Activity size={17}/>선택 고객 통화 품질 추이</h3>{selectedRegion&&<div className={styles.region}><span>{selectedRegion}</span>{onClearRegion&&<button type="button" onClick={onClearRegion}><RotateCcw size={12}/>지역 선택 해제</button>}</div>}</div>
    <div className={styles.toolbar}><div className={styles.identity}><small>서비스계약번호</small><strong>{customer?.number??'고객 미선택'}</strong></div>
      <div className={styles.controls}><div className={styles.toggle} role="group" aria-label="QoE 기간 보기"><button type="button" aria-pressed={mode==='all'} onClick={()=>changeView('all')}>기간 전체</button><button type="button" aria-pressed={mode==='day'} onClick={()=>changeView('day')}>하루 확대</button></div>
        <label className={styles.dateLabel}>날짜<select aria-label="통화 품질 추이 날짜" value={date} disabled={mode!=='day'||!availableDates.length} onChange={event=>{setChosenDate(event.target.value);onSelectCall?.(null);}}>{availableDates.map(date=><option value={date} key={date}>{date}</option>)}</select></label>
      </div>
    </div>
    {busy?<output className={styles.status}>통화별 QoE를 불러오는 중…</output>:!customer?<output className={styles.status}>목록에서 고객을 선택해 통화별 QoE를 확인하세요.</output>:current?.error?<div className={styles.status} role="alert"><span>{current.error}</span><button type="button" onClick={()=>{setResult(null);setAttempt(value=>value+1);}}>다시 시도</button></div>:current?.data?<CustomerQoeTimelineChart key={requestKey+':'+mode+':'+date} calls={current.data.calls} customerId={customer.id} scope={scope} mode={mode} date={date} onSelectCall={onSelectCall}/>:null}
  </section>;
}
