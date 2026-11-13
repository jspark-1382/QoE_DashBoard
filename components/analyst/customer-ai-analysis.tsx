'use client';

import {useCallback,useEffect,useId,useImperativeHandle,useRef,useState,type Ref} from 'react';
import {ArrowLeft,Check,ExternalLink,FileSearch,LoaderCircle,Maximize2,PlugZap,RefreshCw,Sparkles,Square,TriangleAlert,X} from 'lucide-react';
import {analysisRequest,createAnalysisSession,isAnalysisActive,type AnalysisConfigStatus,type AnalysisJob,type AnalysisScope,type AnalysisTarget} from '../../lib/analyst/customer-ai-analysis';
import Link from './document-link';
import styles from './customer-ai-analysis.module.css';

const count=(value:number)=>value.toLocaleString('ko-KR');
const metric=(value:number|null,digits=2)=>value===null?'미평가':value.toFixed(digits);
const percent=(value:number|null)=>value===null?'미평가':(value*100).toFixed(1)+'%';
const statuses={queued:'분석 대기',collecting:'통화 근거 집계 중',analyzing:'Qwen 분석 중',completed:'분석 완료',failed:'분석 실패',cancelled:'분석 취소'};
const assessments={supported:'근거 있음',possible:'가능성 검토',insufficient:'판단 보류'};
const locationNames:Record<string,string>={gnss:'GPS 근거','bye-cell':'BYE 기지국',estimated:'추정 위치',none:'위치 없음','':'위치 없음'};

