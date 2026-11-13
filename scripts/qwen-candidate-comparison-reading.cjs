const callLabels={dl:'DL 약전계',ul:'낮은 UL PHR',overlap:'동일 주파수 셀 복귀',frequencyChange:'주파수 전환',pollution:'서빙 셀 반복 변경',rtpTermination:'RTP 종료'};
const bandLabels={'900':'900 MHz','2.1':'2.1 GHz','1.8협':'1.8 GHz 협대역','1.8광':'1.8 GHz 광대역'};
const categories=new Set(['coverage','capacity','interference','mobility','equipment']);
const sameSide=(a,b)=>a&&b?a.category===b.category&&Array.isArray(a.evidenceIds)&&a.evidenceIds.length===b.evidenceIds.length&&b.evidenceIds.every(id=>a.evidenceIds.includes(id)):a===b;

function readingFor(side,context){
 const matches=row=>row.category===side.category&&side.evidenceIds.every(id=>row.evidenceIds.includes(id));
 const grid=context.gridComparisons.find(row=>row.evidenceIds.length===side.evidenceIds.length&&matches(row));
 if(grid){
  if(![grid.survey?.percent,grid.neighborMeanPct].every(v=>Number.isFinite(v)&&v>=0&&v<=100)||![-100,-105,-110].includes(grid.thresholdDbm)||grid.distanceM!==25||!grid.peers?.length)return;
  const band=bandLabels[grid.band]??'같은 대역';
  return {text:band+' 약전계('+grid.thresholdDbm+' dBm 이하) '+grid.survey.percent.toFixed(2)+'% · 25m 인접 '+grid.peers.length+'곳 '+(grid.peers.length>1?'평균 ':'')+grid.neighborMeanPct.toFixed(2)+'%'};
 }
 const calls=context.callObservations.filter(matches);
 // The same cited call can meet several criteria within one category. A
 // category and partial references alone cannot distinguish those signals.
 if(calls.length!==1)return;
 const row=calls[0],label=callLabels[row.indicator];
 if(!label||!Number.isSafeInteger(row.matchedCalls)||!Number.isSafeInteger(row.assessableCalls)||row.matchedCalls<1||row.matchedCalls>row.assessableCalls)return;
 const basis=row.indicator==='rtpTermination'?'종료 집단 통화':'평가 가능 통화';
 return {indicator:row.indicator,text:label+' '+row.matchedCalls+'/'+row.assessableCalls+'건('+basis+')'};
}
function comparisonReading(card,context,known,stored){
 if(card?.schemaVersion!=='cause-comparison-v1')return;
 const sides=[card.primary,...(card.alternative?[card.alternative]:[])];
 if(sides.some(s=>!categories.has(s?.category)||!Array.isArray(s.evidenceIds)||s.evidenceIds.length<1||s.evidenceIds.length>12||!s.evidenceIds.every(id=>known.has(id))))return;
 if(!context)return stored&&sameSide(stored.primary,card.primary)&&sameSide(stored.alternative,card.alternative)?stored:undefined;
 if(context.schemaVersion!=='candidate-comparison-input-v1')return;
 const readings=sides.map(side=>readingFor(side,context));
 if(readings.some(row=>!row))return;
 const parts=readings.map(row=>row.text);
 if(readings.length===2&&readings.every(row=>row.indicator)){
  const joint=context.callOverlap.find(row=>readings.every(reading=>row.indicators.includes(reading.indicator)));
  if(joint&&Number.isSafeInteger(joint.sameCalls)&&Number.isSafeInteger(joint.assessableForBoth)&&joint.sameCalls>=0&&joint.sameCalls<=joint.assessableForBoth){
   parts.push(joint.assessableForBoth?'같은 통화에서 두 관측 '+joint.sameCalls+'/'+joint.assessableForBoth+'건':'두 관측을 함께 평가할 통화 미확보');
  }
 }
 const copy=({category,evidenceIds})=>({category,evidenceIds:[...evidenceIds]});
 return {primary:copy(card.primary),alternative:card.alternative?copy(card.alternative):null,text:parts.join(' · ')};
}
module.exports={comparisonReading};
