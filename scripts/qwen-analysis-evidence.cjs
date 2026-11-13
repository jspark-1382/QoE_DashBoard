/* eslint-disable @typescript-eslint/no-require-imports -- Local Node analysis worker. */
const {DatabaseSync}=require('node:sqlite');
const {createExportDetailReader}=require('./voice-query-export-details.cjs');
const SAMPLE_LIMIT=32;
const CELL_LIMIT=12;
const RTP_FIELDS=['txPacketLoss','rxPacketLoss','txJitter','rxJitter','txLossCount','rxLossCount'];
const numeric=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const rounded=value=>numeric(value)===null?null:Math.round(value*1e6)/1e6;
const percent=value=>value==null?'미평가':(value*100).toFixed(1)+'%';
const percentValue=value=>value==null?null:Number((value*100).toFixed(1));
function failure(message,status=400,code='INVALID_ANALYSIS_TARGET'){
 const error=new Error(message);error.status=status;error.code=code;return error;
}
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function validDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const time=Date.parse(value+'T00:00:00Z');
 return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;
}
function seconds(value){
 if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))return null;
 const [hours,minutes]=value.split(':').map(Number);return hours*3600+minutes*60;
}
// oxlint-disable-next-line no-control-regex -- Reject control characters in query identifiers.
function identity(value,max){return typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value);}
function validateTarget(input){
 if(!object(input)||!['customer','call'].includes(input.kind)||!identity(input.customerId,200))throw failure('분석할 고객을 선택해 주세요.');
 if(typeof input.sourceRevision!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(input.sourceRevision))throw failure('분석 자료 버전이 올바르지 않습니다.');
 const scope=input.scope;
 if(!object(scope)||!validDate(scope.dateStart)||!validDate(scope.dateEnd)||scope.dateStart>scope.dateEnd)throw failure('분석 날짜 범위가 올바르지 않습니다.');
 const from=seconds(scope.from),to=seconds(scope.to);
 if(from===null||to===null||from>to)throw failure('분석 시간 범위가 올바르지 않습니다.');
 if((Date.parse(scope.dateEnd)-Date.parse(scope.dateStart))/86400000>365)throw failure('한 번의 분석 기간은 최대 366일입니다.');
 if(input.kind==='call'&&!identity(input.callId,400))throw failure('분석할 통화를 선택해 주세요.');
 if(input.kind==='customer'&&input.callId!=null)throw failure('고객 분석에 개별 통화 ID를 지정할 수 없습니다.');
 return {kind:input.kind,customerId:input.customerId,...(input.kind==='call'?{callId:input.callId}:{}),scope:{dateStart:scope.dateStart,dateEnd:scope.dateEnd,from:scope.from,to:scope.to},sourceRevision:input.sourceRevision};
}
function timeText(value){
 if(numeric(value)===null)return '';
 const whole=Math.floor(value);return [Math.floor(whole/3600)%24,Math.floor(whole/60)%60,whole%60].map(n=>String(n).padStart(2,'0')).join(':');
}
const COUNT_SQL=`COUNT(*) AS totalCalls,
 SUM(CASE WHEN c.qoe IS NOT NULL THEN 1 ELSE 0 END) AS evaluatedCalls,
 SUM(CASE WHEN c.qoe<3 THEN 1 ELSE 0 END) AS poorCalls,
 SUM(CASE WHEN c.is_drop=1 THEN 1 ELSE 0 END) AS dropCalls`;
function countRow(row){
 return {totalCalls:Number(row.totalCalls??0),evaluatedCalls:Number(row.evaluatedCalls??0),poorCalls:Number(row.poorCalls??0),dropCalls:Number(row.dropCalls??0)};
}
function mean(values){const valid=values.filter(v=>numeric(v)!==null);return valid.length?rounded(valid.reduce((s,v)=>s+v,0)/valid.length):null;}
/**
 * Full-population facts are computed from the immutable call table, not UI rows.
 * Detailed radio/RTP observations are a bounded, deliberately selected sample.
 * This synchronous function runs in a dedicated worker, with read-only SQLite.
 */
