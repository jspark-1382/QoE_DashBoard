import type { AnalystDataset, AnalystSource } from './types';
export interface AnalystSelection { source:AnalystSource; view:'overview'|'contract'; date:string; customerId:string; callId:string|null; sampleIndex:number|null; }
export function parseSelection(search:string):AnalystSelection {
  const p=new URLSearchParams(search),customer=p.get('customer')??'',raw=p.get('sample');
  const customerId=customer==='__ALL__'?'':customer;
  return {source:p.get('source')==='실측'?'실측':'MDT',view:p.get('view')==='overview'?'overview':p.get('view')==='contract'||customerId?'contract':'overview',date:p.get('date')??'',customerId,callId:p.get('call'),sampleIndex:raw!=null&&/^\d+$/.test(raw)&&Number.isSafeInteger(Number(raw))?Number(raw):null};
}
export function resolveSelection(s:AnalystSelection,dataset:AnalystDataset):AnalystSelection {
  const customer=dataset.customers.find(c=>c.id===s.customerId);
  return {...s,date:dataset.meta.dates.includes(s.date)?s.date:customer?.dates[0]??dataset.meta.dates[0]??'',...(s.customerId&&!customer?{view:'overview' as const,customerId:'',callId:null,sampleIndex:null}:{})};
}
export function selectionQuery(s:AnalystSelection):string {
  const p=new URLSearchParams({source:s.source,view:s.view,date:s.date});
  if(s.customerId)p.set('customer',s.customerId);
  if(s.callId)p.set('call',s.callId);
  if(s.sampleIndex!=null)p.set('sample',String(s.sampleIndex));
  return `?${p.toString()}`;
}
