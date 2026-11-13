import {candidateCircleDistanceM} from './quality-candidate-rough-membership';
import type {CandidateRoughMatch} from './quality-candidate-rough-membership';
import type {StationCatalog,StationTechnology} from './station-catalog';

export type StationDisplayRange='inside'|'near'|'off';
export type StationDisplayRat='LTE'|'NR'|'all';
export interface StationDisplayOptions {
  range:StationDisplayRange;
  rat:StationDisplayRat;
  highlightRelated:boolean;
}
export interface StationDisplayCandidate{
  id:string;location:{lat:number;lon:number;radiusM:number|null}|null;
}
export interface StationSiteMarker{
  id:string;lat:number;lon:number;technology:StationTechnology;
  matchedCandidateIds:string[];
  linkedToSelected:boolean;
  source:'inventory'|'mdt';
  cells:Array<{ruId:string;cellId:string;pci:number|null;rsrpDbm:number|null;related:boolean}>;
}
export const DEFAULT_STATION_OPTIONS:StationDisplayOptions={range:'off',rat:'LTE',highlightRelated:true};
/** Static, identifiable tower glyph used by every map; no handset marker shape reuse. */
export function stationTowerSvg(state:'standard'|'selected'|'linked'|'nearby'='standard',size=24):string{
  const stroke=state==='linked'?'#b45309':state==='selected'?'#2563eb':state==='nearby'?'#8798a7':'#456b87';
  const bg=state==='linked'?'#fff4df':state==='selected'?'#eaf2ff':'#fff';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 30" width="${size}" height="${Math.round(size*30/26)}" aria-hidden="true"><rect x="1.5" y="1.5" width="23" height="27" rx="7" fill="${bg}" stroke="${stroke}" stroke-width="1.8"/><g stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M13 9v14M9 23h8M10 17l3-8 3 8M10 17h6M7 7c-2 2-2 5 0 7M19 7c2 2 2 5 0 7M4.5 4.5c-3 3-3 9 0 12M21.5 4.5c3 3 3 9 0 12"/></g></svg>`;
}
const valid=(x:number,y:number)=>Number.isFinite(x)&&Number.isFinite(y)&&x>=33&&x<=39.8&&y>=124&&y<=132;
/** Registry sites are grouped by position and RAT, not assumed unique physical towers. */
export function selectCandidateStationSites(
  candidates:readonly StationDisplayCandidate[],
  catalogs:readonly StationCatalog[],
  options:StationDisplayOptions,
  selectedId:string|null,
  rough:readonly CandidateRoughMatch[],
):StationSiteMarker[]{
  if(options.range==='off'||!candidates.length)return [];
  const candidatesWithRadius=candidates.filter(c=>c.location&&c.location.radiusM!=null&&c.location.radiusM>0&&valid(c.location.lat,c.location.lon));
  const enabled=(tech:StationTechnology)=>options.rat==='all'||options.rat===tech;
  const matched=(p:{lat:number;lon:number})=>candidatesWithRadius.filter(c=>
    candidateCircleDistanceM(p,c.location!)<=
    (options.range==='near'?500:c.location!.radiusM!)
  ).map(c=>c.id);
  const selectedRough=rough.filter(p=>p.matchingCandidateIds?.includes(selectedId??''));
  const evidence=new Set(selectedRough.flatMap(p=>p.usedStations.map(s=>JSON.stringify([s.ruId,s.cellId]))));
  const sites=new Map<string,StationSiteMarker>();
  const presentCell=new Set<string>();
  const add=(tech:StationTechnology,lat:number,lon:number,cell:{ruId:string;cellId:string;pci:number|null;rsrpDbm:number|null;related:boolean},source:'inventory'|'mdt',force=false)=>{
    if(!enabled(tech)||!valid(lat,lon))return;
    const membership=matched({lat,lon});
    if(!membership.length&&!force)return;
    const cellKey=JSON.stringify([tech,cell.ruId,cell.cellId]);
    if(presentCell.has(cellKey))return;
    presentCell.add(cellKey);
    const coord=JSON.stringify([tech,lat,lon]),prev=sites.get(coord);
    if(prev){
      prev.cells.push(cell);
      prev.linkedToSelected ||=cell.related;
      for(const id of membership)if(!prev.matchedCandidateIds.includes(id))prev.matchedCandidateIds.push(id);
    }else sites.set(coord,{
      id:coord,lat,lon,technology:tech,matchedCandidateIds:membership,
      linkedToSelected:cell.related,source,cells:[cell]
    });
  };
  for(const catalog of catalogs){
    const tech:StationTechnology=catalog.schemaVersion==='nr-station-catalog-v1'?'NR':'LTE';
    if(!enabled(tech))continue;
    for(const [ruId,cellId,pci,lat,lon] of catalog.rows){
      const related=options.highlightRelated&&evidence.has(JSON.stringify([ruId,cellId]));
      add(tech,lat,lon,{ruId,cellId,pci,rsrpDbm:null,related},'inventory');
    }
  }
  // Explicitly observed 3-site MDT evidence may be outside the candidate
  // circle or missing from the more recent tower registry. Show regardless.
  if(options.highlightRelated&&enabled('LTE')){
    for(const p of selectedRough)for(const s of p.usedStations){
      const key=JSON.stringify(['LTE',s.ruId,s.cellId]);
      if(presentCell.has(key)){
        for(const site of sites.values())for(const cell of site.cells){
          if(cell.ruId===s.ruId&&cell.cellId===s.cellId){
            cell.related=true;cell.rsrpDbm=s.rsrpDbm;site.linkedToSelected=true;
          }
        }
      }else add('LTE',s.lat,s.lon,{ruId:s.ruId,cellId:s.cellId,pci:null,rsrpDbm:s.rsrpDbm,related:true},'mdt',true);
    }
  }
  return [...sites.values()].sort((a,b)=>Number(b.linkedToSelected)-Number(a.linkedToSelected)||
    Number(b.matchedCandidateIds.includes(selectedId??''))-Number(a.matchedCandidateIds.includes(selectedId??''))||
    a.lat-b.lat);
}
