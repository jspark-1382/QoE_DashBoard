'use client';

import { useEffect, useRef, useState } from 'react';
import type { DatasetMetric, HeatPoint } from '@/lib/dataset';
import 'leaflet/dist/leaflet.css';

type Props={apiKey:string;center:{lat:number;lon:number};points:HeatPoint[];metric:DatasetMetric;selectedKey:string;onSelect:(key:string)=>void};

function pointColor(point:HeatPoint,metric:DatasetMetric){
  const value=point[metric];
  if(value==null)return '#506575';
  const bands:Record<DatasetMetric,[number,number]>={qoe:[2.5,3.6],mos:[3,4],rsrp:[-105,-92],rsrq:[-15,-10],sinr:[3,10]};
  const [bad,good]=bands[metric];
  if(value<bad)return '#ff3d58';
  if(value<good)return '#ffc83d';
  return '#43d890';
}

export function VworldMap({apiKey,center,points,metric,selectedKey,onSelect}:Props){
  const hostRef=useRef<HTMLDivElement>(null);
  const mapRef=useRef<import('leaflet').Map|null>(null);
  const layerRef=useRef<import('leaflet').LayerGroup|null>(null);
  const tileRef=useRef<import('leaflet').TileLayer|null>(null);
  const onSelectRef=useRef(onSelect);
  const [failed,setFailed]=useState(false);
  const [ready,setReady]=useState(false);
  onSelectRef.current=onSelect;

  useEffect(()=>{
    if(!hostRef.current||mapRef.current)return;
    let active=true;
    import('leaflet').then(L=>{
      if(!active||!hostRef.current)return;
      const map=L.map(hostRef.current,{zoomControl:false,attributionControl:true,preferCanvas:true}).setView([center.lat,center.lon],14);
      L.control.zoom({position:'bottomright'}).addTo(map);
      mapRef.current=map;layerRef.current=L.layerGroup().addTo(map);setReady(true);
    });
    return()=>{active=false;mapRef.current?.remove();mapRef.current=null;layerRef.current=null};
  },[center.lat,center.lon]);

  useEffect(()=>{
    if(!mapRef.current)return;
    tileRef.current?.remove();tileRef.current=null;setFailed(false);
    if(!apiKey)return;
    import('leaflet').then(L=>{
      if(!mapRef.current)return;
      const tiles=L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${apiKey}/Satellite/{z}/{y}/{x}.jpeg`,{maxZoom:19,attribution:'© VWorld 공간정보 오픈플랫폼'});
      tiles.on('tileerror',()=>setFailed(true));tiles.on('load',()=>setFailed(false));tiles.addTo(mapRef.current);tileRef.current=tiles;
    });
  },[apiKey,ready]);

  useEffect(()=>{
    if(!mapRef.current||!layerRef.current)return;
    const map=mapRef.current;
    import('leaflet').then(L=>{
      if(!layerRef.current)return;
      layerRef.current.clearLayers();
      const renderer=L.canvas({padding:.5});
      points.forEach(point=>{
        const key=`${point.rat}-${point.pci}`;const selected=key===selectedKey;
        const circle=L.circleMarker([point.lat,point.lon],{renderer,radius:selected?15:Math.min(13,4+Math.sqrt(point.count)*.7),fillColor:pointColor(point,metric),fillOpacity:selected?.9:.56,color:selected?'#ffffff':'transparent',weight:selected?3:0,opacity:1});
        circle.on('click',()=>onSelectRef.current(key));circle.addTo(layerRef.current!);
      });
      if(points.length){const bounds=L.latLngBounds(points.map(point=>[point.lat,point.lon] as [number,number]));map.fitBounds(bounds,{padding:[24,24],maxZoom:15,animate:false});}
    });
  },[points,metric,selectedKey,ready]);

  return <><div ref={hostRef} className="vworld-map connected"/>{!apiKey&&<div className="vworld-status"><b>VWorld 데이터 레이어 준비됨</b><span>API 키를 연결하면 동일 좌표 위에 위성지도가 표시됩니다.</span></div>}{failed&&<div className="vworld-status error"><b>VWorld 지도 연결을 확인하세요</b><span>키의 허용 도메인과 사용 권한을 확인해 주세요.</span></div>}</>;
}
