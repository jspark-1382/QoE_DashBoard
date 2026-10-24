import type { AnalystSample } from './types';
export type AnalystMetric='qoe'|'rsrp'|'rsrq'|'sinr';
export function metricColor(value:number|null,metric:AnalystMetric,threshold=2.5):string {
  if(value==null||!Number.isFinite(value))return '#87929d';
  const poor=metric==='qoe'?value<threshold:metric==='rsrp'?value<-105:metric==='rsrq'?value<-15:value<3;
  return poor?'#b64536':'#586d85';
}
export function hasCustomerPoint(s:AnalystSample):s is AnalystSample&{lat:number;lon:number} {
  return s.lat!=null&&s.lon!=null&&Number.isFinite(s.lat)&&Number.isFinite(s.lon)&&Math.abs(s.lat)<=90&&Math.abs(s.lon)<=180&&(s.lat!==0||s.lon!==0)&&!['station','unavailable'].includes(s.locationSource);
}
export function visiblePoints(samples:AnalystSample[],showGnss:boolean,showEstimates:boolean) {
  return samples.filter(hasCustomerPoint).filter(s=>['gnss','measured'].includes(s.locationSource)?showGnss:showEstimates);
}
export function splitTracks(samples:AnalystSample[]):AnalystSample[][] {
  const groups:AnalystSample[][]=[];let active:AnalystSample[]=[];
  for(const sample of [...samples].sort((a,b)=>a.timestamp-b.timestamp||a.index-b.index)){
    if(!hasCustomerPoint(sample)||!['gnss','measured'].includes(sample.locationSource)){active=[];continue;}
    const prev=active.at(-1);let join=false;
    if(prev){const seconds=(sample.timestamp-prev.timestamp)/1000,dLat=(sample.lat-prev.lat!)*111195,dLon=(sample.lon-prev.lon!)*111195*Math.cos(sample.lat*Math.PI/180),dist=Math.hypot(dLat,dLon);join=sample.callId===prev.callId&&sample.locationSource===prev.locationSource&&seconds>=0&&seconds<=120&&(seconds===0?dist<1:dist/seconds*3.6<=200);}
    if(!join){active=[];groups.push(active);}active.push(sample);
  }
  return groups;
}
