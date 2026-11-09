'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {X,FlaskConical} from 'lucide-react';
import styles from './quality-simulator-dialog.module.css';

interface Props{
 title:string;
 onClose:()=>void;
 children:ReactNode;
 explanation?:ReactNode;
 criteria?:ReactNode;
}
const FOCUSABLE='button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';

/** Independent simulator popup. The MapPanelFrame is suspended while it is open,
 * so Escape closes ONLY this popup and leaves the map, zoom and candidate intact. */
export function QualitySimulatorDialog({title,onClose,children,explanation,criteria}:Props){
 const [view,setView]=useState<'simulation'|'explanation'|'criteria'>('simulation');
 const frame=useRef<HTMLDialogElement>(null);
 const closeButton=useRef<HTMLButtonElement>(null);
 const onCloseRef=useRef(onClose);
 useEffect(()=>{onCloseRef.current=onClose;},[onClose]);
 useEffect(()=>{
  const prior=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const previousOverflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  closeButton.current?.focus();
  const getFocusables=()=>Array.from(frame.current?.querySelectorAll<HTMLElement>(FOCUSABLE)??[])
   .filter(x=>x.getClientRects().length>0);
  const onKeyDown=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){
    event.preventDefault();
    event.stopImmediatePropagation();
    onCloseRef.current();
    return;
   }
   if(event.key!=='Tab')return;
   const focusables=getFocusables();
   const first=focusables[0],last=focusables[focusables.length-1];
   if(!first)return;
   const active=document.activeElement;
   if(event.shiftKey&&(active===first||!frame.current?.contains(active))){
    event.preventDefault();last.focus();
   }else if(!event.shiftKey&&(active===last||!frame.current?.contains(active))){
    event.preventDefault();first.focus();
   }
  };
  const onFocusIn=(event:FocusEvent)=>{
   if(event.target instanceof Node&&!frame.current?.contains(event.target)){
    closeButton.current?.focus();
   }
  };
  document.addEventListener('keydown',onKeyDown,true);
  document.addEventListener('focusin',onFocusIn,true);
  return()=>{
   document.removeEventListener('keydown',onKeyDown,true);
   document.removeEventListener('focusin',onFocusIn,true);
   document.body.style.overflow=previousOverflow;
   queueMicrotask(()=>{if(prior?.isConnected&&!prior.inert)prior.focus();});
  };
 },[]);
 if(typeof document==='undefined')return null;
 return createPortal(
  <div className={styles.backdrop} aria-label="시뮬레이터 팝업 배경">
   <button type="button" tabIndex={-1} className={styles.backdropDismiss} aria-label="팝업 바깥쪽에서 닫기" onClick={onClose}/>
   <dialog open ref={frame} className={styles.dialog} aria-modal="true" aria-label={title} tabIndex={-1}>
    <header className={styles.header}>
     <div className={styles.heading}>
      <span><FlaskConical size={16}/> 알고리즘 직접 체험</span>
      <h2>{title}</h2>
      <p>가상 실습 전용 · 실제 후보 지역·통화 데이터·지도는 변경되지 않습니다.</p>
     </div>
     {(explanation||criteria)&&<nav className={styles.viewNav} aria-label="팝업 화면 선택">
      <button type="button" aria-pressed={view==='simulation'} onClick={()=>setView('simulation')}>시뮬레이터</button>
      {explanation&&<button type="button" aria-pressed={view==='explanation'} onClick={()=>setView('explanation')}>알고리즘 설명</button>}
      {criteria&&<button type="button" aria-pressed={view==='criteria'} onClick={()=>setView('criteria')}>선정 기준</button>}
     </nav>}
     <button ref={closeButton} className={styles.close} type="button" aria-label="시뮬레이터 팝업 닫기" onClick={()=>onCloseRef.current()}><X size={19}/> 닫기</button>
    </header>
    <div className={styles.content} aria-label="시뮬레이터 팝업 내용">
     <div className={styles.simulationView} hidden={view!=='simulation'} inert={view!=='simulation'}>{children}</div>
     {view==='explanation'&&explanation&&<div className={styles.referenceContent}>{explanation}</div>}
     {view==='criteria'&&criteria&&<div className={styles.referenceContent}>{criteria}</div>}
    </div>
   </dialog>
  </div>,document.body
 );
}
