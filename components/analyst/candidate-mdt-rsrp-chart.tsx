'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import styles from './candidate-mdt-rsrp-chart.module.css';
import {gpsBand,gpsBandLabel} from './gps-marker-style';

/** Original serving-cell MDT sample bins. earfcnBins keys are raw dlearfcn, not LTE band labels. */
export interface CandidateMdtRsrpCall {
 totalRows:number;
 validRows:number;
 excludedRows:number;
 bins:Record<string,number>;
 earfcnBins:Record<string,Record<string,number>>;
}
export interface CandidateMdtRsrpSidecar {
 schemaVersion:'qoe-candidate-mdt-rsrp-v1';
 sourceRevision:string;
 binWidthDb:5;
 records:Record<string,CandidateMdtRsrpCall>;
}
export interface CandidateMdtRsrpSeries {
 earfcn:string;
 total:number;
 points:Array<{dbm:number;count:number}>;
}
export interface CandidateMdtRsrpDistribution {
 memberCalls:number;
 matchedCalls:number;
 totalRows:number;
 validRows:number;
 excludedRows:number;
 points:Array<{dbm:number;count:number}>;
 series:CandidateMdtRsrpSeries[];
}
let request:Promise<CandidateMdtRsrpSidecar>|null=null;
function loadHistogram():Promise<CandidateMdtRsrpSidecar>{
 if(!request){
  request=fetch('/qoe/quality-improvement/candidate-mdt-rsrp-v1.json',{cache:'no-cache'})
   .then(response=>{if(!response.ok)throw new Error('원본 MDT 분포 파일을 찾을 수 없습니다.');return response.json() as Promise<CandidateMdtRsrpSidecar>;})
   .then(data=>{
    if(data.schemaVersion!=='qoe-candidate-mdt-rsrp-v1'||data.binWidthDb!==5||!data.records)throw new Error('MDT RSRP 분포 자료 형식 오류');
    return data;
   }).catch(error=>{request=null;throw error;});
 }
 return request;
}
export function aggregateCandidateMdtRsrp(sidecar:CandidateMdtRsrpSidecar,callIds:readonly string[]):CandidateMdtRsrpDistribution{
 const ids=new Set(callIds),bins=new Map<number,number>(),freqBins=new Map<string,Map<number,number>>();
 let totalRows=0,validRows=0,excludedRows=0,matchedCalls=0;
 for(const id of ids){
  const call=sidecar.records[id];if(!call)continue;
  matchedCalls++;
  totalRows+=call.totalRows;validRows+=call.validRows;excludedRows+=call.excludedRows;
  if(!call.earfcnBins)throw new Error('dlearfcn 원본 구분 자료가 누락됐습니다: '+id);
  let callGroupTotal=0;
  for(const [earfcn,groups] of Object.entries(call.earfcnBins)){
   const series=freqBins.get(earfcn)??new Map<number,number>();
   freqBins.set(earfcn,series);
   for(const [rawBin,count] of Object.entries(groups)){
    const dbm=Number(rawBin);
    if(!Number.isFinite(dbm)||dbm%5!==0||!Number.isSafeInteger(count)||count<0)throw new Error('dlearfcn 원본 분포 값 오류: '+id);
    series.set(dbm,(series.get(dbm)??0)+count);
    bins.set(dbm,(bins.get(dbm)??0)+count);
    callGroupTotal+=count;
   }
  }
  if(callGroupTotal!==call.validRows)throw new Error('dlearfcn별 합계가 MDT 유효 측정 건수와 다릅니다: '+id);
 }
 const keys=[...bins.keys()].sort((a,b)=>a-b);
 const points=keys.length?Array.from({length:Math.round((keys[keys.length-1]-keys[0])/5)+1},(_,i)=>({
  dbm:keys[0]+i*5,count:bins.get(keys[0]+i*5)??0
 })):[];
 const series=[...freqBins.entries()].map(([earfcn,values])=>({
  earfcn,total:[...values.values()].reduce((a,b)=>a+b,0),
  points:points.map(point=>({dbm:point.dbm,count:values.get(point.dbm)??0}))
 })).sort((a,b)=>b.total-a.total||a.earfcn.localeCompare(b.earfcn,'ko',{numeric:true}));
 if(series.reduce((sum,s)=>sum+s.total,0)!==validRows)throw new Error('전체 EARFCN 선의 합계와 MDT RSRP 유효 건수가 일치하지 않습니다.');
 return {memberCalls:ids.size,matchedCalls,totalRows,validRows,excludedRows,points,series};
}
const palette=['#2563eb','#ed8124','#16a66c','#9a67d9','#8b99ae','#c55875','#00a5b5','#915f45'];
function seriesColor(earfcn:string,rank:number):string{
 const known:Record<string,string>={'3743':'#2563eb','1550':'#ed8124','1694':'#16a66c','475':'#9561d5','unknown':'#8493a7'};
 return known[earfcn]??palette[rank%palette.length];
}
/** Keep original EARFCN data keys, but show the verified local LTE frequency names. */
function frequencyLabel(earfcn:string):string{
 if(earfcn==='unknown')return '미확보';
 const band=gpsBand(Number(earfcn));
 return band==='other'?`기타 (${earfcn})`:gpsBandLabel(band);
}
const format=(n:number)=>n.toLocaleString('ko-KR');
export function CandidateMdtRsrpChart({callIds,sourceRevision,compact=false}:{callIds:readonly string[];sourceRevision:string;compact?:boolean}){
 const [state,setState]=useState<{revision:string;sidecar:CandidateMdtRsrpSidecar|null;error:string|null}>({revision:'',sidecar:null,error:null});
 const plotContainer=useRef<HTMLDivElement|null>(null);
 const [plotSize,setPlotSize]=useState({width:0,height:0});
 useEffect(()=>{
  let alive=true;
  void loadHistogram().then(data=>{
   if(alive)setState(data.sourceRevision===sourceRevision?{revision:sourceRevision,sidecar:data,error:null}:
    {revision:sourceRevision,sidecar:null,error:'MDT 원본 데이터 버전이 선택한 분석과 다릅니다.'});
  }).catch(error=>{if(alive)setState({revision:sourceRevision,sidecar:null,error:error instanceof Error?error.message:'MDT RSRP 자료를 불러오지 못했습니다.'});});
  return()=>{alive=false;};
 },[sourceRevision]);
 const {distribution,error}=useMemo(()=>{
  if(state.error)return {distribution:null,error:state.error};
  if(state.revision!==sourceRevision||!state.sidecar)return {distribution:null,error:null};
  try{return {distribution:aggregateCandidateMdtRsrp(state.sidecar,callIds),error:null};}
  catch(e){return {distribution:null,error:e instanceof Error?e.message:'EARFCN 분포를 집계할 수 없습니다.'};}
 },[state,sourceRevision,callIds]);
 const points=distribution?.points??[];
 const series=distribution?.series??[];
 useEffect(()=>{
  if(!compact||!plotContainer.current)return;
  const element=plotContainer.current;
  const measure=()=>{
   const rect=element.getBoundingClientRect();
   const width=Math.round(rect.width),height=Math.round(rect.height);
   if(width>0&&height>0)setPlotSize(previous=>previous.width===width&&previous.height===height?previous:{width,height});
  };
  measure();
  const observer=new ResizeObserver(measure);
  observer.observe(element);
  return()=>observer.disconnect();
 },[compact,points.length]);
 const width=compact?Math.max(265,plotSize.width||395):Math.max(475,75+points.length*29);
 const svgHeight=compact?Math.max(105,plotSize.height||160):204;
 const top=compact?13:16,bottom=compact?svgHeight-33:157,left=compact?39:46,right=width-(compact?77:98);
 const plotHeight=bottom-top,plotWidth=Math.max(1,right-left);
 const maxCount=Math.max(1,...series.flatMap(s=>s.points.map(point=>point.count)));
 const power=10**Math.floor(Math.log10(maxCount/5||1));
 const step=[1,2,5,10].map(n=>n*power).find(n=>n*5>=maxCount)??Math.ceil(maxCount/5);
 const ymax=Math.max(step,Math.ceil(maxCount/step)*step);
 const x=(index:number)=>left+index*plotWidth/Math.max(1,points.length-1);
 const y=(count:number)=>bottom-count/ymax*plotHeight;
 const axisTickEvery=points.length>18?3:points.length>12?2:1;
 const showLegend=series.length>0;
 return <section className={styles.card} data-compact={compact?'true':'false'} aria-label="선택 후보 MDT RSRP 분포">
  <div className={styles.head}>
   <div><h4>EARFCN별 MDT RSRP 추이</h4><p>선택 후보 전체 MDT · dlearfcn 기준 · 5dB 구간</p></div>
   {distribution&&<strong>{format(distribution.validRows)}행</strong>}
  </div>
  {error?<p className={styles.state} role="alert">{error}</p>:
   !distribution?<p className={styles.state}>원본 MDT EARFCN 분포를 불러오는 중입니다…</p>:
   distribution.matchedCalls!==distribution.memberCalls?<p className={styles.state} role="alert">원본 연결 누락: 후보 {distribution.memberCalls}통화 중 {distribution.matchedCalls}통화만 확인됐습니다. 표시를 중단했습니다.</p>:
   points.length===0?<p className={styles.state}>선택한 후보 통화에 유효한 MDT RSRP 측정이 없습니다.</p>:
   <div ref={plotContainer} className={styles.plotScroll}>
    <svg className={styles.plot} viewBox={'0 0 '+width+' '+svgHeight} width={width} height={svgHeight} role="img" aria-label={'dlearfcn EARFCN별 MDT RSRP 5dB 구간 라인 차트. 전체 '+format(distribution.validRows)+'행'}>
     <title>선택 후보 EARFCN별 MDT RSRP 분포, 총 {format(distribution.validRows)}행</title>
     {Array.from({length:6},(_,i)=>{
      const count=i*ymax/5,at=y(count);
      return <g key={i}>
       <line x1={left} y1={at} x2={right} y2={at} stroke="#e2eaf2" strokeWidth="1"/>
       <text x={left-6} y={at+3} textAnchor="end" fontSize="10" fill="#58748a">{format(Math.round(count))}</text>
      </g>;
     })}
     {points.map((point,index)=>index%axisTickEvery===0||index===points.length-1?
      <text key={point.dbm} x={x(index)} y={bottom+15} textAnchor="middle" fontSize="9" fill="#416078">{point.dbm}</text>:null)}
     {series.map((item,rank)=>{
      const color=seriesColor(item.earfcn,rank);
      return <g key={item.earfcn} data-earfcn-series={item.earfcn}>
       <polyline fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        points={item.points.map((p,index)=>x(index)+','+y(p.count)).join(' ')}/>
       {item.points.map((p,index)=><circle key={p.dbm} cx={x(index)} cy={y(p.count)} r={compact?2.4:3} fill="#fff" stroke={color} strokeWidth="1.8"
        data-earfcn={item.earfcn} data-rsrp-bin={p.dbm} data-count={p.count}>
        <title>{frequencyLabel(item.earfcn)} (EARFCN {item.earfcn}) · {p.dbm}~{p.dbm+5} dBm: {format(p.count)}행</title>
       </circle>)}
      </g>;
     })}
     {showLegend&&series.map((item,rank)=>{
      const legendY=top+9+rank*(compact?17:20),color=seriesColor(item.earfcn,rank);
      return <g key={item.earfcn} aria-label={'주파수 '+frequencyLabel(item.earfcn)+' · EARFCN '+item.earfcn} data-earfcn-legend={item.earfcn}>
       <line x1={right+7} y1={legendY} x2={right+24} y2={legendY} stroke={color} strokeWidth="2"/>
       <circle cx={right+15.5} cy={legendY} r="2.8" stroke={color} strokeWidth="1.5" fill="#fff"/>
       <text x={right+29} y={legendY+3} fontSize={compact?10:11} fill="#36536b" fontWeight="700">{frequencyLabel(item.earfcn)}</text>
      </g>;
     })}
     <text x={(left+right)/2} y={compact?svgHeight-8:195} textAnchor="middle" fontSize="10" fontWeight="700" fill="#334e60">RSRP (dBm)</text>
     <text transform={'translate(13 '+(top+plotHeight/2)+') rotate(-90)'} textAnchor="middle" fontSize="10" fontWeight="700" fill="#334e60">Count</text>
    </svg>
   </div>}
  {distribution&&distribution.matchedCalls===distribution.memberCalls&&<p className={styles.note}>대상 통화 {format(distribution.memberCalls)}건 · 유효 MDT {format(distribution.validRows)}행 · 제외 {format(distribution.excludedRows)}행</p>}
 </section>;
}
