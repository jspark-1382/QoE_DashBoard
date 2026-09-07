import { CONFIG } from './config';
import type { Confidence } from './types';
export function decideConfidence(input: {cells:number;history:number;areaKm2:number;transition:boolean;trend:boolean;sinr:number|null;consistent:boolean;virtual:boolean;exact:boolean;knownFrequency:boolean;score:number}) {
  const reasons:string[]=[];
  if(input.cells<2) reasons.push('단일 Cell · 방향 식별 불가');
  if(input.virtual) reasons.push('가상 기지국 좌표 사용');
  if(!input.knownFrequency) reasons.push('주파수 형식 미확인');
  if(!input.exact) reasons.push('Cell 일치 부족 · 기지국 단위 대체');
  if(!input.consistent) reasons.push('시간·거리 근거 불일치');
  if(!input.transition) reasons.push('최근 Cell 변경 근거 없음');
  let confidence:Confidence='LOW';
  if(input.cells>=2 && input.history>=CONFIG.mediumMinHistory && input.transition && input.consistent && input.areaKm2<CONFIG.mediumMaxAreaKm2 && (input.sinr??-Infinity)>=0 && input.exact) confidence='MEDIUM';
  // HIGH is disallowed for virtual coordinates, unknown frequency, or weak temporal evidence.
  if(confidence==='MEDIUM' && !input.virtual && input.knownFrequency && input.trend && input.cells>=CONFIG.highMinCells && input.history>=CONFIG.highMinHistory && input.areaKm2<=CONFIG.highMaxAreaKm2 && (input.sinr??-Infinity)>=CONFIG.highMinSinr && input.score>=CONFIG.highMinimumScore) confidence='HIGH';
  if(confidence!=='LOW') reasons.push('복수 Cell 및 시간 연속성 근거');
  return {confidence,reasons};
}
