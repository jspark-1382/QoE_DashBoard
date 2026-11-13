/* eslint-disable @typescript-eslint/no-require-imports -- Server-only Qwen report validation. */
const {analysisError}=require('./qwen-analysis-config.cjs');

const SCHEMA='cause-comparison-v1';
const INPUT='candidate-comparison-input-v1';
const comparisonInstructions=[
 'comparison은 이 후보를 담당한 엔지니어에게 제공할 짧은 한국어 비교 해석입니다. comparisonContext의 gridComparisons와 callObservations는 실제 관측 후보이며 순위가 아닙니다.',
 '형식: "comparison":{"schemaVersion":"cause-comparison-v1","assessment":"prioritize 또는 unresolved","primary":{"category":"원인 코드","evidenceIds":["T코드"]},"alternative":{"category":"다른 원인 코드","evidenceIds":["T코드"]},"interpretation":"두 설명의 판별력 차이","limitation":"반대 단서 또는 판단할 수 없는 점","nextCheck":"두 설명을 가를 관측과 그 결과의 의미"}.',
 'primary와 alternative 각각은 comparisonContext의 실제 한 행에서 category와 evidenceIds를 복사합니다. gridComparisons는 조사 지점과 비교 지점의 evidenceIds 전체, callObservations는 같은 행에서 실제로 인용한 evidenceIds 한 개 이상을 씁니다. 원인 코드는 서로 달라야 합니다. 두 원인 이상이면 둘을 고르고, 한 원인만 있으면 primary에 놓고 alternative:null, assessment:"unresolved"로 남깁니다. 두 목록 모두 비었으면 comparison:null입니다.',
 'interpretation은 한두 문장입니다. 같은 조건의 주변 대비, 같은 통화에서 함께 관측되는 현상, 서로 다른 측정일, 혹은 반례 중 실제 자료에 있는 차이를 골라 어느 설명이 어떤 현상에 더 잘 맞는지 자신의 말로 비교하세요. 관측 두 개를 단순 나열하거나 규칙을 되풀이하지 마세요. 서로 다른 현상을 설명하거나 대안 간 우열을 가릴 수 없으면 unresolved를 사용하고 관련성의 차이를 설명합니다.',
 'limitation에는 선택을 약화하는 구체적인 관측 또는 빠진 연결을 한 문장으로 적습니다. nextCheck에는 어떤 원본을 확인해서 어떤 결과가 나오면 어느 쪽을 우선할지 한 문장으로 씁니다. 날짜가 다른 MDT와 통화를 같은 위치·시점의 측정으로 잇지 마세요. 격자 비교와 실제 서빙·이웃 셀 신호 비교를 구분하세요.',
 '대안 선택은 실제로 구분 가능한 결과를 기준으로 합니다. 같은 통화에서 DL·UL·셀 전환·RTP 중단이 함께 나타나는지 판단할 수 있으면 callOverlap의 sameCalls와 assessableForBoth를 함께 보세요. 미측정 통화는 반례가 아닙니다. 공동 평가가 가능한 통화에서 겹치지 않는 관측, 대역별 인접 비율 차이, 공간 관측과 종료 사건이 설명하는 서로 다른 범위 중 하나를 해석에 명시하세요. 하나의 원인이 두 현상을 모두 설명하는지 묻고, 자료가 구분되지 않으면 판단을 보류하세요.',
 'nextCheck는 “어느 기록에서 무엇이 재현되면 어느 가설을 우선하고, 다른 결과이면 어디를 볼지”를 답합니다. 단순히 현장 측정이나 시간 정합을 하겠다는 문장은 불충분합니다.',
 '원인 간 비교는 comparison에만 작성합니다. investigations는 각 항목마다 sourceInvestigationCandidates의 **한 행**에서 대상/근거를 그대로 복사하고 해당 종류의 관측과 조사만 적습니다. 통화와 MDT 두 행을 합치면 전체 보고서가 저장되지 않습니다. hypotheses도 sourceHypothesisCandidates의 **한 행**씩만 사용합니다. 원인 가설이 하나여도 됩니다. SOP reason에는 장비 이상 같은 진단 대신 측정 원문이 보여주는 현상과 그 점검이 필요한 이유만 적습니다.',
 '세 본문에는 수치·비율·대역 숫자·시각·원본 식별자·T코드·CALL_REF·링크를 적지 마세요. 수치와 대상은 화면에 연결됩니다. 단정적 진단이나 조치 지시를 쓰지 마세요.',
].join('\n');

const fields=['interpretation','limitation','nextCheck'];
const witnesses={
 coverage:/RSRP|PHR|약전|약한\s*신호|신호\s*약화|커버리지|음영|저신호|하향|상향|수신\s*전력|전력\s*여유|격자/iu,
 interference:/간섭|중첩|복귀|되돌|이웃\s*셀|왕복|핑퐁|ping.?pong/iu,
 mobility:/주파수|대역|전환|전이|이동성|EARFCN|핸드오버|서빙\s*셀|PCI|셀\s*변경/iu,
 equipment:/RTP|BYE|종료|수신\s*중단|전송|중단|단말|타임아웃/iu,
 capacity:/자원|용량|트래픽|부하|PRB/iu,
};
const hasKeys=(obj,keys)=>obj && typeof obj==='object' && !Array.isArray(obj) &&
 Object.keys(obj).length===keys.length && keys.every(key=>Object.hasOwn(obj,key));
const failure=()=>analysisError('QWEN_INVALID_COMPARISON','Qwen의 가설 비교를 이번 후보의 측정 근거에 연결하지 못했습니다.');

