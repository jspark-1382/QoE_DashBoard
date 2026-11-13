'use client';

import {useEffect,useMemo,useState} from 'react';
import {loadCandidateTopTenLocations,type CandidateTopTenState} from '../../lib/analyst/candidate-top-ten';
import type {TopCustomerMap} from '../../lib/analyst/customer-screening-top-ten';
import type {QualityCandidateScope} from '../../lib/analyst/quality-improvement-candidates';

interface CandidateTopTenLocationState {
 status:CandidateTopTenState['status'];value:TopCustomerMap|null;error:string|null;
}
const idle:CandidateTopTenLocationState={status:'idle',value:null,error:null};

/** Keep location requests and completed values bound to the candidate source and time scope. */
export function useCandidateTopTenLocations(scope:QualityCandidateScope,enabled:boolean):CandidateTopTenLocationState {
 const {sourceRevision,dateStart,dateEnd,from,to,policy}=scope;
 const requestScope=useMemo(()=>({sourceRevision,dateStart,dateEnd,from,to,policy}),[sourceRevision,dateStart,dateEnd,from,to,policy]);
 const key=JSON.stringify([sourceRevision,dateStart,dateEnd,from,to,policy]);
 const [stored,setStored]=useState<{key:string;value:CandidateTopTenLocationState}>({key:'',value:idle});
 useEffect(()=>{
  if(!enabled||!sourceRevision)return;
  const controller=new AbortController();
  queueMicrotask(()=>{if(!controller.signal.aborted)setStored(previous=>previous.key===key&&previous.value.status==='ready'?previous:{key,value:{...idle,status:'loading'}});});
  void loadCandidateTopTenLocations(requestScope,controller.signal)
   .then(value=>{if(!controller.signal.aborted)setStored({key,value:{status:'ready',value,error:null}});})
   .catch(error=>{if(!controller.signal.aborted)setStored({key,value:{...idle,status:'error',error:error instanceof Error?error.message:'TOP10 고객 위치를 확인하지 못했습니다.'}});});
  return()=>controller.abort();
 },[enabled,sourceRevision,key,requestScope]);
 if(enabled&&!sourceRevision)return {...idle,status:'error',error:'TOP10 고객 위치의 원본 버전이 없습니다.'};
 const current=stored.key===key?stored.value:idle;
 return current.status==='ready'||current.status==='error'?current:enabled?{...idle,status:'loading'}:idle;
}
