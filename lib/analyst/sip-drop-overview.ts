import type { AnalystOverview } from './types';
import { classifySipReason11 } from './sip-reason';

/** Isolate source SIP CDR 11.REASON Drop calls for a separate investigation.
 * Keep original MOS and the same call's OWN location; never interpolate
 * a different caller's coordinate or rewrite the underlying source.
 */
export function onlyDropCalls(overview:AnalystOverview):AnalystOverview {
  const calls=overview.calls.filter(call=>classifySipReason11(call.sipCause)==='drop');
  const ids=new Set(calls.map(call=>call.id));
  return {...overview,calls,
    callLocations:(overview.callLocations??[]).filter(location=>ids.has(location.callId)),
    cells:overview.cells.map(cell=>({...cell,callIds:cell.callIds.filter(id=>ids.has(id))})),
  };
}
