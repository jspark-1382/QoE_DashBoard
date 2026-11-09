import type { FieldEvidence, ImprovementScope, ScanReference } from './types';
export type {FieldEvidence, ScanReference} from './types';
const localRef=(value:string|null)=>value===null||(/^(?:\/(?!\/)|\.\.?\/)/.test(value)&&!value.includes('..')&&!value.includes('\\'));
export function validateFieldEvidence(value:FieldEvidence):{ok:boolean;reasons:string[]}{
  const reasons:string[]=[];
  if(!value.candidateId)reasons.push('missing-candidate');
  if(!localRef(value.audioRef)||!localRef(value.rfRef))reasons.push('local-or-same-origin-reference-required');
  if(value.measuredMos!==null&&(!Number.isFinite(value.measuredMos)||value.measuredMos<1||value.measuredMos>5))reasons.push('invalid-measured-mos');
  if(value.result==='observed'&&!Number.isFinite(Date.parse(value.observedAt)))reasons.push('missing-observation-time');
  if(value.audioRef&&value.measuredMos!==null&&(!value.measurementId||value.audioMeasurementId!==value.measurementId||value.mosMeasurementId!==value.measurementId))reasons.push('audio-mos-measurement-link-unverified');
  return {ok:reasons.length===0,reasons};
}
export function scanComparisonEligibility(reference:ScanReference|null,scope:ImprovementScope):{eligible:boolean;reasons:string[]}{
  if(!reference?.supplied)return {eligible:false,reasons:['SCAN 자료 미확보']};
  const reasons:string[]=[];
  for(const key of ['dateStart','dateEnd','from','to'] as const)if(reference[key]!==scope[key])reasons.push('기간·시간창 불일치: '+key);
  if(reference.regionDefinition!=='observed-call-locations')reasons.push('원본 지역 정의 불일치');
  if(reference.populationDefinition!=='MDT-CDR')reasons.push('원본 모집단 정의 불일치');
  if(reference.metricDefinition!=='original-mos-v5')reasons.push('지표 정의 불일치');
  if(reference.sourceRevision&&reference.sourceRevision!==scope.sourceRevision)reasons.push('원본 버전 불일치');
  return {eligible:reasons.length===0,reasons};
}
