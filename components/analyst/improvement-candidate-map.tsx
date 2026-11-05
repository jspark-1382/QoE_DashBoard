'use client';
import { useEffect,useRef,useState } from 'react';
import type {Map as LeafletMap,LayerGroup} from 'leaflet';
import {callEvidenceUrl,type ImprovementCandidate} from '../../lib/analyst/improvement-candidates';
import 'leaflet/dist/leaflet.css';
import styles from './improvement-candidate-map.module.css';

interface Props {
  candidates:ImprovementCandidate[];
  selectedId:string;
  onSelect:(id:string)=>void;
}
const TILE_NOTICE='배경지도 불러오기 실패 · 후보 좌표는 계속 표시됩니다.';

export function ImprovementCandidateMap({candidates,selectedId,onSelect}:Props){
  const host=useRef<HTMLDivElement|null>(null);
  const live=useRef<LeafletMap|null>(null);
  const layer=useRef<LayerGroup|null>(null);
  const callback=useRef(onSelect);
  const [map,setMap]=useState<LeafletMap|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const fitOnce=useRef(false);
  useEffect(()=>{callback.current=onSelect;},[onSelect]);
  useEffect(()=>{
    let current=true;
    void import('leaflet').then(L=>{
      if(!current||!host.current)return;
      const initialized=L.map(host.current,{
        preferCanvas:true,zoomControl:false,scrollWheelZoom:true,
        wheelDebounceTime:35,wheelPxPerZoomLevel:75,zoomSnap:0.5,zoomDelta:0.5,
      })
        .setView([37.483,127.057],13);
      live.current=initialized;
      L.control.zoom({position:'bottomright'}).addTo(initialized);
      const key=(import.meta as ImportMeta & {env:{VITE_VWORLD_API_KEY?:string}})
        .env.VITE_VWORLD_API_KEY?.trim();
      if(key){
        const tile=L.tileLayer(
          'https://api.vworld.kr/req/wmts/1.0.0/'+key+'/Base/{z}/{y}/{x}.png',
          {maxZoom:19,attribution:'© VWorld 공간정보 오픈플랫폼'},
        );
        tile.on('tileerror',()=>{if(current)setNotice(TILE_NOTICE);});
        tile.addTo(initialized);
      }else setNotice('배경지도 키 미설정 · 후보 위치는 계속 표시');
      const watcher=new ResizeObserver(()=>initialized.invalidateSize());
      watcher.observe(host.current);
      initialized.on('unload',()=>watcher.disconnect());
      setMap(initialized);
    }).catch(()=>{if(current)setNotice('지도 초기화 실패');});
    return ()=>{
      current=false;
      layer.current?.remove();
      layer.current=null;
      live.current?.remove();
      live.current=null;
      setMap(null);
      fitOnce.current=false;
    };
  },[]);
  useEffect(()=>{
    if(!map)return;
    let current=true;
    void import('leaflet').then(L=>{
      if(!current)return;
      layer.current?.remove();
      const next=L.layerGroup().addTo(map);
      layer.current=next;
      const coords:[number,number][]=[];
      candidates.forEach((candidate,index)=>{
        const loc=candidate.location;
        if(!loc)return;
        const p:[number,number]=[loc.lat,loc.lon];
        coords.push(p);
        const active=candidate.id===selectedId;
        if(candidate.kind==='spatial' && loc.radiusM!=null){
          L.circle(p,{
            radius:loc.radiusM,color:active?'#c4474e':'#d37c74',
            dashArray:'6 5',weight:active?2.4:1.6,
            fillColor:'#e87b78',fillOpacity:active?0.16:0.075,
            interactive:false,
          }).addTo(next);
        }
        const marker=L.circleMarker(p,{
          radius:active?12:9,weight:active?3:2,
          color:'#fff',fillColor:candidate.kind==='spatial'?'#d44956':'#3869a6',
          fillOpacity:1,
        }).addTo(next);
        const content=document.createElement('div');
        const head=document.createElement('strong');
        head.textContent=(index+1)+'. '+candidate.label;
        content.appendChild(head);
        const detail=document.createElement('p');
        detail.textContent=candidate.kind==='spatial'
          ? 'GNSS 연관 통화 반복 · 신규 고객 '+candidate.validation.newPoorCustomers+'명'
          : '기지국 참고점 · 실제 단말 위치 아님';
        content.appendChild(detail);
        marker.bindPopup(content);
        marker.bindTooltip(candidate.label);
        marker.on('click',()=>callback.current(candidate.id));
        if(active)marker.bringToFront();
      });
      // All original GNSS observations associated with the SELECTED candidate,
      // not just the CDR-end representative medoid. These are real MDT sample
      // coordinates, never proven RTCP impairment onset locations.
      const selected=candidates.find(item=>item.id===selectedId);
      for(const point of selected?.relatedGnss??[]){
        const loc:[number,number]=[point.lat,point.lon];
        const dot=L.circleMarker(loc,{
          radius:point.validationDay?5.5:4.5,weight:1.2,color:'#fff',
          fillColor:point.validationDay?'#13a890':'#e7a13d',fillOpacity:0.88,
        }).addTo(next);
        const popup=document.createElement('div');
        const title=document.createElement('strong');
        title.textContent='원본 MDT GNSS · '+point.date.slice(5);
        popup.appendChild(title);
        const info=document.createElement('p');
        info.textContent=(point.observedAt?.slice(11,19)??'시각 미제공')+
          ' · '+point.lat.toFixed(6)+', '+point.lon.toFixed(6)+
          (point.phase?' · '+point.phase:'')+
          (point.validationDay?' · 10/30 재현':'');
        popup.appendChild(info);
        const note=document.createElement('small');
        note.textContent='실제 GNSS 관측점이며 MOS 저하 시점 좌표는 아닙니다.';
        popup.appendChild(note);
        const link=document.createElement('a');
        link.href=callEvidenceUrl({date:point.date,customerId:point.customerId,
          callId:point.callId,mos:0,endCellId:'',start:''});
        link.textContent='원본 통화 상세';
        link.style.display='block';link.style.marginTop='5px';
        popup.appendChild(link);
        dot.bindPopup(popup);
        dot.bindTooltip(point.date.slice(5)+' · GNSS');
      }
      if(!fitOnce.current&&coords.length){
        fitOnce.current=true;
        map.fitBounds(L.latLngBounds(coords),{padding:[38,38],maxZoom:14});
      }else{
        const chosen=candidates.find(x=>x.id===selectedId);
        const focus=chosen?.location??chosen?.relatedGnss?.[0];
        if(focus)
          map.panTo([focus.lat,focus.lon],{animate:true,duration:.35});
      }
    }).catch(()=>{if(current)setNotice('지도 후보 표시 실패');});
    return()=>{current=false;};
  },[candidates,map,selectedId]);
  return <div className={styles.container} aria-label="개선 후보 지도">
    <div className={styles.map} ref={host}/>
    {notice&&<div className={styles.notice} role="status">{notice}</div>}
    <div className={styles.hint}>빨간 원: MOS 저하고객 중복 위치 · 주황 점: 원본 GNSS · 초록 점: 10/30 GNSS · 파란 점: 기지국</div>
  </div>;
}
