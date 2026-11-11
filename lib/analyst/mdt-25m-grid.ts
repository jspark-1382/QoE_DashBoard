/** Read-only 25 m MDT RSRP reference grid, independent of 2026-10-26~30 QoE clustering. */
export interface Mdt25mCell{
 pot:string;x:number;y:number;lat:number;lon:number;
 rsrp:number;samples:number;
 /** Band label -> [mean RSRP dBm, measurement count]. */
 bands:Record<string,[number,number]>;
}
export interface Mdt25mGrid{
 schemaVersion:'mdt-25m-rsrp-grid-v1';
 source:string;sourceDate:string;cellSizeM:25;referenceOnly:true;
 gridCells:number;sourceRows:number;measurements:number;statistic:string;
 basisPerMeter:{latPerX:number;lonPerX:number;latPerY:number;lonPerY:number};
 records:Mdt25mCell[];
}
export function isValidMdt25mGrid(raw:unknown):raw is Mdt25mGrid{
 if(!raw||typeof raw!=='object')return false;
 const grid=raw as Mdt25mGrid;
 return grid.schemaVersion==='mdt-25m-rsrp-grid-v1'&&grid.referenceOnly===true&&grid.cellSizeM===25&&
  typeof grid.sourceDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(grid.sourceDate)&&
  Number.isFinite(grid.basisPerMeter?.latPerX)&&Number.isFinite(grid.basisPerMeter?.lonPerX)&&
  Number.isFinite(grid.basisPerMeter?.latPerY)&&Number.isFinite(grid.basisPerMeter?.lonPerY)&&
  Array.isArray(grid.records)&&grid.records.length===grid.gridCells&&grid.gridCells<=50000;
}
export type MdtGridMode='top1'|'900'|'1.8협'|'1.8광'|'2.1'|'hidden';
export type MdtGridFrequency=Exclude<MdtGridMode,'top1'|'hidden'>;
export const MDT_GRID_MODES:readonly {value:MdtGridMode;label:string}[]=[
 {value:'top1',label:'Top1 (최다 측정)'},
 {value:'900',label:'900'},
 {value:'1.8협',label:'1.8협'},
 {value:'1.8광',label:'1.8광'},
 {value:'2.1',label:'2.1'},
 {value:'hidden',label:'숨김'},
];
// Deterministic priority applies ONLY when sample counts are exactly tied.
const FREQUENCIES:readonly MdtGridFrequency[]=['900','1.8협','1.8광','2.1'];
export interface MdtGridMetric{frequency:MdtGridFrequency;rsrp:number;samples:number;}
export function selectMdtGridMetric(cell:Pick<Mdt25mCell,'bands'>,mode:MdtGridMode):MdtGridMetric|null{
 if(mode==='hidden')return null;
 const chosen=mode==='top1'
  ? FREQUENCIES.reduce<MdtGridFrequency|null>((best,key)=>{
    const n=cell.bands[key]?.[1]??0;
    return n>0&&(!best||n>(cell.bands[best]?.[1]??0))?key:best;
   },null)
  :mode;
 if(!chosen)return null;
 const [rsrp,samples]=cell.bands[chosen]??[];
 if(!Number.isFinite(rsrp)||!Number.isFinite(samples)||samples<=0)return null;
 return {frequency:chosen,rsrp,samples};
}
export interface MdtRsrpColorBand{min:number|null;max:number|null;label:string;start:string;end:string;}
/** Uploaded RSRP (dBm) legend: vivid red→orange→yellow→green→blue→black, no data grey. */
export const MDT_RSRP_LEGEND:readonly MdtRsrpColorBand[]=[
 {min:-60,max:null,label:'> -60',start:'#ff0000',end:'#ff0000'},
 {min:-70,max:-60,label:'-60 ~ -70',start:'#ff0000',end:'#ff9000'},
 {min:-80,max:-70,label:'-70 ~ -80',start:'#ff9000',end:'#ffe000'},
 {min:-90,max:-80,label:'-80 ~ -90',start:'#ffe000',end:'#00ff00'},
 {min:-100,max:-90,label:'-90 ~ -100',start:'#00ff00',end:'#002bff'},
 {min:-110,max:-100,label:'-100 ~ -110',start:'#002bff',end:'#000051'},
 {min:null,max:-110,label:'< -110',start:'#000000',end:'#000000'},
 {min:null,max:null,label:'수집된 값 없음',start:'#888888',end:'#888888'},
];
export interface MdtCandidateCircle{lat:number;lon:number;radiusM:number;}
export function inVisibleCandidate25m(cell:Pick<Mdt25mCell,'lat'|'lon'>,areas:readonly MdtCandidateCircle[]):boolean{
 for(const region of areas){
  if(region.radiusM<=0)continue;
  const dLat=cell.lat-region.lat;
  if(Math.abs(dLat)>region.radiusM/110900)continue;
  const dx=(cell.lon-region.lon)*111320*Math.cos(((cell.lat+region.lat)/2)*Math.PI/180);
  const dy=dLat*111320;
  if(dx*dx+dy*dy<=region.radiusM*region.radiusM)return true;
 }
 return false;
}
export function grid25mCorners(cell:Pick<Mdt25mCell,'lat'|'lon'>,basis:Mdt25mGrid['basisPerMeter'],sizeM=25):[number,number][]{
 const half=sizeM/2;
 return [[-half,half],[half,half],[half,-half],[-half,-half]]
  .map(([dx,dy]):[number,number]=>[
    cell.lat+dx*basis.latPerX+dy*basis.latPerY,
    cell.lon+dx*basis.lonPerX+dy*basis.lonPerY,
  ]);
}
const lerp=(a:number,b:number,t:number)=>Math.round(a+(b-a)*t);
function rgbColor(a:string,b:string,t:number):string{
 return '#'+[1,3,5].map(i=>{
  const v=lerp(Number.parseInt(a.slice(i,i+2),16),Number.parseInt(b.slice(i,i+2),16),t);
  return v.toString(16).padStart(2,'0');
 }).join('');
}
export function grid25mRsrpColor(value:number|null|undefined):string{
 if(value==null||!Number.isFinite(value))return '#888888';
 if(value> -60)return MDT_RSRP_LEGEND[0].start;
 if(value< -110)return '#000000';
 for(const band of MDT_RSRP_LEGEND.slice(1,6)){
  const high=band.max!,low=band.min!;
  if(value>=low&&value<=high)return rgbColor(band.start,band.end,(high-value)/(high-low));
 }
 return '#888888';
}
