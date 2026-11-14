'use client';
/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- Native dialog handles keyboard dismissal and focus containment; its click handler only detects the backdrop. */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  qualityCustomerSelectionIds, updateQualityCustomerSelection, type QualityCustomerFilter,
} from '../../lib/analyst/quality-customer-picker';
import {voiceQuery,type VoiceScope} from '../../lib/analyst/server-query';
import {serverCustomerPickerRequest,type ServerCustomerPickerResult} from '../../lib/analyst/server-customer-picker';
import DocumentLink from './document-link';
import styles from './quality-customer-picker.module.css';

interface Props {
  scope:VoiceScope;
  sourceRevision:string;
  selectedCustomerIds:readonly string[];
  onApplyCustomerIds:(ids:string[])=>void;
  disabled?:boolean;
}
const count = (value: number) => value.toLocaleString('ko-KR');
const filters: { id: QualityCustomerFilter; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'poor', label: '불량 1건 이상' },
  { id: 'repeat', label: '반복 불량 2건 이상' },
];

export function ServerQualityCustomerPicker({scope,sourceRevision,selectedCustomerIds,onApplyCustomerIds,disabled=false}:Props) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const launcherInput = useRef<HTMLInputElement>(null);
  const drawerInput = useRef<HTMLInputElement>(null);
  const launchedFrom = useRef<HTMLElement | null>(null);
  const lockedBody = useRef<{ element: HTMLElement; overflow: string; paddingRight: string } | null>(null);
  const [launcherQuery, setLauncherQuery] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<QualityCustomerFilter>('all');
  const [page, setPage] = useState(0);
  const [draftIds, setDraftIds] = useState<string[]>(() => qualityCustomerSelectionIds(selectedCustomerIds));
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [opened,setOpened]=useState(false);
  const [debouncedQuery,setDebouncedQuery]=useState('');
  const [attempt,setAttempt]=useState(0);
  const [response,setResponse]=useState<{key:string;listKey:string;data?:ServerCustomerPickerResult;error?:string}|null>(null);
  const baseScope=useMemo(()=>({dateStart:scope.dateStart,dateEnd:scope.dateEnd,from:scope.from,to:scope.to}),
    [scope.dateStart,scope.dateEnd,scope.from,scope.to]);
  const request=useMemo(()=>({...serverCustomerPickerRequest(baseScope,debouncedQuery,filter,page,draftIds,selectedOnly),sourceRevision}),
    [baseScope,debouncedQuery,filter,page,draftIds,selectedOnly,sourceRevision]);
  const requestKey=JSON.stringify([request,attempt]);
  const listKey=JSON.stringify([baseScope,debouncedQuery,filter,page,selectedOnly,selectedOnly?draftIds:[],sourceRevision]);
  const active=response?.key===requestKey?response:null;
  const result=active?.data??(response?.listKey===listKey?response.data:undefined);
  const loading=opened&&!result&&!active?.error;
  const selection=active?.data?.selection;
  const rows=result?.rows??[];
  const selectedSet=new Set(draftIds);
  const allPageSelected=rows.length>0&&rows.every(row=>selectedSet.has(row.customerId));
  const singleSelected=draftIds.length===1?selection?.single:null;
  const close=()=>dialog.current?.close();
  useEffect(()=>{
    if(!opened)return;
    const timeout=setTimeout(()=>setDebouncedQuery(query.trim()),200);
    return()=>clearTimeout(timeout);
  },[query,opened]);
  useEffect(()=>{
    if(!opened)return;
    const controller=new AbortController();
    voiceQuery<ServerCustomerPickerResult>('customers',request,controller.signal).then(data=>{
      if(!controller.signal.aborted)setResponse({key:requestKey,listKey,data});
    }).catch(error=>{
      if(!controller.signal.aborted)setResponse({key:requestKey,listKey,error:error instanceof Error?error.message:String(error)});
    });
    return()=>controller.abort();
  },[opened,request,requestKey,listKey]);
  const releasePageScroll = useCallback(() => {
    const previous = lockedBody.current;
    if (!previous) return;
    previous.element.style.overflow = previous.overflow;
    previous.element.style.paddingRight = previous.paddingRight;
    lockedBody.current = null;
  }, []);

  useEffect(() => releasePageScroll, [releasePageScroll]);

  // Close an obsolete search scope, but keep applied identities in the parent.
  useEffect(() => {
    dialog.current?.close();
  }, [baseScope,sourceRevision]);

  const open = (origin: HTMLElement | null, initialQuery: string) => {
    if (disabled) return;
    launchedFrom.current = origin;
    setQuery(initialQuery);
    setDebouncedQuery(initialQuery.trim());
    setResponse(null);
    setOpened(true);
    setFilter('all');
    setPage(0);
    setDraftIds(qualityCustomerSelectionIds(selectedCustomerIds));
    setSelectedOnly(false);
    if (!dialog.current?.open) {
      dialog.current?.showModal();
      const element = document.body;
      lockedBody.current = { element, overflow: element.style.overflow, paddingRight: element.style.paddingRight };
      const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
      if (scrollbarWidth) element.style.paddingRight = (parseFloat(window.getComputedStyle(element).paddingRight) || 0) + scrollbarWidth + 'px';
      element.style.overflow = 'hidden';
    }
    drawerInput.current?.focus();
  };

  const apply = () => {
    onApplyCustomerIds(draftIds);
    close();
  };

  return <>
    <form className={styles.launcher} onSubmit={event => {
      event.preventDefault();
      open(launcherInput.current, launcherQuery);
    }}>
      <label className={styles.launcherField}>
        <input ref={launcherInput} aria-label="서비스 고객번호 검색" disabled={disabled}
          value={launcherQuery} placeholder="원본 고객번호 입력" type="search" autoComplete="off"
          onChange={event => setLauncherQuery(event.target.value)} />
      </label>
      <button type="button" className={styles.findButton} disabled={disabled}
        aria-haspopup="dialog" aria-controls={id + '-dialog'}
        onClick={event => open(event.currentTarget, launcherQuery)}>고객 찾기</button>
      <button type="button" className={styles.listButton} disabled={disabled}
        aria-haspopup="dialog" aria-controls={id + '-dialog'}
        onClick={event => open(event.currentTarget, '')}>고객 목록{selectedCustomerIds.length > 0 ? ' · ' + count(selectedCustomerIds.length) + '명' : ''}</button>
    </form>
    <dialog ref={dialog} id={id + '-dialog'} className={styles.dialog}
      aria-labelledby={id + '-title'} aria-modal="true" aria-describedby={id + '-scope'}
      onClose={() => { setOpened(false); releasePageScroll(); launchedFrom.current?.focus({ preventScroll: true }); }}
      onKeyDownCapture={event => {
        // Search inputs otherwise consume the first Escape to clear their value.
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right ||
            event.clientY < bounds.top || event.clientY > bounds.bottom) close();
      }}>
      <header className={styles.header}>
        <div><span>고객·통화 분석</span><h2 id={id + '-title'}>고객 찾기</h2></div>
        <button type="button" onClick={close} aria-label="고객 목록 닫기">닫기 <span aria-hidden="true">×</span></button>
      </header>
      <div className={styles.body}>
        <div className={styles.scope} id={id + '-scope'}>
          <strong>MDT · {baseScope.dateStart===baseScope.dateEnd?baseScope.dateStart:baseScope.dateStart+' ~ '+baseScope.dateEnd}</strong>
          <span>{baseScope.from} – {baseScope.to}</span>
          <p>고객 목록은 지도 상세 필터와 독립적으로 기간·시간만 적용합니다. 여러 고객을 선택한 뒤 적용하세요.</p>
        </div>
        <label className={styles.drawerSearch}>
          <span>서비스 고객번호 검색</span>
          <input ref={drawerInput} type="search" value={query} autoComplete="off"
            placeholder="원본 고객번호 전체 또는 일부" disabled={disabled}
            onChange={event => { setQuery(event.target.value); setPage(0); }} />
        </label>
        <fieldset className={styles.filters} aria-label="고객 불량 통화 조건">
          {filters.map(item => <button key={item.id} type="button" aria-pressed={filter === item.id}
            onClick={() => { setFilter(item.id); setPage(0); }}>{item.label}</button>)}
        </fieldset>
        <div className={styles.resultHeading}>
          <output aria-live="polite">{result?count(result.total)+'명':loading?'조회 중…':'고객 목록'}</output>
          <span>불량 통화 많은 순 · 25명씩</span>
        </div>
        <p className={styles.counterNote}>불량: 원본 유효 MOS(v5) 3 미만 · 위치: 좌표가 연결된 통화</p>
        <div className={styles.selectionTools}>
          <button type="button" disabled={loading||!rows.length}
            onClick={() => setDraftIds(ids => updateQualityCustomerSelection(ids, rows.map(row => row.customerId), !allPageSelected))}>
            {allPageSelected ? '현재 페이지 선택 해제' : '현재 페이지 전체 선택'}
          </button>
          <button type="button" aria-pressed={selectedOnly}
            onClick={() => { setSelectedOnly(value => !value); setPage(0); }}>선택 고객만</button>
        </div>
        {loading&&<output className={styles.empty}>전체 고객을 조회하는 중…</output>}
        {active?.error&&<div className={styles.empty} role="alert">{active.error}
          <button type="button" onClick={()=>setAttempt(value=>value+1)}>다시 시도</button>
        </div>}
        <ul className={styles.customerList} aria-label="기간 내 고객 목록">
          {rows.map((row, index) => <li key={row.customerId}>
            <label className={styles.customerRow} data-customer-id={row.customerId}
              data-selected={selectedSet.has(row.customerId)}>
              <input type="checkbox" checked={selectedSet.has(row.customerId)}
                aria-label={(row.sourceContractId ?? '고객번호 미제공 (목록 ' + ((result?.page??page) * 25 + index + 1) + ')') + ' 선택'}
                onChange={event => setDraftIds(ids => updateQualityCustomerSelection(ids, [row.customerId], event.target.checked))} />
              <span className={styles.rowContent}>
              <span className={styles.identity}><strong>{row.sourceContractId ?? '고객번호 미제공'}</strong>
                <span>{selectedSet.has(row.customerId) ? '선택됨' : '선택'}</span></span>
              <span className={styles.rowCounts}><span>통화 {count(row.totalCalls)}건</span>
                <span className={row.poorCalls ? styles.poor : undefined}>불량 {count(row.poorCalls)}건</span>
                <span>위치 {count(row.locatedCalls)}건</span></span>
              <small>최근 통화 {row.latestDate} {row.latestCall.start}</small>
              </span>
            </label>
          </li>)}
        </ul>
        {!loading&&!active?.error&&!result?.total && <p className={styles.empty}>조건에 맞는 고객이 없습니다.</p>}
      </div>
      <section className={styles.selection} aria-label="선택 고객 요약" aria-live="polite">
          <div className={styles.selectionHeading}>
            <h3>선택 고객 <strong>{count(draftIds.length)}명</strong></h3>
            <button type="button" disabled={!draftIds.length} onClick={() => setDraftIds([])}>전체 선택 해제</button>
          </div>
          {draftIds.length > 0 ? <>
            <dl>
              <div><dt>통화</dt><dd>{selection?count(selection.totalCalls)+'건':'조회 중…'}</dd></div>
              <div><dt>불량</dt><dd>{selection?count(selection.poorCalls)+'건':'조회 중…'}</dd></div>
              <div><dt>위치 연결</dt><dd>{selection?count(selection.locatedCalls)+'건':'조회 중…'}</dd></div>
              <div><dt>위치 미확인</dt><dd>{selection?count(selection.unlocatedCalls)+'건':'조회 중…'}</dd></div>
            </dl>
            {!!selection?.withoutCalls && <p>{count(selection?.withoutCalls??0)}명은 현재 기간·시간에 통화가 없습니다. 선택은 유지됩니다.</p>}
            {singleSelected && <DocumentLink href={singleSelected.href}>{singleSelected.sourceContractId ?? '선택 고객'} 통화 분석 열기 <span aria-hidden="true">↗</span></DocumentLink>}
          </> : <p>선택이 없으면 전체 고객을 조회합니다.</p>}
          <button type="button" className={styles.applyButton} disabled={disabled} onClick={apply}>
            {draftIds.length ? '선택 고객 ' + count(draftIds.length) + '명 적용' : '전체 고객 조회'}
          </button>
          <small>적용하면 지도·품질 지표·차트·통화 목록에 반영됩니다. 닫기는 선택 변경을 취소합니다.</small>
      </section>
      <footer className={styles.footer}>
        <button type="button" disabled={loading||!result||result.page === 0}
          onClick={() => setPage(Math.max(0,(result?.page??page)-1))}>이전</button>
        <span>{result?.pages ? result.page + 1 : 0} / {result?.pages??0} 페이지</span>
        <button type="button" disabled={loading||!result||result.page + 1 >= result.pages}
          onClick={() => setPage((result?.page??page)+1)}>다음</button>
      </footer>
    </dialog>
  </>;
}
