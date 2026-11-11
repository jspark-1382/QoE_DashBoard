import type {AnalystOverview,OverviewCallLocation} from './types';
import type {BaseStation} from '../location-estimation/types';
const valid=(lat:number,lon:number)=>Number.isFinite(lat)&&Number.isFinite(lon)&&
  Math.abs(lat)<=90&&Math.abs(lon)<=180&&(lat!==0||lon!==0);
export interface GpsMapStationSidecar {
  schemaVersion:'gps-map-stations-v1';sourceRevision:string;date:string;
  records:Record<string,{observedAt:string;station:BaseStation}>;
}
/** Apply only exact source/date/call/time matches without changing the GPS position. */
export function overlayGpsMapStations(overview:AnalystOverview,data:GpsMapStationSidecar):AnalystOverview{
  if(data?.schemaVersion!=='gps-map-stations-v1'||!overview.sourceRevision||
    data.sourceRevision!==overview.sourceRevision||data.date!==overview.date)return overview;
  return {...overview,callLocations:overview.callLocations?.map(p=>{
    const record=data.records?.[p.callId],station=record?.station;
    if(p.evidence!=='gnss'||!p.observedAt||!record||!station||station.isVirtual||
      !station.baseStationId||!station.cellId||!valid(station.latitude,station.longitude)||
      !Number.isFinite(Date.parse(p.observedAt))||Date.parse(record.observedAt)!==Date.parse(p.observedAt))return p;
    return {...p,gpsStation:station};
  })};
}
/** GPS-time stations where available, otherwise explicitly identified same-call BYE references. */
export async function loadGpsMapStations(overview:AnalystOverview,signal?:AbortSignal):Promise<AnalystOverview>{
  try{
    const response=await fetch('/qoe/gps-map-stations/'+overview.date+'.json',{signal,cache:'no-cache'});
    if(!response.ok)return overview;
    return overlayGpsMapStations(overview,await response.json());
  }catch{
    signal?.throwIfAborted();
    return overview;
  }
}
/** Count the coordinate groups actually drawn as tower markers by AnalystMap. */
export function countStationMapPositions(stations:readonly BaseStation[]):number{
  return new Set(stations.filter(s=>valid(s.latitude,s.longitude)).map(s=>s.latitude+'/'+s.longitude)).size;
}
/** Related GPS and 3-site MDT stations; standalone BYE-only locations are excluded. */
export function relatedStationMarkersForMap(locations:readonly OverviewCallLocation[]):BaseStation[]{
  const rows=new Map<string,BaseStation>();
  const add=(station:BaseStation,relation:NonNullable<BaseStation['mapRelations']>[number])=>{
    if(!station.baseStationId||!station.cellId||station.isVirtual||!valid(station.latitude,station.longitude))return;
    const key=JSON.stringify([station.technology??'LTE',station.baseStationId,station.cellId,station.latitude,station.longitude]);
    const previous=rows.get(key);
    if(previous){
      if(!previous.mapRelations!.includes(relation))previous.mapRelations!.push(relation);
      if(previous.pci==null&&station.pci!=null)previous.pci=station.pci;
    }else rows.set(key,{...station,mapRelations:[relation]});
  };
  for(const p of locations){
    if(p.evidence==='bye-cell')continue;
    for(const s of p.usedStations??[]){
      add({baseStationId:s.ruId,cellId:s.cellId,latitude:s.lat,longitude:s.lon,
        frequency:null,technology:'LTE',isVirtual:false,provenanceUnknown:true,
        inventorySource:'MDT 3개 기지국 RSRP 위치 추정 입력',pci:null},'triangulation-input');
    }
    if(p.evidence==='gnss'){
      if(p.gpsStation&&!p.gpsStation.isVirtual&&p.gpsStation.baseStationId&&p.gpsStation.cellId&&
         valid(p.gpsStation.latitude,p.gpsStation.longitude))add(p.gpsStation,'gps-observation');
      else if(p.byeRuId&&p.byeCellId&&p.byeStationLat!=null&&p.byeStationLon!=null)
        add({baseStationId:p.byeRuId,cellId:p.byeCellId,latitude:p.byeStationLat,longitude:p.byeStationLon,
          frequency:null,technology:p.byeTechnology??'LTE',isVirtual:false,provenanceUnknown:true,
          pci:p.byePci??null,inventorySource:p.byeInventory??'BYE 기지국 참고'},'gps-call-bye');
    }
  }
  return [...rows.values()];
}
export function detailStationMarkersForMap(p:OverviewCallLocation|null|undefined):BaseStation[]{
  if(!p)return [];
  const result=relatedStationMarkersForMap([p]);
  if(p.byeRuId&&p.byeCellId&&p.byeStationLat!=null&&p.byeStationLon!=null&&
     valid(p.byeStationLat,p.byeStationLon)&&
     !result.some(r=>r.baseStationId===p.byeRuId&&r.cellId===p.byeCellId)){
    result.push({baseStationId:p.byeRuId,cellId:p.byeCellId,
      latitude:p.byeStationLat,longitude:p.byeStationLon,
      frequency:null,technology:p.byeTechnology??'LTE',isVirtual:false,provenanceUnknown:true,
      pci:p.byePci??null,inventorySource:p.byeInventory??'BYE 기지국 참고'});
  }
  return result;
}
