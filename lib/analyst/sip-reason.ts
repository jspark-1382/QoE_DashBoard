/** SIP CDR 11. REASON classification — NOT 109. SIP response status. */
export type SipReasonGroup='normal'|'drop'|'other';
export function classifySipReason11(reason:string|null|undefined):SipReasonGroup {
  const value=(reason??'').trim();
  // Explicit H-coded Drop in compound reasons: H: Drop, C^H^J^K, etc.
  if (/(?:^|[\^\s\/;,])H\s*(?::\s*Drop\b|(?=\^|$))/i.test(value) ||
      /(?:^|[\s:;\/])Drop\b/i.test(value)) return 'drop';
  if (/^A\s*:\s*Normal$/i.test(value)) return 'normal';
  return 'other';
}
export const sipReasonLabel=(group:SipReasonGroup)=>
  group==='normal'?'Normal':group==='drop'?'Drop':'기타';
