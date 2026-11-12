import type {ScreeningResult,ScreeningRow,ScreeningSource} from './customer-screening';
import type {ScreeningGeography,ScreeningMapView} from './customer-screening-map';
import type {CustomerRoute} from './customer-screening-route';
import type {TopCustomerMap,TopCustomerRoute} from './customer-screening-top-ten';

export type ScreeningRankMode='poor'|'drop'|'repeat';
export type ScreeningCustomerFilter='all'|'affected'|'repeat'|'concentrated'|'drop';
export interface ScreeningQueryScope {dateStart:string;dateEnd:string;from:string;to:string}
export interface ScreeningQueryOptions {
  query:string;filter:ScreeningCustomerFilter;sort:ScreeningRankMode;page:number;
  selectedId:string;areaId:string;cellId:string;
}
export interface ScreeningQueryResult {
  sourceRevision:string;source:ScreeningSource;dates:string[];
  report:Omit<ScreeningResult,'rows'>;affectedCallTotal:number;
  topRows:ScreeningRow[];rows:ScreeningRow[];total:number;page:number;pages:number;
  selected:ScreeningRow|null;comparable:ScreeningRow[];selectedRegion:string;
}
export interface ScreeningMapQueryResult {
  sourceRevision:string;geography:ScreeningGeography;topCustomers:TopCustomerMap;
}
export interface ScreeningRoutesResult {sourceRevision:string;routes:CustomerRoute[]}

export function screeningQueryRequest(scope:ScreeningQueryScope,options:ScreeningQueryOptions) {
  return {scope,...options,pageSize:25};
}
export function screeningRouteIds(enabled:boolean,mode:ScreeningMapView,selectedId:string,rows:readonly Pick<ScreeningRow,'id'|'poor'>[]) {
  if(!enabled)return [];
  if(mode==='route')return selectedId?[selectedId]:[];
  return mode==='top10'?rows.slice(0,10).filter(row=>row.poor>0).map(row=>row.id):[];
}
const ROUTE_COLORS=['#dc3557','#2563eb','#059669','#9333ea','#ea580c','#0891b2','#b45309','#db2777','#4f46e5','#4d7c0f'];
/** The route response may omit an unlocated customer; displayed ranking never changes. */
export function screeningTopRoutes(rows:readonly Pick<ScreeningRow,'id'|'poor'>[],routes:readonly CustomerRoute[]):TopCustomerRoute[] {
  const byId=new Map(routes.map(route=>[route.customerId,route]));
  return rows.slice(0,10).flatMap((row,index)=>{
    const route=byId.get(row.id);
    return row.poor>0&&route?[{rank:index+1,color:ROUTE_COLORS[index],route}]:[];
  });
}
