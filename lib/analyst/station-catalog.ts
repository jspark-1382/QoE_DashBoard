import type {BaseStation} from '../location-estimation/types';

export type InventoryPciStatus='valid'|'missing'|'invalid'|'conflict';
export type StationTechnology='LTE'|'NR';
export type StationRow=[ru:string,cell:string,pci:number|null,lat:number,lon:number,status:InventoryPciStatus];
export interface StationCatalog {
  schemaVersion:'lte-station-catalog-v1'|'nr-station-catalog-v1';
  technology?:StationTechnology;
  source:{file:string;sha256:string;fileDate:string|null};
  summary:{inputRows:number;invalidRows:number;registeredCells:number;withPci:number;missingPci:number;invalidPci:number;conflictingPci:number;distinctPci:number};
  observations?:{sourceRevision:string;dates:string[];total:number;exactMatched:number;comparable:number;matched:number;mismatched:number;unregistered:number;unavailable:number};
  rows:StationRow[];
}
const validPci=(value:unknown,technology:StationTechnology):value is number=>typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=(technology==='NR'?1007:503);
const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
export function stationCatalogTechnology(catalog:StationCatalog):StationTechnology {
  return catalog.schemaVersion==='nr-station-catalog-v1'?'NR':'LTE';
}
export function validateStationCatalog(input:unknown):StationCatalog {
  const data=input as StationCatalog;
  if(!data||!['lte-station-catalog-v1','nr-station-catalog-v1'].includes(data.schemaVersion)||
    (data.schemaVersion==='nr-station-catalog-v1'?data.technology!=='NR':data.technology!==undefined&&data.technology!=='LTE')||
    typeof data.source?.file!=='string'||!data.source.file.trim()||typeof data.source.sha256!=='string'||!/^[a-f\d]{64}$/i.test(data.source.sha256)||
    (data.source.fileDate!==null&&(typeof data.source.fileDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(data.source.fileDate)))||
    !data.summary||!Array.isArray(data.rows))
    throw new Error('기지국 목록 형식을 확인해 주세요.');
  const technology=stationCatalogTechnology(data);
  if(technology==='NR'&&data.observations!==undefined)
    throw new Error('5G NR 인벤토리에는 LTE MDT 비교 집계를 사용할 수 없습니다.');
  const summaryKeys=['inputRows','invalidRows','registeredCells','withPci','missingPci','invalidPci','conflictingPci','distinctPci'] as const;
  if(summaryKeys.some(key=>!count(data.summary[key])))throw new Error('기지국 요약 집계를 확인해 주세요.');
  const statuses={valid:0,missing:0,invalid:0,conflict:0};
  const pcis=new Set<number>();
  const identities=new Set<string>();
  for(const row of data.rows){
    if(!Array.isArray(row)||row.length!==6||typeof row[0]!=='string'||!row[0].trim()||typeof row[1]!=='string'||!row[1].trim()||
      !Number.isFinite(row[3])||row[3]<33||row[3]>39.8||!Number.isFinite(row[4])||row[4]<124||row[4]>132||
      !['valid','missing','invalid','conflict'].includes(row[5])||(row[5]==='valid'?!validPci(row[2],technology):row[2]!==null))
      throw new Error('기지국 좌표 또는 PCI 형식을 확인해 주세요.');
    const identity=JSON.stringify([row[0],row[1]]);
    if(identities.has(identity))throw new Error('기지국 RU+Cell 식별자가 중복되었습니다.');
    identities.add(identity);
    statuses[row[5]]++;
    if(row[2]!=null)pcis.add(row[2]);
  }
  if(data.summary.registeredCells!==data.rows.length||data.summary.withPci!==statuses.valid||
    data.summary.missingPci!==statuses.missing||data.summary.invalidPci!==statuses.invalid||
    data.summary.conflictingPci!==statuses.conflict||data.summary.distinctPci!==pcis.size)
    throw new Error('기지국 목록 집계가 일치하지 않습니다.');
  const observations=data.observations;
  if(observations){
    const keys=['total','exactMatched','comparable','matched','mismatched','unregistered','unavailable'] as const;
    if(typeof observations.sourceRevision!=='string'||!observations.sourceRevision||
      !Array.isArray(observations.dates)||!observations.dates.length||observations.dates.some(date=>typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))||
      keys.some(key=>!count(observations[key]))||observations.total!==observations.exactMatched+observations.unregistered||
      observations.exactMatched!==observations.comparable+observations.unavailable||observations.comparable!==observations.matched+observations.mismatched)
      throw new Error('MDT PCI 비교 집계를 확인해 주세요.');
  }
  return data;
}
export function filterStationRows(rows:readonly StationRow[],query:string,pci:string,technology:StationTechnology='LTE'):StationRow[] {
  const text=query.trim().toLocaleLowerCase();
  const pciText=pci.trim();
  const pciNumber=/^\d+$/.test(pciText)?Number(pciText):null;
  return rows.filter(row=>(!text||row[0].toLocaleLowerCase().includes(text)||row[1].toLocaleLowerCase().includes(text))&&
    (!pciText||(pciText==='missing'?row[5]!=='valid':pciNumber!==null&&validPci(pciNumber,technology)&&row[2]===pciNumber)));
}
export function stationFromRow(row:StationRow,source:string,technology:StationTechnology='LTE'):BaseStation {
  return {baseStationId:row[0],cellId:row[1],pci:row[2],latitude:row[3],longitude:row[4],inventoryPciStatus:row[5],inventorySource:source,technology,frequency:null,isVirtual:false,provenanceUnknown:true};
}