function collectEvidence({dbPath,publicDir,target:input,sourceRevision}){
 const target=validateTarget(input);
 if(sourceRevision!==target.sourceRevision)throw failure('자료 버전이 변경되었습니다. 새로 고침 후 다시 분석해 주세요.',409,'STALE_REVISION');
 const db=new DatabaseSync(dbPath,{readOnly:true});
 try{
  db.exec('PRAGMA query_only=ON; PRAGMA cache_size=-8192;');
  let meta;try{meta=JSON.parse(db.prepare("SELECT json FROM meta WHERE key='dataset'").get()?.json??'null');}catch{throw failure('음성 분석 자료의 메타정보를 읽을 수 없습니다.',503,'EVIDENCE_UNAVAILABLE');}
  if(meta?.revision!==sourceRevision)throw failure('자료 버전이 변경되었습니다. 새로 고침 후 다시 분석해 주세요.',409,'STALE_REVISION');
  if(meta.qoeBasis!=='rtcp-mos-v5')throw failure('현재 음성 품질 기준의 자료가 필요합니다.',503,'EVIDENCE_UNAVAILABLE');
  const where=['c.customer_id=?','c.date>=?','c.date<=?','c.start_second>=?','c.start_second<?'];
  const args=[target.customerId,target.scope.dateStart,target.scope.dateEnd,seconds(target.scope.from),seconds(target.scope.to)+60];
  if(target.kind==='call'){where.push('c.id=?');args.push(target.callId);}
  const clause=where.join(' AND ');
  const raw=db.prepare(`SELECT ${COUNT_SQL},
   SUM(CASE WHEN c.mos>=1 AND c.mos<=5 THEN 1 ELSE 0 END) AS rawMosEvaluatedCalls,
   SUM(CASE WHEN c.mos>=1 AND c.mos<3 THEN 1 ELSE 0 END) AS rawMosPoorCalls,
   AVG(CASE WHEN c.mos>=1 AND c.mos<=5 THEN c.mos END) AS meanMos,AVG(c.qoe) AS meanQoe,
   COUNT(DISTINCT c.date) AS observedDays,COUNT(DISTINCT CASE WHEN c.qoe<3 THEN c.date END) AS poorDays
   FROM calls c WHERE ${clause}`).get(...args);
  if(!raw.totalCalls)throw failure('선택한 고객·통화의 해당 기간 자료가 없습니다.',404,'NO_CALLS');
  const counts=countRow(raw);
  const summary={...counts,poorRate:counts.evaluatedCalls?counts.poorCalls/counts.evaluatedCalls:null,
   rawMosEvaluatedCalls:Number(raw.rawMosEvaluatedCalls??0),rawMosPoorCalls:Number(raw.rawMosPoorCalls??0),
   meanMos:rounded(raw.meanMos),meanQoe:rounded(raw.meanQoe),observedDays:Number(raw.observedDays),poorDays:Number(raw.poorDays)};
  const byDay=db.prepare(`SELECT c.date,${COUNT_SQL} FROM calls c WHERE ${clause} GROUP BY c.date ORDER BY c.date`).all(...args).map(row=>({date:row.date,...countRow(row)}));
  const cellRows=db.prepare(`SELECT COALESCE(NULLIF(c.cell,''),'미확인') AS cell,${COUNT_SQL}
   FROM calls c WHERE ${clause} GROUP BY COALESCE(NULLIF(c.cell,''),'미확인')
   ORDER BY poorCalls DESC,totalCalls DESC,cell ASC LIMIT ?`).all(...args,CELL_LIMIT);
  const byCell=cellRows.map(row=>{const count=countRow(row);return {cell:row.cell,...count,poorRate:count.evaluatedCalls?count.poorCalls/count.evaluatedCalls:null};});
  const cellTotals=byCell.reduce((sum,row)=>{for(const key of ['totalCalls','evaluatedCalls','poorCalls','dropCalls'])sum[key]+=row[key];return sum;},{totalCalls:0,evaluatedCalls:0,poorCalls:0,dropCalls:0});
  if(cellTotals.totalCalls<summary.totalCalls){
   const other={totalCalls:summary.totalCalls-cellTotals.totalCalls,evaluatedCalls:summary.evaluatedCalls-cellTotals.evaluatedCalls,poorCalls:summary.poorCalls-cellTotals.poorCalls,dropCalls:summary.dropCalls-cellTotals.dropCalls};
   byCell.push({cell:'기타 Cell 합계',...other,poorRate:other.evaluatedCalls?other.poorCalls/other.evaluatedCalls:null});
  }
  const locations=db.prepare(`SELECT COALESCE(l.evidence,'none') AS evidence,COUNT(*) AS calls,
   SUM(CASE WHEN c.qoe<3 THEN 1 ELSE 0 END) AS poorCalls FROM calls c
   LEFT JOIN locations l ON l.call_id=c.id AND l.kind='original' WHERE ${clause}
   GROUP BY COALESCE(l.evidence,'none') ORDER BY evidence`).all(...args);
  const locationCalls=locations.filter(row=>row.evidence!=='none').reduce((sum,row)=>sum+row.calls,0);
  const selected=new Map();
  const columns='c.id,c.raw_id,c.date,c.start_second,c.end_second,c.qoe,c.mos,c.is_drop,c.cell,c.area,l.evidence AS locationEvidence';
  const sample=(extra,limit)=>db.prepare(`SELECT ${columns} FROM calls c LEFT JOIN locations l ON l.call_id=c.id AND l.kind='original'
   WHERE ${clause} AND (${extra}) ORDER BY c.date DESC,c.start_second DESC,c.id ASC LIMIT ?`).all(...args,limit);
  // Reserve normal comparison observations even when many poor/Drop calls exist.
  for(const [filter,limit] of [['c.qoe<3',16],['c.is_drop=1',8],['c.qoe>=3 AND c.is_drop=0',8],['1=1',SAMPLE_LIMIT]]){
   for(const row of sample(filter,limit)){if(selected.size>=SAMPLE_LIMIT)break;selected.set(row.id,row);}
  }
  const rows=[...selected.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.start_second-b.start_second||a.id.localeCompare(b.id));
  let detailFailures=0,readDetail;
  try{
   readDetail=createExportDetailReader({publicDir,entryFor:(id,date)=>{
    const found=db.prepare('SELECT json FROM days WHERE customer_id=? AND date=?').get(id,date);
    return found?JSON.parse(found.json):null;
   }});
  }catch{detailFailures++;}
  const metrics=[],calls=rows.map(row=>{
   let detail;
   if(readDetail){try{detail=readDetail(target.customerId,row.date,row.raw_id);}catch{detailFailures++;}}
   const rtp=Object.fromEntries(RTP_FIELDS.map(key=>[key,numeric(detail?.rtp?.[key])]));
   const rsrp=numeric(detail?.rsrp),sinr=numeric(detail?.sinr);
   metrics.push({qoe:numeric(row.qoe),isDrop:row.is_drop===1,rsrp,sinr,rtp});
   const href='/?'+new URLSearchParams({source:'MDT',view:'contract',date:row.date,customer:target.customerId,call:row.raw_id??row.id}).toString();
   return {id:row.id,date:row.date,start:timeText(row.start_second),end:timeText(row.end_second),qoe:numeric(row.qoe),mos:numeric(row.mos),isDrop:row.is_drop===1,cell:row.cell??'',area:row.area??'',locationEvidence:row.locationEvidence??'none',href,rsrp,sinr};
  });
  const radioCalls=metrics.filter(row=>row.rsrp!==null||row.sinr!==null).length;
  const rtpCalls=metrics.filter(row=>Object.values(row.rtp).some(value=>value!==null)).length;
  const radioGroup=predicate=>{
   const group=metrics.filter(predicate);return {sampledCalls:group.length,rsrpCalls:group.filter(row=>row.rsrp!==null).length,sinrCalls:group.filter(row=>row.sinr!==null).length,meanRsrp:mean(group.map(row=>row.rsrp)),meanSinr:mean(group.map(row=>row.sinr))};
  };
  const poorRadio=radioGroup(row=>row.qoe!==null&&row.qoe<3),normalRadio=radioGroup(row=>row.qoe!==null&&row.qoe>=3&&!row.isDrop);
  const rtpSummary=RTP_FIELDS.map(field=>({field,measuredCalls:metrics.filter(row=>row.rtp[field]!==null).length,poorMean:mean(metrics.filter(row=>row.qoe!==null&&row.qoe<3).map(row=>row.rtp[field])),normalMean:mean(metrics.filter(row=>row.qoe!==null&&row.qoe>=3&&!row.isDrop).map(row=>row.rtp[field]))}));
  const detailsPolicy='전체 통계는 선택 범위의 모든 통화로 계산했습니다. 상세는 저QoE 최대 16건, Drop 최대 8건, 정상 비교 최대 8건을 우선 선택하고 중복 제거 후 최대 32건까지 채웠습니다. 무작위 표본이 아니며 radio/RTP 수치는 이 표본에서만 계산했습니다.';
  const coverage={locationCalls,radioCalls,rtpCalls,sampledCalls:calls.length,fullPopulation:true,detailsPolicy};
  const locationDescription=locations.map(row=>({gnss:'GPS',estimated:'추정 위치','bye-cell':'BYE 대표 위치',none:'위치 없음'}[row.evidence]??'기타 위치')+' '+row.calls+'건').join(', ');
  const facts=[
   {id:'E01',title:'전체 모수와 품질 분모',detail:`전체 ${summary.totalCalls}건 중 보정 QoE 평가 ${summary.evaluatedCalls}건, QoE < 3인 통화 ${summary.poorCalls}건(${percent(summary.poorRate)}). 미평가 ${summary.totalCalls-summary.evaluatedCalls}건은 저QoE 비율 분모에서 제외했습니다.`,severity:summary.poorCalls?'attention':'info'},
   {id:'E02',title:'원본 MOS와 Drop 구분',detail:`유효 원본 MOS(1~5) ${summary.rawMosEvaluatedCalls}건 중 MOS < 3은 ${summary.rawMosPoorCalls}건, 평균 ${summary.meanMos??'미평가'}. Drop ${summary.dropCalls}건은 전체 통화 기준이며 MOS 누락 Drop도 포함합니다. 저장된 보정 QoE 평균은 ${summary.meanQoe??'미평가'}입니다.`,severity:summary.dropCalls?'attention':'info'},
   {id:'E03',title:'날짜별 반복',detail:`통화 관측 ${summary.observedDays}일 중 저QoE가 있는 날은 ${summary.poorDays}일입니다. 일별 집계는 동일한 날짜·매일 시간 범위와 품질 정의를 사용합니다.`,severity:summary.poorDays>1?'attention':'info'},
   {id:'E04',title:'위치 근거의 범위',detail:locationDescription+'. BYE와 추정 위치는 저하 순간의 단말 위치로 확정할 수 없으며 GPS도 저하 시점과의 정합을 별도로 확인해야 합니다.',severity:'caution'},
   {id:'E05',title:'대표 Cell별 관측',detail:`대표 Cell 상위 ${cellRows.length}개를 저QoE 건수순으로 표시했습니다. 첫 번째 항목${byCell[0].cell==='미확인'?'(Cell 미확인)':''}은 전체 ${byCell[0].totalCalls}건 중 평가 ${byCell[0].evaluatedCalls}건, 저QoE ${byCell[0].poorCalls}건(${percent(byCell[0].poorRate)}). Cell은 통화 대표 근거이며 원인 기지국 확정이나 동일 위치 집단 대조가 아닙니다.`,severity:'caution'},
   {id:'E06',title:'상세 근거의 수집 범위',detail:`선택 상세 ${calls.length}건 중 통화에 매칭된 RSRP 또는 SINR ${radioCalls}건, 숫자로 확인된 RTP 지표 ${rtpCalls}건입니다. ${detailsPolicy}`,severity:radioCalls&&rtpCalls?'info':'caution'},
  ];
  const radioComparisons=[];
  for(const [label,field,countField,unit] of [['RSRP','meanRsrp','rsrpCalls','dBm'],['SINR','meanSinr','sinrCalls','dB']]){
   if(poorRadio[field]!==null&&normalRadio[field]!==null)radioComparisons.push(`${label}: 저QoE 표본 평균 ${poorRadio[field]} ${unit}(${poorRadio[countField]}건), 정상 비교 표본 ${normalRadio[field]} ${unit}(${normalRadio[countField]}건)`);
  }
  if(radioComparisons.length){
   facts.push({id:'E07',title:'표본 내 저QoE·정상 무선 비교',detail:radioComparisons.join('; ')+'. 서로 같은 시간·장소·Cell로 통제한 비교가 아니며 평균 차이만으로 무선 원인을 확정할 수 없습니다.',severity:'caution'});
  }else facts.push({id:'E07',title:'무선 대조 근거 부족',detail:'저QoE와 정상 비교 양쪽에 공통으로 매칭된 RSRP 또는 SINR이 확보되지 않았습니다. 무선 지표 결측을 정상 상태로 해석하지 않습니다.',severity:'caution'});
  const availableRtp=rtpSummary.filter(row=>row.measuredCalls);
  facts.push({id:'E08',title:'RTP 원본 지표',detail:availableRtp.length?availableRtp.map(row=>`${row.field}: 수치 ${row.measuredCalls}건, 저QoE 평균 ${row.poorMean??'없음'}, 정상 비교 평균 ${row.normalMean??'없음'}`).join('; ')+'. 원본 단위이며 백분율·ms로 임의 변환하지 않습니다. 단위 확인과 시간 정합이 필요합니다.':'선택 상세에서 수치형 RTP Loss/Jitter 근거가 없습니다. 결측을 0이나 정상으로 처리하지 않습니다.',severity:'caution'});
  const limitations=[
   '분석은 관측된 연관성과 추가 확인 대상을 제시합니다. 전파·망·단말·코어 원인을 확정하거나 설정값 변경을 승인하지 않습니다.',
   '고객 본인의 선택 기간 통화만 집계했습니다. 다른 고객의 같은 시간·장소·Cell 대조군은 포함하지 않았습니다.',
   'radio/RTP는 상세 표본의 통화 단위 지표입니다. 저하 순간과의 정밀 시간 정합, 핸드오버, 방향별 구간 분석은 수행하지 않았습니다.',
   'BYE 대표 위치·추정 위치와 통화 대표 Cell만으로 정확한 불량 위치나 원인 기지국을 정할 수 없습니다.',
   detailsPolicy
  ];
  if(detailFailures)limitations.push('일부 원본 상세를 읽을 수 없어 해당 통화의 radio/RTP는 미확인으로 두었습니다. 전체 통화 집계는 유지했습니다.');
  if(!radioCalls)limitations.push('선택 상세에서 매칭된 무선 지표가 없어 무선 원인 여부를 판단할 수 없습니다.');
  if(!rtpCalls)limitations.push('선택 상세에서 수치형 RTP 근거가 없어 패킷 손실·지터 원인 여부를 판단할 수 없습니다.');
  const evidence={schemaVersion:'qwen-evidence-v1',sourceRevision,target,generatedAt:new Date().toISOString(),summary,byDay,byCell,facts,calls,coverage,limitations};
  // Explicit allowlist: no raw call/customer/contract ID, URL, coordinates, raw JSON.
  const modelInput={schemaVersion:'qwen-evidence-v1',subject:target.kind==='call'?'선택 통화':'선택 고객',scope:target.scope,
   summary:{...summary,poorRatePercent:percentValue(summary.poorRate)},byDay,
   byCell:byCell.map((row,index)=>({...row,poorRatePercent:percentValue(row.poorRate),cell:row.cell==='미확인'?'Cell 미확인':index===CELL_LIMIT?'기타 Cell 합계':'대표 Cell '+String(index+1).padStart(2,'0')})),
   facts,coverage,radioComparison:{poor:poorRadio,normal:normalRadio},rtp:rtpSummary,limitations};
  return {...evidence,modelInput};
 }finally{db.close();}
}
module.exports={validateTarget,collectEvidence};
