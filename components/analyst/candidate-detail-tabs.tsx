'use client';

import {useId, type KeyboardEvent, type ReactNode} from 'react';

const tabs = [
  ['summary', '선정 요약'],
  ['calls', '고객·통화'],
  ['rf', '위치·무선 근거'],
] as const;

export type CandidateDetailTab = (typeof tabs)[number][0];

export function CandidateDetailTabs({value, onChange, label, className, panelClassName, children}: {
  value: CandidateDetailTab;
  onChange: (tab: CandidateDetailTab) => void;
  label: string;
  className: string;
  panelClassName?: string;
  children: ReactNode;
}) {
  const prefix = useId();
  const panelId = prefix + '-panel';
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    switch (event.key) {
      case 'ArrowRight': next = (index + 1) % tabs.length; break;
      case 'ArrowLeft': next = (index + tabs.length - 1) % tabs.length; break;
      case 'Home': next = 0; break;
      case 'End': next = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    onChange(tabs[next][0]);
    document.getElementById(prefix + tabs[next][0])?.focus({preventScroll:true});
  }
  return <>
    <div className={className} role="tablist" aria-label={label}>
      {tabs.map(([id,title],index) => <button key={id} id={prefix + id} type="button" role="tab"
        aria-selected={id === value} aria-controls={panelId} tabIndex={id === value ? 0 : -1}
        onClick={() => onChange(id)} onKeyDown={event => navigate(event,index)}>{title}</button>)}
    </div>
    <div id={panelId} className={panelClassName} role="tabpanel" aria-labelledby={prefix + value} tabIndex={0}>{children}</div>
  </>;
}
