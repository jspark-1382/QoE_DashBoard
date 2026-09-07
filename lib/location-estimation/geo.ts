import type { Point } from './types';
const EARTH_M = 6371008.8;
const rad = Math.PI / 180;
export function distanceM(a: Point, b: Point) {
  const dlat = (b.latitude-a.latitude)*rad, dlon = (b.longitude-a.longitude)*rad;
  const h = Math.sin(dlat/2)**2 + Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(dlon/2)**2;
  return 2*EARTH_M*Math.asin(Math.sqrt(Math.min(1,h)));
}
export function offsetPoint(origin: Point, eastM: number, northM: number): Point {
  return { latitude: origin.latitude + northM/EARTH_M/rad, longitude: origin.longitude + eastM/(EARTH_M*Math.cos(origin.latitude*rad))/rad };
}
export function ring(origin: Point, radiusM: number, count = 96): [number,number][] {
  return Array.from({length:count},(_,i)=> {
    const p=offsetPoint(origin, radiusM*Math.cos(i/count*2*Math.PI), radiusM*Math.sin(i/count*2*Math.PI));
    return [p.latitude,p.longitude];
  });
}
