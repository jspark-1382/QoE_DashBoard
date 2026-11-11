'use client';

import {useEffect,useRef,useState} from 'react';
import type {LayerGroup,Map as LeafletMap} from 'leaflet';
import {metricColor,metricLabel,metricSteps,metricUnit,metricValue,validScreeningBoundaries,
  type ScreeningBoundary,type ScreeningGeography,type ScreeningMapMetric,type ScreeningMapView} from '../../lib/analyst/customer-screening-map';
import type {CustomerRoute} from '../../lib/analyst/customer-screening-route';
import {groupTopCustomers,topCustomerBubbleDiameter,TOP_CUSTOMER_ROUTE_ZOOM,type TopCustomerMap,type TopCustomerRoute} from '../../lib/analyst/customer-screening-top-ten';
import 'leaflet/dist/leaflet.css';
import styles from './customer-screening.module.css';

interface Props {
  geography:ScreeningGeography;mode:ScreeningMapView;metric:ScreeningMapMetric;sourceRevision:string;
  selectedAreaId:string;selectedCellId:string;customerRoute:CustomerRoute|null;
  topCustomers:TopCustomerMap;
  topCustomerRoutes:TopCustomerRoute[];
  onSelectArea:(id:string)=>void;onSelectCell:(id:string)=>void;onSelectCustomer:(id:string)=>void;
}
const LABEL_COLORS=['#e9eef4','#f6d7a4','#eda36f','#e66b64','#b72f50'];
export function CustomerScreeningMap({
  geography,mode,metric,sourceRevision,selectedAreaId,selectedCellId,customerRoute,topCustomers,topCustomerRoutes,
  onSelectArea,onSelectCell,onSelectCustomer,
}:Props) {
  const host=useRef<HTMLDivElement|null>(null);
  const live=useRef<LeafletMap|null>(null);
  const overlay=useRef<LayerGroup|null>(null);
  const routeOverlay=useRef<LayerGroup|null>(null);
  const topOverlay=useRef<LayerGroup|null>(null);
  const fitMode=useRef('');
  const callbacks=useRef({onSelectArea,onSelectCell,onSelectCustomer});
  const [map,setMap]=useState<LeafletMap|null>(null);
  const [zoom,setZoom]=useState(12);
  const [topPathsVisible,setTopPathsVisible]=useState(false);
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
      const current=L.map(host.current,{zoomControl:false,scrollWheelZoom:true,preferCanvas:false,
        minZoom:9,maxZoom:TOP_CUSTOMER_ROUTE_ZOOM}).setView([37.482,127.065],12);
      live.current=current;
      current.on('zoomend',()=>{if(active)setZoom(current.getZoom());});
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
      topOverlay.current?.remove();topOverlay.current=null;
      live.current?.remove();live.current=null;
    };
  },[]);
  const values=mode==='dong'?geography.areas:mode==='cell'?geography.cells:geography.gnss;
  const steps=metricSteps(values,metric);
  useEffect(()=>{
    if(mode!=='top10')setTopPathsVisible(false);
    else if(zoom>=TOP_CUSTOMER_ROUTE_ZOOM)setTopPathsVisible(true);
  },[mode,zoom]);
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
      const fitKey=mode+'|'+sourceRevision+(mode==='top10'?'|'+topCustomers.points.map(p=>p.id+':'+p.lat+':'+p.lon).join(','):'');
      if(fitMode.current!==fitKey){
        let bounds:ReturnType<typeof L.latLngBounds>|null=null;
        if(mode==='top10'&&topCustomers.points.length){
          bounds=L.latLngBounds(topCustomers.points.map(p=>[p.lat,p.lon] as [number,number]));
        }else if(mode==='dong'&&districtLayer){
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
          map.fitBounds(bounds,{padding:mode==='top10'?[48,48]:[18,24],maxZoom:mode==='dong'?14:mode==='top10'?15:13.3,animate:false});
          // The viewport is unusually wide; emphasize the central investigated dongs.
          // Other polygons remain available via pan/zoom.
          if(mode==='dong')map.setZoom(Math.min(14.4,map.getZoom()+.65),{animate:false});
        }
        fitMode.current=fitKey;
      }
    });
    return()=>{active=false;};
  },[map,boundaries,geography,mode,metric,selectedAreaId,selectedCellId,sourceRevision,topCustomers]);
  useEffect(()=>{
    topOverlay.current?.remove();topOverlay.current=null;
    if(!map||mode!=='top10')return;
    let active=true;
    void import('leaflet').then(L=>{
      if(!active)return;
      const group=L.layerGroup().addTo(map);
      topOverlay.current=group;
      if(topPathsVisible){
        for(const {rank,color,route} of topCustomerRoutes){
          const className='customer-top-route customer-top-route-'+rank;
          for(const segment of route.segments){
            const a=route.observations[segment.from],b=route.observations[segment.to];
            L.polyline([[a.lat,a.lon],[b.lat,b.lon]],{
              color,weight:3.5,opacity:.85,dashArray:'6 5',className:className+' customer-top-route-line',
            }).bindTooltip('TOP '+rank+' · 시간순 관측점 연결 · 실제 이동경로 확인 아님',
              {className:'customer-top-tooltip'}).addTo(group);
          }
          for(const [index,p] of route.observations.entries()){
            const endpoint=index===0||index===route.observations.length-1;
            const popup=document.createElement('div');
            popup.textContent='TOP '+rank+' · '+route.name+' · '+p.date+' '+p.time+' · QoE '+
              (p.qoe===null?'미평가':p.qoe.toFixed(2))+' · '+
              (p.evidence==='gnss'?'GPS 실측':'BYE 기지국 참고 위치');
            const marker=L.circleMarker([p.lat,p.lon],{
              radius:endpoint?6.5:4,color:endpoint?'#fff':color,weight:endpoint?2:1,
              fillColor:color,fillOpacity:.88,className:className+' customer-top-route-point',
            }).bindTooltip('TOP '+rank+' · '+p.date+' '+p.time,{className:'customer-top-tooltip'})
              .bindPopup(popup,{maxWidth:280}).addTo(group);
            marker.getElement()?.setAttribute('data-top-customer-rank',String(rank));
          }
        }
        return;
      }
      const bubbles=groupTopCustomers(topCustomers.points,zoom,p=>map.project([p.lat,p.lon],zoom));
      for(const bubble of bubbles){
        const size=topCustomerBubbleDiameter(bubble.poor,zoom);
        const label=bubble.customers.length===1?String(bubble.customers[0].rank):bubble.customers.length+'명';
        const popup=document.createElement('div');
        popup.className=styles.topCustomerPopup;
        const heading=document.createElement('strong');
        heading.textContent=bubble.customers.length===1?'TOP '+bubble.customers[0].rank+' · '+bubble.customers[0].number:
          'TOP 10 고객 '+bubble.customers.length+'명';
        popup.appendChild(heading);
        for(const customer of bubble.customers){
          const description=document.createElement('p');
          description.textContent='TOP '+customer.rank+' · '+customer.number+' · 저품질 '+customer.poor+'건 · '+
            (customer.evidence==='gnss'?'GPS 통화 위치':'BYE 기지국 참고 위치');
          popup.appendChild(description);
          const button=document.createElement('button');
          button.type='button';button.textContent='TOP '+customer.rank+' 고객 통화 위치 보기';
          button.addEventListener('click',()=>callbacks.current.onSelectCustomer(customer.id));
          popup.appendChild(button);
        }
        const note=document.createElement('small');
        note.textContent='대표 위치는 저품질 통화 기록 중 최다 관측 위치입니다. BYE 기지국은 단말 실측 위치가 아닙니다.';
        popup.appendChild(note);
        const title=bubble.customers.length===1?'TOP '+bubble.customers[0].rank+' · '+bubble.poor+'건':
          '전체 '+topCustomers.total+'명 중 이 버블 '+bubble.customers.length+'명 · 저품질 '+bubble.poor+'건';
        L.marker([bubble.lat,bubble.lon],{zIndexOffset:1000,
          title,alt:'저품질 고객 '+label,
          icon:L.divIcon({className:styles.topCustomerBubbleIcon,
            html:`<span class="${styles.topCustomerBubble}"><b>${label}</b><small>${bubble.poor}건</small></span>`,
            iconSize:[size,size],iconAnchor:[size/2,size/2]})})
          .bindTooltip(title,{direction:'top',offset:[0,-size/2],className:'customer-top-tooltip'})
          .bindPopup(popup,{maxWidth:320,maxHeight:260}).addTo(group);
      }
    });
    return()=>{active=false;topOverlay.current?.remove();topOverlay.current=null;};
  },[map,mode,topCustomers,topCustomerRoutes,topPathsVisible,zoom]);
  const fitTopRoutes=()=>{
    if(!map)return;
    map.closePopup();setTopPathsVisible(true);
    const positions=topCustomerRoutes.flatMap(r=>r.route.observations.map(p=>[p.lat,p.lon] as [number,number]));
    if(positions.length)void import('leaflet').then(L=>map.fitBounds(L.latLngBounds(positions),{padding:[36,36],maxZoom:15,animate:false}));
  };
  const showTopBubbles=()=>{
    if(!map)return;
    map.closePopup();
    if(topCustomers.points.length)void import('leaflet').then(L=>{
      map.fitBounds(L.latLngBounds(topCustomers.points.map(p=>[p.lat,p.lon] as [number,number])),{padding:[48,48],maxZoom:15,animate:false});
      setTopPathsVisible(false);
    });
    else setTopPathsVisible(false);
  };
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
    {mode==='top10'&&<div className={styles.topRouteActions}>
      <button type="button" onClick={fitTopRoutes} disabled={!topCustomerRoutes.some(r=>r.route.observations.length)}>
        {topCustomers.total}명 {topPathsVisible?'경로 전체 범위':'전체 경로 보기'}</button>
      {topPathsVisible&&<button type="button" onClick={showTopBubbles}>버블 보기</button>}
    </div>}
    {mode==='top10'?<div className={styles.screenMapLegend} aria-label="저품질 고객 TOP 10 범례">
      <strong>저품질 고객 TOP 10 · 전체 {topCustomers.total}명</strong>
      {topPathsVisible?<>
        <span>통화 위치 흐름 {topCustomerRoutes.filter(r=>r.route.observations.length>0).length}명 동시 표시</span>
        <div className={styles.topRouteCustomers} aria-label="TOP 10 고객별 경로 색상">
          {topCustomerRoutes.map(({rank,color,route})=><span key={route.customerId}>
            <i style={{background:color}}/>{rank}. {route.name}
          </span>)}
        </div>
        <small>점선 = 시간순 관측점 연결 · 실제 이동경로 확인 아님</small>
      </>:<>
      <span>숫자 = 고객 순위 · N명 = 밀집 고객</span>
      <small>버블 크기: 저품질 통화 수 · 확대 수준</small>
      <small>최대 확대 시 {topCustomers.total}명 경로 자동 표시</small>
      </>}
      <small>GPS 또는 BYE 기지국 참고 위치</small>
      <small>위치 미확보 {topCustomers.unlocated}명</small>
    </div>:mode==='route'&&customerRoute?<div className={styles.customerRouteLegend} aria-label="고객 위치흐름 범례">
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
    <span className={styles.mapModeCount}>{mode==='top10'?`TOP 10 · 위치 표시 ${topCustomers.points.length}/${topCustomers.total}명`:
      `${mode==='route'?'선택 통화':mode==='dong'?'집계 행정동':mode==='cell'?'관측 셀':'GPS 격자'} ${mode==='route'?customerRoute?.totalCalls??0:count}건`}</span>
    {notice&&<div className={styles.mapNotice}>{notice}</div>}
  </div>;
}