export type CustomerAiAnalysisHandle={startCustomer:()=>void};
export function CustomerAiAnalysis({customerId,customerNumber,scope,sourceRevision,analysisRef,onBusyChange}:{
 customerId:string;customerNumber:string;scope:AnalysisScope;sourceRevision:string;analysisRef:Ref<CustomerAiAnalysisHandle>;onBusyChange:(busy:boolean)=>void;
}){
 const [config,setConfig]=useState<AnalysisConfigStatus|null>(null);
 const [configError,setConfigError]=useState('');
 const [job,setJob]=useState<AnalysisJob|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [connection,setConnection]=useState('');
 const [checking,setChecking]=useState(false);
 const [section,setSection]=useState<'summary'|'calls'>('summary');
 const [requested,setRequested]=useState<AnalysisTarget>({kind:'customer',customerId,scope,sourceRevision});
 const [callLabel,setCallLabel]=useState('');
 const [focusedFact,setFocusedFact]=useState('');
 const [expanded,setExpanded]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null);
 const facts=useRef(new Map<string,HTMLElement>());
 const session=useRef<ReturnType<typeof createAnalysisSession>|null>(null);
 const alive=useRef(true);
 const prefix=useId();
 const readConfig=useCallback(async()=>{
  try{
   const value=await analysisRequest<AnalysisConfigStatus>('/config');
   if(alive.current){setConfig(value);setConfigError('');}
  }catch(err){if(alive.current)setConfigError(err instanceof Error?err.message:'설정을 읽지 못했습니다.');}
 },[]);
 useEffect(()=>{
  alive.current=true;
  const current=createAnalysisSession({
   onJob:value=>{setJob(value);setError('');},
   onError:err=>setError(err.message),
   onPending:value=>{setBusy(value);onBusyChange(value);}
  });
  session.current=current;
  const controller=new AbortController();
  void analysisRequest<AnalysisConfigStatus>('/config',{signal:controller.signal}).then(value=>{
   if(!controller.signal.aborted){setConfig(value);setConfigError('');}
  }).catch(err=>{if(!controller.signal.aborted)setConfigError(err instanceof Error?err.message:'설정을 읽지 못했습니다.');});
  return()=>{alive.current=false;controller.abort();current.dispose();session.current=null;};
 },[onBusyChange]);
 const start=useCallback((target:AnalysisTarget,label='')=>{
  setRequested(target);setCallLabel(label);setJob(null);setError('');setFocusedFact('');setSection('summary');
  void readConfig();void session.current?.start(target);
 },[readConfig]);
 // The parent keys this component by customer + scope + revision. Run only from a user action.
 useImperativeHandle(analysisRef,()=>({startCustomer:()=>start({kind:'customer',customerId,scope,sourceRevision})}),[customerId,scope,sourceRevision,start]);
 async function checkConnection(){
  setChecking(true);setConnection('');
  try{
   await readConfig();
   const value=await analysisRequest<{ok:boolean;model:string;message:string}>('/connection',{method:'POST'});
   if(alive.current)setConnection(value.message);
  }catch(err){if(alive.current)setConnection(err instanceof Error?err.message:'연결을 확인하지 못했습니다.');}
  finally{if(alive.current)setChecking(false);}
 }
 function showFact(id:string){
  setSection('summary');setFocusedFact(id);
  requestAnimationFrame(()=>{const node=facts.current.get(id);node?.scrollIntoView({block:'nearest',behavior:'smooth'});node?.focus({preventScroll:true});});
 }
 function evidenceLinks(ids:string[]){
  return <div className={styles.references}>{ids.map(id=><button key={id} type="button" onClick={()=>showFact(id)} aria-label={id+' 집계 근거 보기'}>{id}</button>)}</div>;
 }
 const evidence=job?.evidence;
 const report=job?.report;
 const pinned=job?.target??requested;
 const allLimitations=[...new Set([...(evidence?.limitations??[]),...(report?.limitations??[])])];
 const canCancel=busy||(job&&isAnalysisActive(job.status));
 const body=<div className={styles.analysis} data-analysis-target={pinned.customerId} data-analysis-kind={pinned.kind}>
  <div className={styles.heading}>
   <div><strong><Sparkles size={15}/> {pinned.kind==='call'?'선택 통화 AI 분석':'고객 AI 분석'}</strong><p>고객 {customerNumber}{pinned.kind==='call'&&callLabel?' · '+callLabel:''}</p></div>
   <div className={styles.headerActions}>
    {(job?.model||config?.model)&&<span className={styles.model} title={job?.model||config?.model}>{job?.model||config?.model}</span>}
    {expanded?<button type="button" className={styles.iconButton} aria-label="확대 화면 닫기" onClick={()=>dialog.current?.close()}><X size={17}/></button>:<button type="button" className={styles.iconButton} aria-label="분석 화면 확대" title="분석 화면 확대" onClick={()=>{setExpanded(true);dialog.current?.showModal();}}><Maximize2 size={16}/></button>}
   </div>
  </div>
  <div className={styles.scope}>{pinned.scope.dateStart} ~ {pinned.scope.dateEnd}<span>매일 {pinned.scope.from} ~ {pinned.scope.to}</span><b>{pinned.kind==='call'?'선택 통화 1건':'선택 고객의 전체 통화'}</b></div>
  {(configError||config?.error)&&<div className={styles.error} role="alert"><TriangleAlert size={16}/><span>{configError||config?.error?.message}</span><button type="button" onClick={()=>void readConfig()}>다시 확인</button></div>}
  {config&&!config.configured&&<div className={styles.setup}>
   <strong>Qwen 연결 설정이 필요합니다</strong>
   <p>프로젝트의 <code>.env</code>에 <code>QWEN_BASE_URL</code>과 <code>QWEN_MODEL</code>을 입력해 주세요. 인증을 사용하는 서버는 <code>QWEN_API_KEY</code>도 설정합니다.</p>
   <p className={styles.muted}>설정은 이 PC의 분석 서버에서 읽습니다. 저장한 뒤 설정을 다시 확인하면 됩니다.</p>
   <button type="button" className={styles.secondary} onClick={()=>void readConfig()}><RefreshCw size={14}/> 설정 다시 확인</button>
  </div>}
  <div className={styles.toolbar}>
   <output className={styles.status} aria-live="polite">{busy?<LoaderCircle size={15} className={styles.spin}/>:job?.status==='completed'?<Check size={15}/>:<FileSearch size={15}/>} {job?statuses[job.status]:busy?'분석 요청 중':'분석 준비'}</output>
   <div className={styles.toolbarButtons}>
    <button type="button" className={styles.textButton} disabled={checking} onClick={()=>void checkConnection()}>{checking?<LoaderCircle size={13} className={styles.spin}/>:<PlugZap size={13}/>} 연결 확인</button>
    {canCancel?<button type="button" className={styles.secondary} onClick={()=>void session.current?.cancel()}><Square size={12}/> 취소</button>:job||error?<button type="button" className={styles.secondary} onClick={()=>start(requested,callLabel)}><RefreshCw size={13}/> 다시 분석</button>:null}
   </div>
  </div>
  {connection&&<output className={styles.connection}>{connection}</output>}
  {error&&<div className={styles.error} role="alert"><TriangleAlert size={17}/><span>{error}</span></div>}
  {job?.error&&<div className={styles.error} role="alert"><TriangleAlert size={17}/><span>{job.error.message}</span></div>}
  {busy&&<div className={styles.progress} aria-label="분석 단계"><span className={job?.status==='collecting'?styles.current:''}>1. 전체 통화 집계</span><span className={job?.status==='analyzing'?styles.current:''}>2. Qwen 근거 해석</span><span>3. 결과 검증</span></div>}
  {!job&&!busy&&!error&&config?.configured&&<div className={styles.empty}><Sparkles size={28}/><strong>선택 고객의 통화 근거를 함께 검토합니다</strong><p>전체 통화 통계, 저품질 반복, 무선·RTP 근거를 모아 원인 가설과 다음 점검 항목을 정리합니다.</p><button type="button" className={styles.primary} onClick={()=>start({kind:'customer',customerId,scope,sourceRevision})}><Sparkles size={15}/> 이 고객 분석 시작</button></div>}
  {evidence&&<>
   <div className={styles.metrics}>
    <div><span>분석 통화</span><strong>{count(evidence.summary.totalCalls)}<small>건</small></strong></div>
    <div><span>저품질 / 평가 통화</span><strong>{count(evidence.summary.poorCalls)}<small> / {count(evidence.summary.evaluatedCalls)}</small></strong><em>{percent(evidence.summary.poorRate)}</em></div>
    <div><span>Drop 통화</span><strong>{count(evidence.summary.dropCalls)}<small>건</small></strong></div>
    <div><span>저품질 발생</span><strong>{evidence.summary.poorDays}<small> / {evidence.summary.observedDays}일</small></strong></div>
   </div>
   <p className={styles.metricNote}>원본 MOS 평균 {metric(evidence.summary.meanMos)} · 보정 QoE 평균 {metric(evidence.summary.meanQoe)}<br/>저품질: 보정 QoE &lt; 3.0 · 저품질 비율의 분모: QoE 평가 통화 · Drop은 MOS 미평가 통화도 포함</p>
   <div className={styles.sectionTabs} role="tablist" aria-label="AI 분석 결과">
    <button id={prefix+'-summary-tab'} aria-controls={prefix+'-summary'} aria-selected={section==='summary'} role="tab" type="button" onClick={()=>setSection('summary')}>분석 요약·근거</button>
    <button id={prefix+'-calls-tab'} aria-controls={prefix+'-calls'} aria-selected={section==='calls'} role="tab" type="button" onClick={()=>setSection('calls')}>근거 통화 <b>{evidence.calls.length}</b></button>
   </div>
   {section==='summary'?<div id={prefix+'-summary'} role="tabpanel" aria-labelledby={prefix+'-summary-tab'} className={styles.result}>
    {report&&<>
     <section className={styles.conclusion}><span>AI 분석 요약 · 검토 의견</span><p>{report.summary}</p></section>
     <section><h4>원인 가설</h4><div className={styles.hypotheses}>{report.hypotheses.map((item,index)=><article key={index}><div className={styles.itemHeading}><strong>{item.title}</strong><span className={item.assessment==='supported'?styles.supported:styles.possible}>{assessments[item.assessment]}</span></div><p>{item.reason}</p>{evidenceLinks(item.evidenceIds)}</article>)}</div></section>
     <section><h4>다음 점검 항목</h4><ol className={styles.checks}>{report.checks.map((item,index)=><li key={index}><strong>{item.action}</strong><p>{item.reason}</p>{evidenceLinks(item.evidenceIds)}</li>)}</ol></section>
    </>}
    {!report&&!busy&&<p className={styles.muted}>아래는 로컬 데이터에서 집계한 근거입니다. AI 해석은 아직 완료되지 않았습니다.</p>}
    <section><h4>확인된 집계 근거 <small>로컬 계산</small></h4><div className={styles.facts}>{evidence.facts.map(fact=><article key={fact.id} ref={node=>{if(node)facts.current.set(fact.id,node);else facts.current.delete(fact.id);}} tabIndex={-1} className={focusedFact===fact.id?styles.focusedFact:''}><div><b>{fact.id}</b><strong>{fact.title}</strong>{fact.severity!=='info'&&<TriangleAlert size={14}/>}</div><p>{fact.detail}</p></article>)}</div></section>
    <details className={styles.detail}><summary>일별·셀별 전체 통화 집계</summary>
     <div className={styles.tableScroll}><table><caption>일별 집계</caption><thead><tr><th>날짜</th><th>전체</th><th>QoE 평가</th><th>저품질</th><th>Drop</th></tr></thead><tbody>{evidence.byDay.map(day=><tr key={day.date}><td>{day.date}</td><td>{count(day.totalCalls)}</td><td>{count(day.evaluatedCalls)}</td><td>{count(day.poorCalls)}</td><td>{count(day.dropCalls)}</td></tr>)}</tbody></table></div>
     <p className={styles.metricNote}>AI 해석의 대표 Cell 번호를 실제 Cell ID와 함께 표시합니다.</p><div className={styles.tableScroll}><table><caption>셀별 집계</caption><thead><tr><th>Cell</th><th>전체</th><th>저품질 / 평가</th><th>저품질률</th><th>Drop</th></tr></thead><tbody>{evidence.byCell.map((cell,index)=><tr key={cell.cell}><td>{cell.cell&&cell.cell!=='미확인'&&cell.cell!=='기타 Cell 합계'&&<small className={styles.cellAlias}>대표 Cell {String(index+1).padStart(2,'0')}</small>}{cell.cell||'미확인'}</td><td>{count(cell.totalCalls)}</td><td>{count(cell.poorCalls)} / {count(cell.evaluatedCalls)}</td><td>{percent(cell.poorRate)}</td><td>{count(cell.dropCalls)}</td></tr>)}</tbody></table></div>
    </details>
   </div>:<div id={prefix+'-calls'} role="tabpanel" aria-labelledby={prefix+'-calls-tab'} className={styles.result}>
    <p className={styles.muted}>{evidence.coverage.detailsPolicy}</p>
    <div className={styles.tableScroll}><table className={styles.callTable}><caption>대표 근거 통화 · 전체 통계와 상세 표본은 구분합니다</caption><thead><tr><th>날짜·시각</th><th>MOS / QoE</th><th>RSRP / SINR</th><th>셀·위치 근거</th><th>확인</th></tr></thead><tbody>{evidence.calls.map(call=><tr key={call.id}><td>{call.date}<br/><b>{call.start}</b>{call.isDrop&&<span className={styles.drop}>Drop</span>}</td><td>{metric(call.mos)} / <b>{metric(call.qoe)}</b></td><td>{metric(call.rsrp,1)} dBm<br/>{metric(call.sinr,1)} dB</td><td>{call.cell||'셀 미확인'}<small>{locationNames[call.locationEvidence]??call.locationEvidence}</small></td><td><Link href={call.href} target="_blank" rel="noopener noreferrer" className={styles.callLink}>상세 <ExternalLink size={12}/></Link><button type="button" disabled={busy} className={styles.callAnalyze} onClick={()=>start({kind:'call',customerId,callId:call.id,scope,sourceRevision},call.date+' '+call.start)}>통화 분석</button></td></tr>)}</tbody></table></div>
    <p className={styles.metricNote}>무선 근거 {evidence.coverage.radioCalls}건 · RTP 근거 {evidence.coverage.rtpCalls}건 / 상세 표본 {evidence.coverage.sampledCalls}건. 상세는 새 탭으로 열립니다.</p>
   </div>}
   {allLimitations.length>0&&<details className={styles.detail} open><summary>판단 한계·추가 확인</summary><ul>{allLimitations.map((text,index)=><li key={index}>{text}</li>)}</ul></details>}
   <div className={styles.footer}>자료 버전 {evidence.sourceRevision} · 집계 {new Date(evidence.generatedAt).toLocaleString('ko-KR')}</div>
  </>}
  {pinned.kind==='call'&&<button type="button" disabled={busy} className={styles.secondary} onClick={()=>start({kind:'customer',customerId,scope,sourceRevision})}><ArrowLeft size={14}/> 고객 전체 통화로 다시 분석</button>}
 </div>;
 return <>
  <div className={styles.viewport}>{expanded?<p className={styles.muted}>확대 화면에서 분석 결과를 확인하고 있습니다.</p>:body}</div>
  <dialog className={styles.dialog} ref={dialog} onClose={()=>setExpanded(false)} aria-label="선택 고객 AI 분석 확대">{expanded&&body}</dialog>
 </>;
}
