'use client';
import { useEffect, useMemo, useState } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import type { BaseStation, MdtSample } from '@/lib/location-estimation';
import { estimateAdaptive, type AdaptivePosition } from '@/lib/location-estimation/adaptive';
import { ADAPTIVE_CONFIG } from '@/lib/location-estimation/adaptive-config';
import { ring } from '@/lib/location-estimation/geo';

const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const time=(t:number)=>new Date(t).toLocaleTimeString('ko-KR',{hour12:false,timeZone:'Asia/Seoul'});
const format=(v:number|null,d=0)=>v==null?'—':v.toFixed(d);
function positionDetails(p:AdaptivePosition){return `<b>추정 단말 위치 · ${time(p.timestamp)}</b><br/>${format(p.estimatedLat,6)}, ${format(p.estimatedLon,6)}<br/>${p.method} · ${p.siteCount} Site / ${p.usedCellCount} Cell<br/>평균 / 최대 RSRP: ${format(p.avgRsrp,1)} / ${format(p.strongestRsrp,1)} dBm<br/>신뢰도 ${p.confidenceScore}/100 · ${p.confidenceGrade} (정확도 아님)<br/>예상 위치 불확실성 약 ±${format(p.estimatedAccuracyM)} m<br/>Residual ${format(p.residualErrorM)} m · Window ±${p.windowSec}초<br/>Site: ${p.usedSites.map(s=>esc(s.siteId)).join(', ')}<br/>Cell: ${p.usedCellIds.map(esc).join(', ')}<br/>${p.warnings.map(esc).join(' · ')}`;}

