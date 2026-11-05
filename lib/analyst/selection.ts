import type { AnalystDataset, AnalystSource } from './types';
import { datesInRange } from './date-range';
export interface AnalystSelection { source:AnalystSource; view:'overview'|'contract'; date:string; dateStart?:string; dateEnd?:string; customerId:string; callId:string|null; sampleIndex:number|null; }
export function parseSelection(search:string):AnalystSelection {
  const p=new URLSearchParams(search),customer=p.get('customer')??'',raw=p.get('sample');
  const customerId=customer==='__ALL__'?'':customer;
  return {source:p.get('source')==='실측'?'실측':'MDT',view:p.get('view')==='overview'?'overview':p.get('view')==='contract'||customerId?'contract':'overview',date:p.get('date')??'',dateStart:p.get('dateStart')??undefined,dateEnd:p.get('dateEnd')??undefined,customerId,callId:p.get('call'),sampleIndex:raw!=null&&/^\d+$/.test(raw)&&Number.isSafeInteger(Number(raw))?Number(raw):null};
}
export function resolveSelection(s:AnalystSelection,dataset:AnalystDataset):AnalystSelection {
  const customer=dataset.customers.find(c=>c.id===s.customerId);
  // An unbounded customer deep link falls back to an available customer day.
  // An explicit range stays within its bounds even when that customer has no calls.
  const defaultDate=dataset.meta.dates.includes(s.date)?s.date:dataset.meta.dates.at(-1)??'';
  const hasRequestedRange=!!(s.dateStart||s.dateEnd);
  const requestedRange=s.dateStart&&s.dateEnd
    ? datesInRange(dataset.meta.dates,s.dateStart,s.dateEnd):[];
  // Invalid range URLs fail closed to the requested/default day.
  const range=requestedRange.length?requestedRange:[defaultDate];
  const preferredDate=customer&&!hasRequestedRange
    ? customer.dates.includes(defaultDate)?defaultDate
      : customer.dates.find(date=>dataset.meta.dates.includes(date))??defaultDate
    : customer
    ? range.find(date=>date===defaultDate&&customer.dates.includes(date))
      ??range.find(date=>customer.dates.includes(date))
      ??range.at(-1)??defaultDate
    : range.includes(defaultDate)?defaultDate:range.at(-1)??defaultDate;
  return {...s,date:preferredDate,
    ...(requestedRange.length ?{dateStart:range[0],dateEnd:range.at(-1)}
      :{dateStart:undefined,dateEnd:undefined}),
    ...(s.customerId&&!customer?{view:'overview' as const,customerId:'',callId:null,sampleIndex:null}:{})};
}
export function selectionQuery(s:AnalystSelection):string {
  const p=new URLSearchParams({source:s.source,view:s.view,date:s.date});
  if(s.dateStart)p.set('dateStart',s.dateStart);
  if(s.dateEnd)p.set('dateEnd',s.dateEnd);
  if(s.customerId)p.set('customer',s.customerId);
  if(s.callId)p.set('call',s.callId);
  if(s.sampleIndex!=null)p.set('sample',String(s.sampleIndex));
  return `?${p.toString()}`;
}
