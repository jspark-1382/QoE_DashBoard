'use client';

import type { MouseEvent, ReactNode } from 'react';
import Link from './document-link';
import { BarChart3, CalendarDays, RadioTower, Users } from 'lucide-react';
import styles from './quality-top-nav.module.css';

export type QualityTab='quality'|'contract'|'mos'|'stations'|'legacy'|'improvement1'|'improvement2'|'customer-screening';
interface Props {
  active:QualityTab;
  date?:string;
  sourceLabel?:string;
  onContract?:()=>void;
  onLegacy?:()=>void;
  legacyHref?:string;
  improvementHref?:string;
  improvementTwoHref?:string;
  qualityHref?:string;
  actions?:ReactNode;
}
/** Shared navigation, visually identical on all QoE quality workspaces. */
export function QualityTopNav({
  active,date='2026-10-30',sourceLabel,onContract,qualityHref,actions,
}:Props) {
  const contract='/?source=MDT&view=contract&date='+date;
  const handle=(callback?:()=>void)=>(event:MouseEvent<HTMLAnchorElement>)=>{
    if(!callback || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)return;
    event.preventDefault();
    callback();
  };
  return <header className={styles.nav}>
    <Link href="/" className={styles.brand}>
      <RadioTower size={24} color="#40d5c7"/>QoE 분석 <span>· 음성품질</span>
    </Link>
    <nav className={styles.links} aria-label="품질 분석 탭">
      <Link className={active==='quality'?styles.current:undefined}
        aria-current={active==='quality'?'page':undefined} href={qualityHref??'/'}>
        <BarChart3 size={15}/>품질 현황
      </Link>
      <Link className={active==='customer-screening'?styles.current:undefined}
        aria-current={active==='customer-screening'?'page':undefined}
        href="/customer-screening"><Users size={15}/>고객 선별</Link>
      <Link className={active==='contract'?styles.current:undefined}
        aria-current={active==='contract'?'page':undefined} href={contract}
        onClick={handle(onContract)}><Users size={15}/>고객·통화 분석</Link>
      <Link className={active==='stations'?styles.current:undefined}
        aria-current={active==='stations'?'page':undefined} href="/stations">
        <RadioTower size={15}/>기지국·PCI
      </Link>
    </nav>
    <span className={styles.source}>
      <CalendarDays size={15}/>{sourceLabel??date.replaceAll('-','.')+' · MDT (Voice)'}
    </span>
    {actions&&<div className={styles.actions}>{actions}</div>}
  </header>;
}
