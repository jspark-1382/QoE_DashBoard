import type {CustomerRouteLocation} from './customer-screening-route';

export interface CustomerRouteCluster {
  locations:CustomerRouteLocation[];
  lat:number;
  lon:number;
  poorCalls:number;
  totalCalls:number;
  endpoint:boolean;
}

/** Match the actual rendered circle, including room for a cluster's place count. */
export function routeMarkerRadius(label:string,clustered=false):number {
  return Math.max(clustered?26:18,6+label.length*3.3);
}

function orderedLocations(locations:readonly CustomerRouteLocation[]):CustomerRouteLocation[] {
  const identity=(location:CustomerRouteLocation)=>location.evidence+'|'+
    location.observations.map(point=>point.id).sort().join('|');
  return [...new Set(locations)].sort((a,b)=>a.lat-b.lat||a.lon-b.lon||
    (identity(a)<identity(b)?-1:identity(a)>identity(b)?1:0));
}

interface Bubble {
  cluster:CustomerRouteCluster;
  x:number;
  y:number;
  radius:number;
  order:number;
}
interface Collision {a:Bubble;b:Bubble;distanceSquared:number}
const compareCollision=(a:Collision,b:Collision)=>a.distanceSquared-b.distanceSquared||
  a.a.order-b.a.order||a.b.order-b.b.order;

/** A small min-heap avoids rescanning every pair after each merge. */
class Collisions {
  private values:Collision[]=[];
  push(value:Collision) {
    const values=this.values;
    let index=values.length;
    values.push(value);
    while(index>0){
      const parent=(index-1)>>1;
      if(compareCollision(values[parent],value)<=0)break;
      values[index]=values[parent];index=parent;
    }
    values[index]=value;
  }
  pop():Collision|undefined {
    const values=this.values,first=values[0],last=values.pop();
    if(values.length&&last){
      let index=0;
      while(index*2+1<values.length){
        let child=index*2+1;
        if(child+1<values.length&&compareCollision(values[child+1],values[child])<0)child++;
        if(compareCollision(last,values[child])<=0)break;
        values[index]=values[child];index=child;
      }
      values[index]=last;
    }
    return first;
  }
}

/**
 * Group screen collisions only: recorded coordinates and observation identities stay intact.
 * Reprojecting at each zoom naturally separates nearby locations. At maximum zoom,
 * callers can fan out coincident source groups and show their individual call lists.
 */
export function clusterCustomerRouteLocations(
  locations:readonly CustomerRouteLocation[],
  project:(location:CustomerRouteLocation)=>{x:number;y:number},
  zoom:number,
  maxZoom=19,
):CustomerRouteCluster[] {
  const ordered=orderedLocations(locations);
  const rank=new Map(ordered.map((location,index)=>[location,index]));
  const bubbles=ordered.map((location,order):Bubble=>{
    const point=project(location);
    if(!Number.isFinite(point.x)||!Number.isFinite(point.y))throw new RangeError('Route projection must be finite');
    return {cluster:{locations:[location],lat:location.lat,lon:location.lon,
      poorCalls:location.poorCalls,totalCalls:location.totalCalls,endpoint:location.endpoint},
    x:point.x,y:point.y,radius:routeMarkerRadius(location.poorCalls+'/'+location.totalCalls),order};
  });
  if(zoom>=maxZoom)return bubbles.map(bubble=>bubble.cluster);

  const active=new Set(bubbles),collisions=new Collisions();
  const addCollision=(a:Bubble,b:Bubble)=>{
    if(a.order>b.order)[a,b]=[b,a];
    const distanceSquared=(a.x-b.x)**2+(a.y-b.y)**2;
    if(distanceSquared<=(a.radius+b.radius+6)**2)collisions.push({a,b,distanceSquared});
  };
  for(let i=0;i<bubbles.length;i++)for(let j=i+1;j<bubbles.length;j++)addCollision(bubbles[i],bubbles[j]);
  let collision:Collision|undefined;
  while((collision=collisions.pop())){
    const {a,b}=collision;
    if(!active.has(a)||!active.has(b))continue;
    active.delete(a);active.delete(b);
    const members=[...a.cluster.locations,...b.cluster.locations].sort((left,right)=>rank.get(left)!-rank.get(right)!);
    const aWeight=a.cluster.locations.length,bWeight=b.cluster.locations.length,total=aWeight+bWeight;
    const poorCalls=a.cluster.poorCalls+b.cluster.poorCalls,totalCalls=a.cluster.totalCalls+b.cluster.totalCalls;
    const merged:Bubble={
      cluster:{locations:members,lat:(a.cluster.lat*aWeight+b.cluster.lat*bWeight)/total,
        lon:(a.cluster.lon*aWeight+b.cluster.lon*bWeight)/total,
        poorCalls,totalCalls,endpoint:a.cluster.endpoint||b.cluster.endpoint},
      x:(a.x*aWeight+b.x*bWeight)/total,y:(a.y*aWeight+b.y*bWeight)/total,
      radius:routeMarkerRadius(poorCalls+'/'+totalCalls,true),order:Math.min(a.order,b.order),
    };
    // A larger merged bubble can touch a location that neither original circle touched.
    for(const other of active)addCollision(merged,other);
    active.add(merged);
  }
  return [...active].sort((a,b)=>a.order-b.order).map(bubble=>bubble.cluster);
}

