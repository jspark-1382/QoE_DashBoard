'use client';

import {useEffect,useRef,useState} from 'react';
import type {LayerGroup,Map as LeafletMap} from 'leaflet';
import {metricColor,metricLabel,metricSteps,metricUnit,metricValue,validScreeningBoundaries,
  type ScreeningBoundary,type ScreeningGeography,type ScreeningMapMetric,type ScreeningMapView} from '../../lib/analyst/customer-screening-map';
import type {CustomerRoute} from '../../lib/analyst/customer-screening-route';
import 'leaflet/dist/leaflet.css';
import styles from './customer-screening.module.css';

interface Props {
  geography:ScreeningGeography;mode:ScreeningMapView;metric:ScreeningMapMetric;sourceRevision:string;
  selectedAreaId:string;selectedCellId:string;customerRoute:CustomerRoute|null;
  onSelectArea:(id:string)=>void;onSelectCell:(id:string)=>void;onSelectCustomer:(id:string)=>void;
}
const LABEL_COLORS=['#e9eef4','#f6d7a4','#eda36f','#e66b64','#b72f50'];
export function CustomerScreeningMap({
  geography,mode,metric,sourceRevision,selectedAreaId,selectedCellId,customerRoute,
  onSelectArea,onSelectCell,onSelectCustomer,
}:Props) {
  const host=useRef<HTMLDivElement|null>(null);
  const live=useRef<LeafletMap|null>(null);
  const overlay=useRef<LayerGroup|null>(null);
  const routeOverlay=useRef<LayerGroup|null>(null);
  const fitMode=useRef('');
  const callbacks=useRef({onSelectArea,onSelectCell,onSelectCustomer});
  const [map,setMap]=useState<LeafletMap|null>(null);
  const [boundaries,setBoundaries]=useState<ScreeningBoundary|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  useEffect(()=>{callbacks.current={onSelectArea,onSelectCell,onSelectCustomer};},[onSelectArea,onSelectCell,onSelectCustomer]);
  useEffect(()=>{
    const controller=new AbortController();
    setBoundaries(null);
    void fetch('/qoe/customer-screening-data/administrative-boundaries-v1.json',{signal:controller.signal})
      .then(response=>{if(!response.ok)throw Error('행정동 원본 경계 파일 없음');return response.json() as Promise<unknown>;})
      .then(raw=>{
        if(!validScreeningBoundaries(raw,sourceRevision))throw Error('경계 데이터 리비전 또는 형식 불일치');
        if(!controller.signal.aborted)setBoundaries(raw);
      })
      .catch(()=>{if(!controller.signal.aborted)setNotice('행정동 경계 데이터 확인이 필요합니다.');});
    return()=>controller.abort();
  },[sourceRevision]);
  useEffect(()=>{
    let active=true,observer:ResizeObserver|null=null;
    void import('leaflet').then(L=>{
      if(!active||!host.current)return;
      const current=L.map(host.current,{zoomControl:false,scrollWheelZoom:true,preferCanvas:false}).setView([37.482,127.065],12);
      live.current=current;
      L.control.zoom({position:'bottomright'}).addTo(current);
      const key=(import.meta as ImportMeta & {env:{VITE_VWORLD_API_KEY?:string}}).env.VITE_VWORLD_API_KEY?.trim();
      if(key){
        L.tileLayer('https://api.vworld.kr/req/wmts/1.0.0/'+key+'/Base/{z}/{y}/{x}.png',
          {minZoom:9,maxZoom:19,attribution:'© VWorld 공간정보 오픈플랫폼'})
          .on('tileerror',()=>{if(active)setNotice('배경지도에 접근할 수 없습니다. 행정동 경계는 계속 표시됩니다.');})
          .addTo(current);
      }else setNotice('배경지도 키 미설정 · 행정동 경계만 표시합니다.');
      observer=new ResizeObserver(()=>current.invalidateSize());
      observer.observe(host.current);
      setMap(current);
    }).catch(()=>{if(active)setNotice('지도 초기화 실패');});
    return()=>{
      active=false;observer?.disconnect();
      overlay.current?.remove();overlay.current=null;
      routeOverlay.current?.remove();routeOverlay.current=null;
      live.current?.remove();live.current=null;
    };
  },[]);
  const values=mode==='dong'?geography.areas:mode==='cell'?geography.cells:geography.gnss;
  const steps=metricSteps(values,metric);
  useEffect(()=>{
    if(!map)return;
    let active=true;
    void import('leaflet').then(L=>{
      if(!active)return;
      overlay.current?.remove();
      const group=L.layerGroup().addTo(map);
      overlay.current=group;
      const areaIndex=new Map(geography.areas.map(x=>[x.id,x]));
      const featuredAreas=new Set([...geography.areas].sort((a,b)=>metricValue(b,metric)-metricValue(a,metric)).slice(0,5).map(x=>x.id));
      let districtLayer:ReturnType<typeof L.geoJSON>|null=null;
      if(boundaries){
        const valid=boundaries.features.filter(feature=>feature.geometry.coordinates.length>0);
        // The coordinates were sourced from data/행정동경계 (via daily analyst overview).
        districtLayer=L.geoJSON({type:'FeatureCollection',features:valid} as GeoJSON.FeatureCollection,{
          style:feature=>{
            const id=String(feature?.properties?.id??'');
            const stat=areaIndex.get(id);
            const count=stat?metricValue(stat,metric):0;
            const selected=mode==='dong'&&selectedAreaId===id;
            return {
              color:selected?'#124c82':'#fff',
              weight:selected?2.8:mode==='dong'?1.35:.7,
              opacity:mode==='dong'?1:mode==='route'?.22:.58,
              fillColor:mode==='dong'?metricColor(count,steps):'#dce8f1',
              fillOpacity:mode==='dong'?(count?0.9:0.35):mode==='route'?0.025:0.06,
              dashArray:selected?undefined:mode==='dong'?undefined:'3 3',
            };
          },
          onEachFeature:(feature,layer)=>{
            const id=String(feature.properties?.id??'');
            const label=String(feature.properties?.label??id);
            const stat=areaIndex.get(id);
            const count=stat?metricValue(stat,metric):0;
            if(mode==='dong'){
              layer.on('click',()=>callbacks.current.onSelectArea(id));
              layer.bindPopup('<b>'+label+'</b><div>'+metricLabel(metric)+' '+count.toLocaleString('ko-KR')+metricUnit(metric)
                +'</div><small>BYE Cell 행정동 기준 참고 집계 · 실제 고객 위치 확정 아님</small>');
              if(count>0||selectedAreaId===id){
                layer.bindTooltip(label+' · '+count.toLocaleString('ko-KR'),{
                  permanent:featuredAreas.has(id)||selectedAreaId===id,
                  direction:'center',className:'customer-screen-dong-label',interactive:false,opacity:1,
                });
              }
            }
          }
        }).addTo(group);
      }
      const source=mode==='cell'?geography.cells:mode==='gnss'?geography.gnss:[];
      for(const [i,item] of source.entries()){
        if(!Number.isFinite(item.lat)||!Number.isFinite(item.lon))continue;
        const count=metricValue(item,metric);
        const selected=mode==='cell'&&selectedCellId===item.id;
        const marker=L.circleMarker([item.lat,item.lon],{
          radius:Math.max(5,Math.min(16,4+Math.sqrt(Math.max(1,count))*1.1)),
          color:selected?'#1d3e68':'#fff',weight:selected?2.5:1.3,
          fillColor:metricColor(count,steps),fillOpacity:.87,
        }).addTo(group);
        if(i<10&&count>0)marker.bindTooltip(String(count),{
          permanent:true,direction:'center',className:'customer-screen-site-label',interactive:false
        });
        marker.bindPopup(
          '<b>'+(mode==='cell'?'BYE Cell '+item.id:'GPS 실측 약 200m 영역')+'</b><div>'
          +metricLabel(metric)+' '+count.toLocaleString('ko-KR')+metricUnit(metric)+'</div>'
          +(mode==='cell'?'<small>기지국 참고 좌표 · 단말 위치 아님</small>':'<small>GPS 실측만 포함</small>'));
        marker.on('click',()=>{
          if(mode==='cell')callbacks.current.onSelectCell(item.id);
          else if(item.customerIds[0])callbacks.current.onSelectCustomer(item.customerIds[0]);
        });
      }
      // Preserve manually chosen zoom on polygon selection and metric change; refit only on view switch.
      const fitKey=mode+'|'+sourceRevision;
      if(fitMode.current!==fitKey){
        let bounds:ReturnType<typeof L.latLngBounds>|null=null;
        if(mode==='dong'&&districtLayer){
          // Default viewport focuses the five most affected districts (most cases),
          // while all 39 source polygons remain available for pan/zoom.
          const activeIds=new Set(geography.areas.filter(x=>x.customers>0).slice(0,5).map(x=>x.id));
          const selectedFeatures=boundaries?.features.filter(f=>activeIds.has(f.properties.id))??[];
          if(selectedFeatures.length){
            const areaLayer=L.geoJSON({type:'FeatureCollection',features:selectedFeatures} as GeoJSON.FeatureCollection);
            bounds=areaLayer.getBounds();
          }else bounds=districtLayer.getBounds();
        }else if(source.length){
          bounds=L.latLngBounds(source.map(x=>[x.lat,x.lon] as [number,number]));
        }
        if(bounds?.isValid()){
          map.fitBounds(bounds,{padding:[18,24],maxZoom:mode==='dong'?14:13.3,animate:false});
          // The viewport is unusually wide; emphasize the central investigated dongs.
          // Other polygons remain available via pan/zoom.
          if(mode==='dong')map.setZoom(Math.min(14.4,map.getZoom()+.65),{animate:false});
        }
        fitMode.current=fitKey;
      }
    });
    return()=>{active=false;};
  },[map,boundaries,geography,mode,metric,selectedAreaId,selectedCellId,sourceRevision]);
  // A customer is an ordered set of independently observed call endpoints.
  // Dashed links are visual order hints only, NEVER a verified traversed route.
  useEffect(()=>{
    routeOverlay.current?.remove();routeOverlay.current=null;
    if(!map||mode!=='route'||!customerRoute)return;
    let active=true;
    void import('leaflet').then(L=>{
      if(!active)return;
      routeOverlay.current?.remove();
      const group=L.layerGroup().addTo(map);
      routeOverlay.current=group;
      const points=customerRoute.observations;
      const key='route|'+customerRoute.customerId+'|'+points.map(p=>p.id).join(',');
      const html=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
      } as Record<string,string>)[c]);
      for(const segment of customerRoute.segments){
        const a=points[segment.from],b=points[segment.to];
        if(!a||!b)continue;
        const observed=segment.kind==='gnss-observed-link';
        L.polyline([[a.lat,a.lon],[b.lat,b.lon]],{
          color:observed?'#0b9d8a':'#355e85',weight:observed?3.5:3,
          opacity:observed?.94:.88,dashArray:observed?'7 4':'4 7',
          className:'customer-route-link',
        }).bindTooltip(
          '시간순 참조 연결 · '+segment.minutes+'분 · 직선 '+segment.distanceM+'m'
          +'<br/>실제 이동경로 확인 아님'
        ).addTo(group);
      }
      // Also surface the serving site for GPS-observed calls. This is reference
      // infrastructure and is never substituted for the handset GPS position.
      for(const site of customerRoute.sites){
        if(!site.gnssServed)continue;
        L.circleMarker([site.lat,site.lon],{
          radius:5,color:'#fff',weight:1.3,fillColor:'#d39336',fillOpacity:.85,
          className:'customer-route-site',
        }).bindTooltip('서빙 기지국 Cell '+html(site.cell)+' · GPS와 별도 참고').addTo(group);
      }
      for(const [i,p] of points.entries()){
        const gps=p.evidence==='gnss';
        const marker=L.circleMarker([p.lat,p.lon],{
          radius:i===0||i===points.length-1?9:gps?7.5:5.8,
          color:p.quality==='poor'?'#de3f57':i===0||i===points.length-1?'#164f78':'#fff',
          weight:i===0||i===points.length-1?2.8:p.quality==='poor'?2.4:1.3,
          fillColor:gps?'#16ab91':'#f3a443',fillOpacity:.93,
          className:'customer-route-point',
        }).addTo(group);
        const note=gps?'GPS 실측':'BYE Cell 기지국 참고 · 단말 위치 아님';
        marker.bindPopup(
          '<b>'+p.index+'. '+html(p.date)+' '+html(p.time)+'</b>'+
          '<div>'+note+'</div><div>QoE '+(p.qoe===null?'미평가':p.qoe.toFixed(2))+
          (p.drop?' · SIP Drop':'')+'</div><div>BYE Cell '+html(p.cell||'미확인')+'</div>'+
          '<small>호 종료 관측 기준 · 경로/위치 정확도 확정 아님</small>'
        );
        if(i===0||i===points.length-1||i%Math.max(6,Math.ceil(points.length/12))===0){
          marker.bindTooltip(i===0?'1':i===points.length-1?String(p.index):String(p.index),{
            permanent:true,direction:'top',offset:[0,-3],
            className:'customer-route-index',interactive:false,
          });
        }
      }
      if(points.length>0&&fitMode.current!==key){
        const bounds=L.latLngBounds(points.map(p=>[p.lat,p.lon] as [number,number]));
        if(bounds.isValid())map.fitBounds(bounds,{padding:[34,40],maxZoom:14.5,animate:false});
        fitMode.current=key;
      }
    });
    return()=>{active=false;routeOverlay.current?.remove();routeOverlay.current=null;};
  },[map,mode,customerRoute]);
  const count=mode==='dong'?geography.areas.length:mode==='cell'?geography.cells.length:geography.gnss.length;
  return <div className={styles.mapWrap}>
    <div ref={host} className={styles.mapCanvas} aria-label="고객 선별 행정동 경계 및 무선 위치근거 지도"/>
    {mode==='route'&&customerRoute?<div className={styles.customerRouteLegend} aria-label="고객 위치흐름 범례">
      <strong>{customerRoute.name} · 통화 위치 흐름</strong>
      <span><i className={styles.routeGpsDot}/> GPS 실측 {customerRoute.gnssCount}건
        <i className={styles.routeSiteDot}/> BYE 기지국 참고 {customerRoute.cellReferenceCount}건</span>
      <small>시간순 점선 = 관측점 연결, 실제 이동경로 아님</small>
      <small>위치 없는 통화 {customerRoute.unlocatedCalls}건 · 날짜·시간 간격 큰 구간 미연결</small>
    </div>:<div className={styles.screenMapLegend} aria-label="고객 지도 집계 범례">
      <strong>{metricLabel(metric)} ({metricUnit(metric)})</strong>
      <div className={styles.screenMapLegendRow}>
        {LABEL_COLORS.map((color,i)=><span key={color} className={styles.screenMapLegendBlock}>
          <i style={{background:color}}/>{i===0?'0':i===4?(steps[2]+1)+'+':i===1?'1~'+steps[0]:i===2?(steps[0]+1)+'~'+steps[1]:(steps[1]+1)+'~'+steps[2]}
        </span>)}
      </div>
      <small>{mode==='dong'?'행정동 BYE Cell 참고 권역':mode==='cell'?'기지국 서빙 셀 참고 위치':'GPS 실측 고객 위치'}</small>
    </div>}
    <span className={styles.mapModeCount}>{mode==='route'?'선택 통화':mode==='dong'?'집계 행정동':mode==='cell'?'관측 셀':'GPS 격자'} {mode==='route'?customerRoute?.totalCalls??0:count}건</span>
    {notice&&<div className={styles.mapNotice}>{notice}</div>}
  </div>;
}
