'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExecutiveSample } from '@/lib/executive';
import { estimatePosition, DEFAULT_OPTIONS, type BaseStation, type EstimationOptions, type MdtSample } from '@/lib/location-estimation';
import { CONFIG, HISTORY_WINDOW } from '@/lib/location-estimation/config';
import { ring, offsetPoint } from '@/lib/location-estimation/geo';
import { matchBaseStation } from '@/lib/location-estimation/master';
import { mapMetrics, metricColor, type MapMetric } from '@/lib/executive/map-metrics';
import 'leaflet/dist/leaflet.css';
import { AdaptivePositionLayer } from './adaptive-position-layer';

const esc = (value: string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const confidenceLabel = { LOW: '낮음 (LOW)', MEDIUM: '중간 (MEDIUM)', HIGH: '높음 (HIGH)' };
const meters = (value: number) => Math.round(value).toLocaleString() + ' m';
const reading = (value: number | null | undefined, unit: string) => value == null ? '미측정' : value.toFixed(1) + ' ' + unit;

export function MdtLocationMap({ samples, baseStations, selectedSampleIndex, onSampleSelect, apiKey, metric, overviewRevision }: {
  samples: ExecutiveSample[]; baseStations: BaseStation[]; selectedSampleIndex: number | null;
  onSampleSelect: (index:number)=>void; apiKey: string; metric: MapMetric; overviewRevision: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<import('leaflet').Map|null>(null);
  const layer = useRef<import('leaflet').LayerGroup|null>(null);
  const selectRef = useRef(onSampleSelect);
  const [ready,setReady]=useState(false);
  const [mapError,setMapError]=useState('');
  const [algorithm,setAlgorithm]=useState<'adaptive'|'legacy'>('adaptive');
  const [options,setOptions]=useState<EstimationOptions>({...DEFAULT_OPTIONS});
  const [windowSize,setWindowSize]=useState(HISTORY_WINDOW);
  const detailsOpen=false;
  const events=useMemo<MdtSample[]>(()=>samples.flatMap((sample,index)=>sample.mdt ? [{
    ...sample.mdt, timestamp:Date.parse(sample.mdt.timestamp), rsrp:sample.rsrp, rsrq:sample.rsrq, sinr:sample.sinr, sampleIndex:index,
  }]:[]),[samples]);
  const selected=events.find(event=>event.sampleIndex===selectedSampleIndex)??events[0];
  // Compute a causal trajectory once per dataset/settings, not from a new seed on each selection.
  const allEstimates=useMemo(()=>algorithm==='legacy'?estimatePosition(events,baseStations,{...options,historyWindow:windowSize}):[],[events,baseStations,options,windowSize,algorithm]);
  const estimate=selected ? allEstimates.find(e=>e.sample.sampleIndex===selected.sampleIndex) : undefined;
  const estimates=useMemo(()=>estimate ? allEstimates.filter(e=>e.sample.streamId===estimate.sample.streamId && e.segmentId===estimate.segmentId && e.sample.sampleIndex<=estimate.sample.sampleIndex).slice(-windowSize):[],[allEstimates,estimate,windowSize]);
  const transitions=useMemo(()=>events.filter((event,index)=>{
    const previous=events.slice(0,index).findLast(e=>e.streamId===event.streamId);
    return previous && previous.cellId!==event.cellId && event.timestamp-previous.timestamp<=CONFIG.maxHistoryGapSeconds*1000;
  }),[events]);
  const join=selected ? matchBaseStation(selected,baseStations):null;
  useEffect(()=>{selectRef.current=onSampleSelect;},[onSampleSelect]);
  useEffect(()=>{
    let active=true;
    void import('leaflet').then(L=>{
      if(!active || !host.current)return;
      const instance=L.map(host.current,{zoomControl:false,preferCanvas:true}).setView([35.2123,126.8647],13);
      L.control.zoom({position:'bottomright'}).addTo(instance);
      map.current=instance;layer.current=L.layerGroup().addTo(instance);
      if(apiKey){
        const tiles=L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${apiKey}/Satellite/{z}/{y}/{x}.jpeg`,{maxZoom:19,attribution:'© VWorld'});
        tiles.on('tileerror',()=>setMapError('배경 지도 연결 실패 · 후보 영역은 표시됩니다.'));
        tiles.addTo(instance);
      }
      const observer=new ResizeObserver(()=>instance.invalidateSize());
      observer.observe(host.current);
      instance.on('unload',()=>observer.disconnect());
      setReady(true);
    }).catch(()=>setMapError('지도를 불러오지 못했습니다.'));
    return ()=>{active=false;map.current?.remove();map.current=null;layer.current=null;};
  },[apiKey]);
  useEffect(()=>{
    if(!ready || !map.current)return;
    let active=true;
    void import('leaflet').then(L=>{
      if(!active || !map.current || !layer.current)return;
      const target=layer.current, instance=map.current;
      target.clearLayers();
      if(algorithm==='adaptive')return;
      const renderer=L.canvas({padding:.5});
      if(!estimate){
        if(join){
          L.marker([join.station.latitude,join.station.longitude]).bindTooltip(join.station.isVirtual?'가상 기지국':'기지국 Master 좌표').addTo(target);
          instance.setView([join.station.latitude,join.station.longitude],13);
        }
        return;
      }
      const station=estimate.station, center:[number,number]=[station.latitude,station.longitude], radius=estimate.radius;
      const selectedSample=samples[estimate.sample.sampleIndex];
      const color=metricColor(selectedSample?.[metric]??null,metric);
      // Geo rings use metres, polygon hole stays empty at all map zoom levels.
      L.polygon([ring(station,radius.outerRadiusM,CONFIG.ringSegments),ring(station,radius.innerRadiusM,CONFIG.ringSegments).reverse()],
        {renderer,color:'#65b9e8',weight:1,fillColor:'#5eafff',fillOpacity:.16,fillRule:'evenodd'})
        .bindTooltip('추정 위치 후보 영역 · Inner–Outer Annulus').addTo(target);
      L.circle(center,{renderer,radius:radius.estimatedRadiusM,color:'#e8edf3',weight:1.5,dashArray:'6 5',fill:false}).bindTooltip('경험적 추정 거리 '+meters(radius.estimatedRadiusM)).addTo(target);
      for(const [r,label] of [[radius.innerRadiusM,'내측 추정 반경'],[radius.outerRadiusM,'외측 추정 반경']] as const)
        L.circle(center,{renderer,radius:r,color:'#85c9ff',weight:1,fill:false}).bindTooltip(label+' '+meters(r)).addTo(target);
      const squares=(points:typeof estimate.candidates)=>points.map(p=>{
        const a=offsetPoint(p,-estimate.gridResolutionM/2,-estimate.gridResolutionM/2);
        const b=offsetPoint(p,estimate.gridResolutionM/2,estimate.gridResolutionM/2);
        return [[a.latitude,a.longitude],[a.latitude,b.longitude],[b.latitude,b.longitude],[b.latitude,a.longitude]] as [number,number][];
      });
      L.polygon(squares(estimate.candidates),{renderer,stroke:false,fillColor:'#56d8cb',fillOpacity:.42})
        .bindTooltip('최종 위치 후보 영역 · 경험적 상대 점수').addTo(target);
      if(estimate.transition){
        const {from,to}=estimate.transition;
        L.polyline([[from.latitude,from.longitude],[to.latitude,to.longitude]],{renderer,color:'#ffcb69',dashArray:'9 7',weight:2})
          .bindTooltip('Cell 변경 · 기지국 사이 기준선 (이동 경로 아님)').addTo(target);
        if(estimate.transitionCandidates.length)L.polygon(squares(estimate.transitionCandidates),{renderer,stroke:false,fillColor:'#ffd66b',fillOpacity:.65}).bindTooltip('Cell 변경 경계 후보 영역').addTo(target);
        const oldEvent=estimates.findLast(e=>e.station.cellId===from.cellId);
        if(oldEvent)L.polygon([ring(from,oldEvent.radius.outerRadiusM),ring(from,oldEvent.radius.innerRadiusM).reverse()],
          {renderer,color:'#ffd66b',weight:1,dashArray:'5 5',fillOpacity:.07}).addTo(target);
      }
      const stations=baseStations.filter((s,i,all)=>all.findIndex(t=>t.baseStationId===s.baseStationId && t.latitude===s.latitude && t.longitude===s.longitude)===i);
      stations.forEach(s=>{
        const virtual=s.isVirtual?'가상 기지국':s.provenanceUnknown?'기지국 · 출처 미확인':'기지국 Master';
        L.marker([s.latitude,s.longitude],{icon:L.divIcon({className:'location-station-marker',html:`<span>📡</span><b>${virtual}</b>`,iconSize:[92,46],iconAnchor:[46,24]})})
          .bindTooltip(`${virtual} · ${esc(s.baseStationId)}<br/>Cell ${esc(s.cellId)}`).addTo(target);
      });
      // A dashed path links candidate representatives, not a GPS trajectory.
      const linked=estimates.filter(e=>e.sample.streamId===estimate.sample.streamId);
      linked.forEach((e,index)=>{
        const before=linked[index-1];
        if(before?.showRepresentative && e.showRepresentative)L.polyline([[before.latitude,before.longitude],[e.latitude,e.longitude]],{renderer,color:'#ba9cff',weight:2,dashArray:'3 8',opacity:.6})
          .bindTooltip('추정 후보 중심 이력 · GPS 이동 경로 아님').addTo(target);
      });
      linked.forEach(e=>{
        if(!e.showRepresentative)return;
        L.circleMarker([e.latitude,e.longitude],{renderer,radius:e===estimate?13:5,color:'#fff',weight:2,fillColor:e===estimate?color:'#bda2f5',fillOpacity:1})
          .bindTooltip(`추정 중심점 · ${new Date(e.sample.timestamp).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul'})} · ${confidenceLabel[e.confidence]}`,{permanent:e===estimate,direction:'top',offset:[0,-14]})
          .on('click',()=>selectRef.current(e.sample.sampleIndex)).addTo(target);
      });
      const bounds=L.latLngBounds(ring(station,radius.outerRadiusM));
      estimates.filter(e=>e.showRepresentative).forEach(e=>bounds.extend([e.latitude,e.longitude]));
      if(estimate.transition)bounds.extend([estimate.transition.from.latitude,estimate.transition.from.longitude]);
      if(bounds.isValid())instance.fitBounds(bounds,{padding:[65,75],maxZoom:16,animate:false});
    }).catch(()=>setMapError('추정 영역 표시 중 오류가 발생했습니다.'));
    return ()=>{active=false;};
  },[ready,estimate,estimates,join,metric,samples,overviewRevision,detailsOpen,algorithm]);
  return <div className="location-poc">
    <div className="location-controls"><label>위치추정 알고리즘<select aria-label="위치추정 알고리즘" value={algorithm} onChange={e=>setAlgorithm(e.target.value as typeof algorithm)}><option value="adaptive">Adaptive · 다중 Site</option><option value="legacy">기존 · 경험적 후보 영역</option></select></label></div>
    {algorithm==='legacy' && <details className="location-settings">
      <summary>추정 설정 <span>주파수 {options.frequencyEncoding === 'unknown' ? '미확인' : options.frequencyEncoding === 'mhz' ? 'MHz' : 'LTE EARFCN'} · {options.movementMode === 'walking' ? '보행' : options.movementMode === 'vehicle' ? '차량' : '이동 미확인'} · 최근 {windowSize}개</span></summary>
      <div className="location-controls">
        <label>주파수 형식<select aria-label="추정 주파수 형식" value={options.frequencyEncoding} onChange={event=>setOptions({...options,frequencyEncoding:event.target.value as EstimationOptions['frequencyEncoding']})}>
          <option value="unknown">미확인 · 보정 없음</option><option value="mhz">MHz (확인된 경우)</option><option value="lte-earfcn">LTE EARFCN (확인된 경우)</option>
        </select></label>
        <label>이동 모드<select aria-label="이동 모드" value={options.movementMode} onChange={event=>setOptions({...options,movementMode:event.target.value as EstimationOptions['movementMode']})}>
          <option value="unknown">미확인 · 상한 40 m/s</option><option value="walking">보행 · 상한 2 m/s</option><option value="vehicle">차량 · 상한 30 m/s</option>
        </select></label>
        <label>분석 이력<select aria-label="이력 Sample 수" value={windowSize} onChange={event=>setWindowSize(Number(event.target.value))}>
          <option value={1}>선택 1개</option><option value={5}>최근 5개</option><option value={8}>최근 8개</option>
        </select></label>
        <button type="button" onClick={()=>{setOptions({...DEFAULT_OPTIONS});setWindowSize(HISTORY_WINDOW);}}>기본값 복원</button>
      </div>
      <p>주파수 형식을 확인한 경우에만 보정을 선택하세요. 설정에 따라 POC 후보 영역이 달라지며 실제 GPS 위치를 의미하지 않습니다.</p>
    </details>}
    {algorithm==='adaptive' && <AdaptivePositionLayer map={ready?map.current:null} events={events} stations={baseStations} selectedIndex={selectedSampleIndex} onSelect={onSampleSelect} overviewRevision={overviewRevision}/>}
    <div ref={host} className="location-map" aria-label="MDT 기지국 기반 추정 위치 지도" />
    {algorithm==='legacy' && <div className="location-legend"><b>고객 추정 위치 · POC</b>
      {estimate ? <span>{samples[estimate.sample.sampleIndex]?.time} · 신뢰도 {confidenceLabel[estimate.confidence]}</span> : <span>기지국 연결 또는 무선 정보가 부족하여 위치를 추정할 수 없습니다.</span>}
      <span>청록: 추정 후보 영역 · 파랑 고리: 추정 반경 범위</span>
      {estimate && !estimate.showRepresentative && <span>방향 또는 이동 근거 부족 · 추정점 대신 후보 영역만 표시</span>}
      {estimate && estimate.smoothedRsrp!==estimate.sample.rsrp && <span>일시적 RSRP 변동 완화 적용 · 원본 측정값은 유지</span>}
      <span>노랑: Cell 변경 경계 후보 · 점선: 추정 이력</span>
      <span>콜 또는 시간 차트를 선택해 위치를 확인하세요.</span>
      <span>점은 후보 영역의 대표 위치이며 실제 GPS 위치가 아닙니다.</span>
      {mapError&&<span>{mapError}</span>}
    </div>}
  </div>;
}
