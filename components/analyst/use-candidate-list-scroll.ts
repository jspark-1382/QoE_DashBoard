'use client';

import {useLayoutEffect,useRef} from 'react';

function revealRow(viewport:HTMLElement, row:HTMLElement) {
  if (!viewport.clientHeight || viewport.scrollHeight <= viewport.clientHeight) return;
  const top = viewport.getBoundingClientRect().top + viewport.clientTop;
  const bottom = top + viewport.clientHeight;
  const bounds = row.getBoundingClientRect();
  if (bounds.top < top || (bounds.bottom > bottom && bounds.height > viewport.clientHeight)) {
    viewport.scrollTop += bounds.top - top;
  } else if (bounds.bottom > bottom) {
    viewport.scrollTop += bounds.bottom - bottom;
  }
}

/** Reveal a new or explicitly reselected candidate without scrolling the document or moving focus. */
export function useCandidateListScroll<T extends HTMLElement>(id:string | null | undefined, mapPick:number, filter:string, rowCount:number) {
  const list = useRef<T>(null);
  useLayoutEffect(() => {
    const viewport = list.current;
    const selected = viewport?.querySelector<HTMLElement>('button[data-candidate-id][aria-pressed="true"]');
    if (!viewport || !selected || selected.dataset.candidateId !== id) return;
    revealRow(viewport,selected);
    // In fullscreen the TOP10 coverage and the list can share a second scroller.
    const card = viewport.closest<HTMLElement>('[data-candidate-list-viewport]');
    if (card) revealRow(card,selected);
  },[id,mapPick,filter,rowCount]);
  return list;
}
