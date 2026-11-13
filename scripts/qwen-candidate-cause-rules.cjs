/* eslint-disable @typescript-eslint/no-require-imports -- Pure, source-owned radio criteria; no inference or operational actions. */
const {createHash}=require('node:crypto');
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const number=value=>finite(value)?value:null;
const cell=value=>typeof value==='string'&&/^[\w.:-]{1,128}$/.test(value)?value:null;
const pci=value=>Number.isInteger(value)&&value>=0&&value<=1007?value:null;
const validRsrp=value=>finite(value)&&value<0&&value>=-200?value:null;
const dateParts=value=>{
 const match=typeof value==='string'&&value.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!match)return null;
 const [year,month,day]=match.slice(1).map(Number),ms=Date.UTC(year,month-1,day),d=new Date(ms);
 return d.getUTCFullYear()===year&&d.getUTCMonth()===month-1&&d.getUTCDate()===day?{date:value,ms}:null;
};

/** Time-only values are anchored without inventing an overnight rollover. */
function parseRadioTimestamp(value,callDate){
 if(typeof value!=='string')return null;
 const match=value.match(/^(?:(\d{4}-\d{2}-\d{2})T)?(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})?$/);
 if(!match)return null;const d=dateParts(match[1]??callDate);if(!d)return null;
 const hour=Number(match[2]),minute=Number(match[3]),second=Number(match[4]);if(hour>23||minute>59||second>59)return null;
 let offset=0;if(match[6]&&match[6]!=='Z'){const h=Number(match[6].slice(1,3)),m=Number(match[6].slice(4,6));if(h>23||m>59)return null;offset=(h*60+m)*60000*(match[6][0]==='-'?-1:1);}
 return {original:value,date:d.date,milliseconds:d.ms+hour*3600000+minute*60000+second*1000+(match[5]?Number('0.'+match[5])*1000:0)-offset,basis:match[6]?'absolute':'local',explicitDate:!!match[1]};
}

function sourceRows(call){
 const rows=(Array.isArray(call.radioSeries)?call.radioSeries:[]).map((raw,index)=>({index,time:parseRadioTimestamp(raw?.timestamp,call.date),cellId:cell(raw?.cellId),servingPci:pci(raw?.servingPci),frequency:finite(raw?.frequency)&&raw.frequency>0?raw.frequency:null,technology:raw?.radioTechnology??null,triggerEvent:raw?.triggerEvent==='A3'?'A3':null,rsrp:validRsrp(raw?.rsrp),rsrq:number(raw?.rsrq),phr:number(raw?.phr)}));
 const duplicates=new Map();for(const row of rows)if(row.time){const key=row.time.basis+'|'+row.time.milliseconds,list=duplicates.get(key)??[];list.push(row);duplicates.set(key,list);}
 let conflictingRows=0,duplicateRows=0;
 for(const list of duplicates.values())if(list.length>1){
  const identities=new Set(list.map(row=>JSON.stringify([row.cellId,row.servingPci,row.frequency,row.technology,row.rsrp,row.rsrq,row.phr])));
  if(identities.size>1){for(const row of list)row.conflict=true;conflictingRows+=list.length;}else{for(const row of list.slice(1))row.duplicate=true;duplicateRows+=list.length-1;}
 }
 return {rows,conflictingRows,duplicateRows};
}

function thresholdCriterion(rows,key,threshold){
 const values=rows.filter(row=>!row.conflict&&!row.duplicate).map(row=>row[key]).filter(value=>value!==null);
 const matches=values.filter(value=>value<=threshold);
 return {status:matches.length?'matched':values.length?'not-matched':'insufficient',threshold,validSamples:values.length,observedCount:matches.length,...(values.length?{minimum:Math.min(...values)}:{}),missing:values.length?[]:[key==='rsrp'?'통화에 연결된 유효한 음수 DL RSRP 원본 측정이 없습니다.':'통화에 연결된 UL PHR 원본 측정이 없습니다. 결측을 영으로 대체하지 않습니다.']};
}

