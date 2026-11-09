import type { AnalystSelection } from './selection';
export function withComparisonRevision(query:string, revision:string, mode=''):string {
  if(!revision&&!mode)return query;
  const params=new URLSearchParams(query);
  if(revision)params.set('compareRevision',revision);
  if(mode==='holdout'||mode==='screening')params.set('mode',mode);
  return '?'+params.toString();
}
export function buildImprovementHref(
  selection:Pick<AnalystSelection,'source'|'date'|'dateStart'|'dateEnd'|'customerId'>,
  filters:{from:string;to:string;hour:number|null;scoreMetric?:string}, revision:string, mode='',
):string {
  const p=new URLSearchParams({source:selection.source,date:selection.date,
    dateStart:selection.dateStart??selection.date,dateEnd:selection.dateEnd??selection.date,
    from:filters.from,to:filters.to,metric:filters.scoreMetric??'qoe',compareRevision:revision});
  if(filters.hour!==null)p.set('hour',String(filters.hour));
  if(selection.customerId)p.set('customer',selection.customerId);
  if(mode==='holdout'||mode==='screening')p.set('mode',mode);
  p.set('variant','improvement1');
  return '/?'+p.toString();
}
