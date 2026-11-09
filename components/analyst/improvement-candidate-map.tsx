'use client';
import { useEffect,useRef,useState } from 'react';
import type {Map as LeafletMap,LayerGroup} from 'leaflet';
import {callEvidenceUrl,type ImprovementCandidate} from '../../lib/analyst/improvement-candidates';
import {withQoeBasePath} from './document-link';
import {displayQualityLabel} from './display-quality-label';
import 'leaflet/dist/leaflet.css';
import styles from './improvement-candidate-map.module.css';

interface Props {
  candidates:ImprovementCandidate[];
  selectedId:string;
  onSelect:(id:string)=>void;
  observationPoints?:Array<{callId:string;customerId:string;date:string;lat:number;lon:number;kind:'gnss'|'reviewed-radio';observedAt?:string|null}>;
  hint?:string;
  presentation?:'legacy'|'proposal2';
  fullscreenEnhanced?:boolean;
}
const TILE_NOTICE='배경지도 불러오기 실패 · 후보 좌표는 계속 표시됩니다.';

export function ImprovementCandidateMap({candidates,selectedId,onSelect,observationPoints=[],hint,presentation='legacy',fullscreenEnhanced=false}:Props){
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
        // This small candidate layer uses SVG so queued Canvas redraws cannot
        // outlive the map when switching analysis modes.
        preferCanvas:false,zoomControl:false,scrollWheelZoom:true,
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
            radius:loc.radiusM,color:fullscreenEnhanced?(active?'#d8414c':'#9caeb8'):presentation==='proposal2'?(active?'#c98520':'#91a6b3'):active?'#c4474e':'#d37c74',
            dashArray:fullscreenEnhanced&&active?'7 5':'6 5',weight:active?2.5:1.6,
            fillColor:fullscreenEnhanced?'#f06c75':presentation==='proposal2'?'#efbf65':'#e87b78',fillOpacity:active?0.16:0.075,
            interactive:false,
          }).addTo(next);
        }
        const marker=L.circleMarker(p,{
          radius:active?12:9,weight:active?3:2,
          color:fullscreenEnhanced&&active?'#fff':presentation==='proposal2'&&active?'#a66014':'#fff',fillColor:fullscreenEnhanced?(active?'#d8414c':'#8fa4b3'):presentation==='proposal2'?(active?'#f6bb45':'#8fa4b3'):candidate.kind==='spatial'?'#d44956':'#3869a6',
          fillOpacity:1,
        }).addTo(next);
        const content=document.createElement('div');
        const head=document.createElement('strong');
        head.textContent=presentation==='proposal2'?'후보 지역 '+(index+1): (index+1)+'. '+displayQualityLabel(candidate.label);
        content.appendChild(head);
        const detail=document.createElement('p');
        detail.textContent=candidate.kind==='spatial'
          ? (presentation==='proposal2'?'서로 다른 고객 '+candidate.discovery.distinctPoorCustomers+'명 · '+candidate.discovery.days+'일 관측 · 신규 고객 '+candidate.validation.newPoorCustomers+'명 재관측':'GPS 연관 통화 반복 · 신규 고객 '+candidate.validation.newPoorCustomers+'명')
          : '기지국 참고점 · 실제 단말 위치 아님';
        content.appendChild(detail);
        marker.bindPopup(content);
        if(fullscreenEnhanced){
          marker.bindTooltip(active?'저QoE 반복 후보 지역 '+(index+1):'후보 '+(index+1),{
            permanent:active||index<5,direction:'top',offset:[0,active?-16:-12],
            className:active?'quality-candidate-label quality-candidate-label-active':'quality-candidate-label',
            opacity:1,
          });
          if(active&&loc.radiusM!=null){
            // A label on the east edge describes the actual candidate display radius,
            // not DBSCAN eps or a GNSS location-error interval.
            const longitudeOffset=loc.radiusM/(111320*Math.cos(loc.lat*Math.PI/180));
            L.marker([loc.lat,loc.lon+longitudeOffset],{
              interactive:false,
              icon:L.divIcon({className:'quality-candidate-radius-label',html:String(Math.round(loc.radiusM))+'m',iconSize:[48,22],iconAnchor:[24,11]})
            }).addTo(next);
          }
        }else{
          marker.bindTooltip(presentation==='proposal2'?'후보 지역 '+(index+1):displayQualityLabel(candidate.label));
        }
        const markerElement=marker.getElement();
        if(markerElement){
          markerElement.setAttribute('data-candidate-id',candidate.id);
          markerElement.setAttribute('role','button');
          markerElement.setAttribute('tabindex','0');
          markerElement.setAttribute('aria-label','후보 지역 '+(index+1)+' 지도에서 선택');
          markerElement.addEventListener('keydown',event=>{
            if(event instanceof KeyboardEvent&&(event.key==='Enter'||event.key===' ')){event.preventDefault();callback.current(candidate.id);}
          });
        }
        marker.on('click',()=>callback.current(candidate.id));
        if(active)marker.bringToFront();
      });
      // All original GNSS observations associated with the SELECTED candidate,
      // not just the CDR-end representative medoid. These are real MDT sample
      // coordinates, never proven RTCP impairment onset locations.
      const selected=candidates.find(item=>item.id===selectedId);
      for(const point of observationPoints){
        const loc:[number,number]=[point.lat,point.lon];coords.push(loc);
        const dot=L.circleMarker(loc,{radius:4,weight:1,color:'#fff',fillColor:point.kind==='gnss'?'#e7a13d':'#8376c5',fillOpacity:.75}).addTo(next);
        dot.bindTooltip(point.date+' · '+(point.kind==='gnss'?'실측 GPS':'검토 통과 삼각 측량'));
      }
      for(const point of selected?.relatedGnss??[]){
        const loc:[number,number]=[point.lat,point.lon];
        const dot=L.circleMarker(loc,{
          radius:point.validationDay?5.5:4.5,weight:1.2,color:'#fff',
          fillColor:point.validationDay?'#13a890':'#e7a13d',fillOpacity:0.88,
        }).addTo(next);
        const popup=document.createElement('div');
        const title=document.createElement('strong');
        title.textContent='원본 MDT GPS · '+point.date.slice(5);
        popup.appendChild(title);
        const info=document.createElement('p');
        info.textContent=(point.observedAt?.slice(11,19)??'시각 미제공')+
          ' · '+point.lat.toFixed(6)+', '+point.lon.toFixed(6)+
          (point.phase?' · '+point.phase:'')+
          (point.validationDay?' · 10/30 재현':'');
        popup.appendChild(info);
        const note=document.createElement('small');
        note.textContent='실제 GPS 관측점이며 QoE 저하 시점 좌표는 아닙니다.';
        popup.appendChild(note);
        const link=document.createElement('a');
        link.href=withQoeBasePath(callEvidenceUrl({date:point.date,customerId:point.customerId,
          callId:point.callId,mos:0,endCellId:'',start:''}));
        link.textContent='원본 통화 상세';
        link.style.display='block';link.style.marginTop='5px';
        popup.appendChild(link);
        dot.bindPopup(popup);
        dot.bindTooltip(point.date.slice(5)+' · GPS');
      }
      if(!fitOnce.current&&coords.length){
        fitOnce.current=true;
        // Establish the initial view immediately so a mode switch cannot leave
        // a deferred zoom transition targeting an already removed map.
        map.fitBounds(L.latLngBounds(coords),{padding:[38,38],maxZoom:14,animate:false});
      }else{
        const chosen=candidates.find(x=>x.id===selectedId);
        const focus=chosen?.location??chosen?.relatedGnss?.[0];
        if(focus)
          map.panTo([focus.lat,focus.lon],{animate:true,duration:.35});
      }
    }).catch(()=>{if(current)setNotice('지도 후보 표시 실패');});
    return()=>{current=false;};
  },[candidates,map,selectedId,observationPoints,presentation,fullscreenEnhanced]);
  return <div className={[styles.container,fullscreenEnhanced?styles.referenceMap:''].filter(Boolean).join(' ')} aria-label="개선 후보 지도">
    <div className={styles.map} ref={host}/>
    {notice&&<output className={styles.notice}>{notice}</output>}
    <div className={styles.hint}>{hint??'빨간 원: QoE 저하고객 중복 위치 · 주황 점: 원본 GPS · 초록 점: 10/30 GPS · 파란 점: 기지국'}</div>
  </div>;
}
