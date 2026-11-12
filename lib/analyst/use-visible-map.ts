'use client';

import {useEffect,useRef} from 'react';

/** Let the summary paint before starting map work, and skip offscreen maps. */
export function useVisibleMap<Element extends HTMLElement=HTMLElement>(ready:boolean,setEnabled:(enabled:boolean)=>void){
  const target=useRef<Element|null>(null);
  useEffect(()=>{
    if(!ready||!target.current)return;
    let stopped=false,frame=0;
    const load=()=>{frame=requestAnimationFrame(()=>{if(!stopped)setEnabled(true);});};
    if(typeof IntersectionObserver==='undefined'){
      load();
      return()=>{stopped=true;cancelAnimationFrame(frame);};
    }
    const observer=new IntersectionObserver(entries=>{
      if(!entries.some(entry=>entry.isIntersecting))return;
      observer.disconnect();
      load();
    },{threshold:0.01});
    observer.observe(target.current);
    return()=>{stopped=true;observer.disconnect();cancelAnimationFrame(frame);};
  },[ready,setEnabled]);
  return target;
}