function transitionCriterion(rows){
 const segments=[];let current=[],previous=null;
 const audit={invalidTimestamps:0,conflictingRows:0,timeRegressions:0,basisChanges:0,identityGaps:0,longGaps:0,missingServingPci:0,missingCellId:0,missingFrequency:0,frequencyChangeEvents:0};
 const flush=()=>{if(current.length)segments.push(current.sort((a,b)=>a.time.milliseconds-b.time.milliseconds||a.index-b.index));current=[];previous=null;};
 for(const row of rows){
  if(row.duplicate)continue;
  if(row.conflict){audit.conflictingRows++;flush();continue;}
  if(!row.time){audit.invalidTimestamps++;flush();continue;}
  if(row.cellId===null&&row.servingPci===null){audit.identityGaps++;flush();continue;}
  if(row.servingPci===null)audit.missingServingPci++;if(row.cellId===null)audit.missingCellId++;if(row.frequency===null)audit.missingFrequency++;
  if(previous&&previous.time.basis!==row.time.basis){audit.basisChanges++;flush();}
  else if(previous&&row.time.milliseconds<previous.time.milliseconds&&(!row.time.explicitDate||!previous.time.explicitDate)){audit.timeRegressions++;flush();}
  current.push(row);previous=row;
 }
 flush();
 let validSamples=0,maxChanges=0,firstOffending=null,best=null;
 const windowFor=(points,left,right,events,firstEvent)=>({startedAt:points[left].time.original,endedAt:points[right].time.original,changes:events.length-firstEvent,eventCount:events.length-firstEvent,events:events.slice(firstEvent,firstEvent+12).map(({fromIndex:_fromIndex,toIndex:_toIndex,...event})=>event),omittedEvents:Math.max(0,events.length-firstEvent-12)});
 const inspect=points=>{
  if(!points.length)return;validSamples+=points.length;
  const events=[];let left=0,firstEvent=0;
  for(let index=1;index<points.length;index++){
   const before=points[index-1],after=points[index];
   const cellComparable=before.cellId!==null&&after.cellId!==null,pciComparable=before.servingPci!==null&&after.servingPci!==null;
   if(!cellComparable&&!pciComparable){audit.identityGaps++;left=index;firstEvent=events.length;continue;}
   const cellChanged=cellComparable&&before.cellId!==after.cellId,pciChanged=pciComparable&&before.servingPci!==after.servingPci;
   if(cellChanged||pciChanged){const frequencyChanged=before.frequency!==null&&after.frequency!==null&&before.frequency!==after.frequency;if(frequencyChanged)audit.frequencyChangeEvents++;
    events.push({fromIndex:index-1,toIndex:index,fromAt:before.time.original,at:after.time.original,cellChanged,pciChanged,frequencyChanged,fromCellId:before.cellId,toCellId:after.cellId,fromServingPci:before.servingPci,toServingPci:after.servingPci,fromFrequency:before.frequency,toFrequency:after.frequency});
   }
   while(left<index&&after.time.milliseconds-points[left].time.milliseconds>30000)left++;
   // Include the baseline observation before the first change in the window.
   while(firstEvent<events.length&&events[firstEvent].fromIndex<left)firstEvent++;
   const count=events.length-firstEvent;
   if(count>maxChanges){maxChanges=count;best=windowFor(points,left,index,events,firstEvent);}
   if(count>=3&&!firstOffending)firstOffending=windowFor(points,left,index,events,firstEvent);
  }
 };
 for(const segment of segments){let part=[];for(const row of segment){if(part.length&&row.time.milliseconds-part.at(-1).time.milliseconds>30000){audit.longGaps++;inspect(part);part=[];}part.push(row);}inspect(part);}
 const missing=[];
 if(audit.missingServingPci||!validSamples)missing.push('서빙 PCI가 없는 관측은 PCI 변화 판정에서 제외하고 실제 Cell-ID가 있으면 그 변화만 사용했습니다. 이웃 PCI를 서빙 PCI로 대체하지 않습니다.');
 if(audit.missingCellId||!validSamples)missing.push('Cell-ID가 없는 관측은 Cell-ID 변화 판정에서 제외했습니다.');
 if(audit.invalidTimestamps)missing.push('원본 시각이 없거나 형식이 불명확한 관측을 넘어 전환을 연결하지 않았습니다.');
 if(audit.conflictingRows)missing.push('동일 시각에 서로 충돌하는 중복 원본이 있어 해당 시각을 넘어 전환을 연결하지 않았습니다.');
 if(audit.timeRegressions)missing.push('날짜 없는 시각의 역행에서 날짜 변경을 추정하지 않고 조사 구간을 분리했습니다.');
 if(audit.basisChanges)missing.push('시간대가 명시된 시각과 시간대 미확인 시각을 서로 연결하지 않았습니다.');
 if(audit.identityGaps)missing.push('서로 비교할 수 있는 관측 Cell-ID·서빙 PCI가 없는 경계는 전환 횟수에서 제외했습니다.');
 if(audit.longGaps)missing.push('관측 간격이 삼십 초를 초과한 공백을 넘어 전환을 연결하지 않았습니다.');
 if(audit.missingFrequency)missing.push('일부 관측의 주파수 범위는 미확인입니다.');
 if(audit.frequencyChangeEvents)missing.push('서로 다른 주파수 사이의 관측 전환도 포함됩니다. 동일 주파수 간섭이나 핸드오버 실패를 확정하지 않습니다.');
 const incomplete=!validSamples||validSamples<2||audit.invalidTimestamps||audit.conflictingRows||audit.timeRegressions||audit.basisChanges||audit.identityGaps||audit.longGaps||audit.missingServingPci||audit.missingCellId;
 return {status:maxChanges>=3?'matched':incomplete?'insufficient':'not-matched',threshold:3,windowSeconds:30,validSamples,observedCount:maxChanges,...(firstOffending||best?{window:firstOffending??best}:{}),missing,audit};
}

