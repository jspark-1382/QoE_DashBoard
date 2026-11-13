/* eslint-disable @typescript-eslint/no-require-imports -- Source-owned observation targets, never causal verdicts. */
const {createHash}=require('node:crypto');
const n=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const opaque=(kind,key)=>kind+'_'+createHash('sha256').update(JSON.stringify(key)).digest('hex').slice(0,12);
const RTP_FIELDS=['txPacketLoss','rxPacketLoss','txJitter','rxJitter','txLossCount','rxLossCount'];
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value);
const validRadio=value=>n(value)!==null&&value<0&&value>=-200?value:null;
const quality=value=>n(value)!==null&&value>=1&&value<=5?value:null;

function investigationHint(target){
 if(target.kind==='mdt-grid'){
  const positive=target.metrics.some(m=>/^RSRP ≤-(?:105|110) dBm$/.test(m.label)&&n(m.value)!==null&&m.value>0);
  return {why:positive?'RSRP 평균과 기준 이하 비율을 함께 볼 수 있어 국소 약신호의 조사 경계를 좁힐 수 있습니다.':'같은 날짜·대역의 RSRP 분포를 주변 조사 POT와 비교할 관측입니다. 영 비율도 전체 품질 정상을 뜻하지 않습니다.',check:'같은 날짜·대역·EARFCN 인접 POT의 RSRP·RSRQ와 비교하고, 해당 POT에서 서빙·이웃 셀과 음성 품질을 동시 측정합니다.'};
 }
 if(target.kind==='termination-group')return {why:'동일한 종료 원문이 연결된 실제 통화를 열어 종료 주체와 중단 전후 흐름을 확인할 수 있습니다.',check:'연결 통화의 마지막 송수신 RTP와 최초 BYE 시각·발신 주체를 맞추고 같은 통화의 무선·IMS 기록을 대조합니다. 코드만으로 결함 구간을 정하지 않습니다.'};
 if(target.kind==='call-radio')return {why:'같은 통화·Cell·주파수에서 RSRP 변화가 관측되어 통화 평균에 가려진 구간을 확인할 수 있습니다.',check:'원본 무선 시계열의 변화 시각을 MOS·QoE 저하 구간 및 RSRQ·SINR과 맞춥니다. 변화만으로 핸드오버 실패를 판정하지 않습니다.'};
 return target.investigationHint;
}

