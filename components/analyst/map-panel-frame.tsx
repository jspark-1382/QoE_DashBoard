'use client';

import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Maximize2,Minimize2} from 'lucide-react';
import styles from './map-panel-frame.module.css';

interface Props {
  label:string;
  className?:string;
  suspended?:boolean;
  children:(controls:{expanded:boolean;toggleButton:ReactNode})=>ReactNode;
}

const FOCUSABLE='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex],[contenteditable="true"]';

/** Keeps the map mounted while its existing panel fills the viewport. */
export function MapPanelFrame({label,className,suspended=false,children}:Props){
  const [expanded,setExpanded]=useState(false);
  const frameRef=useRef<HTMLElement|null>(null);
  const toggleRef=useRef<HTMLButtonElement|null>(null);

  useEffect(()=>{
    if(!expanded)return;
    const returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    return()=>{
      document.body.style.overflow=overflow;
      if(returnFocus?.isConnected)returnFocus.focus();
    };
  },[expanded]);

  useEffect(()=>{
    if(!expanded||suspended)return;
    const frame=frameRef.current;
    if(!frame)return;

    // Inert only branches outside this panel, including siblings of ancestors.
    // The panel stays in its original DOM position so Leaflet retains its view.
    const background=new Map<HTMLElement,boolean>();
    let branch:HTMLElement=frame;
    while(branch.parentElement){
      const parent=branch.parentElement;
      for(const sibling of parent.children){
        if(sibling!==branch&&sibling instanceof HTMLElement){
          background.set(sibling,sibling.inert);
          sibling.inert=true;
        }
      }
      if(parent===document.body)break;
      branch=parent;
    }

    const focusable=()=>Array.from(frame.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter(node=>node.tabIndex>=0&&node.getClientRects().length>0&&!node.closest('[hidden],[inert]'));
    const focusStart=()=>{(toggleRef.current??focusable()[0]??frame).focus();};
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        event.preventDefault();
        event.stopPropagation();
        setExpanded(false);
        return;
      }
      if(event.key!=='Tab')return;
      const items=focusable();
      const first=items[0],last=items[items.length-1];
      const active=document.activeElement;
      if(!first){event.preventDefault();frame.focus();}
      else if(event.shiftKey&&(active===first||active===frame||!frame.contains(active))){
        event.preventDefault();last.focus();
      }else if(!event.shiftKey&&(active===last||!frame.contains(active))){
        event.preventDefault();first.focus();
      }
    };
    const onFocusIn=(event:FocusEvent)=>{
      if(!(event.target instanceof Node)||!frame.contains(event.target))focusStart();
    };
    document.addEventListener('keydown',onKeyDown,true);
    document.addEventListener('focusin',onFocusIn,true);
    if(!frame.contains(document.activeElement))focusStart();
    return()=>{
      document.removeEventListener('keydown',onKeyDown,true);
      document.removeEventListener('focusin',onFocusIn,true);
      for(const [element,inert] of background)element.inert=inert;
    };
  },[expanded,suspended]);

  const toggleLabel=expanded?'전체 화면 닫기':'지도 전체 화면';
  const Icon=expanded?Minimize2:Maximize2;
  const toggleButton=<button ref={toggleRef} type="button" className={styles.toggle}
    aria-label={toggleLabel} aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>
    <Icon size={14} aria-hidden="true"/>{toggleLabel}
  </button>;

  return <section ref={frameRef} className={[styles.frame,className,expanded?styles.expanded:''].filter(Boolean).join(' ')}
    aria-label={label} role={expanded?'dialog':undefined} aria-modal={expanded&&!suspended?true:undefined}
    aria-hidden={expanded&&suspended?true:undefined} inert={expanded&&suspended?true:undefined} tabIndex={-1}>
    {children({expanded,toggleButton})}
  </section>;
}
