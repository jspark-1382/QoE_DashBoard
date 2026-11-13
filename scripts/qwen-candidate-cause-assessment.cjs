/* eslint-disable @typescript-eslint/no-require-imports -- Source-owned investigations are independent of Qwen. */
const CATEGORIES=['coverage','capacity','interference','mobility','equipment'];
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const interrupted=target=>Object.values(target?.metrics?.rawCodes??{}).some(value=>typeof value==='string'&&/RTP timeout|Rx_RTP_middle_Loss/iu.test(value));
const matched=(criteria,key)=>criteria?.[key]?.status==='matched';
function bandName(earfcn,band){
 const known={'3743':'900 MHz','1550':'1.8 GHz','1694':'1.8 GHz','475':'2.1 GHz'};
 return known[earfcn]??({'900':'900 MHz','1.8광':'1.8 GHz','1.8협':'1.8 GHz','2.1':'2.1 GHz'}[band])??(band||'');
}
const timeLabel=value=>String(value??'').match(/(?:T|^)(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/u)?.[1]??'';
const sourceLabel=call=>call?[call.date,call.start].filter(Boolean).join(' '):'';
const measureRange=(events,key,unit)=>{
 const values=events.map(row=>row[key]).filter(finite);
 return values.length?Math.min(...values)+'~'+Math.max(...values)+' '+unit:null;
};
function buildCauseAssessments(targets=[],modelTargets=[],options={}){
 const models=new Map(modelTargets.map(target=>[target.id,target])),byId=new Map(targets.map(target=>[target.id,target]));
 const calls=new Map((options.calls??[]).map(call=>[call.id,call]));
 const fieldPoints=options.coveragePoints?.points,cohort=options.capacityComparison;
 const eligible=category=>targets.filter(target=>target.allowedCauseCategories?.includes(category));
 const coverage=eligible('coverage').filter(t=>matched(t.criteria,'dl')||matched(t.criteria,'ul')||models.get(t.id)?.metrics?.belowPct?.['-100']>0||models.get(t.id)?.metrics?.minRsrp<=-100);
 const grids=fieldPoints ? fieldPoints.map(point=>byId.get(point.targetId)).filter(Boolean) : coverage.filter(t=>t.kind==='mdt-grid').slice(0,5);
 const observedCalls=coverage.filter(t=>t.kind!=='mdt-grid').slice(0,5);
 const coverageTargets=[...grids,...observedCalls];
 const overlap=eligible('interference').filter(t=>matched(t.criteria,'overlap'));
 const mobility=eligible('mobility').filter(t=>matched(t.criteria,'frequencyChange')||matched(t.criteria,'pollution')).sort((a,b)=>Number(matched(b.criteria,'frequencyChange'))-Number(matched(a.criteria,'frequencyChange')));
 const equipment=eligible('equipment').filter(t=>interrupted(models.get(t.id)));
 const records=[];
 const add=(category,headline,selected,status,reason,nextCheck,missingEvidence)=>{
  const linked=[...new Map(selected.map(t=>[t.id,t])).values()];
  records.push({category,headline,status,reason,nextCheck,missingEvidence,targetIds:linked.map(t=>t.id),evidenceIds:[...new Set(linked.flatMap(t=>t.evidenceIds??[]))]});
 };
 const bands=[...new Set(grids.map(grid=>bandName(grid.earfcn,grid.band)).filter(Boolean))];
 const dlGrids=grids.filter(t=>matched(t.criteria,'dl')||models.get(t.id)?.metrics?.belowPct?.['-100']>0);
 const ulGrids=grids.filter(t=>matched(t.criteria,'ul'));
 const indicators=[...(dlGrids.length?['DL RSRP 분포']:[]),...(ulGrids.length?['UL PHR 평균']:[])].join('·')||'RSRP 분포';
 const dlCalls=observedCalls.filter(t=>matched(t.criteria,'dl')||models.get(t.id)?.metrics?.minRsrp<=-100);
 const ulCalls=observedCalls.filter(t=>matched(t.criteria,'ul'));
 const callIndicators=[...(dlCalls.length?['DL RSRP']:[]),...(ulCalls.length?['UL PHR']:[])].join('·');
 const headline=grids.length?[bands.join('·'),indicators+' 조사'].filter(Boolean).join(' '):observedCalls.length?'통화 '+callIndicators+' 조사':'커버리지 측정 자료 필요';
 const reason=fieldPoints?.length?'배경 MDT에서 조사할 서로 다른 POT '+fieldPoints.length+'곳을 선정했습니다. '+fieldPoints.slice(0,2).map(point=>point.pot+' ('+point.sourceDate+', EARFCN '+point.earfcn+') '+point.reason).join('. ')+'.'
  :grids.length?'배경 격자의 '+indicators+'에서 조사할 관측을 확인했습니다.'
  :observedCalls.length?'선택한 통화 원본에서 '+[...(dlCalls.length?['DL RSRP ≤ −100 dBm']:[]),...(ulCalls.length?['UL PHR ≤ 3']:[])].join(', ')+' 관측을 확인했습니다.':'확보한 측정에서 DL 또는 UL 조사 기준을 뒷받침하는 근거가 없습니다.';
 add('coverage',headline,coverageTargets,coverageTargets.length?'criteria-met':'insufficient',reason,
  grids.length?'각 조사 POT에서 해당 주파수의 서빙·이웃 셀 신호와 음성 품질을 동시 측정하고 같은 주파수의 인접 기록과 대조합니다.':'해당 통화의 RSRP·PHR 시각과 음성 시계열, 송신전력·경로손실을 대조합니다.',
  ['통화 당시 음성·무선 동시 측정과 동일 조건의 정상 비교','격자 측정 수와 지표별 유효 분모 구분, PHR 원본 단위 확인']);
 add('capacity',cohort?.totalCalls?'동시간대 비교 통화와 셀 부하 대조':'셀 자원 자료 필요',[],'insufficient',(cohort?.strata?('같은 날짜·시작 시간대·종료 셀에서 후보를 제외한 비교 통화 '+cohort.totalCalls+'건 중 '+cohort.evaluatedCalls+'건에 QoE 점수가 있고 '+cohort.poorCalls+'건이 3점 미만입니다. '+(finite(cohort.normalRadioCalls)?'QoE 3 이상이며 무선 관측이 있는 비교 통화는 '+cohort.normalRadioCalls+'건입니다. ':'')):'')+'실제 저하 시각의 서빙 셀 부하 기록이 없어 용량 부족을 판단할 수 없습니다.',
  '실제 저하 시각의 서빙 셀 PRB 사용률·활성 사용자·자원 할당 실패를 같은 시간대의 정상 통화와 대조합니다.',
  ['서빙 셀·저하 시각별 PRB 사용률, 활성 사용자 수와 전체 트래픽','자원 할당 실패 및 정상 시간대 자료']);
 const overlapInfo=overlap[0]?.criteria.overlap;
 let overlapReason='동일 EARFCN에서 30초 이내에 서빙 PCI 또는 Cell-ID가 A→B→A로 돌아온 연속 관측을 확인하지 못했습니다.';
 let overlapBand='';
 if(overlapInfo){
  const trace=overlapInfo.window.events,reports=overlapInfo.a3Reports??[];
  const proof=reports.length>=3&&reports.every(row=>row.servingPci!==null)&&reports[0].servingPci===reports[2].servingPci&&reports[0].servingPci!==reports[1].servingPci?reports:trace;
  const freq=trace[0].earfcn;overlapBand=trace[0].technology==='NR'?'':bandName(freq);
  const identityKey=proof.every(row=>row.servingPci!==null)&&proof[0].servingPci!==proof[1].servingPci&&proof[0].servingPci===proof[2].servingPci?'servingPci':'cellId';
  overlapReason=sourceLabel(calls.get(overlap[0].callIds?.[0]))+' 통화 '+timeLabel(proof[0].at)+'~'+timeLabel(proof.at(-1).at)+'에 '+(proof===reports?'A3 보고 '+proof.length+'개에서 ':'')+'EARFCN '+freq+', '+(identityKey==='servingPci'?'서빙 PCI ':'Cell-ID ')+proof.map(row=>row[identityKey]).join('→')+' 순서를 관측했습니다.';
  const metrics=[['rsrp','RSRP','dBm'],['rsrq','RSRQ','dB']].map(([key,label,unit])=>{const range=measureRange(proof,key,unit);return range?label+' '+range:null;}).filter(Boolean);
  if(metrics.length)overlapReason+=' 해당 관측의 '+metrics.join(', ')+'입니다.';
 }
 add('interference',overlapInfo?(overlapBand?overlapBand+' ':'')+'동일 주파수 서빙 셀 복귀':'동일 주파수 서빙 셀 복귀 근거 필요',overlap.slice(0,5),overlap.length?'possible':'insufficient',overlapReason,
  '표시 시각·주파수의 서빙·이웃 셀 신호를 현장에서 동시에 측정하고 이동 경로·셀 경계·부하의 영향을 구분합니다.',
  ['동일 시각 서빙·이웃 셀 수신전력과 SINR, 이동 경로와 부하 자료','A3 보고와 셀 복귀만으로 간섭원·핸드오버 결과를 확정할 수 없습니다.']);
 const first=mobility[0],change=first?.criteria.frequencyChange?.window,mc=calls.get(first?.callIds?.[0]);
 let mobilityHeadline='셀·주파수 전환 검토',mobilityReason='확보된 통화에서 연속 EARFCN 변경 또는 30초 내 서빙 식별자 3회 이상 변경을 확인하지 못했습니다.';
 if(change){
  const [a,b]=change.events,fromBand=a.technology==='NR'?'':bandName(a.earfcn),toBand=b.technology==='NR'?'':bandName(b.earfcn);
  mobilityHeadline=(fromBand&&fromBand===toBand?fromBand+' 내 ':fromBand&&toBand?fromBand+'→'+toBand+' ':'')+'주파수 전환 검토';
  mobilityReason=sourceLabel(mc)+' 통화 '+timeLabel(a.at)+'~'+timeLabel(b.at)+'에 EARFCN '+a.earfcn+'→'+b.earfcn+(a.servingPci!=null&&b.servingPci!=null?', PCI '+a.servingPci+'→'+b.servingPci:'')+(finite(a.rsrp)&&finite(b.rsrp)?', RSRP '+a.rsrp+'→'+b.rsrp+' dBm':'')+'을 관측했습니다.'+(finite(mc?.mos)?' 통화 전체 MOS '+Number(mc.mos.toFixed(2))+'이며 저하 시각은 미확인입니다.':'');
 }else if(first){
  const w=first.criteria.pollution.window;
  mobilityHeadline='서빙 셀 반복 전환 조사';
  mobilityReason=sourceLabel(mc)+' 통화 '+timeLabel(w.startedAt)+'~'+timeLabel(w.endedAt)+'에 실제 서빙 PCI 또는 Cell-ID가 '+w.changes+'회 바뀌었습니다.';
 }
 add('mobility',mobilityHeadline,mobility.slice(0,5),mobility.length?'criteria-met':'insufficient',mobilityReason,
  '전환 직전·직후의 RRC 요청·명령·완료·실패 기록과 같은 통화의 음성 시계열을 대조합니다.',
  ['RRC 전환 절차 결과','통화 전체 MOS와 별도로 시각이 확인된 음성 품질 시계열']);
 const eq=equipment[0],eqCalls=(eq?.callIds??[]).map(id=>calls.get(id)).filter(Boolean).slice(0,3);
 const codes=Object.values(models.get(eq?.id)?.metrics?.rawCodes??{});
 const equipmentTitle=eq?[...(codes.some(code=>/RTP timeout/iu.test(code))?['RTP 타임아웃']:[]),
  ...(codes.some(code=>/Rx_RTP_middle_Loss/iu.test(code))?['수신 중간 손실']:[])].join('·')+' 종료 기록 확인':'RTP 중단 종료 원문 필요';
 add('equipment',equipmentTitle,equipment.slice(0,5),eq?'possible':'insufficient',eq?
  [eq.observation,...eqCalls.map(call=>sourceLabel(call)+(finite(call.rtp?.rxLossCount)?' 수신 손실 카운트 '+call.rtp.rxLossCount:''))].join(' · '):
  '후보의 Drop 통화에 연결된 RTP timeout 또는 수신 중간 손실 종료 원문을 확인하지 못했습니다.',
  '해당 통화의 단말·무선·전송·IMS 기록에서 양방향 RTP가 먼저 멎은 시각과 최초 BYE 발신 주체를 대조합니다.',
  ['같은 통화의 단말·무선·IMS·전송 구간별 동기화 로그','FC 벤더 코드 공식 해석 및 최초 중단 방향']);
 return records;
}
/** Source-authorized links only. Qwen must still write and validate its own
 * hypothesis, limitations and investigations; this is not a fallback report. */
function buildSourceHypothesisCandidates(modelInput){
 const targets=modelInput.analysisTargets??[],templates=modelInput.sop?.templates??[];
 const allowed=(target,category)=>(target.allowedCauseCategories??modelInput.targetRules?.[target.kind]?.allowedCauseCategories??[]).includes(category);
 const procedures=(target,category)=>(target.sopIds??modelInput.targetRules?.[target.kind]?.sopByCategory?.[category]??[]).filter(id=>templates.some(step=>step.id===id&&step.causeCategory===category));
 const matched=(target,key)=>target.metrics?.criteria?.[key]?.status==='matched';
 const dl=target=>finite(target.metrics?.belowPct?.['-100'])&&target.metrics.belowPct['-100']>0;
 const result=[],extraCoverage=[];
 function sourceOption(category, selected) {
  const evidenceIds=[...new Set(selected.flatMap(target=>target.evidenceIds))];
  return {category,assessment:'possible',sourceKind:selected[0].kind,
   targetIds:selected.map(target=>modelInput.targetIdPolicy==='evidence-id-alias-v1'?target.evidenceIds[0]:target.id),
   evidenceIds,sopIds:[...new Set(selected.flatMap(target=>procedures(target,category)))],
   criteriaByEvidenceId:Object.fromEntries(selected.map(target=>[target.evidenceIds[0],Object.fromEntries(
    ['dl','ul','pollution','overlap','frequencyChange'].map(key=>[key+'Status',target.metrics?.criteria?.[key]?.status??'insufficient']))]))};
 }
 for(const category of CATEGORIES){
  const eligible=targets.filter(target=>allowed(target,category)&&procedures(target,category).length);
  let selected=[];
  if(category==='coverage'){
   const shortlist=modelInput.coveragePointTargetIds;
   if(shortlist){
    const byId=new Map(eligible.filter(t=>t.kind==='mdt-grid'&&(dl(t)||matched(t,'ul'))).map(t=>[t.id,t]));
    const points=shortlist.map(id=>byId.get(id)).filter(Boolean);
    if(points.length)selected=[points[0]];
    extraCoverage.push(...points.slice(1).map(point=>sourceOption(category,[point])));
   }
   const pair=!shortlist&&modelInput.coveragePairTargetIds?.map(id=>eligible.find(t=>t.id===id));
   if(pair?.length===2&&pair.every(t=>t?.kind==='mdt-grid')&&pair.some(dl))selected=pair;
   if(!shortlist&&!selected.length){
    const grids=eligible.filter(target=>target.kind==='mdt-grid'),ids=new Set(grids.map(target=>target.id));
    const group=(modelInput.observationGroups??[]).find(row=>row.targetIds.length<=5&&row.targetIds.every(id=>ids.has(id))&&row.targetIds.some(id=>{const target=grids.find(t=>t.id===id);return dl(target);}));
    selected=group?group.targetIds.map(id=>grids.find(target=>target.id===id)):grids.filter(target=>dl(target)).slice(0,5);
   }
   if(!selected.length)selected=eligible.filter(target=>target.kind==='call-criteria'&&(matched(target,'dl')||matched(target,'ul'))).slice(0,1);
   if(!shortlist&&!selected.length)selected=eligible.filter(target=>target.kind==='mdt-grid'&&matched(target,'ul')).slice(0,1);
   if(!selected.length)selected=eligible.filter(target=>target.kind==='call-radio'&&finite(target.metrics?.minRsrp)&&target.metrics.minRsrp<=-100).slice(0,1);
  }else if(category==='equipment')selected=eligible.filter(target=>target.kind==='termination-group'&&interrupted(target)).slice(0,1);
  else if(category==='interference')selected=eligible.filter(target=>target.kind==='call-criteria'&&matched(target,'overlap')).slice(0,1);
  else if(category==='mobility'){
   selected=eligible.filter(target=>target.kind==='call-criteria'&&matched(target,'frequencyChange')).slice(0,1);
   if(!selected.length)selected=eligible.filter(target=>target.kind==='call-criteria'&&matched(target,'pollution')).slice(0,1);
  }
  if(!selected.length)continue;
  result.push(sourceOption(category,selected));
 }
 return [...result,...extraCoverage];
}
function buildSourceInvestigationCandidates(modelInput){
 const targets=modelInput.analysisTargets??[],rows=[];
 const add=(selected,comparisonScope)=>{if(!selected.length)return;const evidenceIds=[...new Set(selected.flatMap(target=>target.evidenceIds))];rows.push({kind:selected[0].kind,targetIds:selected.map(target=>modelInput.targetIdPolicy==='evidence-id-alias-v1'?target.evidenceIds[0]:target.id),evidenceIds,...(comparisonScope?{comparisonScope}:{})});};
 const observed=targets.filter(t=>t.kind==='call-criteria'&&Object.values(t.metrics?.criteria??{}).some(value=>value.status==='matched'));
 const call=observed.find(t=>t.metrics.criteria.overlap?.status==='matched')??observed.find(t=>t.metrics.criteria.frequencyChange?.status==='matched')??observed[0];
 const gridIds=new Set(targets.filter(target=>target.kind==='mdt-grid').map(target=>target.id));
 const area=(modelInput.observationGroups??[]).find(group=>group.targetIds.length<=5&&group.targetIds.every(id=>gridIds.has(id)));
 const pair=modelInput.coveragePairTargetIds?.map(id=>targets.find(t=>t.id===id));
 const sameCarrier=[];
 if(modelInput.coveragePointTargetIds){
  const byId=new Map(targets.filter(t=>t.kind==='mdt-grid').map(t=>[t.id,t]));
  const groups=new Map();
  for(const id of modelInput.coveragePointTargetIds){
   const target=byId.get(id);
   if(!target)continue;
   const key=JSON.stringify([target.sourceDates,target.band,target.earfcn]);
   if(!groups.has(key))groups.set(key,[]);
   groups.get(key).push(target);
  }
  // Each location is independently measured. Matching frequency does not imply adjacency.
  for(const group of groups.values())for(let i=0;i<group.length;i+=5)sameCarrier.push(group.slice(i,i+5));
  if(sameCarrier.length)add(sameCarrier.shift(),'independent-points-same-carrier');
 }else if(pair?.length===2&&pair.every(t=>t?.kind==='mdt-grid'))add(pair);
 else if(area)add(area.targetIds.map(id=>targets.find(target=>target.id===id)));
 else {const grid=targets.find(target=>target.kind==='mdt-grid');if(grid)add(targets.filter(target=>target.kind==='mdt-grid'&&target.band===grid.band&&target.earfcn===grid.earfcn&&JSON.stringify(target.sourceDates)===JSON.stringify(grid.sourceDates)).slice(0,5));}
 if(call)add([call]);
 const termination=targets.filter(target=>target.kind==='termination-group'&&target.allowedCauseCategories?.includes('equipment')).slice(0,1);
 add(termination.length?termination:targets.filter(target=>target.kind==='call-quality').slice(0,3));
 for(const group of sameCarrier)add(group,'independent-points-same-carrier');
 return rows;
}
module.exports={buildCauseAssessments,buildSourceHypothesisCandidates,buildSourceInvestigationCandidates};
