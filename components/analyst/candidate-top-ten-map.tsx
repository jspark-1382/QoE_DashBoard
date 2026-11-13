'use client';

import {lazy,Suspense,useEffect,useMemo,useState} from 'react';
import type {CandidateTopTenCustomer} from '../../lib/analyst/candidate-top-ten';
import type {QualityCandidateScope} from '../../lib/analyst/quality-improvement-candidates';
import type {ScreeningGeography} from '../../lib/analyst/customer-screening-map';
import type {TopCustomerMap} from '../../lib/analyst/customer-screening-top-ten';
import {screeningTopRoutes,type ScreeningMapQueryResult,type ScreeningRoutesResult} from '../../lib/analyst/screening-query';
import {voiceQuery} from '../../lib/analyst/server-query';
import styles from './candidate-top-ten-map.module.css';

const CustomerScreeningMap=lazy(()=>import('./customer-screening-map').then(module=>({default:module.CustomerScreeningMap})));
const EMPTY_GEOGRAPHY:ScreeningGeography={areas:[],cells:[],gnss:[],unmappedPoorCalls:0,gnssPoorCalls:0,byeCellPoorCalls:0};
const ignoreSelection=()=>{};
interface Props {scope:QualityCandidateScope;customers:readonly CandidateTopTenCustomer[]}
interface QueryResult<T> {key:string;value:T|null;error:string|null}

