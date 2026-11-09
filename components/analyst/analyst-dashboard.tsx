'use client';
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- The custom combobox uses an ARIA listbox to retain contract metadata and keyboard-accessible result buttons. */
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  loadDataset,
  loadDay,
  loadOverview,
} from '../../lib/analyst/data-loader';
import { getContractId } from '../../lib/analyst/data';
import { indexDataset } from '../../lib/analyst/dataset-index';
import {
  parseSelection,
  resolveSelection,
  selectionQuery,
  type AnalystSelection,
} from '../../lib/analyst/selection';
import type { AnalystSource, SourceCustomer } from '../../lib/analyst/types';
import { ContractPicker } from './contract-picker';
import { ContractWorkspace } from './contract-workspace';
import { adjustDateRange, combineDateOverviews, datesInRange, dateOfCall } from '../../lib/analyst/date-range';
import { overlayThreeSiteRough, type ThreeSiteRoughDataset } from '../../lib/analyst/three-site-rough';
import { QualityOverview, type OverviewFilters } from './quality-overview';
import styles from './analyst-shell.module.css';
import { QualityTopNav } from './quality-top-nav';
import { buildImprovementHref, withComparisonRevision } from '../../lib/analyst/improvement-navigation';
const initialFilters: OverviewFilters = {
  from: '00:00',
  to: '23:59',
  hour: null,
  cellId: null,
  missingLocation: false,
  poorOnly: true,
  sort: 'poor',
  page: 0,
  scoreMetric: 'mos',
  scoreBand: null,
  experienceGroup: null,
};
function readFilters(search: string): OverviewFilters {
  const p = new URLSearchParams(search);
  const h = Number(p.get('hour'));
  const page = Number(p.get('page'));
  return {
    from: /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(p.get('from') ?? '')
      ? p.get('from')!
      : '00:00',
    to: /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(p.get('to') ?? '')
      ? p.get('to')!
      : '23:59',
    hour: p.has('hour') && Number.isInteger(h) && h >= 0 && h <= 23 ? h : null,
    cellId: p.get('cell'),
    missingLocation: p.get('missing') === '1',
    poorOnly: p.get('poor') !== '0',
    sort: p.get('sort') === 'time' ? 'time' : 'poor',
    page: Number.isSafeInteger(page) ? Math.max(0, page) : 0,
    scoreMetric: p.get('metric') === 'mos' ? 'mos' : 'qoe',
    scoreBand:
      p.get('band') === 'good' ||
      p.get('band') === 'poor' ||
      p.get('band') === 'fair'
        ? (p.get('band') as OverviewFilters['scoreBand'])
        : null,
    experienceGroup: ['affected', 'repeat', 'consecutive'].includes(
      p.get('experience') ?? '',
    )
      ? (p.get('experience') as OverviewFilters['experienceGroup'])
      : null,
  };
}
function urlFor(selection: AnalystSelection, filters: OverviewFilters) {
  const p = new URLSearchParams(selectionQuery(selection));
  p.set('from', filters.from);
  p.set('to', filters.to);
  if (filters.hour !== null) p.set('hour', String(filters.hour));
  if (filters.cellId) p.set('cell', filters.cellId);
  if (filters.missingLocation) p.set('missing', '1');
  p.set('poor', filters.poorOnly ? '1' : '0');
  p.set('sort', filters.sort);
  p.set('page', String(filters.page));
  if (filters.scoreMetric === 'mos') p.set('metric', 'mos');
  if (filters.scoreBand) p.set('band', filters.scoreBand);
  if (filters.experienceGroup) p.set('experience', filters.experienceGroup);
  return `?${p}`;
}
interface Resource<T> {
  key: string;
  data?: T;
  error?: string;
}
function useResource<T>(
  key: string | null,
  loader: (signal: AbortSignal) => Promise<T>,
) {
  const cache = useRef(new Map<string, T>()),
    [result, setResult] = useState<Resource<T> | null>(null),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    let current = true;
    const cached = cache.current.get(key);
    if (cached) {
      cache.current.delete(key);
      cache.current.set(key,cached);
      queueMicrotask(() => {
        if (current) setResult({ key, data: cached });
      });
      return () => {
        current = false;
        controller.abort();
      };
    }
    loader(controller.signal).then(
      (data) => {
        if (current && !controller.signal.aborted) {
          cache.current.set(key, data);
          // A period summary can retain all calls. Keep only the two most
          // recently used results per resource instead of every date combination.
          while(cache.current.size>2)cache.current.delete(cache.current.keys().next().value!);
          setResult({ key, data });
        }
      },
      (error) => {
        if (current && !controller.signal.aborted)
          setResult({
            key,
            error:
              error instanceof Error
                ? error.message
                : '자료를 불러오지 못했습니다.',
          });
      },
    );
    return () => {
      current = false;
      controller.abort();
    };
  }, [key, loader, attempt]);
  const active = result?.key === key ? result : null;
  return {
    data: active?.data,
    error: active?.error,
    loading: Boolean(key && !active?.data && !active?.error),
    retry: () => {
      if (key) cache.current.delete(key);
      setResult(null);
      setAttempt((n) => n + 1);
    },
  };
}
export function AnalystDashboard() {
  const [compareRevision,setCompareRevision]=useState('');
  const [compareMode,setCompareMode]=useState('');
  const [selection, setSelection] = useState(() => parseSelection('')),
    [filters, setFilters] = useState(initialFilters),
    [ready, setReady] = useState(false),
    [query, setQuery] = useState(''),
    [searchOpen, setSearchOpen] = useState(false),
    [highlight, setHighlight] = useState(-1),
    [message, setMessage] = useState(''),
    [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    const read = () => {
      setCompareRevision(new URLSearchParams(window.location.search).get('compareRevision')??'');
      setCompareMode(new URLSearchParams(window.location.search).get('mode')??'');
      setSelection(parseSelection(window.location.search));
      setFilters(readFilters(window.location.search));
      setReady(true);
    };
    queueMicrotask(read);
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);
  const manifestLoader = useCallback(
    (signal: AbortSignal) => loadDataset(selection.source, signal),
    [selection.source],
  );
  const manifest = useResource(
      ready ? `manifest/${selection.source}` : null,
      manifestLoader,
    ),
    dataset = manifest.data;
  const datasetIndex=useMemo(()=>dataset?indexDataset(dataset):null,[dataset]);
  const resolved = useMemo(()=>dataset?resolveSelection(selection,dataset):selection,[dataset,selection]);
  const revision = dataset?.meta.revision ?? 'inline';
  const entry = datasetIndex?.daysByCustomer.get(resolved.customerId)?.get(resolved.date);
  const detailKey =
    resolved.view === 'contract' && entry
      ? `detail-compact-v2/${resolved.source}/${revision}/${resolved.date}/${resolved.customerId}`
      : null;
  const detailLoader = useCallback(
    (signal: AbortSignal) => loadDay(dataset!, entry!, resolved.source, signal),
    [dataset, entry, resolved.source],
  );
  const detail = useResource(detailKey, detailLoader);
  const rangeStart=resolved.dateStart??resolved.date;
  const rangeEnd=resolved.dateEnd??resolved.date;
  const selectedDates=useMemo(()=>datesInRange(dataset?.meta.dates??[],rangeStart,rangeEnd),[dataset,rangeStart,rangeEnd]);
  const overviewDates=useMemo(()=>resolved.view==='overview'?selectedDates:[resolved.date],[resolved.view,selectedDates,resolved.date]);
  const dateKey=overviewDates.join('|');
  const overviewKey =
    dataset && (resolved.view === 'overview' || (resolved.view === 'contract' && resolved.source === 'MDT')) && resolved.date
      ? `overview-analytics-v1/${resolved.source}/${revision}/${dateKey}/overview`
      : null;
  const overviewLoader = useCallback(
    async (signal: AbortSignal) => combineDateOverviews(await Promise.all(
      overviewDates.map(date=>loadOverview(dataset!,resolved.source,date,signal)),
    )),
    [dataset,resolved.source,overviewDates],
  );
  const overview = useResource(overviewKey, overviewLoader);
  const roughKey=dataset && resolved.view==='contract' && resolved.source==='MDT' && resolved.date
    ? 'three-site-rough-v1/'+revision+'/'+resolved.date : null;
  const roughLoader=useCallback(async (signal:AbortSignal):Promise<ThreeSiteRoughDataset>=>{
    const response=await fetch('/qoe/three-site-rough/'+resolved.date+'.json',{signal,cache:'no-cache'});
    if(!response.ok)throw new Error('삼각 측량 조사 권역 데이터를 불러오지 못했습니다.');
    const value=await response.json() as ThreeSiteRoughDataset;
    if(value.sourceRevision!==revision || value.date!==resolved.date ||
       value.schemaVersion!=='coarse-three-site-v1')
      throw new Error('삼각 측량 조사 권역 데이터 버전이 일치하지 않습니다.');
    return value;
  },[revision,resolved.date]);
  const rough=useResource(roughKey,roughLoader);
  const periodKey=dataset&&resolved.view==='contract'&&resolved.customerId&&selectedDates.length>1
    ? 'contract-period-v1/'+resolved.source+'/'+revision+'/'+resolved.customerId+'/'+selectedDates.join('|')
    : null;
  const periodLoader=useCallback(async (signal:AbortSignal)=>{
    const entries=selectedDates.flatMap(date=>{
      const found=datasetIndex?.daysByCustomer.get(resolved.customerId)?.get(date);
      return found?[found]:[];
    });
    return Promise.all(entries.map(entry=>loadDay(dataset!,entry,resolved.source,signal)));
  },[dataset,datasetIndex,resolved.customerId,resolved.source,selectedDates]);
  const period=useResource(periodKey,periodLoader);
  const roughOverview=useMemo(
    ()=>overview.data?overlayThreeSiteRough(overview.data,rough.data??null,true):null,
    [overview.data,rough.data],
  );
  const day = detail.data;
  const activeCall =
    day?.calls.find((c) => c.id === resolved.callId) ?? day?.calls[0] ?? null;
  const activeSample =
    day && activeCall
      ? (day.samples.find(
          (s) =>
            s.index === resolved.sampleIndex &&
            s.callId === activeCall.id &&
            s.inCallWindow,
        ) ??
        day.samples.find((s) => s.callId === activeCall.id && s.inCallWindow) ??
        null)
      : null;
  const current = {
    ...resolved,
    ...(resolved.view === 'contract' && day
      ? {
          callId: activeCall?.id ?? null,
          sampleIndex: activeSample?.index ?? null,
        }
      : {}),
  };
  const canonical = withComparisonRevision(urlFor(current, filters),compareRevision,compareMode);
  useEffect(() => {
    if (ready && dataset)
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${canonical}`,
      );
  }, [ready, dataset, canonical]);
  const navigate = (next: AnalystSelection, nextFilters = filters) => {
    setSelection(next);
    setFilters(nextFilters);
    window.history.pushState(
      null,
      '',
      `${window.location.pathname}${withComparisonRevision(urlFor(next, nextFilters),compareRevision,compareMode)}`,
    );
  };
  const deferred = useDeferredValue(query.trim().toLowerCase());
  const results = useMemo(() => {
    if (!dataset || !deferred) return [];
    return dataset.customers
      .filter((c) =>
        [getContractId(c), c.displayName, c.maskedPhone].some((v) =>
          v?.toLowerCase().includes(deferred),
        ),
      )
      .sort(
        (a, b) =>
          Number(getContractId(b)?.toLowerCase() === deferred) -
          Number(getContractId(a)?.toLowerCase() === deferred),
      )
      .slice(0, 40);
  }, [dataset, deferred]);
  const customer = datasetIndex?.customersById.get(resolved.customerId);
  const choose = (chosen: SourceCustomer) => {
    const inside=selectedDates.filter(date=>chosen.dates.includes(date));
    const chosenDate=inside.includes(resolved.date)?resolved.date:inside[0]??chosen.dates[0]??resolved.date;
    // A customer outside the selected interval starts a new one-day interval;
    // never show an out-of-range call while claiming the previous date range.
    navigate({
      ...resolved,
      view: 'contract',
      customerId: chosen.id,
      date:chosenDate,
      dateStart:inside.length?rangeStart:chosenDate,
      dateEnd:inside.length?rangeEnd:chosenDate,
      callId: null,
      sampleIndex: null,
    });
    setQuery(getContractId(chosen) ?? chosen.displayName);
    setSearchOpen(false);
    setMessage('');
  };
  const submit = () => {
    if (!searchOpen && customer) {
      choose(customer);
      return;
    }
    const exact = results.find(
      (c) => getContractId(c)?.toLowerCase() === query.trim().toLowerCase(),
    );
    if (exact) choose(exact);
    else if (results.length === 1) choose(results[0]);
    else {
      setSearchOpen(true);
      setMessage('검색 결과에서 조사할 고객을 선택하세요.');
    }
  };
  const threshold = dataset?.meta.poorQoeThreshold ?? 3.0;
  const toolbar = (
    <div className={styles.toolbar}>
      {dataset && (
        <ContractPicker
          dataset={dataset}
          source={resolved.source}
          date={resolved.date}
          selectedId={resolved.customerId}
          onSelect={choose}
        />
      )}
      <div className={styles.search}>
        <label htmlFor="contract-search">
          {resolved.source === 'MDT'
            ? '서비스 고객번호'
            : '고객번호 / 고객'}{' '}
        </label>
        <div className={styles.searchLine}>
          <input
            id="contract-search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={searchOpen && results.length > 0}
            aria-controls="contract-results"
            aria-activedescendant={
              searchOpen && results[highlight]
                ? `contract-result-${highlight}`
                : undefined
            }
            value={
              searchOpen
                ? query
                : customer
                  ? (getContractId(customer) ?? customer.displayName)
                  : query
            }
            placeholder="고객번호 입력"
            onFocus={() => {
              if (!searchOpen && customer)
                setQuery(getContractId(customer) ?? customer.displayName);
              setSearchOpen(true);
            }}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(-1);
              setSearchOpen(true);
              setMessage('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSearchOpen(true);
                setHighlight((i) => Math.min(results.length - 1, i + 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlight((i) => Math.max(0, i - 1));
              }
              if (e.key === 'Escape') setSearchOpen(false);
              if (e.key === 'Enter') {
                e.preventDefault();
                if (searchOpen && results[highlight])
                  choose(results[highlight]);
                else submit();
              }
            }}
          />
          <button onClick={submit} aria-label="고객번호 찾기">
            찾기
          </button>
          {customer && getContractId(customer) && (
            <button
              className={styles.copyButton}
              aria-label="고객번호 복사"
              title="고객번호 복사"
              onClick={() =>
                navigator.clipboard.writeText(getContractId(customer)!).then(
                  () => setMessage('고객번호를 복사했습니다.'),
                  () => setMessage('고객번호를 선택해 복사하세요.'),
                )
              }
            >
              ⧉
            </button>
          )}
        </div>
        {searchOpen && deferred && (
          <div className={styles.results}>
            <div
              id="contract-results"
              role="listbox"
              aria-label="고객 검색 결과"
            >
              {results.map((c, i) => (
                <button
                  key={c.id}
                  id={`contract-result-${i}`}
                  role="option"
                  aria-selected={i === highlight}
                  onFocus={() => setHighlight(i)}
                  onClick={() => choose(c)}
                >
                  <strong>{getContractId(c) ?? c.displayName}</strong>
                  <span>
                    {c.displayName.replace(/^계약\s+/, '고객 ')} · {c.sampleCount.toLocaleString()}개 관측
                  </span>
                </button>
              ))}
              {!results.length && <p>일치하는 고객이 없습니다.</p>}
            </div>
            <p>최대 40건 표시 · 결과를 선택해야 분석 대상이 바뀝니다.</p>
            <button onClick={() => setSearchOpen(false)}>검색 결과 닫기</button>
          </div>
        )}
      </div>
      <label className={styles.field}>
        시작일
        <select aria-label="분석 시작일" value={rangeStart} onChange={e=>{
          const next=adjustDateRange(dataset?.meta.dates??[],rangeStart,rangeEnd,'start',e.target.value);
          const active=datesInRange(dataset?.meta.dates??[],next.start,next.end);
          const customerDates=customer?.dates??[];
          const nextDate=active.includes(resolved.date)&&(!customer||customerDates.includes(resolved.date))
            ? resolved.date:(active.find(date=>!customer||customerDates.includes(date))??next.end);
          navigate({...resolved,date:nextDate,dateStart:next.start,dateEnd:next.end,
            callId:null,sampleIndex:null}, {...initialFilters});
        }}>
          {(dataset?.meta.dates??[]).map(date=><option key={date} value={date}>{date}</option>)}
        </select>
      </label>
      <label className={styles.field}>
        종료일
        <select aria-label="분석 종료일" value={rangeEnd} onChange={e=>{
          const next=adjustDateRange(dataset?.meta.dates??[],rangeStart,rangeEnd,'end',e.target.value);
          const active=datesInRange(dataset?.meta.dates??[],next.start,next.end);
          const customerDates=customer?.dates??[];
          const nextDate=active.includes(resolved.date)&&(!customer||customerDates.includes(resolved.date))
            ? resolved.date:(active.find(date=>!customer||customerDates.includes(date))??next.end);
          navigate({...resolved,date:nextDate,dateStart:next.start,dateEnd:next.end,
            callId:null,sampleIndex:null}, {...initialFilters});
        }}>
          {(dataset?.meta.dates??[]).map(date=><option key={date} value={date}>{date}</option>)}
        </select>
      </label>
      <button type="button" aria-label="전체 분석기간 조회"
        disabled={!dataset?.meta.dates.length}
        aria-pressed={selectedDates.length>0&&selectedDates.length===dataset?.meta.dates.length}
        onClick={()=>{
          const dates=[...new Set(dataset?.meta.dates??[])].sort();
          if(!dates.length)return;
          const nextDate=dates.includes(resolved.date)&&(!customer||customer.dates.includes(resolved.date))
            ?resolved.date:dates.find(date=>!customer||customer.dates.includes(date))??dates.at(-1)!;
          navigate({...resolved,date:nextDate,dateStart:dates[0],dateEnd:dates.at(-1),
            callId:null,sampleIndex:null},{...initialFilters});
        }}>전체 기간</button>
      <span className={styles.rangeHint}>{selectedDates.length}일 선택</span>
      <label className={styles.field}>
        데이터 출처
        <select
          aria-label="데이터 출처"
          value={resolved.source}
          onChange={(e) => {
            navigate(
              {
                ...parseSelection(''),
                source: e.target.value as AnalystSource,
              },
              { ...initialFilters },
            );
            setQuery('');
            setSearchOpen(false);
          }}
        >
          <option>MDT</option>
          {dataset?.meta.qoeBasis !== 'rtcp-mos-v5' && <option>실측</option>}
        </select>
      </label>
    </div>
  );
  return (
    <div className={styles.shell}>
      <QualityTopNav
        active={resolved.view === 'overview' ? 'legacy' : 'contract'}
        date={resolved.date}
        sourceLabel={resolved.source+' · Voice'}
        improvementHref={buildImprovementHref(resolved,{
          ...filters,scoreMetric:dataset?.meta.qoeBasis==='rtcp-mos-v5'?'mos':filters.scoreMetric,
        },compareRevision||revision,compareMode)}
        onLegacy={() => navigate({ ...current, view: 'overview' })}
        onContract={() => navigate({ ...current, view: 'contract' })}
        actions={<button className={styles.settingsButton} aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen(v => !v)}>분석 설정</button>}
      />
      <div className={styles.content}>
        {compareRevision&&dataset&&compareRevision!==revision&&<p role="alert">비교할 원본 버전이 다릅니다. 같은 조건의 비교로 볼 수 없습니다.</p>}
        {resolved.view === 'overview' && (
          <div className={styles.pageHeading}>
            <h1>기존안 · 품질 현황</h1>
            <span>지역·시간·고객별 저품질을 조사합니다.</span>
          </div>
        )}
        {resolved.view === 'contract' && (
          <>
            <div className={styles.breadcrumb}>
              <button
                onClick={() => navigate({ ...current, view: 'overview' })}
              >
                기존안으로 돌아가기
              </button>
              <span>/ 고객 분석</span>
            </div>
            <div className={styles.pageHeading}>
              <h1>고객·통화 분석</h1>
              <span>고객별 통화와 관측 근거를 비교합니다.</span>
            </div>
          </>
        )}
        {!(
          (resolved.view === 'contract' &&
            day &&
            !detail.loading &&
            !detail.error) ||
          (resolved.view === 'overview' &&
            overview.data &&
            !overview.loading &&
            !overview.error)
        ) && toolbar}
        <p className={styles.message} role="status">
          {message}
        </p>
        {settingsOpen && resolved.view === 'overview' && (
          <div className={styles.notice}>
            전체 요약은 선택한 일자·출처·시각 범위 기준입니다. 지도와 구역
            순위는 동일한 60m 격자를 사용하며, 여러 격자에 걸친 통화는 구역별
            중복 포함됩니다. 저품질 비율은 저품질 통화 / 평가 가능 통화입니다.
          </div>
        )}
        {!ready || manifest.loading ? (
          <div className={styles.state} role="status">
            데이터 목록을 불러오는 중입니다…
          </div>
        ) : manifest.error ? (
          <div className={styles.state} role="alert">
            {manifest.error}
            <button onClick={manifest.retry}>다시 시도</button>
          </div>
        ) : (
          dataset && (
            <>
              {resolved.view === 'overview' ? (
                overview.loading ? (
                  <div className={styles.state} role="status">
                    일자별 품질 현황을 불러오는 중입니다…
                  </div>
                ) : overview.error ? (
                  <div className={styles.state} role="alert">
                    {overview.error}
                    <button onClick={overview.retry}>다시 시도</button>
                  </div>
                ) : overview.data ? (
                  <QualityOverview
                    overview={overview.data}
                    mosOnly={dataset.meta.qoeBasis === 'rtcp-mos-v5'}
                    toolbar={toolbar}
                    threshold={threshold}
                    filters={filters}
                    onFiltersChange={setFilters}
                    onAnalyze={(call) =>
                      navigate({
                        ...resolved,
                        view: 'contract',
                        date:dateOfCall(call,resolved.date),
                        customerId: call.customerId,
                        callId:
                          call.rawCallId ??
                          call.id.slice(call.customerId.length + 1),
                        sampleIndex: null,
                      })
                    }
                  />
                ) : (
                  <div className={styles.state}>분석할 일자가 없습니다.</div>
                )
              ) : !resolved.customerId ? (
                <div className={styles.state}>
                  고객 목록에서 고객을 선택하거나 서비스 고객번호를 검색하세요.
                </div>
              ) : !entry ? (
                <div className={styles.state}>
                  선택한 고객의 해당 일자 자료가 없습니다. 다른 일자를
                  선택하세요.
                </div>
              ) : detail.loading ? (
                <div className={styles.state} role="status">
                  선택한 고객의 통화 자료를 불러오는 중입니다…
                </div>
              ) : detail.error ? (
                <div className={styles.state} role="alert">
                  {detail.error}
                  <button onClick={detail.retry}>다시 시도</button>
                </div>
              ) : day ? (
                <ContractWorkspace
                  day={day}
                  byeLocation={overview.data?.callLocations?.find(point=>point.callId===day.customerId+':'+(activeCall?.id??''))}
                  roughLocation={roughOverview?.callLocations?.find(point=>point.callId===day.customerId+':'+(activeCall?.id??'')&&point.positionQuality==='three-site-rough')}
                  periodDays={period.data}
                  periodRange={selectedDates.length>1?{start:rangeStart,end:rangeEnd}:undefined}
                  onSelectPeriodDate={date=>navigate({...resolved,date,callId:null,sampleIndex:null})}
                  toolbar={toolbar}
                  callId={activeCall?.id ?? null}
                  sampleIndex={activeSample?.index ?? null}
                  threshold={threshold}
                  settingsOpen={settingsOpen}
                  onSelectCall={(id) =>
                    navigate({ ...resolved, callId: id, sampleIndex: null })
                  }
                  onSelectSample={(index) =>
                    setSelection({
                      ...resolved,
                      callId: activeCall?.id ?? null,
                      sampleIndex: index,
                    })
                  }
                />
              ) : null}
            </>
          )
        )}
      </div>
    </div>
  );
}
