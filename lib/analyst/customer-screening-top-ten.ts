import type {PoorCall,ScreeningRow,ScreeningSource} from './customer-screening';
import {buildCustomerRoute,type CustomerRoute} from './customer-screening-route';

export const TOP_CUSTOMER_ROUTE_ZOOM=19;
const ROUTE_COLORS=['#dc3557','#2563eb','#059669','#9333ea','#ea580c','#0891b2','#b45309','#db2777','#4f46e5','#4d7c0f'];
export interface TopCustomerRoute {rank:number;color:string;route:CustomerRoute}
export function buildTopCustomerRoutes(source:ScreeningSource,rows:readonly ScreeningRow[],
  start:string,end:string,from:string,to:string):TopCustomerRoute[]{
  return rows.slice(0,10).flatMap((row,index)=>{
    if(row.poor<=0)return [];
    const route=buildCustomerRoute(source,row.id,start,end,from,to);
    return route?[{rank:index+1,color:ROUTE_COLORS[index],route}]:[];
  });
}

export interface TopCustomerMapPoint {
  id:string;number:string;rank:number;poor:number;lat:number;lon:number;
  evidence:'gnss'|'bye-cell';locationCalls:number;
}
export interface TopCustomerMap {
  total:number;unlocated:number;points:TopCustomerMapPoint[];
}
export interface TopCustomerBubble {
  lat:number;lon:number;poor:number;customers:TopCustomerMapPoint[];
}
const located=(p:PoorCall)=>typeof p.lat==='number'&&Number.isFinite(p.lat)&&Math.abs(p.lat)<=90&&
  typeof p.lon==='number'&&Number.isFinite(p.lon)&&Math.abs(p.lon)<=180&&(p.lat!==0||p.lon!==0)&&
  (p.evidence==='gnss'||p.evidence==='bye-cell');

/** Keep the displayed list's first ten ranks and choose an existing poor-call location. */
export function buildTopCustomerMap(rows:readonly ScreeningRow[]):TopCustomerMap{
  const points:TopCustomerMapPoint[]=[];
  let total=0,unlocated=0;
  rows.slice(0,10).forEach((row,index)=>{
    if(row.poor<=0)return;
    total++;
    const groups=new Map<string,{point:PoorCall;count:number}>();
    for(const p of row.badCalls){
      if(!located(p))continue;
      const key=p.evidence+':'+p.lat!.toFixed(5)+':'+p.lon!.toFixed(5);
      const old=groups.get(key);
      if(old){old.count++;if(p.date>old.point.date||(p.date===old.point.date&&p.second>old.point.second))old.point=p;}
      else groups.set(key,{point:p,count:1});
    }
    const representative=[...groups.values()].sort((a,b)=>b.count-a.count||
      Number(b.point.evidence==='gnss')-Number(a.point.evidence==='gnss')||
      b.point.date.localeCompare(a.point.date)||b.point.second-a.point.second)[0];
    if(!representative){unlocated++;return;}
    const p=representative.point;
    points.push({id:row.id,number:row.number,rank:index+1,poor:row.poor,
      lat:p.lat!,lon:p.lon!,evidence:p.evidence as 'gnss'|'bye-cell',locationCalls:representative.count});
  });
  return {total,unlocated,points};
}

/** Nearby ranks combine on overview zooms; identical coordinates always share a selectable bubble. */
export function groupTopCustomers(points:readonly TopCustomerMapPoint[],zoom:number,
  project:(p:TopCustomerMapPoint)=>{x:number;y:number}):TopCustomerBubble[]{
  const groups=new Map<string,TopCustomerBubble>();
  // Distance-based connected components avoid arbitrary 9+1 splits at grid edges.
  const pixels=points.map(project),parents=points.map((_,i)=>i);
  const root=(i:number):number=>parents[i]===i?i:(parents[i]=root(parents[i]));
  if(zoom<17)for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){
    if(Math.hypot(pixels[i].x-pixels[j].x,pixels[i].y-pixels[j].y)<=56)
      parents[root(j)]=root(i);
  }
  for(const [index,p] of points.entries()){
    const key=zoom>=17?p.lat.toFixed(5)+':'+p.lon.toFixed(5):String(root(index));
    const group=groups.get(key);
    if(group){group.customers.push(p);group.poor+=p.poor;}
    else groups.set(key,{lat:p.lat,lon:p.lon,poor:p.poor,customers:[p]});
  }
  return [...groups.values()];
}
export function topCustomerBubbleDiameter(poorCalls:number,zoom:number):number{
  return Math.round(Math.max(32,Math.min(76,
    (30+Math.sqrt(Math.max(1,poorCalls))*3)*2**((zoom-13)*.13))));
}
