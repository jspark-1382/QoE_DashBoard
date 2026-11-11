import type {ReactNode} from 'react';

export type GpsBand='1800-wide'|'1800-narrow'|'900'|'2100'|'other';
export interface GpsRfRecord {
 callId:string;
 date:string;
 observedAt:string;
 mdtObservedAt:string;
 sampleDeltaSec:number;
 earfcn:number|null;
 band:GpsBand;
 rsrpDbm:number|null;
 matchedBy:string;
}
export interface GpsRfSidecar {
 schemaVersion:'qoe-gps-marker-rf-v1';
 sourceRevision:string;
 records:Record<string,GpsRfRecord>;
}

// Keep the original RF band evidence for source inspection, but NEVER distinguish
// GPS map shapes by frequency: all GPS points are circles, color = measured RSRP.
export const GPS_BANDS:ReadonlyArray<{id:GpsBand;name:string}>= [
 {id:'1800-wide',name:'1.8광'},{id:'1800-narrow',name:'1.8협'},
 {id:'900',name:'900'},{id:'2100',name:'2.1'},{id:'other',name:'기타'},
];
export function gpsBand(earfcn:number|null|undefined):GpsBand{
 switch(earfcn){
  case 1550:return '1800-wide';
  case 1694:return '1800-narrow';
  case 3743:return '900';
  case 475:return '2100';
  default:return 'other';
 }
}
export function gpsBandLabel(band:GpsBand){
 return GPS_BANDS.find(x=>x.id===band)?.name??'기타';
}
export function gpsRsrpColor(value:number|null|undefined):string {
 return value==null||!Number.isFinite(value)?'#94a3b8':value<=-105?'#dc2626':'#16a34a';
}
/** Every frequency uses the same circular shape. Only RSRP determines the color. */
export function gpsMarkerSvg(_band:GpsBand,rsrp:number|null|undefined):string {
 return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="20" height="20" aria-hidden="true"><g fill="'+gpsRsrpColor(rsrp)+'" stroke="#fff" stroke-width="2.2"><circle cx="14" cy="14" r="11"/></g></svg>';
}
/** Legacy public helper also uses a circle so frequency never changes the symbol. */
export function GpsLegendSymbol({color='#16a34a'}:{band:GpsBand;color?:string}):ReactNode{
 return <svg width="17" height="17" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
  <circle cx="14" cy="14" r="11" fill={color} stroke="#fff" strokeWidth="2"/>
 </svg>;
}