export interface CustomerRoutePlacement {location:CustomerRouteLocation;x:number;y:number}

/**
 * Display-only maximum-zoom packing. Preserve a stable set of original positions,
 * then search outward for the nearest safe ring for each remaining circle.
 * A global spatial index also prevents shifted circles overlapping another group.
 */
export function separateRouteLocations(
  locations:readonly CustomerRouteLocation[],
  project:(location:CustomerRouteLocation)=>{x:number;y:number},
):CustomerRoutePlacement[] {
  const candidates=orderedLocations(locations).map(location=>{
    const point=project(location);
    if(!Number.isFinite(point.x)||!Number.isFinite(point.y))throw new RangeError('Route projection must be finite');
    return {location,x:point.x,y:point.y,radius:routeMarkerRadius(location.poorCalls+'/'+location.totalCalls)};
  });
  if(!candidates.length)return [];
  type Placed=typeof candidates[number];
  const cellSize=2*Math.max(...candidates.map(point=>point.radius))+6;
  const cells=new Map<string,Placed[]>(),placed=new Map<CustomerRouteLocation,Placed>();
  const colliding=(x:number,y:number,radius:number)=>{
    const found:Placed[]=[],cx=Math.floor(x/cellSize),cy=Math.floor(y/cellSize);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
      for(const other of cells.get((cx+dx)+'|'+(cy+dy))??[]){
        if((x-other.x)**2+(y-other.y)**2<(radius+other.radius+6)**2-1e-7)found.push(other);
      }
    }
    return found;
  };
  const add=(point:Placed)=>{
    const key=Math.floor(point.x/cellSize)+'|'+Math.floor(point.y/cellSize);
    const contents=cells.get(key)??[];
    contents.push(point);cells.set(key,contents);placed.set(point.location,point);
  };
  const pending:Placed[]=[];
  // Reserve non-overlapping original locations before displaced circles consume space.
  for(const point of candidates){
    if(colliding(point.x,point.y,point.radius).length)pending.push(point);
    else add(point);
  }
  for(const point of pending){
    const blockers=colliding(point.x,point.y,point.radius);
    const minDistance=Math.max(1e-5,...blockers.map(other=>
      point.radius+other.radius+6-Math.hypot(point.x-other.x,point.y-other.y)));
    let found:Placed|undefined;
    for(let distance=minDistance;!found;distance+=6){
      const samples=Math.max(12,Math.ceil(2*Math.PI*distance/10));
      for(let sample=0;sample<samples;sample++){
        const angle=2*Math.PI*sample/samples;
        const x=point.x+Math.cos(angle)*distance,y=point.y+Math.sin(angle)*distance;
        if(!colliding(x,y,point.radius).length){found={...point,x,y};break;}
      }
    }
    add(found);
  }
  return candidates.map(({location})=>{
    const {x,y}=placed.get(location)!;
    return {location,x,y};
  });
}
