'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import type {Map as LeafletMap} from 'leaflet';
import type {CandidateTopTenCustomer} from '../../lib/analyst/candidate-top-ten';
import type {QualityCandidateScope} from '../../lib/analyst/quality-improvement-candidates';
import type {ImprovementCandidate} from '../../lib/analyst/improvement-candidates';
import {groupTopCustomers,topCustomerBubbleDiameter,type TopCustomerMap} from '../../lib/analyst/customer-screening-top-ten';
import type {ScreeningMapQueryResult} from '../../lib/analyst/screening-query';
import {voiceQuery} from '../../lib/analyst/server-query';
import styles from './candidate-top-ten-overlay.module.css';

interface Props {
 map:LeafletMap|null;scope:QualityCandidateScope;customers:readonly CandidateTopTenCustomer[];
 candidates:readonly ImprovementCandidate[];expectedSourceRevision?:string;
}
const validPosition=(lat:number,lon:number)=>Number.isFinite(lat)&&Number.isFinite(lon)&&
 Math.abs(lat)<=90&&Math.abs(lon)<=180&&(lat!==0||lon!==0);

/** Missing ranks stay missing; only exact supplied customers can receive API coordinates. */
export function projectUnmatchedTopTenCustomers(customers:readonly CandidateTopTenCustomer[],source?:TopCustomerMap):TopCustomerMap {
 const byId=new Map((source?.points??[]).map(point=>[point.id,point]));
 const points=[...customers].sort((a,b)=>a.rank-b.rank).flatMap(customer=>{
  const point=byId.get(customer.id);
  return point&&validPosition(point.lat,point.lon)&&(point.evidence==='gnss'||point.evidence==='bye-cell')
   ?[{...point,...customer}]:[];
 });
 return {total:customers.length,unlocated:customers.length-points.length,points};
}

