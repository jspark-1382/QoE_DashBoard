/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Inline SVG exposes exact daily chart values as an accessible image. */
import {useId,useRef,useState} from 'react';
import {ChevronRight,LoaderCircle,Sparkles,Users} from 'lucide-react';
import type {AnalysisScope} from '../../lib/analyst/customer-ai-analysis';
import {CustomerAiAnalysis,type CustomerAiAnalysisHandle} from './customer-ai-analysis';
import {number,type ScreeningRow} from '../../lib/analyst/customer-screening';
import Link from './document-link';
import styles from './customer-screening.module.css';
import dailyStyles from './customer-screening-daily-stack.module.css';
import previewTheme from './customer-status-preview.module.css';

export function CustomerScreeningPreview({row,dates,scope,sourceRevision}:{row:ScreeningRow;dates:string[];scope:AnalysisScope;sourceRevision:string}) {
  const [tab,setTab]=useState<'overview'|'analysis'>('overview');
  const analysisRef=useRef<CustomerAiAnalysisHandle>(null);
  const [busy,setBusy]=useState(false);
  const tabId=useId();
  const days=dates.map((date,i)=>({date,total:row.dailyTotal?.[i]??null,poor:row.dailyPoor[i]??0}))
    .filter(day=>day.date>=scope.dateStart&&day.date<=scope.dateEnd);
  const width=300,height=134,left=32,right=width-6,top=26,bottom=105;
  const max=Math.max(1,...days.map(day=>day.total??0)),maxAxis=Math.ceil(max/4)*4;
  const step=(right-left)/Math.max(1,days.length),barWidth=Math.min(48,step*.6);
  const dayLabel=(day:typeof days[number])=>`${day.date} ${day.total===null?'전체 통화 미제공':`전체 ${number(day.total)}건`}, 저품질 ${number(day.poor)}건`;
  return <div className={styles.preview+' '+previewTheme.preview} data-preview-customer={row.id} data-preview-tab={tab}>
    <div className={styles.previewIdentity+' '+previewTheme.identity}>
      <div className={styles.previewCustomer+' '+previewTheme.customer}>
        <span className={styles.previewCustomerIcon+' '+previewTheme.customerIcon}><Users size={20}/></span>
        <div><small>서비스계약번호</small><strong>{row.number}</strong></div>
      </div>
      <div className={styles.previewLocation+' '+previewTheme.location}>
        <span>주요 행정동 <b>{row.mainArea||'미확인'}</b></span>
        <span>BYE Cell <b>{row.mainCell||'미확인'}</b></span>
      </div>
      <div className={styles.previewActions+' '+previewTheme.actions}>
        <button type="button" className={styles.aiAnalysisButton} disabled={busy} aria-busy={busy} onClick={()=>{setTab('analysis');analysisRef.current?.startCustomer();}}>{busy?<LoaderCircle size={14} className={styles.aiSpin}/>:<Sparkles size={14}/>} {busy?'분석 중':'AI 분석'}</button>
        <Link className={styles.detailLink} href={row.href}>고객·통화 상세 <ChevronRight size={14}/></Link>
      </div>
    </div>
    <div className={styles.previewTabs+' '+previewTheme.tabs} role="tablist" aria-label="선택 고객 상세 보기">
      <button type="button" role="tab" id={tabId+'-overview-tab'} aria-controls={tabId+'-overview'} aria-selected={tab==='overview'} onClick={()=>setTab('overview')}>고객 현황</button>
      <button type="button" role="tab" id={tabId+'-analysis-tab'} aria-controls={tabId+'-analysis'} aria-selected={tab==='analysis'} onClick={()=>setTab('analysis')}><Sparkles size={13}/> AI 분석 {busy&&<span className={styles.aiStatusDot}/>}</button>
    </div>
    <div id={tabId+'-overview'} role="tabpanel" aria-labelledby={tabId+'-overview-tab'} hidden={tab!=='overview'} className={styles.previewOverview+' '+previewTheme.overview}>
    <div className={styles.previewGrid+' '+previewTheme.grid}>
      <div className={styles.previewCard+' '+previewTheme.card}>
        <div className={styles.previewCardHeading+' '+previewTheme.cardHeading}><strong>일별 전체 · 저품질 통화 수</strong><span className={dailyStyles.totals+' '+previewTheme.totals}><span>전체 <b>{number(row.total)}</b>건</span><span>저품질 <b>{number(row.poor)}</b>건</span></span></div>
        <div className={dailyStyles.legend+' '+previewTheme.legend}><span>숫자 = 저품질/총통화</span><span><i className={dailyStyles.other}/>그 외 통화</span><span><i className={dailyStyles.poor}/>저품질 통화</span></div>
        <figure className={dailyStyles.chart+' '+previewTheme.chart}>
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`일별 전체 · 저품질 통화 수: ${days.map(dayLabel).join('; ')}`}>
            {[0,1,2].map(i=>{
              const value=maxAxis*(2-i)/2,y=top+(bottom-top)*i/2;
              return <g key={i} aria-hidden="true"><line x1={left} x2={right} y1={y} y2={y} stroke="#e6edf6"/>
                <text x={left-7} y={y+4} textAnchor="end" className={dailyStyles.axis}>{number(value)}</text></g>;
            })}
            {days.map((day,i)=>{
              const x=left+step*(i+.5),totalHeight=(day.total??0)/maxAxis*(bottom-top),poorHeight=day.poor/maxAxis*(bottom-top);
              const otherHeight=day.total===null?0:Math.max(0,totalHeight-poorHeight);
              return <g data-day={day.date} key={day.date}>
                <title>{dayLabel(day)}</title>
                {day.total!==null&&<>
                  <rect data-segment="other" x={x-barWidth/2} y={bottom-otherHeight} width={barWidth} height={otherHeight} fill="#3d8fe1" rx="1"/>
                  <rect data-segment="poor" x={x-barWidth/2} y={bottom-totalHeight} width={barWidth} height={poorHeight} fill="#ee5262" rx="1"/>
                </>}
                <text x={x} y={bottom-totalHeight-9} textAnchor="middle" className={dailyStyles.countLabel} aria-label={dayLabel(day)}>
                  {number(day.poor)}/{day.total===null?'—':number(day.total)}
                </text>
                <text x={x} y={height-10} textAnchor="middle" className={dailyStyles.date}>{day.date.slice(5)}</text>
              </g>;
            })}
          </svg>
          <figcaption>통화 시작일 기준 · 전체 통화에는 QoE 미평가 통화가 포함됩니다.</figcaption>
        </figure>
      </div>
      <div className={styles.previewCard+' '+previewTheme.card}>
        <div className={styles.previewCardHeading+' '+previewTheme.cardHeading}><strong>대표 QoE · SIP 근거</strong></div>
        <dl className={styles.previewMetrics+' '+previewTheme.metrics}>
          <div><dt>평균 QoE</dt><dd className={styles.red}>{row.mean===null?'미평가':row.mean.toFixed(2)}</dd></div>
          <div><dt>QoE 평가 통화</dt><dd>{number(row.eligible)}<small>건</small></dd></div>
          <div><dt>Drop 통화</dt><dd>{number(row.drop)}<small>건</small></dd></div>
          <div><dt>저품질 발생 일수</dt><dd>{row.repeatedDays}<small>일</small></dd></div>
        </dl>
        <p className={styles.previewFootnote+' '+previewTheme.footnote}>RSRP · RSRQ · SINR은 개별 통화 상세에서 확인할 수 있습니다.</p>
      </div>
    </div>
    </div>
    <div id={tabId+'-analysis'} role="tabpanel" aria-labelledby={tabId+'-analysis-tab'} hidden={tab!=='analysis'} className={styles.previewAnalysis+' '+previewTheme.analysis}>
      <CustomerAiAnalysis customerId={row.id} customerNumber={row.number} scope={scope} sourceRevision={sourceRevision} analysisRef={analysisRef} onBusyChange={setBusy}/>
    </div>
  </div>;
}
