import type { CoverageCounts, CoverageRatio, CoverageSummary, EvidenceCall, EvidenceDecision } from './types';
export const validOriginalMos=(mos:number|null|undefined):mos is number=>typeof mos==='number'&&Number.isFinite(mos)&&mos>=1&&mos<=5;
export const isPoorOriginalMos=(mos:number|null|undefined)=>validOriginalMos(mos)&&mos<3;
export function buildCoverage(calls:readonly EvidenceCall[],decisions:readonly EvidenceDecision[]):CoverageSummary {
  const byCall=new Map(calls.map(call=>[call.callId,call]));
  if(byCall.size!==calls.length)throw new Error('Duplicate call IDs in coverage');
  const decisionByCall=new Map<string,EvidenceDecision>();
  for(const decision of decisions){
    if(decisionByCall.has(decision.callId))throw new Error('Duplicate evidence decisions');
    if(!byCall.has(decision.callId))throw new Error('Evidence decision references an unknown call');
    decisionByCall.set(decision.callId,decision);
  }
  const count=(subset:readonly EvidenceCall[]):CoverageCounts=>{
    const evaluated=subset.filter(c=>validOriginalMos(c.mos)), linked=evaluated.filter(c=>c.mdtLinkStatus==='unique');
    const located=linked.map(c=>decisionByCall.get(c.callId)).filter(d=>d?.status==='accepted');
    const G=located.filter(d=>d?.kind==='gnss').length,T=located.filter(d=>d?.kind==='reviewed-radio').length;
    return {N:subset.length,M:evaluated.length,D:linked.length,G,T,U:G+T};
  };
  const ratios=(c:CoverageCounts):Record<string,CoverageRatio>=>Object.fromEntries(
    ([['M','N'],['D','N'],['D','M'],['G','D'],['T','D'],['U','D'],['U','N']] as const)
      .map(([n,d])=>[n+'_'+d,{numerator:c[n],denominator:c[d],value:c[d]===0?null:c[n]/c[d]}]));
  const all=count(calls),poor=count(calls.filter(c=>isPoorOriginalMos(c.mos))),excludedReasons:Record<string,number>={};
  for(const decision of decisions.filter(d=>d.status==='excluded'))for(const reason of new Set(decision.reasons))excludedReasons[reason]=(excludedReasons[reason]??0)+1;
  return {...all,poor,ratios:ratios(all),poorRatios:ratios(poor),mdtAmbiguous:calls.filter(c=>c.mdtLinkStatus==='ambiguous').length,mdtUnknown:calls.filter(c=>c.mdtLinkStatus==='unknown').length,
    mosMissing:calls.filter(c=>c.mos==null).length,mosInvalid:calls.filter(c=>c.mos!=null&&!validOriginalMos(c.mos)).length,excludedReasons};
}
