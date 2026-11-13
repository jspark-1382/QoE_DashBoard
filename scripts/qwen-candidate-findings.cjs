/* eslint-disable @typescript-eslint/no-require-imports -- Server deterministic findings. */
const {createHash}=require('node:crypto');
const {buildIndependentReview,buildMdtObservationGroups}=require('./qwen-candidate-review.cjs');
const {buildCallObservationTargets,investigationHint}=require('./qwen-candidate-investigation-evidence.cjs');
const {buildRadioCriteriaTargets}=require('./qwen-candidate-cause-rules.cjs');
const {buildCauseAssessments}=require('./qwen-candidate-cause-assessment.cjs');
const {MDT_SUPPORT_WEIGHT}=require('../lib/analyst/candidate-coverage-points.mjs');
const n=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const display=v=>n(v)===null?null:Math.round(v*100)/100;
const id=(kind,key)=>kind+'_'+createHash('sha256').update(JSON.stringify(key)).digest('hex').slice(0,12);
const RAW=['fcRaw','reasonRaw','releaseCauseRaw','secondaryReleaseCause1Raw','secondaryReleaseCause2Raw','sipFailResponseCodeRaw','byeReasonRaw','callDirectionRaw'];
// Public source strings remain exact. Only structural vendor codes/known cause
// tokens cross the LLM boundary; arbitrary free text is represented as unavailable.
const provided=value=>typeof value==='string'&&value.trim()&&!['null','none','nan','n/a'].includes(value.trim().toLowerCase());
function safeCode(value){
 if(!provided(value))return null;
 const v=value.trim();return v.length<=120&&/^[0-9A-Za-z _^:/.-]+$/.test(v)&&!/(?:https?|www|ignore|instruction|system|prompt|password|secret|token|key|customer|imsi|imei)/i.test(v)
 &&(/^[0-9 :^/.-]+$/.test(v)||/^(?:\d+\s*[:^]\s*)?(?:RTP timeout|Tx Bye|Rx Bye|Normal|Drop|Rx_RTP_middle_Loss|H\s*:\s*Drop\/V\s*:\s*Rx_RTP_middle_Loss)$/i.test(v))?v:'[미확인 원문 보관]';
}
function sampledCallReferences(calls){
 const counts=new Map();
 for(const call of calls)if(typeof call.id==='string'&&call.id)counts.set(call.id,(counts.get(call.id)??0)+1);
 const valid=calls.filter(call=>counts.get(call.id)===1&&typeof call.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(call.date)).sort((a,b)=>a.id.localeCompare(b.id));
 return new Map(valid.map((call,index)=>{
  let ordinal=index+1,letters='';
  while(ordinal>0){ordinal--;letters=String.fromCharCode(65+ordinal%26)+letters;ordinal=Math.floor(ordinal/26);}
  return [call.id,{date:call.date,alias:'CALL_REF_'+letters}];
 }));
}
function buildCandidateFindings({grid,termination,sourceRevision,candidate,rows=[],calls=[]}){
 const targets=[],inRangePots=new Set(),measuredPots=new Set();
 const metricWeightBasis=grid?.metricWeightBasis??'O열 원본 측정 수를 집계 가중치로 사용하며 실제 지표별 유효 분모는 미확인입니다.';
 if(grid?.analysisSchemaVersion==='mdt-grid-analysis-v1'&&Array.isArray(grid.records))for(const cell of grid.records){
  const lat=n(cell.lat),lon=n(cell.lon);if(lat===null||lon===null||!candidate?.medoid)continue;
  const dx=(lon-candidate.medoid.lon)*111320*Math.cos(candidate.medoid.lat*Math.PI/180),dy=(lat-candidate.medoid.lat)*110900;
  if(dx*dx+dy*dy>candidate.displayRadiusM**2)continue;
  inRangePots.add(String(cell.pot));
  for(const a of cell.analysis??[]){
   if(!Number.isSafeInteger(a.samples)||a.samples<=0||!/^\d{4}-\d{2}-\d{2}$/.test(a.date)||typeof a.band!=='string'||typeof a.earfcn!=='string')continue;
   const basic=n(a.belowPct?.['-100']),tail=n(a.belowPct?.['-105']),deep=n(a.belowPct?.['-110']),phr=n(a.phrMean);
   if(n(a.rsrpMean)===null&&n(a.rsrqMean)===null&&basic===null&&tail===null&&deep===null&&phr===null)continue;
   if([basic,tail,deep].some(value=>value!==null&&(value<0||value>100)))continue;
   // Zero-tail observations remain comparison evidence, never a fabricated fault.
   measuredPots.add(String(cell.pot));
   const samples=a.metricSamples?.['-100']??a.metricSamples?.['-105']??a.samples,support=Math.min(1,samples/MDT_SUPPORT_WEIGHT);
   const criteria={dl:{status:basic===null?'insufficient':basic>0?'matched':'not-matched',threshold:-100,tailPct:basic,aggregation:'source-grid-distribution',missing:basic===null?['RSRP ≤ -100 원본 분포 미확보']:[]},ul:{status:phr===null?'insufficient':phr<=3?'matched':'not-matched',threshold:3,mean:phr,aggregation:'source-grid-mean',missing:['PHR 원본 단위와 실제 유효 분모 미확인','격자 평균이며 개별 PHR ≤ 3 횟수·비율은 미제공']}};
   const targetId=id('MDT',[cell.pot,a.date,a.band,a.earfcn]);
   const limitations=['별도 날짜 배경 MDT의 조사 구간이며 통화 저하 당시 위치·서빙 Cell 또는 책임 기지국을 뜻하지 않습니다.','측정 수는 독립 통화·고객 수가 아닙니다.',metricWeightBasis,'PHR 원본 단위는 미확인입니다. 지표별 가중치는 실제 기준별 유효 분모와 다를 수 있습니다.'];
   if(samples<MDT_SUPPORT_WEIGHT)limitations.push('기준별 측정 표본이 적어 단일 극단값의 원인 설명력은 제한적입니다. 독립 측정을 보완합니다.');
   targets.push({id:targetId,kind:'mdt-grid',title:String(cell.pot)+' · '+a.band+' · '+a.date,
    observation:a.date+' '+a.band+' EARFCN '+a.earfcn+', '+a.samples+'측정: 평균 RSRP '+display(a.rsrpMean)+' dBm, RSRQ '+(display(a.rsrqMean)??'미확보')+' dB; DL RSRP ≤-100 dBm '+(display(basic)??'미확보')+'%, ≤-105 dBm '+(display(tail)??'미확보')+'%, ≤-110 dBm '+(display(deep)??'미확보')+'%. UL 원본 PHR 평균 '+(phr??'미확보')+' (기준 ≤3, 단위·유효 분모 미확인; 개별 측정 비율 아님).',
    sourceDates:[a.date],band:a.band,earfcn:a.earfcn,
    metrics:[{label:'측정 수',value:a.samples,unit:'측정'},{label:'RSRP 평균',value:display(a.rsrpMean),unit:'dBm'},{label:'RSRQ 평균',value:display(a.rsrqMean),unit:'dB'},{label:'PHR 평균 (단위 미확인)',value:display(a.phrMean)},{label:'RSRP MeanSumCnt 평균 (Y, P와 별도)',value:display(a.rsrpMeanSumCnt),unit:'dBm'},
     ...Object.entries(a.belowPct??{}).map(([key,value])=>({label:'RSRP ≤'+key+' dBm',value:display(value),unit:'%'})),
     ...Object.entries(a.metricSamples??{}).map(([key,value])=>({label:key+' 집계 가중치 (원본 측정 수)',value,unit:'측정'}))],
    evidenceIds:[],sopIds:['MDT_COVERAGE_REVIEW'],allowedCauseCategories:['coverage'],callIds:[],mapPoints:[{pot:String(cell.pot),lat,lon,band:a.band,date:a.date}],limitations,criteria,
    _score:((basic??0)+(tail??0)+(deep??0)+(criteria.ul.status==='matched'?30:0))*support,_samples:samples,_grid:{x:n(cell.x),y:n(cell.y)},
    _model:{samples:a.samples,rsrpMean:display(a.rsrpMean),rsrqMean:display(a.rsrqMean),phrMean:phr,phrUnit:'원본 단위 미확인',criteria,belowPct:{'-100':display(basic),'-105':display(tail),'-110':display(deep)},...Object.keys(a.metricSamples??{}).some(k=>['-100','-105','-110','rsrp','rsrq'].includes(k)&&a.metricSamples[k]!==a.samples)?{metricSamples:Object.fromEntries(Object.entries(a.metricSamples??{}).filter(([k])=>['-100','-105','-110','rsrp','rsrq'].includes(k)))}:{},...(samples<MDT_SUPPORT_WEIGHT?{sampleSupport:'sparse'}:{})}});
  }
 }
 targets.sort((a,b)=>b._score-a._score||b._samples-a._samples||a.id.localeCompare(b.id));
 // Every measured in-range combination is retained. Request size is checked before inference.
 const gridAvailable=grid?.analysisSchemaVersion==='mdt-grid-analysis-v1'?targets.length:null;
 const mdtCoverage={inRangePots:inRangePots.size,measuredPots:measuredPots.size,missingPots:inRangePots.size-measuredPots.size,availableCombinations:gridAvailable,includedCombinations:targets.length};
 const neighbourLinks=[];
 const byGrid=new Map(targets.filter(t=>t._grid.x!==null&&t._grid.y!==null).map(t=>[[t.sourceDates[0],t.band,t.earfcn,t._grid.x,t._grid.y].join('|'),t]));
 for(const t of targets){
  if(t._grid.x===null||t._grid.y===null)continue;
  for(const [x,y,direction] of [[25,0,'동쪽'],[0,25,'북쪽'],[25,25,'북동쪽'],[-25,25,'북서쪽']]){
   const other=byGrid.get([t.sourceDates[0],t.band,t.earfcn,t._grid.x+x,t._grid.y+y].join('|'));
   if(other)neighbourLinks.push([t.id,other.id,direction,display(Math.hypot(x,y))]);
  }
 }
 neighbourLinks.sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1]));
 const groups=new Map(),validTermination=termination?.schemaVersion==='qoe-candidate-termination-v1'&&termination.sourceRevision===sourceRevision;
 if(validTermination)for(const row of rows){
  if(row.is_drop!==1)continue;
  // Exact current published member ID only; never raw-ID/nearest/first-match joins.
  const raw=termination.records?.[row.memberId];if(!raw||!RAW.some(k=>provided(raw[k])))continue;
  const tuple=RAW.map(k=>typeof raw[k]==='string'&&raw[k].trim()?raw[k]:null),key=JSON.stringify(tuple);
  const group=groups.get(key)??{tuple,rows:[],dropCalls:0};group.rows.push(row);if(row.is_drop===1)group.dropCalls++;groups.set(key,group);
 }
 let terminationAvailable=validTermination?0:null;
 for(const [,group] of [...groups].sort((a,b)=>b[1].dropCalls-a[1].dropCalls||b[1].rows.length-a[1].rows.length||a[0].localeCompare(b[0]))){
  terminationAvailable++;if(terminationAvailable>4)continue;
  const values=Object.fromEntries(RAW.map((k,i)=>[k,group.tuple[i]])),targetId=id('TERM',group.tuple);
  targets.push({id:targetId,kind:'termination-group',title:'원본 종료 사유 · FC '+(provided(values.fcRaw)?values.fcRaw:'미확보')+' · BYE '+(provided(values.byeReasonRaw)?values.byeReasonRaw:'미확보'),observation:'Drop '+group.dropCalls+'통화 · '+[['fcRaw','FC'],['byeReasonRaw','BYE'],['releaseCauseRaw','종료'],['reasonRaw','REASON']].filter(([key])=>provided(values[key])).map(([key,label])=>label+' '+values[key]).join(' · '),
   sourceDates:[...new Set(group.rows.map(r=>r.date))].sort((a,b)=>a.localeCompare(b)),band:null,earfcn:null,
   metrics:[{label:'동일 종료 사유 통화 수',value:group.rows.length,unit:'통화'},{label:'Drop 통화 수',value:group.dropCalls,unit:'통화'},...RAW.map(k=>({label:k,value:values[k]}))],
   evidenceIds:[],sopIds:[],callIds:group.rows.map(r=>r.id),mapPoints:[],
   limitations:['FC 등 벤더 코드는 공식 해석이 미등록인 원문입니다. SIP/Q.850 또는 특정 장애로 임의 변환하지 않습니다.','종료 사유는 종료 직전 메시지의 주체·시간 및 단말·망측 기록으로 구분해야 합니다.'],
   _model:{calls:group.rows.length,dropCalls:group.dropCalls,rawCodes:Object.fromEntries(RAW.map(k=>[k,safeCode(values[k])])),rawFieldStatus:Object.fromEntries(RAW.map(k=>[k,!provided(values[k])?'not-provided':safeCode(values[k])==='[미확인 원문 보관]'?'present-withheld-free-text':'present']))}});
 }
 // Call radio targets require an observed variation on the same measured cell,
 // frequency and call, not just existence of a scalar average.
 for(const call of calls){
  if(targets.filter(t=>t.kind==='call-radio').length>=2)break;
  const series=(call.radioSeries??[]).filter(r=>n(r.rsrp)!==null&&r.rsrp<0&&r.rsrp>=-200&&typeof r.cellId==='string'&&r.cellId&&r.frequency!=null);
  const segments=new Map();for(const r of series){const k=JSON.stringify([r.cellId,r.frequency]);const s=segments.get(k)??[];s.push(r);segments.set(k,s);}
  for(const [key,s] of segments){
   if(s.length<3)continue;const min=Math.min(...s.map(r=>r.rsrp)),max=Math.max(...s.map(r=>r.rsrp));if(max-min<10)continue;
   const targetId=id('RADIO',[call.id,key]),observation=call.date+' 통화 구간 동일 Cell/주파수 RSRP '+display(min)+'~'+display(max)+' dBm ('+s.length+'관측).';
   targets.push({id:targetId,kind:'call-radio',title:'통화 구간 무선 변화',observation,sourceDates:[call.date],band:null,earfcn:String(s[0].frequency),metrics:[{label:'관측 수',value:s.length},{label:'RSRP 최소',value:display(min),unit:'dBm'},{label:'RSRP 최대',value:display(max),unit:'dBm'}],evidenceIds:[],sopIds:[],callIds:[call.id],mapPoints:[],limitations:['통화 구간 관측이며 QoE 저하 순간과 자동 시간 정합되지 않았습니다. 정상 비교와 정밀 시각 대조 전에는 인과로 단정하지 않습니다.'],_model:{observations:s.length,minRsrp:display(min),maxRsrp:display(max)}});break;
  }
 }
 targets.push(...buildCallObservationTargets({rows,calls}));
 targets.push(...buildRadioCriteriaTargets({calls}));
 // Sorting conveys no root-cause probability. Observation-only call targets never acquire a cause category.
 targets.sort((a,b)=>({'call-criteria':0,'termination-group':1,'mdt-grid':2,'call-radio':3,'call-quality':4,'call-pattern':5}[a.kind])-({'call-criteria':0,'termination-group':1,'mdt-grid':2,'call-radio':3,'call-quality':4,'call-pattern':5}[b.kind]));
 const modelTargets=[],facts=[],callReferences=sampledCallReferences(calls);
 for(const [index,t] of targets.entries()){
  const evidenceId='T'+String(index+1).padStart(2,'0');t.evidenceIds=[evidenceId];
  if(t.kind==='termination-group'||t.kind==='call-radio'){t.sopIds=['TG_'+t.id];t.allowedCauseCategories=t.kind==='termination-group'?(Object.values(t._model.rawCodes??{}).some(value=>typeof value==='string'&&/RTP timeout|Rx_RTP_middle_Loss/iu.test(value))?['equipment']:[]):t._model.minRsrp<=-100?['coverage']:[];}
  if(t.kind==='call-criteria')t.sopIds=t.allowedCauseCategories.map(category=>'RULE_'+category.toUpperCase()+'_REVIEW');
  t.investigationHint=investigationHint(t);
  // IDs are stable opaque aliases; public POT/coords/call IDs/raw source prose do not cross.
  const reference=['call-radio','call-quality','call-criteria'].includes(t.kind)&&t.callIds.length===1&&t.sourceDates.length===1?callReferences.get(t.callIds[0]):null;
  const callRef=reference&&reference.date===t.sourceDates[0]?reference.alias:null;
  modelTargets.push({id:t.id,kind:t.kind,sourceDates:t.sourceDates,band:t.band,earfcn:t.earfcn,metrics:t._model,evidenceIds:t.evidenceIds,...(callRef?{callRef}:{}),...(t.kind==='mdt-grid'?{sopIds:t.sopIds,allowedCauseCategories:t.allowedCauseCategories}:{investigationHint:t.investigationHint,sopIds:t.sopIds,allowedCauseCategories:t.allowedCauseCategories,limitations:t.limitations})});
  facts.push({id:evidenceId,title:t.kind==='call-criteria'?'실제 통화 DL·UL·Pollution 운영 기준':t.kind==='mdt-grid'?'배경 MDT 분포 대상':t.kind==='termination-group'?'실제 종료 사유 대상':t.kind==='call-quality'?'실제 통화 음성·무선·RTP 관측':t.kind==='call-pattern'?'후보 구성 반복 관측':'통화 구간 무선 변화',detail:t.kind==='termination-group'?JSON.stringify(t._model):t.observation.replace(String(t.mapPoints[0]?.pot??'__none__'),'대상'),severity:'attention'});
  delete t._model;delete t._score;delete t._samples;delete t._grid;
 }
 return {analysisTargets:targets,modelTargets,facts,neighbourLinks,mdtCoverage,metricWeightBasis,causeAssessments:buildCauseAssessments(targets,modelTargets),limitations:['후보 안의 유효 MDT POT·날짜·대역 조합 전체를 검토합니다. 기준 이하 0%도 비교 관측으로 포함하며 측정 미확보는 별도 집계합니다. MDT 정렬 점수는 조사 표시 순서이며 원인 확률이 아닙니다.',...(gridAvailable===null?['배경 MDT 날짜·POT·대역 분포 분석 자료가 미확보입니다. 원본 기준 이하 비율과 집계 가중치를 보완해야 합니다.']:[]),...(!validTermination?['현재 자료 버전에 연결된 종료 사유 sidecar가 미확보입니다. 같은 통화 ID의 FC/BYE/REASON/Release 원문을 확보해야 합니다.']:[])],transmission:[
  {label:'배경 MDT 분석 대상',available:gridAvailable,sent:targets.filter(t=>t.kind==='mdt-grid').length,fields:['date','band','earfcn','samples','RSRP/RSRQ','belowPct(-100/-105/-110)','PHR 원본 평균·단위 미확인','DL/UL 운영 기준과 집계 종류','유효 분모가 전체 측정 수와 다른 경우 metricSamples','동일 날짜·대역·EARFCN 인접관계'],excluded:['좌표','POT 원문','원본 경로','원본 행','PHR 단위 확정과 개별 측정 비율','그 외 임계값은 UI 원본 상세에 보존']},
  {label:'Drop 종료 사유 집단',available:terminationAvailable,sent:targets.filter(t=>t.kind==='termination-group').length,fields:RAW,excluded:['고객 ID','통화 ID','원본 링크','비구조 자유 텍스트']},
  {label:'통화 구간 무선 변화',available:calls.filter(c=>Array.isArray(c.radioSeries)&&c.radioSeries.length).length,sent:targets.filter(t=>t.kind==='call-radio').length,fields:['동일 Cell/주파수 관측 수','RSRP 범위','측정일'],excluded:['고객 ID','Cell 원문','위치','원시 시계열']},
  {label:'실제 통화 음성·무선·RTP 관측',available:calls.filter(c=>n(c.qoe)!==null||n(c.mos)!==null).length,sent:targets.filter(t=>t.kind==='call-quality').length,fields:['원본 MOS','저장 QoE','SIP Drop','연결 RSRP/RSRQ/SINR','송수신 RTP 원본 수치','조사 이유·확인 사항'],excluded:['실제 통화·고객·Cell ID','RTP 단위·방향 확정','전체 통화 시계열','상세 표본 중 최대 6통화만 전달']},
  {label:'후보 구성 반복 관측',available:rows.length,sent:targets.filter(t=>t.kind==='call-pattern').length,fields:['동일 Cell 또는 시작 시간대 반복 그룹','구성 통화·고객·관측 날짜·Drop 수'],excluded:['실제 통화·고객·Cell ID','정상 지역 분모','원인·과부하 판정','반복 그룹 중 최대 3개만 전달']}],independentReview:buildIndependentReview(targets,modelTargets,neighbourLinks),observationGroups:buildMdtObservationGroups(targets,modelTargets,neighbourLinks)};
}
module.exports={buildCandidateFindings,safeCode};
