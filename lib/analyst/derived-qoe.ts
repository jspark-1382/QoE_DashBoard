import {classifySipReason11} from './sip-reason';

export const SIP_DROP_QOE_PENALTY=2.5;

/**
 * Display/analytical QoE derived from the source RTCP MOS(v5).
 * Preserve the unmodified MOS in `mos`/`mosV5Original`; never use a
 * previously adjusted QoE as input, so repeated normalization is idempotent.
 * A negative adjusted QoE is a valid poor result, not a missing MOS.
 */
export function deriveCallQoe(originalMos:number|null|undefined,sipReason:string|null|undefined):number|null {
  if(typeof originalMos!=='number'||!Number.isFinite(originalMos)||originalMos<1||originalMos>5)return null;
  return classifySipReason11(sipReason)==='drop'
    ? Math.round((originalMos-SIP_DROP_QOE_PENALTY)*1e6)/1e6
    : originalMos;
}
export function effectiveCallQoe(call:{mos?:number|null;sipCause?:string|null;qoe?:number|null}):number|null {
  if(call.mos!==undefined)return deriveCallQoe(call.mos,call.sipCause);
  return typeof call.qoe==='number'&&Number.isFinite(call.qoe)?call.qoe:null;
}
