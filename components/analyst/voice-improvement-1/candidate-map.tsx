'use client';
import { useEffect,useRef,useState } from 'react';
import type { Map as LeafletMap,LayerGroup } from 'leaflet';
import type { SpatialCandidate } from '../../../lib/analyst/voice-improvement-1/types';
import type { ObservationPoint } from './map-evidence';
import 'leaflet/dist/leaflet.css';
import styles from './workspace.module.css';

type NearbyPoint=SpatialCandidate['nearbyPoints'][number];
interface Props { candidates:readonly SpatialCandidate[];nearbyPoints:readonly NearbyPoint[];observationPoints:readonly ObservationPoint[];selectedId:string;onSelect:(id:string)=>void; }
export function CandidateMap({candidates,nearbyPoints,observationPoints,selectedId,onSelect}:Props){
 const host=useRef<HTMLDivElement>(null),live=useRef<LeafletMap|null>(null),layer=useRef<LayerGroup|null>(null);
 const callback=useRef(onSelect);
 const [map,setMap]=useState<LeafletMap|null>(null),[notice,setNotice]=useState('');
 useEffect(()=>{callback.current=onSelect;},[onSelect]);
 useEffect(()=>{
  let active=true;
  void import('leaflet').then(L=>{
   if(!active||!host.current)return;
   const next=L.map(host.current,{zoomControl:false,scrollWheelZoom:true,preferCanvas:true,wheelPxPerZoomLevel:75}).setView([37.49,127.06],13);
   live.current=next;L.control.zoom({position:'bottomright'}).addTo(next);
   const key=(import.meta as ImportMeta & {env:{VITE_VWORLD_API_KEY?:string}}).env.VITE_VWORLD_API_KEY?.trim();
   const tile=key?L.tileLayer('https://api.vworld.kr/req/wmts/1.0.0/'+key+'/Base/{z}/{y}/{x}.png',{maxZoom:19,attribution:'© VWorld'}):L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'});
   tile.on('tileerror',()=>{if(active)setNotice('배경지도 연결을 확인해 주세요. 후보 좌표는 계속 표시됩니다.');});tile.addTo(next);
   const observer=new ResizeObserver(()=>next.invalidateSize());observer.observe(host.current);next.on('unload',()=>observer.disconnect());
   setMap(next);
  }).catch(()=>{if(active)setNotice('지도를 불러오지 못했습니다. 오른쪽 후보 목록에서 근거를 확인할 수 있습니다.');});
  return()=>{active=false;layer.current?.remove();live.current?.remove();live.current=null;};
 },[]);
 useEffect(()=>{
  if(!map)return;let active=true;
  void import('leaflet').then(L=>{
   if(!active)return;layer.current?.remove();const group=L.layerGroup().addTo(map);layer.current=group;
   const coords:[number,number][]=[];
   for(const candidate of candidates){
    const p:[number,number]=[candidate.medoid.lat,candidate.medoid.lon];coords.push(p);const chosen=candidate.id===selectedId;
    L.circle(p,{radius:candidate.displayRadiusM,color:chosen?'#d06a40':'#8c98b0',dashArray:'6 6',weight:chosen?2:1,fillOpacity:chosen?.09:.025,interactive:false}).addTo(group);
    const marker=L.circleMarker(p,{radius:chosen?13:9,color:'#fff',weight:3,fillColor:chosen?'#d26b44':'#213e67',fillOpacity:1}).addTo(group);
    marker.bindTooltip('조사 '+candidate.rank+'순위 · 현장 확인 필요');marker.on('click',()=>callback.current(candidate.id));
   }
   for(const point of nearbyPoints){
    const p:[number,number]=[point.lat,point.lon];const radio=point.kind==='reviewed-radio';
    const color=point.role==='discovery-member'?'#e19a3e':point.role==='validation-new'?'#098f87':'#7773bd';
    const marker=radio?L.marker(p,{icon:L.divIcon({html:'<span style="display:block;width:11px;height:11px;background:'+color+';border:2px solid white;transform:rotate(45deg)"></span>',className:'',iconSize:[13,13]})}):L.circleMarker(p,{radius:4.5,color:'#fff',weight:1,fillColor:color,fillOpacity:.9});
    const text=document.createElement('span');text.textContent=point.date+' · '+(radio?'◆ 검토 통과 삼각 측량':'● GPS')+' · '+(point.role==='discovery-member'?'발견 구성 통화':point.role==='validation-new'?'검증 신규 고객':'검증 기존 고객');marker.bindTooltip(text).addTo(group);
   }
   for(const point of observationPoints){
    const p:[number,number]=[point.lat,point.lon];
    if(!candidates.length)coords.push(p);
    const radio=point.kind==='reviewed-radio';
    const marker=radio?L.marker(p,{icon:L.divIcon({html:'<span style="display:block;width:11px;height:11px;background:#6683a1;border:2px solid white;transform:rotate(45deg)"></span>',className:'',iconSize:[13,13]})}):L.circleMarker(p,{radius:5,color:'#fff',weight:1.5,fillColor:'#6683a1',fillOpacity:.9});
    const text=document.createElement('span');text.textContent=point.date+' · '+(radio?'◆ 검토 통과 삼각 측량':'● GPS')+' · 저QoE 연결 관측점 · 반복 지역 후보로 선정되지 않았습니다.';
    marker.bindTooltip(text).addTo(group);
   }
   if(coords.length)map.fitBounds(L.latLngBounds(coords),{padding:[55,55],maxZoom:15});
  });return()=>{active=false;};
 },[map,candidates,nearbyPoints,observationPoints,selectedId]);
 return <div className={styles.mapWrap}><div ref={host} className={styles.map} aria-label={candidates.length?'규칙 기반 조사 후보 지도':'저QoE 연결 관측점 지도'}/>{notice&&<output className={styles.mapNotice}>{notice}</output>}<div className={styles.mapCaption}>{candidates.length?'점선 원: 조사 표시 범위 · 위치 오차 / 확정 불량 영역이 아닙니다.':'저QoE 통화와 연결된 관측·추정 위치입니다. 반복 지역 후보로 선정되지 않았습니다.'}</div></div>;
}