// Each window uses adjacent original observations in one call. Unknown rows,
// ambiguous timestamps and radio technology changes form hard boundaries.
function frequencyCriteria(rows){
 const overlap={status:'insufficient',validSamples:0,observedCount:0,windowSeconds:30,missing:[]};
 const frequencyChange={status:'insufficient',validSamples:0,observedCount:0,missing:[]};
 let previous=null,older=null,firstReturn=null;
 const seen=rows.filter(row=>!row.duplicate);
 const point=row=>({at:row.time.original,earfcn:row.frequency,technology:row.technology,servingPci:row.servingPci,cellId:row.cellId,rsrp:row.rsrp,rsrq:row.rsrq,...(row.triggerEvent?{triggerEvent:row.triggerEvent}:{})});
 const sameIdentity=(a,b,c,key)=>[a,b,c].every(row=>row[key]!==null)&&a[key]===c[key]&&a[key]!==b[key];
 for(const row of seen){
  if(row.conflict||!row.time||row.frequency===null){previous=null;older=null;continue;}
  if(previous&&(previous.time.basis!==row.time.basis||previous.technology!==row.technology||previous.time.milliseconds>=row.time.milliseconds||row.time.milliseconds-previous.time.milliseconds>30000)){previous=null;older=null;}
  if(previous){
   frequencyChange.validSamples++;
   if(previous.frequency!==row.frequency){
    frequencyChange.observedCount++;
    frequencyChange.window??={startedAt:previous.time.original,endedAt:row.time.original,events:[point(previous),point(row)]};
   }
  }
  if(older&&older.frequency===previous.frequency&&older.frequency===row.frequency&&row.time.milliseconds-older.time.milliseconds<=30000){
   const triple=[older,previous,row];
   if(['cellId','servingPci'].some(key=>triple.every(r=>r[key]!==null))){
    overlap.validSamples++;
    if(['cellId','servingPci'].some(key=>sameIdentity(older,previous,row,key))){
     overlap.observedCount++;
     if(!firstReturn){firstReturn=older;overlap.window={startedAt:older.time.original,endedAt:row.time.original,events:triple.map(point)};}
    }
   }
  }
  older=previous;previous=row;
 }
 if(firstReturn){
  const cluster=[];const start=seen.indexOf(firstReturn);
  for(const row of seen.slice(start)){
   if(row.conflict||!row.time||row.time.basis!==firstReturn.time.basis||row.time.milliseconds<firstReturn.time.milliseconds||row.time.milliseconds-firstReturn.time.milliseconds>30000)break;
   if(row.frequency!==null&&(row.frequency!==firstReturn.frequency||row.technology!==firstReturn.technology))break;
   if(row.frequency===firstReturn.frequency&&row.triggerEvent==='A3')cluster.push(point(row));
  }
  if(cluster.length)overlap.a3Reports=cluster.slice(0,12);
 }
 overlap.status=overlap.observedCount?'matched':overlap.validSamples?'not-matched':'insufficient';
 frequencyChange.status=frequencyChange.observedCount?'matched':frequencyChange.validSamples?'not-matched':'insufficient';
 overlap.missing=['동시 서빙·이웃 셀 수신전력과 현장 중첩 측정이 필요합니다.'];
 frequencyChange.missing=['RRC 전환 절차 결과와 음성 저하 순간의 시계열이 필요합니다.'];
 return {overlap,frequencyChange};
}
function modelCriteria(criteria){
 const result={};
 for(const [key,value] of Object.entries(criteria)){
  if(key==='overlap'||key==='frequencyChange'){
   const safe=({at,earfcn,rsrp,rsrq,triggerEvent})=>({at,earfcn,rsrp,rsrq,...(triggerEvent?{triggerEvent}:{})});
   result[key]={status:value.status,observedCount:value.observedCount,validSamples:value.validSamples,...(value.window?{window:{startedAt:value.window.startedAt,endedAt:value.window.endedAt,events:value.window.events.map(safe)},...(key==='overlap'?{sameFrequencyReturn:true}:{})}:{}),...(value.a3Reports?{a3Reports:value.a3Reports.map(safe)}:{})};
  }else result[key]={...value,...(value.window?{window:{...value.window,events:value.window.events.map(event=>({fromAt:event.fromAt,at:event.at,cellChanged:event.cellChanged,pciChanged:event.pciChanged,frequencyChanged:event.frequencyChanged}))}}:{})};
 }
 return result;
}

