import type {ScreeningSource,ScreeningCall} from './customer-screening';

export type RouteEvidence='gnss'|'bye-cell';
export type RouteQuality='poor'|'normal'|'good'|'unscored';
export interface CustomerRoutePoint {
  id:string;index:number;date:string;time:string;day:number;timeSeconds:number;
  lat:number;lon:number;evidence:RouteEvidence;cell:string;area:string;
  qoe:number|null;drop:boolean;quality:RouteQuality;
}
export interface CustomerRouteCellSite {
  cell:string;lat:number;lon:number;count:number;gnssServed:number;
}
export interface CustomerRouteSegment {
  from:number;to:number;kind:'gnss-observed-link'|'reference-order';distanceM:number;minutes:number;
}
export interface CustomerRoute {
  customerId:string;name:string;
  observations:CustomerRoutePoint[];sites:CustomerRouteCellSite[];
  segments:CustomerRouteSegment[];
  totalCalls:number;gnssCount:number;cellReferenceCount:number;unlocatedCalls:number;
  skippedLongGaps:number;
}
const seconds=(v:string)=>{
  const m=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(v);
  return m?Number(m[1])*3600+Number(m[2])*60:NaN;
};
function validLocation(lat:number|null,lon:number|null):lat is number {
  return typeof lat==='number'&&Number.isFinite(lat)&&lat>=33&&lat<=39
    &&typeof lon==='number'&&Number.isFinite(lon)&&lon>=124&&lon<=132;
}
export function haversineMeters(a:{lat:number;lon:number},b:{lat:number;lon:number}):number {
  const rad=Math.PI/180,dLat=(b.lat-a.lat)*rad,dLon=(b.lon-a.lon)*rad;
  const t=Math.sin(dLat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLon/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(t),Math.sqrt(Math.max(0,1-t)));
}
export function buildCustomerRoute(
  source:ScreeningSource, customerId:string, start:string,end:string,from:string,to:string,dayChoice='all'
):CustomerRoute|null {
  const customer=source.customers.find(row=>row.id===customerId);
  if(!customer)return null;
  const startIndex=source.dates.indexOf(start),endIndex=source.dates.indexOf(end);
  const minSec=seconds(from),maxSec=seconds(to);
  if(startIndex<0||endIndex<startIndex||!Number.isFinite(minSec)||!Number.isFinite(maxSec)||minSec>maxSec)return null;
  const selected: Array<{day:number;startSecond:number;endSecond:number|null;call:ScreeningCall}>=[];
  for(const call of customer.calls){
    const [day,second]=call;
    if(day<startIndex||day>endIndex||second<minSec||second>=maxSec+60)continue;
    if(dayChoice!=='all'&&source.dates[day]!==dayChoice)continue;
    selected.push({day,startSecond:second,endSecond:call[10]??null,call});
  }
  // BYE is the representative position; use end-of-call second for ordering (with
  // midnight rollover), falling back to start if the original end time is absent.
  selected.sort((a,b)=>a.day-b.day||
    ((a.endSecond??a.startSecond)+(a.endSecond!=null&&a.endSecond<a.startSecond?86400:0))-
    ((b.endSecond??b.startSecond)+(b.endSecond!=null&&b.endSecond<b.startSecond?86400:0)));
  let noLocation=0,gnssCount=0,cellReferenceCount=0;
  const points:CustomerRoutePoint[]=[];
  const siteGroups=new Map<string,CustomerRouteCellSite>();
  for(const row of selected){
    const [day,,qoe,drop,area,cell,lat,lon,evidence]=row.call;
    const site=source.cellSites?.[cell];
    if(cell&&site&&validLocation(site[0],site[1])){
      const prev=siteGroups.get(cell)??{cell,lat:site[0],lon:site[1],count:0,gnssServed:0};
      prev.count++; if(evidence==='gnss')prev.gnssServed++;
      siteGroups.set(cell,prev);
    }
    const gps=evidence==='gnss'&&validLocation(lat,lon);
    const cellSite=evidence==='bye-cell'&&validLocation(lat,lon);
    // No BYE-site value should ever be presented as a GNSS measured location.
    const location = gps||cellSite ? [lat!,lon!] as const :
      site&&validLocation(site[0],site[1]) ? [site[0],site[1]] as const : null;
    if(!location){noLocation++;continue;}
    const kind:RouteEvidence=gps?'gnss':'bye-cell';
    if(kind==='gnss')gnssCount++;else cellReferenceCount++;
    const t=(row.endSecond??row.startSecond)+(row.endSecond!==null&&row.endSecond<row.startSecond?86400:0);
    const sec=t%86400;
    const time=[Math.floor(sec/3600),Math.floor(sec%3600/60),Math.floor(sec%60)].map(n=>String(n).padStart(2,'0')).join(':');
    points.push({
      id:customerId+':'+day+':'+row.startSecond+':'+points.length,index:points.length+1,
      date:source.dates[day],day,time,timeSeconds:t,lat:location[0],lon:location[1],
      evidence:kind,cell,area,qoe,drop:Boolean(drop),
      quality:qoe===null?'unscored':qoe<3?'poor':qoe<3.5?'normal':'good'
    });
  }
  const segments:CustomerRouteSegment[]=[];
  let skippedLongGaps=0;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];
    if(a.day!==b.day){skippedLongGaps++;continue;}
    const delta=b.timeSeconds-a.timeSeconds;
    if(delta<=0||delta>90*60){skippedLongGaps++;continue;}
    const meters=haversineMeters(a,b);
    if(meters>30000 || (a.evidence==='gnss'&&b.evidence==='gnss'&&meters/(delta/3600)>160000)) {
      skippedLongGaps++;continue;
    }
    if(meters<5)continue; // same-site repeat observations remain visible, not fake movement.
    segments.push({from:i-1,to:i,kind:a.evidence==='gnss'&&b.evidence==='gnss'?
      'gnss-observed-link':'reference-order',distanceM:Math.round(meters),minutes:Math.round(delta/60)});
  }
  return {customerId,name:customer.number,observations:points,sites:[...siteGroups.values()],
    segments,totalCalls:selected.length,gnssCount,cellReferenceCount,unlocatedCalls:noLocation,skippedLongGaps};
}
