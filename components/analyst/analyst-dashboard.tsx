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
import {
  parseSelection,
  resolveSelection,
  selectionQuery,
  type AnalystSelection,
} from '../../lib/analyst/selection';
import type { AnalystSource, SourceCustomer } from '../../lib/analyst/types';
import { ContractPicker } from './contract-picker';
import { ContractWorkspace } from './contract-workspace';
import { QualityOverview, type OverviewFilters } from './quality-overview';
import styles from './analyst-shell.module.css';
const initialFilters: OverviewFilters = {
  from: '00:00',
  to: '23:59',
  hour: null,
  cellId: null,
  missingLocation: false,
  poorOnly: true,
  sort: 'poor',
  page: 0,
  scoreMetric: 'qoe',
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
  const resolved = dataset ? resolveSelection(selection, dataset) : selection;
  const revision = dataset?.meta.revision ?? 'inline';
  const entry = dataset?.days.find(
    (d) => d.customerId === resolved.customerId && d.date === resolved.date,
  );
  const detailKey =
    resolved.view === 'contract' && entry
      ? `detail-compact-v2/${resolved.source}/${revision}/${resolved.date}/${resolved.customerId}`
      : null;
  const detailLoader = useCallback(
    (signal: AbortSignal) => loadDay(dataset!, entry!, resolved.source, signal),
    [dataset, entry, resolved.source],
  );
  const detail = useResource(detailKey, detailLoader);
  const overviewKey =
    dataset && resolved.view === 'overview' && resolved.date
      ? `overview-analytics-v1/${resolved.source}/${revision}/${resolved.date}/overview`
      : null;
  const overviewLoader = useCallback(
    (signal: AbortSignal) =>
      loadOverview(dataset!, resolved.source, resolved.date, signal),
    [dataset, resolved.source, resolved.date],
  );
  const overview = useResource(overviewKey, overviewLoader);
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
  const canonical = urlFor(current, filters);
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
      `${window.location.pathname}${urlFor(next, nextFilters)}`,
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
  const customer = dataset?.customers.find((c) => c.id === resolved.customerId);
  const choose = (chosen: SourceCustomer) => {
    navigate({
      ...resolved,
      view: 'contract',
      customerId: chosen.id,
      date: chosen.dates.includes(resolved.date)
        ? resolved.date
        : (chosen.dates[0] ?? resolved.date),
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
      setMessage('검색 결과에서 조사할 계약을 선택하세요.');
    }
  };
  const threshold = dataset?.meta.poorQoeThreshold ?? 2.5;
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
            ? '서비스 계약번호'
            : '계약번호 / 고객'}{' '}
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
            placeholder="계약번호 입력"
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
          <button onClick={submit} aria-label="계약번호 찾기">
            찾기
          </button>
          {customer && getContractId(customer) && (
            <button
              className={styles.copyButton}
              aria-label="계약번호 복사"
              title="계약번호 복사"
              onClick={() =>
                navigator.clipboard.writeText(getContractId(customer)!).then(
                  () => setMessage('계약번호를 복사했습니다.'),
                  () => setMessage('계약번호를 선택해 복사하세요.'),
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
              aria-label="계약 검색 결과"
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
                    {c.displayName} · {c.sampleCount.toLocaleString()}개 관측
                  </span>
                </button>
              ))}
              {!results.length && <p>일치하는 계약이 없습니다.</p>}
            </div>
            <p>최대 40건 표시 · 결과를 선택해야 분석 대상이 바뀝니다.</p>
            <button onClick={() => setSearchOpen(false)}>검색 결과 닫기</button>
          </div>
        )}
      </div>
      <label className={styles.field}>
        일자
        <select
          aria-label="분석 일자"
          value={resolved.date}
          onChange={(e) =>
            navigate(
              {
                ...resolved,
                date: e.target.value,
                callId: null,
                sampleIndex: null,
              },
              { ...initialFilters },
            )
          }
        >
          {(dataset?.meta.dates ?? []).map((date) => (
            <option key={date}>{date}</option>
          ))}
        </select>
      </label>
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
          <option>실측</option>
        </select>
      </label>
    </div>
  );
  return (
    <div className={styles.shell}>
      <header className={styles.appbar}>
        <button
          className={styles.brand}
          onClick={() => navigate({ ...current, view: 'overview' })}
        >
          QoE 분석
        </button>
        <nav aria-label="분석 화면">
          <button
            className={resolved.view === 'overview' ? styles.active : ''}
            onClick={() => navigate({ ...current, view: 'overview' })}
          >
            품질 현황
          </button>
          <button
            className={resolved.view === 'contract' ? styles.active : ''}
            onClick={() => navigate({ ...current, view: 'contract' })}
          >
            계약·통화 분석
          </button>
        </nav>
        <span className={styles.headerSource}>{resolved.source} · Voice</span>
        <button
          className={styles.settingsButton}
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((v) => !v)}
        >
          분석 설정
        </button>
      </header>
      <div className={styles.content}>
        {resolved.view === 'overview' && (
          <div className={styles.pageHeading}>
            <h1>품질 현황</h1>
            <span>지역·시간·계약별 저품질을 조사합니다.</span>
          </div>
        )}
        {resolved.view === 'contract' && (
          <>
            <div className={styles.breadcrumb}>
              <button
                onClick={() => navigate({ ...current, view: 'overview' })}
              >
                품질 현황으로 돌아가기
              </button>
              <span>/ 계약 분석</span>
            </div>
            <div className={styles.pageHeading}>
              <h1>계약·통화 분석</h1>
              <span>계약별 통화와 관측 근거를 비교합니다.</span>
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
                    toolbar={toolbar}
                    threshold={threshold}
                    filters={filters}
                    onFiltersChange={setFilters}
                    onAnalyze={(call) =>
                      navigate({
                        ...resolved,
                        view: 'contract',
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
                  계약 목록에서 계약을 선택하거나 서비스 계약번호를 검색하세요.
                </div>
              ) : !entry ? (
                <div className={styles.state}>
                  선택한 계약의 해당 일자 자료가 없습니다. 다른 일자를
                  선택하세요.
                </div>
              ) : detail.loading ? (
                <div className={styles.state} role="status">
                  선택한 계약의 통화 자료를 불러오는 중입니다…
                </div>
              ) : detail.error ? (
                <div className={styles.state} role="alert">
                  {detail.error}
                  <button onClick={detail.retry}>다시 시도</button>
                </div>
              ) : day ? (
                <ContractWorkspace
                  day={day}
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
