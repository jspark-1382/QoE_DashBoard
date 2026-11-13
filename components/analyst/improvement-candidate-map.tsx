'use client';
import { useEffect,useMemo,useRef,useState } from 'react';
import type {Map as LeafletMap,LayerGroup,Canvas as LeafletCanvas} from 'leaflet';
import {callEvidenceUrl,type ImprovementCandidate} from '../../lib/analyst/improvement-candidates';
import {withQoeBasePath} from './document-link';
import {displayQualityLabel} from './display-quality-label';
import {gpsBand,gpsBandLabel,gpsMarkerSvg,type GpsRfRecord,type GpsRfSidecar} from './gps-marker-style';
import type {CandidateRoughMatch} from '../../lib/analyst/quality-candidate-rough-membership';
import {candidateCircleDistanceM} from '../../lib/analyst/quality-candidate-rough-membership';
import {stationTowerSvg,type StationSiteMarker} from '../../lib/analyst/station-map-presentation';
import {grid25mCorners,grid25mRsrpColor,inVisibleCandidate25m,isValidMdt25mGrid,MDT_RSRP_LEGEND,selectMdtGridMetric,type Mdt25mGrid,type MdtGridMode,type MdtCandidateCircle} from '../../lib/analyst/mdt-25m-grid';
import {candidateResource} from '../../lib/analyst/candidate-resource-cache';
import type {CandidateTopTenCustomer} from '../../lib/analyst/candidate-top-ten';
import type {QualityCandidateScope} from '../../lib/analyst/quality-improvement-candidates';
import {CandidateTopTenOverlay} from './candidate-top-ten-overlay';
import 'leaflet/dist/leaflet.css';
import styles from './improvement-candidate-map.module.css';

interface Props {
  candidates:ImprovementCandidate[];
  selectedId:string;
  onSelect:(id:string)=>void;
  sourceRevision?:string;
  observationPoints?:Array<{callId:string;customerId:string;date:string;lat:number;lon:number;kind:'gnss'|'reviewed-radio';observedAt?:string|null}>;
  /** Display-only low-QoE 3-site RSRP barycentres; never clustering inputs. */
  roughPoints?:readonly CandidateRoughMatch[];
  stationSites?:readonly StationSiteMarker[];
  roughUsedForCandidate?:boolean;
  hint?:string;
  presentation?:'legacy'|'proposal2';
  fullscreenEnhanced?:boolean;
  mdtGridMode?:MdtGridMode;
  unmatchedTopTen?:{scope:QualityCandidateScope;customers:readonly CandidateTopTenCustomer[]};
}
const TILE_NOTICE='배경지도 불러오기 실패 · 후보 좌표는 계속 표시됩니다.';