export function CandidateTopTenOverlay({map,scope,customers,candidates,expectedSourceRevision}:Props){
 const {sourceRevision,dateStart,dateEnd,from,to,policy}=scope;
 const queryScope=useMemo(()=>({dateStart,dateEnd,from,to}),[dateStart,dateEnd,from,to]);
 const scopeKey=JSON.stringify([sourceRevision,policy,dateStart,dateEnd,from,to]);
 const customerKey=JSON.stringify(customers.map(customer=>[customer.id,customer.rank,customer.number,customer.poor]));
 const [result,setResult]=useState<{key:string;value:ScreeningMapQueryResult|null;error:string|null}|null>(null);
 const [zoom,setZoom]=useState(13);
 const fit=useRef('');
 const revisionError=!sourceRevision?'고객 위치의 원본 버전이 없습니다.':
  expectedSourceRevision&&sourceRevision!==expectedSourceRevision?'고객 위치와 후보의 원본 버전이 다릅니다.':null;
 useEffect(()=>{
  if(!customers.length||revisionError)return;
  const controller=new AbortController();
  let active=true;
  void voiceQuery<ScreeningMapQueryResult>('screening-map',{
   sourceRevision,scope:queryScope,query:'',filter:'all',sort:'poor',
  },controller.signal).then(value=>{
   if(!Array.isArray(value.topCustomers?.points))throw new Error('TOP10 고객 위치 응답을 확인하지 못했습니다.');
   if(active&&!controller.signal.aborted)setResult({key:scopeKey,value,error:null});
  }).catch(error=>{
   if(active&&!controller.signal.aborted)setResult({key:scopeKey,value:null,error:error instanceof Error?error.message:String(error)});
  });
  return()=>{active=false;controller.abort();};
 },[customers.length,revisionError,sourceRevision,queryScope,scopeKey]);
 const data=!revisionError&&result?.key===scopeKey?result.value:null;
 const error=revisionError??(result?.key===scopeKey?result.error:null);
 const topCustomers=useMemo(()=>projectUnmatchedTopTenCustomers(customers,data?.topCustomers),[customers,data]);
 useEffect(()=>{
  if(!map)return;
  let active=true;
  const update=()=>{if(active)setZoom(map.getZoom());};
  map.on('zoomend',update);
  queueMicrotask(update);
  return()=>{active=false;map.off('zoomend',update);};
 },[map]);
 useEffect(()=>{
  if(!map||!data||error)return;
  let active=true;
  let remove=()=>{};
  void import('leaflet').then(L=>{
   if(!active)return;
   const layer=L.layerGroup().addTo(map);
   remove=()=>layer.remove();
   for(const bubble of groupTopCustomers(topCustomers.points,zoom,point=>map.project([point.lat,point.lon],zoom))){
    const size=topCustomerBubbleDiameter(bubble.poor,zoom);
    const ranks=bubble.customers.map(customer=>customer.rank);
    const label=bubble.customers.length===1?String(ranks[0]):bubble.customers.length+'명';
    const title='후보 미포함 TOP '+ranks.join(', ')+' · 저품질 '+bubble.poor+'건';
    const popup=document.createElement('div');
    popup.className=styles.popup+' qoe-unmatched-top-customer-popup';
    popup.setAttribute('data-unmatched-top-customer-popup','true');
    const heading=document.createElement('strong');heading.textContent='후보 미포함 TOP10 고객';popup.appendChild(heading);
    for(const customer of bubble.customers){
     const description=document.createElement('p');
     description.setAttribute('data-top-customer-id',customer.id);
     description.setAttribute('data-top-customer-rank',String(customer.rank));
     description.setAttribute('data-top-customer-evidence',customer.evidence);
     description.textContent='TOP '+customer.rank+' · '+customer.number+' · 저품질 '+customer.poor+'건 · '+
      (customer.evidence==='gnss'?'GPS 통화 위치':'BYE 기지국 참고 위치');
     popup.appendChild(description);
    }
    const note=document.createElement('small');
    note.textContent='대표 위치는 저품질 통화 기록 중 최다 관측 위치입니다. BYE 기지국은 단말 실측 위치가 아닙니다.';
    popup.appendChild(note);
    const marker=L.marker([bubble.lat,bubble.lon],{zIndexOffset:1100,title,alt:title,
     icon:L.divIcon({className:styles.bubbleIcon+' qoe-unmatched-top-customer-marker',
      html:'<span class="'+styles.bubble+'"><b>'+label+'</b><small>'+bubble.poor+'건</small></span>',
      iconSize:[size,size],iconAnchor:[size/2,size/2]}),
    }).bindTooltip(title,{direction:'top',offset:[0,-size/2],className:styles.tooltip})
     .bindPopup(popup,{maxWidth:340,maxHeight:260}).addTo(layer);
    const element=marker.getElement();
    element?.setAttribute('data-unmatched-top-customer','true');
    element?.setAttribute('data-top-customer-ids',JSON.stringify(bubble.customers.map(customer=>customer.id)));
    element?.setAttribute('data-top-customer-ranks',JSON.stringify(ranks));
    element?.setAttribute('data-top-customer-lat',String(bubble.lat));
    element?.setAttribute('data-top-customer-lon',String(bubble.lon));
   }
  }).catch(()=>{if(active)setResult({key:scopeKey,value:null,error:'미포함 TOP10 고객 지도 표시 실패'});});
  return()=>{active=false;remove();};
 },[map,data,error,topCustomers,zoom,scopeKey]);
 const geometryKey=JSON.stringify(candidates.flatMap(candidate=>{
  const location=candidate.location;
  return location&&validPosition(location.lat,location.lon)?[{lat:location.lat,lon:location.lon,
   radiusM:typeof location.radiusM==='number'&&Number.isFinite(location.radiusM)&&location.radiusM>0?location.radiusM:0}]:[];
 }));
 const geometries=useMemo(()=>JSON.parse(geometryKey) as Array<{lat:number;lon:number;radiusM:number}>,[geometryKey]);
 const pointKey=JSON.stringify(topCustomers.points.map(point=>[point.id,point.lat,point.lon]));
 const fitKey=JSON.stringify([scopeKey,customerKey,geometryKey,pointKey]);
 useEffect(()=>{
  if(!map)return;
  let active=true;
  let resize:(()=>void)|null=null;
  void import('leaflet').then(L=>{
   if(!active)return;
   const coordinates:[number,number][]=topCustomers.points.map(point=>[point.lat,point.lon]);
   for(const location of geometries){
    const latOffset=location.radiusM/111320;
    const lonOffset=location.radiusM/(111320*Math.max(.01,Math.cos(location.lat*Math.PI/180)));
    coordinates.push([location.lat-latOffset,location.lon-lonOffset],[location.lat+latOffset,location.lon+lonOffset]);
   }
   if(!coordinates.length)return;
   const bounds=L.latLngBounds(coordinates);
   const fitUnion=()=>{
    if(!active)return;
    map.fitBounds(bounds,{padding:[48,48],maxZoom:14,animate:false});
    fit.current=fitKey;
   };
   if(fit.current!==fitKey)fitUnion();
   resize=fitUnion;map.on('resize',fitUnion);
  }).catch(()=>{if(active)setResult({key:scopeKey,value:null,error:'미포함 TOP10 고객 지도 범위 표시 실패'});});
  return()=>{active=false;if(resize)map.off('resize',resize);};
 },[map,fitKey,geometries,topCustomers.points,scopeKey]);
 if(!customers.length)return null;
 return <output className={styles.status} aria-label="후보 미포함 TOP10 고객 지도 상태"
  data-unmatched-top-status={error?'error':data?'ready':'loading'}>
  <strong>후보 미포함 TOP10 {customers.length}명</strong>
  <span>{error?'위치 불러오기 실패 · '+error:!data?'고객 위치를 불러오는 중입니다.':
   '지도 표시 '+topCustomers.points.length+'명 · 위치 미확보 '+topCustomers.unlocated+'명'}</span>
  <small>분홍 버블: 숫자 = TOP 순위 · N명 = 밀집 고객 수</small>
  <small>GPS 실측 또는 BYE 기지국 참고 위치</small>
 </output>;
}