export function AdaptivePositionLayer({map,events,stations,selectedIndex,onSelect,overviewRevision}:{map:LeafletMap|null;events:MdtSample[];stations:BaseStation[];selectedIndex:number|null;onSelect:(i:number)=>void;overviewRevision:number}){
  const [mode,setMode]=useState<'max'|'median'|'mean'>('max');
  const [method,setMethod]=useState('ALL'),[grade,setGrade]=useState('ALL'),[site,setSite]=useState('ALL');
  const [cell,setCell]=useState(''),[frequency,setFrequency]=useState('ALL'),[pci,setPci]=useState('');
  const [minRsrp,setMinRsrp]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState('');
  const [layers,setLayers]=useState({stations:true,positions:true,path:true,accuracy:true,debug:false});
  const [playing,setPlaying]=useState(false);
  const data=useMemo(()=>estimateAdaptive(events,stations,{...ADAPTIVE_CONFIG,siteRsrpMode:mode}),[events,stations,mode]);
  const selected=data.positions.find(p=>p.sample.sampleIndex===selectedIndex)??(selectedIndex==null?data.positions[0]:undefined);
  const list=useMemo(()=>data.positions.filter(p=>{
    if(selected && p.sample.streamId!==selected.sample.streamId)return false;
    const clock=new Date(p.timestamp).toLocaleTimeString('en-GB',{hour12:false,timeZone:'Asia/Seoul'});if(from&&clock<from||to&&clock>to+':59')return false;
    if(method!=='ALL'&&p.method!==method||grade==='AB'&&!['A','B'].includes(p.confidenceGrade)||grade!=='ALL'&&grade!=='AB'&&p.confidenceGrade!==grade)return false;
    if(site!=='ALL'&&!p.usedSites.some(s=>s.siteId===site)||cell&&!p.usedCellIds.includes(cell.trim()))return false;
    if(minRsrp!==''&&(p.strongestRsrp==null||p.strongestRsrp<Number(minRsrp)))return false;
    const used=stations.filter(s=>p.usedCellIds.includes(s.cellId));
    if(frequency!=='ALL'&&!used.some(s=>String(s.frequency)===frequency)||pci&&!used.some(s=>String(s.pci)===pci.trim()))return false;
    return true;
  }),[data,selected,method,grade,site,cell,frequency,pci,minRsrp,from,to,stations]);
  const activeIndex=list.findIndex(p=>p===selected),visible=selected&&list.includes(selected)?selected:undefined;
  const displayed=list.slice(Math.max(0,activeIndex-ADAPTIVE_CONFIG.displayLimit+1),Math.max(0,activeIndex)+1);
  useEffect(()=>{if(!playing)return;const timer=setInterval(()=>{const next=list[activeIndex+1];if(next)onSelect(next.sample.sampleIndex);else setPlaying(false);},1000);return()=>clearInterval(timer);},[playing,list,activeIndex,onSelect]);
  useEffect(()=>{
    if(!map)return;let disposed=false;let group:import('leaflet').LayerGroup|undefined;
    void import('leaflet').then(L=>{
      if(disposed)return;group=L.layerGroup().addTo(map);
      const tokens=getComputedStyle(map.getContainer());
      const svg=L.svg();
      const color=(p:AdaptivePosition)=>tokens.getPropertyValue(['A','B'].includes(p.confidenceGrade)?'--exec-green':p.confidenceGrade==='C'?'--exec-amber':'--exec-red').trim()||'#56d8cb';
      if(layers.stations)for(const s of data.sites.filter(s=>!s.excluded)){
        const used=visible?.usedSites.find(o=>o.siteId===s.siteId),virtual=s.cells.some(c=>c.isVirtual),unknown=s.cells.some(c=>c.provenanceUnknown);
        L.marker([s.latitude,s.longitude],{icon:L.divIcon({className:'location-station-marker',html:`<span>📡</span><b>${esc(s.siteId)}${used?' · 사용':''}</b>`,iconSize:[110,46],iconAnchor:[55,24]})})
          .bindPopup(`<b>${esc(s.siteId)} · ${virtual?'가상 기지국':unknown?'출처 미확인':'기지국'}</b><br/>기지국: ${[...new Set(s.cells.map(c=>c.baseStationId))].map(esc).join(', ')}<br/>Cell: ${[...new Set(s.cells.map(c=>c.cellId))].map(esc).join(', ')}<br/>PCI: ${[...new Set(s.cells.map(c=>c.pci??'미제공'))].join(', ')}<br/>주파수: ${[...new Set(s.cells.map(c=>c.frequency??'미제공'))].join(', ')}<br/>현재 사용: ${used?'예':'아니오'} · 대표 RSRP ${format(used?.rsrp??null,1)} dBm`).addTo(group);
      }
      if(layers.path)displayed.forEach((p,i)=>{const prev=displayed[i-1];if(!prev||p.breakBefore||p.jump||prev.jump||p.estimatedLat==null||prev.estimatedLat==null||p.estimatedLon==null||prev.estimatedLon==null)return;
        // Do not bridge observations removed by a filter or missing-data results.
        const full=data.positions.filter(e=>e.sample.streamId===p.sample.streamId);if(full.indexOf(p)!==full.indexOf(prev)+1)return;
        L.polyline([[prev.estimatedLat,prev.estimatedLon],[p.estimatedLat,p.estimatedLon]],{color:'#ba9cff',weight:2,dashArray:'4 7',opacity:.65}).addTo(group!);});
      if(layers.positions)for(const p of displayed){if(p.estimatedLat==null||p.estimatedLon==null)continue;
        const marker=L.circleMarker([p.estimatedLat,p.estimatedLon],{renderer:svg,radius:p===visible?11:5,color:color(p),weight:3,fillColor:color(p),fillOpacity:['D','E'].includes(p.confidenceGrade)?.18:.9})
          .bindTooltip(`추정 UE · ${time(p.timestamp)} · ${p.confidenceGrade}`,{permanent:p===visible,direction:'top'})
          .bindPopup(positionDetails(p)).on('click',()=>{if(p!==visible)onSelect(p.sample.sampleIndex);}).addTo(group);
        marker.getElement()?.setAttribute('aria-label',`추정 UE ${p.sample.sampleIndex}`);
      }
      if(visible?.estimatedLat!=null&&visible.estimatedLon!=null){
        const point:[number,number]=[visible.estimatedLat,visible.estimatedLon];
        if(layers.accuracy&&visible.estimatedAccuracyM!=null)L.circle(point,{radius:visible.estimatedAccuracyM,color:'#56d8cb',weight:1.5,fillColor:'#56d8cb',fillOpacity:.15}).bindTooltip(`예상 위치 불확실성 약 ±${format(visible.estimatedAccuracyM)} m`).addTo(group);
        if(layers.debug)visible.usedSites.forEach(s=>{
          const details=`${esc(s.siteId)} · ${s.rsrp.toFixed(1)} dBm<br/>추정 거리 ${s.estimatedDistanceM.toFixed(0)} m · Weight ${s.weight.toFixed(3)}<br/>Δt ${s.deltaTimeSec.toFixed(1)}초 · Residual ${s.residualM.toFixed(0)} m`;
          L.circle([s.latitude,s.longitude],{radius:s.estimatedDistanceM,color:'#ffcb69',fill:false,weight:1,dashArray:'5 5'}).bindTooltip(details).addTo(group!);
          L.polyline([[s.latitude,s.longitude],point],{color:'#ffcb69',weight:1,dashArray:'3 5'}).bindTooltip(details).addTo(group!);
        });
      }
    });return()=>{disposed=true;group?.remove();};
  },[map,data,visible,list,activeIndex,layers,onSelect]);
  useEffect(()=>{if(!map||visible?.estimatedLat==null||visible.estimatedLon==null)return;
    // Keep user zoom/pan between point selections. Explicit overview fits the analyzed sites.
    if(!map.getBounds().contains([visible.estimatedLat,visible.estimatedLon]))map.panTo([visible.estimatedLat,visible.estimatedLon],{animate:false});
  },[map,visible]);
  useEffect(()=>{if(!map)return;void import('leaflet').then(L=>{const active=data.sites.filter(s=>!s.excluded);if(active.length)map.fitBounds(L.latLngBounds(active.map(s=>[s.latitude,s.longitude])),{padding:[70,70],maxZoom:15,animate:false});});},[map,data.sites,overviewRevision]);
  return <>
    <details className="location-settings adaptive-settings">
      <summary>추정 설정 · Adaptive <span>{list.length}개 관측 · ±5~60초 · 제외 Site {data.stats.excludedSites.length}개</span></summary>
      <div className="location-controls adaptive-filters">
        <label>Site 대표 RSRP<select aria-label="Site 대표 RSRP" value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="max">최대</option><option value="median">중앙값</option><option value="mean">평균</option></select></label>
        <label>추정 방식<select aria-label="추정 방식 필터" value={method} onChange={e=>setMethod(e.target.value)}>{['ALL','MULTILATERATION','WEIGHTED_2_SITE','CELL_SITE','INVALID'].map(v=><option key={v}>{v}</option>)}</select></label>
        <label>신뢰도<select aria-label="신뢰도 필터" value={grade} onChange={e=>setGrade(e.target.value)}>{['ALL','AB','A','B','C','D','E'].map(v=><option key={v}>{v}</option>)}</select></label>
        <label>Site<select aria-label="Site 필터" value={site} onChange={e=>setSite(e.target.value)}><option>ALL</option>{data.sites.filter(s=>!s.excluded).map(s=><option key={s.siteId}>{s.siteId}</option>)}</select></label>
        <label>Cell ID<input aria-label="Cell ID 필터" value={cell} onChange={e=>setCell(e.target.value)} placeholder="전체" /></label>
        <label>주파수<select aria-label="주파수 필터" value={frequency} onChange={e=>setFrequency(e.target.value)}><option>ALL</option>{[...new Set(stations.map(s=>s.frequency).filter(f=>f!=null))].map(f=><option key={f}>{f}</option>)}</select></label>
        <label>PCI<input aria-label="PCI 필터" value={pci} onChange={e=>setPci(e.target.value)} placeholder="전체" /></label>
        <label>최대 RSRP 하한<input type="number" aria-label="RSRP 하한" value={minRsrp} onChange={e=>setMinRsrp(e.target.value)} placeholder="dBm" /></label>
        <label>시작<input type="time" aria-label="추정 시작 시간" value={from} onChange={e=>setFrom(e.target.value)} /></label><label>종료<input type="time" aria-label="추정 종료 시간" value={to} onChange={e=>setTo(e.target.value)} /></label>
      </div>
      <div className="location-controls">{Object.entries(layers).map(([key,value])=><label className="adaptive-check" key={key}><input type="checkbox" checked={value} onChange={e=>setLayers({...layers,[key]:e.target.checked})}/>{{stations:'기지국',positions:'추정 위치',path:'추정 경로',accuracy:'불확실성 반경',debug:'Debug'}[key]}</label>)}</div>
      <p>기준 100m / −65dBm / n=3 · 미보정 모델 · 시간창은 전후 관측을 포함합니다. 신뢰도는 정확도 백분율이 아닙니다.</p>
    </details>
    <div className="adaptive-playbar"><button disabled={activeIndex<=0} onClick={()=>onSelect(list[activeIndex-1].sample.sampleIndex)}>이전</button><button disabled={!list.length} onClick={()=>setPlaying(v=>!v)}>{playing?'일시정지':'재생'}</button><button disabled={activeIndex>=list.length-1||!list.length} onClick={()=>onSelect(list[activeIndex+1].sample.sampleIndex)}>다음</button><input type="range" aria-label="위치 추정 시간" min={0} max={Math.max(0,list.length-1)} value={Math.max(0,activeIndex)} disabled={!list.length} onChange={e=>{setPlaying(false);onSelect(list[Number(e.target.value)].sample.sampleIndex);}}/><span>{selected?time(selected.timestamp):'관측 없음'}</span></div>
    <div className="location-legend adaptive-summary" aria-label="Adaptive 위치 상세">
      <b>추정 단말 위치 · {visible?.method??'표시 결과 없음'}</b>
      {visible&&<><span>{format(visible.estimatedLat,6)}, {format(visible.estimatedLon,6)} · {visible.siteCount} Site</span><span>신뢰도 {visible.confidenceScore}/100 · {visible.confidenceGrade} · Window ±{visible.windowSec}초</span><span>평균 / 최대 RSRP {format(visible.avgRsrp,1)} / {format(visible.strongestRsrp,1)} dBm</span><span>예상 위치 불확실성 약 ±{format(visible.estimatedAccuracyM)}m · Residual {format(visible.residualErrorM)}m</span><span>Site {visible.usedSites.map(s=>s.siteId).join(', ')||'없음'} · Cell {visible.usedCellIds.join(', ')||'없음'}</span><span>{visible.warnings.join(' · ')}</span></>}
      {!visible&&<span>필터에 해당하는 관측을 시간 선택에서 고르세요.</span>}
      <span>미매칭 {data.stats.unmatched}개 · 좌표 이상 제외 {data.stats.excludedSamples}개 관측 · 경로 최대 {ADAPTIVE_CONFIG.displayLimit}개 표시</span>
    </div>
  </>;
}