export function ImprovementCandidateMap({candidates,selectedId,onSelect,sourceRevision,observationPoints=[],roughPoints=[],stationSites=[],roughUsedForCandidate=false,hint,presentation='legacy',fullscreenEnhanced=false,mdtGridMode='hidden',unmatchedTopTen}:Props){
  const host=useRef<HTMLDivElement|null>(null);
  const live=useRef<LeafletMap|null>(null);
  const layer=useRef<LayerGroup|null>(null);
  const gridLayer=useRef<LayerGroup|null>(null);
  const gridRenderer=useRef<LeafletCanvas|null>(null);
  const callback=useRef(onSelect);
  const [map,setMap]=useState<LeafletMap|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const fitOnce=useRef(false);
  const unmatchedOverlayActive=!!unmatchedTopTen?.customers.length;
  const [rfRecords,setRfRecords]=useState<Record<string,GpsRfRecord>>({});
  const [gridSource,setGridSource]=useState<Mdt25mGrid|null>(null);
  const [gridError,setGridError]=useState<string|null>(null);
  const [gridStats,setGridStats]=useState<{key:string;drawn:number;missing:number}|null>(null);
  const gridRenderKey=mdtGridMode+'|'+candidates.map(candidate=>candidate.id).join('|');
  // Detail/selection updates enrich candidate objects without moving circles.
  // Avoid rebuilding every 25 m polygon when only those non-spatial fields change.
  const gridAreaKey=JSON.stringify(candidates.flatMap(candidate=>{
    const loc=candidate.location;
    return loc&&Number.isFinite(loc.lat)&&Number.isFinite(loc.lon)&&typeof loc.radiusM==='number'&&loc.radiusM>0
      ?[{lat:loc.lat,lon:loc.lon,radiusM:loc.radiusM}]:[];
  }));
  const gridAreas=useMemo(()=>JSON.parse(gridAreaKey) as MdtCandidateCircle[],[gridAreaKey]);
  const visibleGridStats=gridStats?.key===gridRenderKey?gridStats:null;
  useEffect(()=>{
    if(!sourceRevision){setRfRecords({});return;}
    const controller=new AbortController();
    void candidateResource('gps-marker-rf|'+sourceRevision,async signal=>{
      const response=await fetch('/qoe/quality-improvement/gps-marker-rf-v1.json',{signal,cache:'no-cache'});
      if(!response.ok)throw new Error('GPS RF evidence unavailable');
      const data=await response.json() as GpsRfSidecar;
      if(data.schemaVersion!=='qoe-gps-marker-rf-v1'||data.sourceRevision!==sourceRevision)throw new Error('GPS RF source revision mismatch');
      return data;
    },controller.signal)
      .then(data=>{if(!controller.signal.aborted)setRfRecords(data.records);})
      .catch(()=>{if(!controller.signal.aborted)setRfRecords({});});
    return()=>controller.abort();
  },[sourceRevision]);
  useEffect(()=>{callback.current=onSelect;},[onSelect]);
  useEffect(()=>{
    // Different date from the call cohort: this overlay is strictly reference-only.
    if(mdtGridMode==='hidden'||gridSource)return;
    const controller=new AbortController();
    setGridError(null);
    void candidateResource('mdt-grid-25m|'+(sourceRevision??''),async signal=>{
      const response=await fetch('/qoe/quality-improvement/mdt-grid-25m-v1.json',{signal,cache:'no-cache'});
      if(!response.ok)throw new Error('25m MDT dataset unavailable');
      const data:unknown=await response.json();
      if(!isValidMdt25mGrid(data))throw new Error('25m MDT grid schema mismatch');
      return data;
    },controller.signal)
      .then(data=>{if(!controller.signal.aborted)setGridSource(data);})
      .catch(()=>{if(!controller.signal.aborted)setGridError('25m MDT 격자 파일을 읽을 수 없습니다.');});
    return()=>controller.abort();
  },[mdtGridMode,gridSource,sourceRevision]);

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
      gridLayer.current?.remove();
      gridLayer.current=null;
      gridRenderer.current?.remove();
      gridRenderer.current=null;
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
      gridLayer.current?.remove();
      gridLayer.current=null;
      if(mdtGridMode==='hidden'||!gridSource){setGridStats(null);return;}
      const pane=map.getPane('qoe-mdt-25m')??map.createPane('qoe-mdt-25m');
      // Below other Leaflet overlays (400) and markers (600); above the basemap.
      pane.style.zIndex='340';
      let canvas=gridRenderer.current;
      if(!canvas){
        canvas=L.canvas({pane:'qoe-mdt-25m',padding:0.2});
        // Leaflet can lose a queued frame ID when a synchronous redraw runs first.
        // That orphan frame must not draw after a model/filter removes this map.
        const renderer=canvas as LeafletCanvas&{_redraw:()=>void};
        const draw=renderer._redraw.bind(renderer);
        renderer._redraw=()=>{if(map.hasLayer(renderer))draw();};
        gridRenderer.current=canvas;
      }
      const group=L.layerGroup().addTo(map);
      gridLayer.current=group;
      const areas=gridAreas;
      let drawn=0;
      let missing=0;
      for(const cell of gridSource.records){
        if(!inVisibleCandidate25m(cell,areas))continue;
        if(!Number.isFinite(cell.rsrp)||!Number.isFinite(cell.lat)||!Number.isFinite(cell.lon)||!Number.isFinite(cell.samples)||cell.samples<=0)continue;
        const metric=selectMdtGridMetric(cell,mdtGridMode);
        if(!metric)missing++;
        const polygon=L.polygon(grid25mCorners(cell,gridSource.basisPerMeter,gridSource.cellSizeM),{
          pane:'qoe-mdt-25m',renderer:canvas,interactive:true,bubblingMouseEvents:false,
          color:'#708d87',weight:0.45,opacity:0.26,
          fillColor:grid25mRsrpColor(metric?.rsrp),fillOpacity:metric?0.34:0.17,
        }).addTo(group);
        const tooltip=document.createElement('div');
        const rsrp=document.createElement('strong');
        rsrp.textContent=metric?('25m MDT '+(mdtGridMode==='top1'?'Top1 · ':'')+metric.frequency+' 평균 RSRP '+metric.rsrp.toFixed(1)+' dBm'):('25m MDT '+mdtGridMode+' · 수집된 값 없음');
        tooltip.appendChild(rsrp);
        const measurement=document.createElement('div');
        measurement.textContent=gridSource.sourceDate+' · 측정 '+(metric?metric.samples.toLocaleString('ko-KR')+'건':'0건')+' · PotID '+cell.pot;
        tooltip.appendChild(measurement);
        const bands=document.createElement('div');
        bands.textContent=Object.entries(cell.bands)
          .map(([label,[mean,count]])=>label+' '+mean.toFixed(1)+' dBm ('+count.toLocaleString('ko-KR')+'건)')
          .join(' · ');
        tooltip.appendChild(bands);
        polygon.bindTooltip(tooltip,{sticky:true,direction:'top',opacity:0.97});
        drawn++;
      }
      setGridStats({key:gridRenderKey,drawn,missing});
    }).catch(()=>{if(current)setGridError('25m 격자 레이어 표시 실패');});
    return()=>{
      current=false;
      gridLayer.current?.remove();
      gridLayer.current=null;
    };
  },[map,mdtGridMode,gridSource,gridAreas,gridRenderKey]);

  useEffect(()=>{
    if(!map)return;
    let current=true;
    void import('leaflet').then(L=>{
      if(!current)return;
      layer.current?.remove();
      const next=L.layerGroup().addTo(map);
      layer.current=next;
      const coords:[number,number][]=[];
      // Station positions are inventory/MDT references, NEVER handset fixes.
      for(const site of stationSites){
        // Do not render another candidate's tower markers when selection changes.
        if(!selectedId || (!site.matchedCandidateIds.includes(selectedId)&&!site.linkedToSelected))continue;
        if(!Number.isFinite(site.lat)||!Number.isFinite(site.lon))continue;
        const selected=site.matchedCandidateIds.includes(selectedId);
        const variant=site.linkedToSelected?'linked':selected?'selected':'nearby';
        const pos:[number,number]=[site.lat,site.lon];
        const icon=L.divIcon({
          className:'qoe-station-tower-marker'+(site.linkedToSelected?' qoe-station-linked':''),
          html:stationTowerSvg(variant,23),iconSize:[25,29],iconAnchor:[12,14],
        });
        const marker=L.marker(pos,{icon,zIndexOffset:site.linkedToSelected?-105:-230}).addTo(next);
        marker.getElement()?.setAttribute('data-station-site','true');
        marker.bindTooltip((site.technology==='LTE'?'LTE':'5G')+' 기지국 등록 위치 · '+site.cells.length+'셀'+
          (site.linkedToSelected?' · 선택 근사점의 측위 근거':' · 단말 위치 아님'));
        const popup=document.createElement('div');
        const head=document.createElement('strong');
        head.textContent=(site.technology==='LTE'?'LTE':'5G')+' 기지국 위치 · '+site.cells.length+'셀';
        popup.appendChild(head);
        const coordinates=document.createElement('p');
        coordinates.textContent=site.lat.toFixed(6)+', '+site.lon.toFixed(6)+
          ' · '+(site.source==='mdt'?'MDT 관측 기지국 위치':'등록 인벤토리 위치')+
          (site.matchedCandidateIds.length?' · 포함 후보 '+site.matchedCandidateIds.map(id=>candidates.findIndex(c=>c.id===id)+1).join(', ')+'번':' · 후보 원 외 측위 근거');
        popup.appendChild(coordinates);
        const list=document.createElement('ul');
        for(const cell of site.cells.slice(0,20)){
          const item=document.createElement('li');
          item.textContent='RU '+cell.ruId+' · Cell '+cell.cellId+' · PCI '+(cell.pci??'미제공')+
            (cell.rsrpDbm==null?'':' · MDT RSRP '+cell.rsrpDbm+' dBm')+
            (cell.related?' · 측위 근거':'');
          list.appendChild(item);
        }
        popup.appendChild(list);
        if(site.cells.length>20){const more=document.createElement('small');more.textContent='나머지 '+(site.cells.length-20)+'셀은 기지국·PCI 검색에서 확인';popup.appendChild(more);}
        const note=document.createElement('p');
        note.textContent='기지국 등록 위치는 단말 위치나 실제 서비스 커버리지가 아닙니다. 관련 근사점은 3개 기지국 RSRP 가중중심이며 측정 전파 경로를 의미하지 않습니다.';
        popup.appendChild(note);marker.bindPopup(popup,{maxWidth:340});
        // Lines are shown only for selected rough-position MDT input sites.
        if(site.linkedToSelected){
          for(const point of roughPoints.filter(p=>p.matchingCandidateIds.includes(selectedId))){
            if(!point.usedStations.some(s=>site.cells.some(c=>c.ruId===s.ruId&&c.cellId===s.cellId)))continue;
            L.polyline([pos,[point.lat,point.lon]],{
              color:'#b97836',weight:1.1,dashArray:'3 6',opacity:.5,
              interactive:false,
            }).addTo(next);
          }
        }
      }
      // Hollow diamonds for unvalidated MDT RSRP barycentres, optionally actual model inputs.
      // No radius circles here: the rough search radius is NOT an accuracy interval.
      // In exploratory GPS+MDT modes, supplied points are real candidate members.
      for(const point of roughPoints){
        // Membership was computed against the actual drawn candidate-circle radii.
        // Hide stale/outside references defensively, even if a caller passes one.
        const belonging=candidates.filter(c=>c.id===selectedId&&point.matchingCandidateIds.includes(c.id)&&c.location&&
          c.location.radiusM!=null&&c.location.radiusM>0&&
          (roughUsedForCandidate||candidateCircleDistanceM(point,c.location)<=c.location.radiusM));
        if(!belonging.length)continue;
        const active=belonging.some(c=>c.id===selectedId);
        const loc:[number,number]=[point.lat,point.lon];
        coords.push(loc);
        const marker=L.marker(loc,{zIndexOffset:active?-55:-160,icon:L.divIcon({
          className:'qoe-rough-location-marker'+(active?' qoe-rough-selected':''),
          html:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="#fff5e5" fill-opacity="'+(active?'0.85':'0.25')+'" stroke="'+(active?'#b45309':'#d97706')+'" stroke-width="'+(active?'3':'2.4')+'" stroke-dasharray="3 2"/></svg>',
          iconSize:[22,22],iconAnchor:[11,11],
        })}).addTo(next);
        marker.bindTooltip(point.date.slice(5)+' · '+(roughUsedForCandidate?'선택 알고리즘 구성 MDT 근사 (미검증)':'삼각 측량 근사 · 참고'));
        const popup=document.createElement('div');
        const title=document.createElement('strong');title.textContent=roughUsedForCandidate?'MDT RSRP 근사 · 개선 후보 산정에 사용 (미검증)':'삼각 측량 근사 · 검토 전 참고 위치';popup.appendChild(title);
        const detail=document.createElement('p');
        detail.textContent=point.date+' · '+point.lat.toFixed(6)+', '+point.lon.toFixed(6)+
          ' · 참고 반경 약 '+Math.round(point.roughSearchRadiusM).toLocaleString('ko-KR')+'m';
        popup.appendChild(detail);
        const membership=document.createElement('p');
        membership.textContent=(roughUsedForCandidate?'선택 모델 후보 구성: ':'포함된 후보: ')+belonging.map(c=>{
          const index=candidates.findIndex(item=>item.id===c.id)+1;
          return index+'번 (중심 거리 '+Math.round(candidateCircleDistanceM(point,c.location!))+'m / 표시 반경 '+Math.round(c.location!.radiusM!)+'m)';
        }).join(' · ');
        popup.appendChild(membership);
        const timing=document.createElement('p');
        timing.textContent='MDT 관측: '+(point.observedAt??'미확인')+
          (point.secondsBeforeEnd==null?'':' · 종료 기준 '+Math.abs(point.secondsBeforeEnd).toFixed(1)+'초 '+(point.secondsBeforeEnd<0?'후':'전'));
        popup.appendChild(timing);
        const summary=document.createElement('strong');summary.textContent='사용 기지국 '+point.usedSiteCount+'곳 · 원본 RSRP';popup.appendChild(summary);
        const siteList=document.createElement('ul');
        for(const site of point.usedStations){
          const item=document.createElement('li');
          item.textContent='RU '+site.ruId+' · Cell '+site.cellId+' · RSRP '+site.rsrpDbm+' dBm';
          siteList.appendChild(item);
        }
        popup.appendChild(siteList);
        const caution=document.createElement('p');
        caution.textContent=roughUsedForCandidate?'이 MDT RSRP 가중중심 근사는 선택 알고리즘의 개선 후보 구성에 사용됐습니다. 실제 단말 위치 정확도는 아직 검증되지 않았고 참고 반경은 오차 신뢰구간이 아닙니다. 후보 중심·순위를 확정 장애 위치로 해석하지 마세요.':'3개 사이트 RSRP 가중중심 참고점으로 GPS보다 위치 불확실성이 큽니다. 참고 반경은 오차 신뢰구간이 아닙니다.';
        popup.appendChild(caution);
        const link=document.createElement('a');
        link.href=withQoeBasePath(callEvidenceUrl({date:point.date,customerId:point.customerId,callId:point.callId,mos:0,endCellId:'',start:''}));
        link.textContent='원본 통화 상세';link.style.display='block';
        popup.appendChild(link);
        marker.bindPopup(popup,{maxWidth:340});
      }
      candidates.forEach((candidate,index)=>{
        const loc=candidate.location;
        if(!loc)return;
        const p:[number,number]=[loc.lat,loc.lon];
        coords.push(p);
        const active=candidate.id===selectedId;
        if(candidate.kind==='spatial' && loc.radiusM!=null){
          const circle=L.circle(p,{
            radius:loc.radiusM,color:fullscreenEnhanced?(active?'#d8414c':'#9caeb8'):presentation==='proposal2'?(active?'#c98520':'#91a6b3'):active?'#c4474e':'#d37c74',
            dashArray:fullscreenEnhanced&&active?'7 5':'6 5',weight:active?2.5:1.6,
            fillColor:fullscreenEnhanced?'#f06c75':presentation==='proposal2'?'#efbf65':'#e87b78',fillOpacity:active?0.16:0.075,
            interactive:false,
          }).addTo(next);
          circle.getElement()?.setAttribute('data-candidate-circle-id',candidate.id);
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
        if(point.kind==='gnss'){
          const rf=rfRecords[point.callId];
          const band=gpsBand(rf?.earfcn);
          const dot=L.marker(loc,{icon:L.divIcon({className:'qoe-gps-rf-marker',html:gpsMarkerSvg(band,rf?.rsrpDbm),iconSize:[20,20],iconAnchor:[10,10]})}).addTo(next);
          dot.bindTooltip(point.date+' · GPS'+(rf?.rsrpDbm==null?' · RSRP 미확보':' · RSRP '+rf.rsrpDbm+' dBm'));
          const popup=document.createElement('div');
          const title=document.createElement('strong');
          title.textContent=point.date+' · 원본 GPS 관측';
          popup.appendChild(title);
          const info=document.createElement('p');
          info.textContent=gpsBandLabel(band)+(rf?.earfcn==null?'':' · EARFCN '+rf.earfcn)+
            (rf?.rsrpDbm==null?' · RSRP 미확보':' · RSRP '+rf.rsrpDbm+' dBm')+
            ' · '+(point.observedAt??'관측시각 미제공');
          popup.appendChild(info);
          const note=document.createElement('small');
          note.textContent='같은 통화·GPS 관측시각의 MDT 측정값입니다. QoE 저하 순간의 위치 확정 근거는 아닙니다.';
          popup.appendChild(note);
          const link=document.createElement('a');
          link.href=withQoeBasePath(callEvidenceUrl({date:point.date,customerId:point.customerId,callId:point.callId,mos:0,endCellId:'',start:''}));
          link.textContent='원본 통화 상세';
          link.style.display='block';link.style.marginTop='5px';
          popup.appendChild(link);
          dot.bindPopup(popup);
        }else{
          const dot=L.circleMarker(loc,{radius:4,weight:1,color:'#fff',fillColor:'#8376c5',fillOpacity:.75}).addTo(next);
          dot.bindTooltip(point.date+' · 검토 통과 삼각 측량');
        }
      }
      for(const point of selected?.relatedGnss??[]){
        const loc:[number,number]=[point.lat,point.lon];
        const rf=rfRecords[point.callId]??rfRecords[point.date+':'+point.callId];
        const band=gpsBand(rf?.earfcn);
        const dot=L.marker(loc,{icon:L.divIcon({className:'qoe-gps-rf-marker',html:gpsMarkerSvg(band,rf?.rsrpDbm),iconSize:[20,20],iconAnchor:[10,10]})}).addTo(next);
        const popup=document.createElement('div');
        const title=document.createElement('strong');
        title.textContent='원본 MDT GPS · '+point.date.slice(5);
        popup.appendChild(title);
        const info=document.createElement('p');
        info.textContent=(point.observedAt?.slice(11,19)??'시각 미제공')+
          ' · '+point.lat.toFixed(6)+', '+point.lon.toFixed(6)+
          (point.phase?' · '+point.phase:'')+
          (point.validationDay?' · 10/30 재현':'')+' · '+gpsBandLabel(band)+
          (rf?.earfcn==null?'':' (EARFCN '+rf.earfcn+')')+
          (rf?.rsrpDbm==null?' · RSRP 미확보':' · RSRP '+rf.rsrpDbm+' dBm');
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
        dot.bindTooltip(point.date.slice(5)+' · GPS'+(rf?.rsrpDbm==null?' · RSRP 미확보':' · RSRP '+rf.rsrpDbm+' dBm'));
      }
      if(!unmatchedOverlayActive&&!fitOnce.current&&coords.length){
        fitOnce.current=true;
        // Establish the initial view immediately so a mode switch cannot leave
        // a deferred zoom transition targeting an already removed map.
        map.fitBounds(L.latLngBounds(coords),{padding:[38,38],maxZoom:14,animate:false});
      }else if(!unmatchedOverlayActive){
        const chosen=candidates.find(x=>x.id===selectedId);
        const focus=chosen?.location??chosen?.relatedGnss?.[0];
        if(focus)
          map.panTo([focus.lat,focus.lon],{animate:true,duration:.35});
      }
    }).catch(()=>{if(current)setNotice('지도 후보 표시 실패');});
    return()=>{current=false;};
  },[candidates,map,selectedId,observationPoints,roughPoints,stationSites,roughUsedForCandidate,presentation,fullscreenEnhanced,rfRecords,unmatchedOverlayActive]);
  return <div className={[styles.container,fullscreenEnhanced?styles.referenceMap:''].filter(Boolean).join(' ')} aria-label="개선 후보 지도">
    <div className={styles.map} ref={host}/>
    {unmatchedTopTen&&unmatchedOverlayActive&&<CandidateTopTenOverlay map={map} scope={unmatchedTopTen.scope}
      customers={unmatchedTopTen.customers} candidates={candidates} expectedSourceRevision={sourceRevision}/>}
    {notice&&<output className={styles.notice}>{notice}</output>}
    {mdtGridMode!=='hidden'&&<>
      <div className={styles.gridNote} role="status" aria-label="25m MDT 격자 상태">{gridError??(gridSource&&visibleGridStats?`MDT 25m · ${mdtGridMode==='top1'?'Top1 최다 측정 주파수':mdtGridMode} · 11/03 자료 · ${visibleGridStats.drawn.toLocaleString('ko-KR')}격자${visibleGridStats.missing?' · 미수집 '+visibleGridStats.missing.toLocaleString('ko-KR')+'격자':''}`:'MDT 25m 격자 계산 중')}</div>
      <div className={styles.gridLegend} aria-label="RSRP 색상 범례">
        <strong>RSRP (dBm)</strong>
        {MDT_RSRP_LEGEND.map(item=><div className={styles.gridLegendRow} key={item.label}>
          <span>{item.label}</span>
          <i style={{background:item.start===item.end?item.start:`linear-gradient(to right, ${item.start}, ${item.end})`}}/>
        </div>)}
      </div>
    </>}
    <div className={styles.hint}>{hint??'GPS: 도형=주파수 · 빨강 RSRP ≤ −105 dBm / 초록 > −105 dBm / 회색 미확보 · 후보 지역 중심은 별도 표시'}</div>
  </div>;
}
