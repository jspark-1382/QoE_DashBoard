import {useId,useRef,useState} from 'react';
import {ChevronRight,LoaderCircle,Sparkles,Users} from 'lucide-react';
import type {AnalysisScope} from '../../lib/analyst/customer-ai-analysis';
import {CustomerAiAnalysis,type CustomerAiAnalysisHandle} from './customer-ai-analysis';
import {number,type ScreeningRow} from '../../lib/analyst/customer-screening';
import Link from './document-link';
import styles from './customer-screening.module.css';

export function CustomerScreeningPreview({row,dates,scope,sourceRevision}:{row:ScreeningRow;dates:string[];scope:AnalysisScope;sourceRevision:string}) {
  const [tab,setTab]=useState<'overview'|'analysis'>('overview');
  const analysisRef=useRef<CustomerAiAnalysisHandle>(null);
  const [busy,setBusy]=useState(false);
  const tabId=useId();
  const days=dates.map((date,i)=>({date,count:row.dailyPoor[i]??0}));
  const max=Math.max(1,...days.map(day=>day.count));
  return <div className={styles.preview} data-preview-customer={row.id}>
    <div className={styles.previewIdentity}>
      <div className={styles.previewCustomer}>
        <span className={styles.previewCustomerIcon}><Users size={20}/></span>
        <div><small>서비스계약번호</small><strong>{row.number}</strong></div>
      </div>
      <div className={styles.previewLocation}>
        <span>주요 행정동 <b>{row.mainArea||'미확인'}</b></span>
        <span>BYE Cell <b>{row.mainCell||'미확인'}</b></span>
      </div>
      <div className={styles.previewActions}>
        <button type="button" className={styles.aiAnalysisButton} disabled={busy} aria-busy={busy} onClick={()=>{setTab('analysis');analysisRef.current?.startCustomer();}}>{busy?<LoaderCircle size={14} className={styles.aiSpin}/>:<Sparkles size={14}/>} {busy?'분석 중':'AI 분석'}</button>
        <Link className={styles.detailLink} href={row.href}>고객·통화 상세 <ChevronRight size={14}/></Link>
      </div>
    </div>
    <div className={styles.previewTabs} role="tablist" aria-label="선택 고객 상세 보기">
      <button type="button" role="tab" id={tabId+'-overview-tab'} aria-controls={tabId+'-overview'} aria-selected={tab==='overview'} onClick={()=>setTab('overview')}>고객 현황</button>
      <button type="button" role="tab" id={tabId+'-analysis-tab'} aria-controls={tabId+'-analysis'} aria-selected={tab==='analysis'} onClick={()=>setTab('analysis')}><Sparkles size={13}/> AI 분석 {busy&&<span className={styles.aiStatusDot}/>}</button>
    </div>
    <div id={tabId+'-overview'} role="tabpanel" aria-labelledby={tabId+'-overview-tab'} hidden={tab!=='overview'} className={styles.previewOverview}>
    <div className={styles.previewGrid}>
      <div className={styles.previewCard}>
        <div className={styles.previewCardHeading}><strong>일별 저품질 통화 수</strong><span>총 <b>{number(row.poor)}</b>건</span></div>
        <figure className={styles.previewBarRow} aria-label={days.map(day=>`${day.date} ${day.count}건`).join(', ')}>
          {days.map(({date,count})=><div key={date} className={styles.previewDay}>
            <div className={styles.previewBarTrack}>
              <div className={styles.previewBar} style={{height:count/max*100+'%'}}><b>{count}</b></div>
            </div>
            <span>{date.slice(5)}</span>
          </div>)}
        </figure>
      </div>
      <div className={styles.previewCard}>
        <div className={styles.previewCardHeading}><strong>대표 QoE · SIP 근거</strong></div>
        <dl className={styles.previewMetrics}>
          <div><dt>평균 QoE</dt><dd className={styles.red}>{row.mean===null?'미평가':row.mean.toFixed(2)}</dd></div>
          <div><dt>QoE 평가 통화</dt><dd>{number(row.eligible)}<small>건</small></dd></div>
          <div><dt>Drop 통화</dt><dd>{number(row.drop)}<small>건</small></dd></div>
          <div><dt>저품질 발생 일수</dt><dd>{row.repeatedDays}<small>일</small></dd></div>
        </dl>
        <p className={styles.previewFootnote}>RSRP · RSRQ · SINR은 개별 통화 상세에서 확인할 수 있습니다.</p>
      </div>
    </div>
    </div>
    <div id={tabId+'-analysis'} role="tabpanel" aria-labelledby={tabId+'-analysis-tab'} hidden={tab!=='analysis'} className={styles.previewAnalysis}>
      <CustomerAiAnalysis customerId={row.id} customerNumber={row.number} scope={scope} sourceRevision={sourceRevision} analysisRef={analysisRef} onBusyChange={setBusy}/>
    </div>
  </div>;
}