function buildCallObservationTargets({rows=[],calls=[]}){
 const targets=[],seen=new Set();
 // This is a selected detail sample, not all calls or a normal control group.
 const eligible=calls.filter(call=>typeof call.id==='string'&&call.id&&validDate(call.date)&&(n(call.qoe)!==null||quality(call.mos)!==null));
 const ranked=[...eligible].sort((a,b)=>(n(a.qoe)??Infinity)-(n(b.qoe)??Infinity)||(quality(a.mos)??6)-(quality(b.mos)??6)||a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
 const selected=[];
 // Include date/Cell diversity before filling with the lowest quality details.
 const strata=new Set();
 for(const call of ranked){const key=JSON.stringify([call.date,call.cell??'']);if(!strata.has(key)){strata.add(key);selected.push(call);seen.add(call.id);if(selected.length===6)break;}}
 for(const call of ranked){if(selected.length===6)break;if(!seen.has(call.id)){selected.push(call);seen.add(call.id);}}
 for(const call of selected){
  const metrics={qoe:n(call.qoe),mos:quality(call.mos),dropCalls:call.isDrop===true?1:0,rsrp:validRadio(call.rsrp),rsrq:n(call.rsrq),sinr:n(call.sinr),rtp:Object.fromEntries(RTP_FIELDS.map(key=>[key,n(call.rtp?.[key])]))};
  const radioPresent=metrics.rsrp!==null||metrics.rsrq!==null||metrics.sinr!==null;
  const rtpPresent=Object.values(metrics.rtp).some(value=>value!==null);
  const both=radioPresent&&rtpPresent;
  const hint={why:both?'같은 통화에 음성 품질·무선·방향별 RTP 관측이 연결되어 종료 여부와 별개로 저하 구간을 대조할 수 있습니다.':radioPresent?'같은 통화의 음성 품질과 무선 관측을 연결해 신호 세기·품질이 함께 변하는지 확인할 수 있습니다.':rtpPresent?'같은 통화의 음성 품질과 방향별 RTP 원본을 연결해 저하 구간을 확인할 수 있습니다.':'저품질로 선정된 실제 통화이며 원본 MOS·저장 QoE와 종료 여부를 분리해 재확인할 수 있습니다.',check:both?'연결 통화 원본에서 MOS·QoE 저하 구간과 RSRP·RSRQ·SINR 시각을 대조하고, 송수신 RTP 필드의 단위·방향·누적 또는 구간 정의를 먼저 확인합니다.':radioPresent?'연결 통화 원본에서 MOS·QoE 저하 시각과 RSRP·RSRQ·SINR 시각을 맞추고 동일 조건 정상 통화와 대조합니다.':rtpPresent?'연결 통화 원본에서 RTP 단위·송수신 방향·집계 구간을 확인한 뒤 MOS·QoE 저하 시각과 대조합니다.':'연결 통화 원본의 MOS·QoE·종료 여부를 확인하고 같은 통화에 연결된 무선·RTP 시각 자료를 확보합니다.'};
  targets.push({id:opaque('CALL',[call.id,call.date]),kind:'call-quality',title:call.date+' '+(typeof call.start==='string'&&/^\d{2}:\d{2}(?::\d{2})?$/.test(call.start)?call.start+' ':'')+'음성 품질 통화',observation:'동일 통화의 원본 MOS '+(metrics.mos??'미확보')+' · 저장 QoE '+(metrics.qoe??'미확보')+' · SIP Drop '+(metrics.dropCalls?'관측':'미관측')+'. '+(radioPresent?'연결된 무선 지표를 함께 확인합니다. ':'')+(rtpPresent?'송수신 RTP 원본 지표가 있습니다.':''),sourceDates:[call.date],band:null,earfcn:null,
   metrics:[{label:'원본 MOS',value:metrics.mos},{label:'저장 QoE',value:metrics.qoe},{label:'SIP Drop 통화 수',value:metrics.dropCalls,unit:'통화'},{label:'RSRP',value:metrics.rsrp,unit:'dBm'},{label:'RSRQ',value:metrics.rsrq,unit:'dB'},{label:'SINR',value:metrics.sinr,unit:'dB'},...RTP_FIELDS.map(label=>({label,value:metrics.rtp[label]}))],evidenceIds:[],sopIds:[],allowedCauseCategories:[],callIds:[call.id],mapPoints:[],investigationHint:hint,
   limitations:['후보의 대표 상세 표본 중 선정한 통화이며 지역 전체·정상 비교 통화가 아닙니다.','MOS·저장 QoE·SIP Drop은 서로 다른 관측입니다. Drop 미관측은 전체 SIP 성공을 뜻하지 않습니다.','무선·음성 품질의 저하 순간 시간 정합은 미검증입니다. RTP 단위·송수신 방향·집계 구간 정의는 미확인입니다.','관측 동반만으로 무선·간섭·전송·단말 결함을 확정하지 않습니다.'],_model:metrics});
 }
 const exactRows=[...new Map(rows.filter(row=>typeof row.id==='string'&&row.id&&validDate(row.date)).map(row=>[row.id,row])).values()];
 const cellGroups=new Map(),hourGroups=new Map();
 for(const row of exactRows){
  if(typeof row.cell==='string'&&row.cell.trim()){const group=cellGroups.get(row.cell)??[];group.push(row);cellGroups.set(row.cell,group);}
  if(n(row.start_second)!==null&&row.start_second>=0&&row.start_second<86400){const hour=Math.floor(row.start_second/3600),group=hourGroups.get(hour)??[];group.push(row);hourGroups.set(hour,group);}
 }
 const repeats=(kind,groups)=>[...groups].map(([key,members])=>({kind,key,members,dates:[...new Set(members.map(row=>row.date))].sort((a,b)=>a.localeCompare(b)),customers:new Set(members.map(row=>row.customer_id).filter(value=>typeof value==='string'&&value)).size})).filter(group=>group.members.length>=2&&(group.dates.length>=2||group.customers>=2)).sort((a,b)=>b.dates.length-a.dates.length||b.customers-a.customers||b.members.length-a.members.length||String(a.key).localeCompare(String(b.key)));
 // Preserve both spatial/Cell and repeated-hour views; each view is explicitly selected.
 const groupCandidates=[...repeats('cell',cellGroups).slice(0,2),...repeats('hour',hourGroups).slice(0,1)];
 for(const group of groupCandidates){
  const members=[...group.members].sort((a,b)=>a.date.localeCompare(b.date)||(a.start_second??0)-(b.start_second??0)||a.id.localeCompare(b.id));
  const metrics={grouping:group.kind,calls:members.length,customers:group.customers,observedDays:group.dates.length,dropCalls:members.filter(row=>row.is_drop===1).length,...(group.kind==='hour'?{hour:group.key}:{})};
  const title=group.kind==='cell'?'Cell '+group.key+' 반복 관측':String(group.key).padStart(2,'0')+'시 시작 통화 반복 관측';
  const hint={why:group.kind==='cell'?'동일 Cell로 기록된 후보 구성 통화가 여러 고객 또는 날짜에서 반복되어 개별 통화와 공통 관측을 대조할 수 있습니다.':'같은 시작 시간대의 후보 구성 통화가 여러 고객 또는 날짜에서 반복되어 해당 시간대의 원본 관측을 우선 대조할 수 있습니다.',check:group.kind==='cell'?'연결 통화를 날짜·고객·시각별로 나누어 무선·RTP·종료 원문이 같은지 비교합니다. 기록된 Cell을 책임 셀로 확정하지 않고 동일 조건 정상 통화 분모를 확보합니다.':'연결 통화의 실제 저하 시각과 관측 조건을 비교하고 해당 시간대 전체 평가 가능 통화·부하 기록을 확보합니다. 시작 시간대 집중만으로 혼잡을 판정하지 않습니다.'};
  targets.push({id:opaque('PATTERN',[group.kind,group.key,members.map(row=>row.id)]),kind:'call-pattern',title,observation:'후보 구성 '+metrics.calls+'통화 · '+metrics.customers+'고객 · '+metrics.observedDays+'일 관측 · SIP Drop '+metrics.dropCalls+'통화. 지역 전체 통화 분모가 아닌 저품질 후보 구성의 반복 관측입니다.',sourceDates:group.dates,band:null,earfcn:null,metrics:[{label:'구성 통화 수',value:metrics.calls,unit:'통화'},{label:'고객 수',value:metrics.customers,unit:'고객'},{label:'관측 날짜 수',value:metrics.observedDays,unit:'일'},{label:'Drop 통화 수',value:metrics.dropCalls,unit:'통화'},...(group.kind==='hour'?[{label:'통화 시작 시',value:group.key,unit:'시'}]:[])],evidenceIds:[],sopIds:[],allowedCauseCategories:[],callIds:members.slice(0,32).map(row=>row.id),mapPoints:[],investigationHint:hint,
   limitations:['저품질로 선정된 후보 구성 통화의 반복 관측입니다. 정상 지역 분모가 없어 지역 불량률·Cell 불량률·과부하를 판정하지 않습니다.','대표 Cell·통화 시작 시각은 저하 순간의 서빙 Cell·정확한 발생 시각을 보장하지 않습니다.',...(members.length>32?['원본 연결은 날짜·시각 순서의 최대 32통화이며 표시한 통화 수 집계는 해당 그룹 전체입니다.']:[])],_model:metrics});
 }
 return targets;
}
module.exports={buildCallObservationTargets,investigationHint};
