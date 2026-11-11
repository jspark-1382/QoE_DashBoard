'use client';
import {useEffect,useMemo,useState} from 'react';
import {validateStationCatalog,type StationCatalog,type StationTechnology} from '../../lib/analyst/station-catalog';
import {DEFAULT_STATION_OPTIONS,type StationDisplayOptions} from '../../lib/analyst/station-map-presentation';
const CACHE=new Map<StationTechnology,StationCatalog>();
export interface StationLayerState {
  options:StationDisplayOptions;
  setOptions:(options:StationDisplayOptions)=>void;
  catalogs:StationCatalog[];
  status:'off'|'loading'|'ready'|'error';
  error:string|null;
}
/** Catalogs are fetched only when the optional map layer is enabled. */
export function useCandidateStationLayer():StationLayerState{
  const [options,setOptions]=useState<StationDisplayOptions>(DEFAULT_STATION_OPTIONS);
  const [,setUpdates]=useState(0);
  const [error,setError]=useState<string|null>(null);
  const required=useMemo(()=>options.range==='off'?[]:
    (options.rat==='all'?['LTE','NR']:[options.rat]) as StationTechnology[],[options.range,options.rat]);
  const signature=required.join(',');
  useEffect(()=>{
    if(!required.length){setError(null);return;}
    const needed=required.filter(tech=>!CACHE.has(tech));
    if(!needed.length){setError(null);return;}
    const controller=new AbortController();
    void Promise.all(needed.map(async tech=>{
      const url=tech==='LTE'?'/qoe/station-catalog.json':'/qoe/nr-station-catalog.json';
      const response=await fetch(url,{cache:'no-cache',signal:controller.signal});
      if(!response.ok)throw new Error(tech+' 기지국 인벤토리 HTTP '+response.status);
      const data=validateStationCatalog(await response.json());
      if((data.schemaVersion==='nr-station-catalog-v1'?'NR':'LTE')!==tech)
        throw new Error('기지국 인벤토리 통신방식 불일치');
      return {tech,data};
    })).then(results=>{
      if(controller.signal.aborted)return;
      for(const {tech,data} of results)CACHE.set(tech,data);
      setError(null);setUpdates(n=>n+1);
    }).catch(err=>{
      if(!controller.signal.aborted)setError(err instanceof Error?err.message:'기지국 인벤토리 불러오기 실패');
    });
    return()=>controller.abort();
  },[signature]);
  const catalogs=required.flatMap(tech=>CACHE.has(tech)?[CACHE.get(tech)!]:[]);
  const status=options.range==='off'?'off':error?'error':catalogs.length!==required.length?'loading':'ready';
  return {options,setOptions,catalogs,status,error};
}