export function CandidateTopTenMap({scope,customers}:Props){
 const ranked=useMemo(()=>customers.slice(0,10),[customers]);
 const {sourceRevision,dateStart,dateEnd,from,to,policy}=scope;
 const queryScope=useMemo(()=>({dateStart,dateEnd,from,to}),[dateStart,dateEnd,from,to]);
 const scopeKey=JSON.stringify([sourceRevision,policy,dateStart,dateEnd,from,to]);
 const customerIds=JSON.stringify(ranked.map(customer=>customer.id));
 const routeKey=JSON.stringify([scopeKey,customerIds]);
 const hasCustomers=ranked.length>0;
 const [mapResult,setMapResult]=useState<QueryResult<ScreeningMapQueryResult>|null>(null);
 const [routeResult,setRouteResult]=useState<QueryResult<ScreeningRoutesResult>|null>(null);
 const [selection,setSelection]=useState<{key:string;id:string}|null>(null);
 useEffect(()=>{
  if(!hasCustomers||!sourceRevision)return;
  const controller=new AbortController();
  let active=true;
  void voiceQuery<ScreeningMapQueryResult>('screening-map',{
   sourceRevision,scope:queryScope,query:'',filter:'all',sort:'poor',
  },controller.signal).then(value=>{
   if(!Array.isArray(value.topCustomers?.points))throw new Error('TOP10 고객 위치 응답을 확인하지 못했습니다.');
   if(active&&!controller.signal.aborted)setMapResult({key:scopeKey,value,error:null});
  }).catch(error=>{
   if(active&&!controller.signal.aborted)setMapResult({key:scopeKey,value:null,error:error instanceof Error?error.message:String(error)});
  });
  return()=>{active=false;controller.abort();};
 },[hasCustomers,sourceRevision,queryScope,scopeKey]);
 useEffect(()=>{
  if(!hasCustomers||!sourceRevision)return;
  const controller=new AbortController();
  let active=true;
  queueMicrotask(()=>{if(!controller.signal.aborted)setSelection(null);});
  void voiceQuery<ScreeningRoutesResult>('routes',{
   sourceRevision,scope:queryScope,customerIds:JSON.parse(customerIds) as string[],day:'all',
  },controller.signal).then(value=>{
   if(!Array.isArray(value.routes))throw new Error('TOP10 고객 통화 위치 응답을 확인하지 못했습니다.');
   if(active&&!controller.signal.aborted)setRouteResult({key:routeKey,value,error:null});
  }).catch(error=>{
   if(active&&!controller.signal.aborted)setRouteResult({key:routeKey,value:null,error:error instanceof Error?error.message:String(error)});
  });
  return()=>{active=false;controller.abort();};
 },[hasCustomers,sourceRevision,queryScope,customerIds,routeKey]);
 const mapData=mapResult?.key===scopeKey?mapResult.value:null;
 const mapError=!sourceRevision?'고객 위치를 조회할 원본 버전이 없습니다.':mapResult?.key===scopeKey?mapResult.error:null;
 const routeData=routeResult?.key===routeKey?routeResult.value:null;
 const routeError=routeResult?.key===routeKey?routeResult.error:null;
 const topCustomers=useMemo<TopCustomerMap>(()=>{
  const byId=new Map((mapData?.topCustomers.points??[]).map(point=>[point.id,point]));
  const points=ranked.flatMap(customer=>{
   const point=byId.get(customer.id);
   if(!point||!Number.isFinite(point.lat)||!Number.isFinite(point.lon)||
    Math.abs(point.lat)>90||Math.abs(point.lon)>180||(point.lat===0&&point.lon===0))return [];
   return [{...point,id:customer.id,number:customer.number,rank:customer.rank,poor:customer.poor}];
  });
  return {total:ranked.length,unlocated:ranked.length-points.length,points};
 },[mapData,ranked]);
 const routes=routeData?.routes??[];
 const ranks=new Map(ranked.map(customer=>[customer.id,customer.rank]));
 const topCustomerRoutes=screeningTopRoutes(ranked,routes).map(item=>({...item,rank:ranks.get(item.route.customerId)??item.rank}));
 const selectedId=selection?.key===routeKey?selection.id:'';
 const selectedCustomer=ranked.find(customer=>customer.id===selectedId);
 const selectedRoute=routes.find(route=>route.customerId===selectedId);
 const customerRoute=selectedRoute?.observations.length?selectedRoute:null;
 const routeLoading=hasCustomers&&!!sourceRevision&&!routeData&&!routeError;
 const pickCustomer=(id:string)=>{if(ranks.has(id))setSelection({key:routeKey,id});};
 return <section className={styles.panel} aria-label="후보가 없는 TOP10 고객 위치 지도">
  <header className={styles.header}>
   <div><strong>고객현황 TOP10 위치</strong><p>TOP10 고객이 포함된 후보가 없어 고객 위치를 표시합니다.</p></div>
   <button type="button" onClick={()=>setSelection(null)} disabled={!selectedId}>TOP10 전체 보기</button>
  </header>
  {selectedCustomer&&<output className={styles.selection}>TOP {selectedCustomer.rank} · {selectedCustomer.number}
   {routeLoading?' · 통화 위치를 불러오는 중입니다.':routeError?' · 통화 위치 조회 실패':!customerRoute?' · 표시할 통화 위치가 없습니다.':' · 통화 위치 흐름'}</output>}
  {routeError&&mapData&&<p className={styles.error} role="alert">통화 위치 흐름을 불러오지 못했습니다. {routeError}</p>}
  <div className={styles.mapSurface}>
   {!hasCustomers?<output className={styles.status}>선택한 기간·시간에 저품질 TOP10 고객이 없습니다.</output>:
    mapError?<div className={styles.status} role="alert">고객 위치를 불러오지 못했습니다. {mapError}</div>:
    !mapData?<output className={styles.status}>TOP10 고객 위치를 불러오는 중입니다.</output>:
    !topCustomers.points.length?<output className={styles.status}>TOP10 {topCustomers.total}명의 위치를 확보하지 못했습니다. 위치 미확보 {topCustomers.unlocated}명</output>:
    <Suspense fallback={<output className={styles.status}>지도를 준비하는 중입니다.</output>}>
     <CustomerScreeningMap key={JSON.stringify([scopeKey,customerRoute?.customerId??'top10'])} geography={EMPTY_GEOGRAPHY} sourceRevision={sourceRevision}
      mode={customerRoute?'route':'top10'} metric="customers" selectedAreaId="" selectedCellId=""
      customerRoute={customerRoute} topCustomers={topCustomers} topCustomerRoutes={topCustomerRoutes}
      onSelectArea={ignoreSelection} onSelectCell={ignoreSelection} onSelectCustomer={pickCustomer}/>
    </Suspense>}
  </div>
  <footer className={styles.footer}>
   {mapData&&<span>위치 표시 {topCustomers.points.length}/{topCustomers.total}명 · 위치 미확보 {topCustomers.unlocated}명</span>}
   <span>GPS는 실측 통화 위치이며 BYE 기지국은 참고 위치입니다. 시간순 점선은 실제 이동경로를 뜻하지 않습니다.</span>
  </footer>
 </section>;
}