function validateComparison(card,evidence,{onExpansion}={}) {
 const context=evidence.modelInput.comparisonContext;
 if(context?.schemaVersion!==INPUT)throw failure();
 const rows=[...context.gridComparisons,...context.callObservations];
 if(!rows.length && card===null)return null;
 if(!hasKeys(card,['schemaVersion','assessment','primary','alternative',...fields]) || card.schemaVersion!==SCHEMA ||
    !['prioritize','unresolved'].includes(card.assessment))throw failure();
 const hasAlternative=new Set(rows.map(row=>row.category)).size>1;
 if(hasAlternative ? !card.alternative||card.alternative.category===card.primary?.category :
    card.alternative!==null||card.assessment!=='unresolved')throw failure();
 const transmitted=new Map(evidence.modelInput.analysisTargets.map(target=>[target.id,new Set(target.evidenceIds)]));
 const facts=new Set(evidence.facts.map(fact=>fact.id));
 const sentFacts=new Set(evidence.modelInput.facts.map(fact=>fact.id));
 const normalized={...card};
 const bands=new Set();
 const sides=hasAlternative?['primary','alternative']:['primary'];
 for(const key of sides){
  const side=card[key];
  if(!hasKeys(side,['category','evidenceIds'])||!Object.hasOwn(witnesses,side.category))throw failure();
  let ids=side.evidenceIds;
  if(!Array.isArray(ids)||ids.length<1||ids.length>12||new Set(ids).size!==ids.length)throw failure();
  // A unique primary survey ID identifies an entire server-computed contrast,
  // including its measured peers. Never complete peer-only or mixed-row refs.
  if(ids.length===1){
   const focal=context.gridComparisons.filter(row=>row.category===side.category&&row.survey?.evidenceId===ids[0]&&row.evidenceIds[0]===ids[0]);
   if(focal.length===1&&focal[0].evidenceIds.length>1&&!context.callObservations.some(row=>row.evidenceIds.includes(ids[0]))){
    ids=[...focal[0].evidenceIds];
    normalized[key]={...side,evidenceIds:ids};
    onExpansion?.({side:key,surveyEvidenceId:ids[0],addedEvidenceIds:ids.slice(1)});
   }
  }
  if(!ids.every(id=>typeof id==='string'&&/^T\d+$/.test(id)&&facts.has(id)&&sentFacts.has(id)&&
    evidence.analysisTargets.some(t=>t.allowedCauseCategories?.includes(side.category)&&t.evidenceIds.includes(id)&&transmitted.get(t.id)?.has(id))))throw failure();
  const grid=context.gridComparisons.find(row=>row.category===side.category&&row.evidenceIds.length===ids.length&&ids.every(id=>row.evidenceIds.includes(id)));
  const call=context.callObservations.some(row=>row.category===side.category&&ids.every(id=>row.evidenceIds.includes(id)));
  if(!grid&&!call)throw failure();
  if(grid?.band)bands.add(grid.band);
 }
 const bandIdentity=text=>text.replace(/(?<![\d.])(900\s*MHz|1\.8\s*GHz|2\.1\s*GHz)/giu,match=>{
  const value=match.replace(/\s|MHz|GHz/giu,'');
  return [...bands].some(band=>band===value||value==='1.8'&&['1.8광','1.8협'].includes(band))?'해당 대역':match;
 });
 if(!fields.every(key=>typeof card[key]==='string'&&card[key].trim()&&card[key].length<=360&&
   // Render concrete quantities and identifiers from source links. Text is analysis only.
   !/[\p{Nd}\p{Cc}]|https?:|www\.|(?:CALL_REF|MDT|TARGET)_|\[[^\]]+\]\(|\x60\x60\x60|<\/?[A-Za-z]/iu.test(bandIdentity(card[key]).replace(/\bA3\b/giu,''))))throw failure();
 if(new Set(fields.map(key=>card[key].trim())).size!==fields.length)throw failure();
 const interpretation=card.interpretation+' '+card.limitation;
 if(!sides.every(key=>witnesses[card[key].category].test(interpretation)))throw failure();
 if(hasAlternative && (!/(?:반면|달리|보다|비해|대비|차이|서로|겹치|겹친|별도|다른|같은\s*통화|동일\s*통화|우선|한정|한계|직접|설명|구분|판단하기|비교)/u.test(card.interpretation)||
   !/(?:[가-힣]면|경우|여부에\s*따라|결과에\s*따라|일\s*때|됐을\s*때|재현될\s*때)/u.test(card.nextCheck)))throw failure();
 for(const field of fields){
  for(const clause of card[field].split(/[.!?。]|(?:하지만|반면|으나|지만)/u)){
   if(/(?:전송|단말|특정\s*장비|코어망|IMS|SBC)[^.!?]{0,14}(?:고장|결함|장애|오류)[^.!?]{0,18}(?:시사|나타|입증|유발|확정|원인입니다)/iu.test(clause)&&
      !/(?:미확인|미검증|특정할\s*수\s*없|알\s*수\s*없|단정할\s*수\s*없|입증되지\s*않)/u.test(clause))throw failure();
   if(/(?:장비|기지국|송신\s*전력|파라미터|단말)[^.!?]{0,32}(?:교체|재기동|재설정|조정|증설)(?:합|하세|해야|할\s*필요)/u.test(clause))throw failure();
  }
 }
 return normalized;
}
module.exports={comparisonInstructions,validateComparison};
