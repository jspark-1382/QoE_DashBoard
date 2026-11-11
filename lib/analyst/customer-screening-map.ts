import type {ScreeningSource,ScreeningRow} from './customer-screening';

export type ScreeningMapView='dong'|'cell'|'gnss'|'route';
export type ScreeningMapMetric='customers'|'repeat'|'poorCalls'|'drops';
export interface ScreeningMapArea {
  id:string;label:string;customers:number;repeat:number;poorCalls:number;drops:number;
}
export interface ScreeningMapPoint {
  id:string;lat:number;lon:number;customers:number;repeat:number;poorCalls:number;drops:number;
  cellId?:string;customerIds:string[];
}
export interface ScreeningGeography {
  areas:ScreeningMapArea[];cells:ScreeningMapPoint[];gnss:ScreeningMapPoint[];
  unmappedPoorCalls:number;gnssPoorCalls:number;byeCellPoorCalls:number;
}
export interface ScreeningBoundary {
  schemaVersion:'customer-screening-boundaries-v1';
  sourceRevision:string;
  type:'FeatureCollection';
  features:Array<{type:'Feature';properties:{id:string;label:string};
    geometry:{type:'MultiPolygon';coordinates:number[][][][]}}>;
}
interface MutableGroup {
  customers:Set<string>;days:Map<string,Set<number>>;poorCalls:number;drops:number;
}
interface MutablePoint extends MutableGroup {id:string;lat:number;lon:number;cellId?:string}
const newGroup=():MutableGroup=>({customers:new Set(),days:new Map(),poorCalls:0,drops:0});
function addPoor(g:MutableGroup,customerId:string,day:number){
  g.customers.add(customerId);g.poorCalls++;
  const days=g.days.get(customerId)??new Set<number>();
  days.add(day);g.days.set(customerId,days);
}
function toMetrics(group:MutableGroup){
  return {customers:group.customers.size,
    repeat:[...group.days.values()].filter(d=>d.size>=2).length,
    poorCalls:group.poorCalls,drops:group.drops};
}
const parseClock=(time:string)=>{
  const m=/^(\d{2}):(\d{2})$/.exec(time);
  return m?Number(m[1])*3600+Number(m[2])*60:NaN;
};
export function buildScreeningGeography(
  source:ScreeningSource,start:string,end:string,from:string,to:string,
):ScreeningGeography {
  const first=source.dates.indexOf(start),last=source.dates.indexOf(end),
    fromSec=parseClock(from),toSec=parseClock(to);
  if(first<0||last<first||!Number.isFinite(fromSec)||!Number.isFinite(toSec)||fromSec>toSec)
    throw Error('지도 조회 기간이 올바르지 않습니다.');
  const areas=new Map<string,MutableGroup>(),cells=new Map<string,MutablePoint>(),
    gps=new Map<string,MutablePoint>(),cellDropCounts=new Map<string,number>();
  let unmappedPoorCalls=0,gnssPoorCalls=0,byeCellPoorCalls=0;
  for(const customer of source.customers){
    for(const [day,second,qoe,drop,areaId,cellId,lat,lon,evidence] of customer.calls){
      if(day<first||day>last||second<fromSec||second>=toSec+60)continue;
      const area=areaId&&source.areas[areaId]?areas.get(areaId)??newGroup():null;
      if(area&&drop)area.drops++;
      if(area&&!areas.has(areaId))areas.set(areaId,area);
      if(cellId&&drop)cellDropCounts.set(cellId,(cellDropCounts.get(cellId)??0)+1);
      if(qoe===null||!Number.isFinite(qoe)||qoe>=source.thresholds.poor)continue;
      if(area)addPoor(area,customer.id,day);
      else unmappedPoorCalls++;
      const valid=typeof lat==='number'&&Number.isFinite(lat)&&typeof lon==='number'&&Number.isFinite(lon);
      if(cellId){
        const c=cells.get(cellId)??{...newGroup(),id:cellId,cellId,lat:NaN,lon:NaN};
        // BYE Cell identity is available even when the call has GNSS; coordinates must
        // come exclusively from a BYE Cell site evidence record, never from customer GNSS.
        if(evidence==='bye-cell'&&valid){c.lat=lat!;c.lon=lon!;byeCellPoorCalls++;}
        addPoor(c,customer.id,day);cells.set(cellId,c);
      }
      if(evidence==='gnss'&&valid){
        gnssPoorCalls++;
        // ~200m observation aggregation; unlike BYE sites, this contains GNSS evidence only.
        const key=Math.round(lat!/.002)+':'+Math.round(lon!/.002);
        const g=gps.get(key)??{...newGroup(),id:key,lat:Math.round(lat!/.002)*.002,lon:Math.round(lon!/.002)*.002};
        if(drop)g.drops++;
        addPoor(g,customer.id,day);gps.set(key,g);
      }
    }
  }
  const output:ScreeningGeography={
    areas:[...areas].map(([id,g])=>({id,label:source.areas[id][0],...toMetrics(g)}))
      .filter(x=>x.customers>0||x.drops>0)
      .sort((a,b)=>b.customers-a.customers||b.poorCalls-a.poorCalls),
    cells:[...cells.values()].filter(g=>Number.isFinite(g.lat)&&Number.isFinite(g.lon))
      .map(g=>({...toMetrics(g),drops:cellDropCounts.get(g.id)??0,id:g.id,cellId:g.cellId,lat:g.lat,lon:g.lon,customerIds:[...g.customers]}))
      .sort((a,b)=>b.customers-a.customers||b.poorCalls-a.poorCalls),
    gnss:[...gps.values()].map(g=>({...toMetrics(g),id:g.id,lat:g.lat,lon:g.lon,customerIds:[...g.customers]}))
      .sort((a,b)=>b.customers-a.customers||b.poorCalls-a.poorCalls),
    unmappedPoorCalls,gnssPoorCalls,byeCellPoorCalls,
  };
  return output;
}
export function metricValue(group:Pick<ScreeningMapArea,'customers'|'repeat'|'poorCalls'|'drops'>,metric:ScreeningMapMetric){
  return group[metric];
}
export function metricLabel(metric:ScreeningMapMetric){
  return ({customers:'저품질 경험 고객',repeat:'2일 이상 반복 고객',poorCalls:'저품질 통화',drops:'SIP Drop 통화'} as const)[metric];
}
export function metricUnit(metric:ScreeningMapMetric){return metric==='customers'||metric==='repeat'?'명':'건';}
export function metricSteps(stats:Array<Pick<ScreeningMapArea,'customers'|'repeat'|'poorCalls'|'drops'>>,metric:ScreeningMapMetric){
  const values=stats.map(s=>metricValue(s,metric)).filter(n=>n>0).sort((a,b)=>a-b);
  if(!values.length)return [1,2,3];
  const pick=(q:number)=>values[Math.floor((values.length-1)*q)];
  const a=pick(.25),b=Math.max(a+1,pick(.5)),c=Math.max(b+1,pick(.75));
  return [a,b,c];
}
export function metricColor(n:number,thresholds:number[]){
  if(n<=0)return '#e9eef4';
  if(n<=thresholds[0])return '#f6d7a4';
  if(n<=thresholds[1])return '#eda36f';
  if(n<=thresholds[2])return '#e66b64';
  return '#b72f50';
}
export function scopedCustomersInArea(reportRows:ScreeningRow[],areaId:string) {
  return reportRows.filter(r=>r.badCalls.some(call=>call.area===areaId));
}
export function validScreeningBoundaries(value:unknown,revision:string):value is ScreeningBoundary {
  if(!value||typeof value!=='object')return false;
  const d=value as Partial<ScreeningBoundary>;
  return d.schemaVersion==='customer-screening-boundaries-v1'&&d.sourceRevision===revision
    &&d.type==='FeatureCollection'&&Array.isArray(d.features)&&d.features.length>0
    &&d.features.every(f=>f.type==='Feature'&&typeof f.properties?.id==='string'
      &&f.geometry?.type==='MultiPolygon'&&Array.isArray(f.geometry.coordinates));
}