function buildRadioCriteriaTargets({calls=[]}={}){
 if(!Array.isArray(calls)||calls.length>32)throw new TypeError('Radio criteria require the original detail sample of at most 32 calls.');
 const seen=new Set(),targets=[];
 for(const call of calls){
  if(!call||typeof call.id!=='string'||!call.id||!dateParts(call.date))throw new TypeError('Radio criteria require an original call ID and valid source date.');
  const key=JSON.stringify([call.id,call.date]);if(seen.has(key))throw new TypeError('Duplicate original call in radio criteria.');seen.add(key);
  const source=sourceRows(call),criteria={dl:thresholdCriterion(source.rows,'rsrp',-100),ul:thresholdCriterion(source.rows,'phr',3),pollution:transitionCriterion(source.rows),...frequencyCriteria(source.rows)};
  const allowedCauseCategories=[...(criteria.dl.status==='matched'||criteria.ul.status==='matched'?['coverage']:[]),...(criteria.overlap.status==='matched'?['interference']:[]),...(criteria.frequencyChange.status==='matched'||criteria.pollution.status==='matched'?['mobility']:[])];
  const hint={why:allowedCauseCategories.length?'해당 통화의 원본 측정이 사용자가 정한 무선 조사 기준을 충족하여 실제 시각과 음성 품질을 함께 대조할 대상입니다.':'확보한 원본으로 조사 기준 충족 여부와 부족한 지표를 구분합니다. 기준 미충족 또는 결측은 전체 품질 정상을 뜻하지 않습니다.',check:'연결 통화 원본에서 DL RSRP·UL PHR와 관측 Cell-ID·서빙 PCI 전환 창을 확인하고 MOS·QoE 저하 시각과 대조합니다. 빈번한 전환만으로 간섭이나 핸드오버 실패를 확정하지 않습니다.'};
  if(criteria.overlap.status==='matched'){
   hint.why='동일 EARFCN에서 서빙 식별자가 A→B→A로 복귀한 구간을 실제 시각·신호 품질과 대조할 수 있습니다.';
   hint.check='복귀 구간을 같은 경로에서 서빙·이웃 셀 동시 측정, RSRQ와 부하 기록으로 확인합니다.';
  }else if(criteria.frequencyChange.status==='matched'){
   hint.why='해당 통화의 연속 원본 측정 사이에 EARFCN 변경이 관측되었습니다.';
   hint.check='실제 EARFCN 변경 시각의 RRC 절차 결과와 음성 시계열을 대조합니다.';
  }
  const observation='DL RSRP 기준 '+criteria.dl.threshold+' dBm 이하 '+criteria.dl.observedCount+'관측'+(criteria.dl.minimum!==undefined?' · 최소 '+criteria.dl.minimum+' dBm':' · 유효 측정 미확보')+'; UL PHR 기준 '+criteria.ul.threshold+' 이하 '+criteria.ul.observedCount+'관측'+(criteria.ul.minimum!==undefined?' · 최소 원본 값 '+criteria.ul.minimum:' · 원본 미확보')+'; 삼십 초 창의 관측 Cell-ID 또는 서빙 PCI 전환 최대 '+criteria.pollution.observedCount+'회. 기준 충족은 조사 조건이며 확정 원인이 아닙니다.';
  const metrics=[{label:'DL RSRP 최소',value:criteria.dl.minimum??null,unit:'dBm'},{label:'DL RSRP 기준 이하 관측 수',value:criteria.dl.observedCount,unit:'관측'},{label:'UL PHR 최소 (원본 단위 미확인)',value:criteria.ul.minimum??null},{label:'UL PHR 기준 이하 관측 수',value:criteria.ul.observedCount,unit:'관측'},{label:'30초 내 최대 관측 전환 수',value:criteria.pollution.observedCount,unit:'회'},{label:'전환 조사 창',value:30,unit:'초'},{label:'DL 유효 관측 수',value:criteria.dl.validSamples,unit:'관측'},{label:'UL 유효 관측 수',value:criteria.ul.validSamples,unit:'관측'}];
  targets.push({id:'CRITERIA_'+createHash('sha256').update(key).digest('hex').slice(0,12),kind:'call-criteria',title:call.date+' '+(typeof call.start==='string'?call.start+' ':'')+'통화 무선 조사 기준',observation,sourceDates:[call.date],band:null,earfcn:null,metrics,criteria,evidenceIds:[],sopIds:[],allowedCauseCategories,callIds:[call.id],mapPoints:[],investigationHint:hint,limitations:['DL·UL·Pollution 기준 충족은 원인 확정이나 망 조정 승인 결과가 아닙니다.','원본 PHR에 임의 단위를 붙이지 않으며 이웃 PCI를 서빙 PCI로 간주하지 않습니다.','관측 신원 전환을 셉니다. 실제 핸드오버 명령·성공·실패 이벤트 또는 책임 셀 판정이 아닙니다.',...new Set(Object.values(criteria).flatMap(value=>value.missing))],_model:{criteria:modelCriteria(criteria)}});
 }
 return targets.sort((a,b)=>Number(b.allowedCauseCategories.length>0)-Number(a.allowedCauseCategories.length>0)||a.sourceDates[0].localeCompare(b.sourceDates[0])||a.id.localeCompare(b.id));
}

function summarizeRadioCriteria(targets){
 const result={calls:targets.length,dl:{matched:0,'not-matched':0,insufficient:0},ul:{matched:0,'not-matched':0,insufficient:0},pollution:{matched:0,'not-matched':0,insufficient:0}};
 for(const target of targets)for(const key of ['dl','ul','pollution'])if(Object.hasOwn(result[key],target.criteria?.[key]?.status))result[key][target.criteria[key].status]++;
 return result;
}

module.exports={buildRadioCriteriaTargets,parseRadioTimestamp,summarizeRadioCriteria};
