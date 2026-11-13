/* eslint-disable @typescript-eslint/no-require-imports -- Local candidate evidence builder. */
const {MDT_SUPPORT_WEIGHT}=require('../lib/analyst/candidate-coverage-points.mjs');
const indicators=[
 ['coverage','dl'],['coverage','ul'],['interference','overlap'],['mobility','frequencyChange'],['mobility','pollution'],
];
const limits=[-100,-105,-110];
const alias=target=>target.evidenceIds?.[0];
const round=value=>Math.round(value*100)/100;

function distribution(target,threshold){
 const metrics=target.metrics;
 const percent=metrics?.belowPct?.[threshold], weight=metrics?.metricSamples?.[threshold]??metrics?.samples;
 if(!Number.isFinite(percent)||percent<0||percent>100||!Number.isSafeInteger(weight)||weight<MDT_SUPPORT_WEIGHT)return;
 return {evidenceId:alias(target),percent,sourceWeight:weight};
}

function gridComparisons(input){
 const grid=input.analysisTargets.filter(target=>target.kind==='mdt-grid'&&target.sourceDates?.length===1&&target.band&&target.earfcn);
 const byId=new Map(grid.map(target=>[target.id,target]));
 const byAlias=new Map(grid.map(target=>[alias(target),target]));
 return (input.coveragePointTargetIds??[]).flatMap(id=>{
  const target=byId.get(id);
  if(!target)return [];
  const ref=alias(target),neighbors=new Map();
  for(const [a,b,,distance] of input.neighbourLinks??[]){
   if(distance!==25||(a!==ref&&b!==ref))continue;
   const peer=byAlias.get(a===ref?b:a);
   if(peer&&peer.id!==id&&peer.band===target.band&&peer.earfcn===target.earfcn&&peer.sourceDates[0]===target.sourceDates[0]){
    neighbors.set(alias(peer),peer);
   }
  }
  // Direct source links are the four cardinal 25m edges. Keep equal/higher
  // neighbour tails as well as lower ones so Qwen can challenge the contrast.
  for(const thresholdDbm of limits){
   const survey=distribution(target,thresholdDbm);
   if(!survey)continue;
   const peers=[...neighbors.values()].map(peer=>distribution(peer,thresholdDbm)).filter(Boolean);
   if(!peers.length)continue;
   const neighborMeanPct=Math.round(peers.reduce((sum,peer)=>sum+Math.round(peer.percent*100),0)/peers.length)/100;
   return [{category:'coverage',evidenceIds:[ref,...peers.map(peer=>peer.evidenceId)],date:target.sourceDates[0],
    band:target.band,earfcn:target.earfcn,thresholdDbm,distanceM:25,survey,peers,neighborMeanPct,gapPp:round(survey.percent-neighborMeanPct)}];
  }
  return [];
 });
}

function buildCandidateComparisonContext(input,findings,calls){
 const targets=input.analysisTargets;
 // Raw call IDs are join keys only. No raw call identifiers or neighbor-cell
 // identities are serialized in this context.
 const localById=new Map(findings.analysisTargets.map(t=>[t.id,t]));
 const callsOf=rows=>new Set(rows.flatMap(t=>localById.get(t.id)?.callIds??[]));
 const criteria=targets.filter(t=>t.kind==='call-criteria');
 const radioCriteriaCoverage={};
 const observations=[];
 function add(category,indicator,matched,assessed){
  const callIds=callsOf(matched);
  if(!callIds.size)return;
  const refs=[...new Set(matched.map(alias))];
  const assessedIds=callsOf(assessed);
  observations.push({category,indicator,callIds,assessedIds,matchedCalls:callIds.size,assessableCalls:assessedIds.size,
   evidenceIds:refs.slice(0,8),citedEvidenceScope:refs.length>8?'examples':'all-matched-targets'});
 }
 for(const [category,indicator] of indicators){
  const status=t=>t.metrics.criteria?.[indicator]?.status;
  const assessed=criteria.filter(t=>['matched','not-matched'].includes(status(t)));
  const matched=assessed.filter(t=>status(t)==='matched');
  radioCriteriaCoverage[indicator]={assessableCalls:callsOf(assessed).size,matchedCalls:callsOf(matched).size};
  add(category,indicator,matched,assessed);
 }
 const groups=targets.filter(t=>t.kind==='termination-group');
 const interrupted=groups.filter(t=>Object.values(t.metrics?.rawCodes??{}).some(code=>
  typeof code==='string'&&/RTP timeout|Rx_RTP_middle_Loss/iu.test(code)));
 add('equipment','rtpTermination',interrupted,groups);

 const callOverlap=[];
 for(const [index,first] of observations.entries())for(const second of observations.slice(index+1)){
  const sameCalls=[...first.callIds].filter(id=>second.callIds.has(id)).length;
  const assessableForBoth=[...first.assessedIds].filter(id=>second.assessedIds.has(id)).length;
  callOverlap.push({indicators:[first.indicator,second.indicator],sameCalls,assessableForBoth});
 }
 const reports=calls.flatMap(call=>call.radioSeries??[]);
 const signal=v=>Number.isFinite(v)&&v<0&&v>=-200;
 const pci=v=>Number.isInteger(v)&&v>=0;
 const paired=reports.filter(r=>pci(r.servingPci)&&signal(r.rsrp)&&r.neighbors?.some(n=>pci(n.pci)&&n.pci!==r.servingPci&&signal(n.rsrp)));
 return {schemaVersion:'candidate-comparison-input-v1',
  scope:{candidateCalls:input.summary.totalCalls,sampledCalls:calls.length,sampledRadioReports:reports.length,
   reportsWithServingAndNeighborRsrp:paired.length,gridToCallImpairmentLink:'not-established',
   sourceMeaning:'격자 비교는 같은 날짜·대역·EARFCN의 25m 인접 POT 비율의 산술평균입니다. 통화 당시 위치·서빙 셀 입증은 아닙니다. 수치는 원인 확률이 아닙니다. 통화 기준 분모는 해당 기준을 평가할 수 있는 통화, RTP 종료 분모는 제공된 종료 집단의 통화입니다. sameCalls는 두 관측 모두에 해당한 고유 통화 수, assessableForBoth는 두 종류의 자료를 모두 평가할 수 있던 통화 수입니다. 분모가 0이면 공동 관측을 판단할 수 없습니다. 같은 통화라도 두 현상의 선후와 인과는 미확인입니다.'},
  gridComparisons:gridComparisons(input),radioCriteriaCoverage,
  callObservations:observations.map(({callIds:_callIds,assessedIds:_assessedIds,...row})=>row),callOverlap};
}
module.exports={buildCandidateComparisonContext};
