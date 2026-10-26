'use client';

import { useMemo, useRef, useState } from 'react';
import type { AnalystOverview, OverviewCall } from '../../lib/analyst/types';
import {
  filterOverviewCalls,
  getOverviewCells,
  getOverviewSummary,
  getHourlyCalls,
} from '../../lib/analyst/overview';
import {
  timeToSecond,
  locationLabels,
  isPoorCall,
} from '../../lib/analyst/data';
import { AnalystMap } from './analyst-map';
import { getAreaLabels, getHourlyDisplay } from '../../lib/analyst/overview-ui';
import { getOverviewRateLegend } from '../../lib/analyst/map';
import styles from './quality-overview.module.css';

export interface OverviewFilters {
  from: string;
  to: string;
  hour: number | null;
  cellId: string | null;
  missingLocation: boolean;
  poorOnly: boolean;
  sort: 'poor' | 'time';
  page: number;
}
interface Props {
  overview: AnalystOverview;
  threshold: number;
  onAnalyze: (call: OverviewCall) => void;
  filters: OverviewFilters;
  onFiltersChange: (next: OverviewFilters) => void;
}
const count = (value: number) => value.toLocaleString('ko-KR');
const rate = (value: number | null) =>
  value === null ? '평가 불가' : `${value.toFixed(1)}%`;
function duration(call: OverviewCall) {
  let seconds = timeToSecond(call.end) - call.startSecond;
  if (seconds < 0) seconds += 86400;
  return `${Math.floor(seconds / 60)}분 ${String(seconds % 60).padStart(2, '0')}초`;
}

export function QualityOverview({
  overview,
  threshold,
  onAnalyze,
  filters,
  onFiltersChange,
}: Props) {
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map');
  const [hourMode, setHourMode] = useState<'count' | 'rate'>('count');
  const [focusTarget, setFocusTarget] = useState<{
    key: string;
    lat: number;
    lon: number;
  }>();
  const focusSequence = useRef(0);
  const labels = useMemo(() => getAreaLabels(overview.cells), [overview.cells]);
  const [pageSize, setPageSize] = useState(25);
  const [rankSort, setRankSort] = useState<'poor' | 'rate' | 'customers'>(
    'poor',
  );
  const change = (next: Partial<OverviewFilters>) =>
    onFiltersChange({ ...filters, ...next, page: next.page ?? 0 });
  const base = useMemo(
    () => ({
      fromSecond: timeToSecond(`${filters.from}:00`),
      toSecond: timeToSecond(`${filters.to}:00`) + 59,
      threshold,
    }),
    [filters.from, filters.to, threshold],
  );
  const globalCalls = useMemo(
    () => filterOverviewCalls(overview, base),
    [overview, base],
  );
  const summary = useMemo(
    () => getOverviewSummary(globalCalls, threshold),
    [globalCalls, threshold],
  );
  const investigation = useMemo(
    () =>
      filterOverviewCalls(overview, {
        ...base,
        hour: filters.hour ?? undefined,
      }),
    [overview, base, filters.hour],
  );
  const cells = useMemo(
    () =>
      getOverviewCells(overview, investigation, threshold).map((cell) => ({
        ...cell,
        label: labels.get(cell.id) || cell.id,
      })),
    [overview, investigation, threshold, labels],
  );
  const ranked = useMemo(
    () =>
      [...cells].sort(
        (a, b) =>
          (rankSort === 'rate'
            ? (b.poorRate ?? -1) - (a.poorRate ?? -1)
            : rankSort === 'customers'
              ? b.affectedCustomers - a.affectedCustomers
              : b.poor - a.poor) || a.id.localeCompare(b.id),
      ),
    [cells, rankSort],
  );
  const hourly = useMemo(
    () => getHourlyCalls(globalCalls, threshold),
    [globalCalls, threshold],
  );
  const maximum =
    hourMode === 'rate' ? 100 : Math.max(1, ...hourly.map((bin) => bin.poor));
  const selected = cells.find((cell) => cell.id === filters.cellId);
  const areaCalls = useMemo(
    () =>
      filterOverviewCalls(overview, {
        ...base,
        hour: filters.hour ?? undefined,
        cellId: filters.cellId ?? undefined,
        location: filters.missingLocation ? 'missing' : 'all',
      }),
    [overview, base, filters.hour, filters.cellId, filters.missingLocation],
  );
  const area = getOverviewSummary(areaCalls, threshold);
  const rows = useMemo(
    () =>
      areaCalls
        .filter((call) =>
          filters.poorOnly || filters.missingLocation
            ? isPoorCall(call.qoe, threshold)
            : call.qoe !== null && Number.isFinite(call.qoe),
        )
        .sort((a, b) =>
          filters.sort === 'time'
            ? a.startSecond - b.startSecond || a.id.localeCompare(b.id)
            : (a.qoe ?? Infinity) - (b.qoe ?? Infinity) ||
              a.startSecond - b.startSecond,
        ),
    [
      areaCalls,
      filters.poorOnly,
      filters.missingLocation,
      filters.sort,
      threshold,
    ],
  );
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(Math.max(0, filters.page), pages - 1);
  const visible = rows.slice(page * pageSize, (page + 1) * pageSize);
  return (
    <div
      className={`${styles.overview} ${viewMode === 'list' ? styles.listMode : ''}`}
    >
      <div className={styles.scope}>
        <span>
          <strong>전체 분석 범위</strong> · {overview.date} · {overview.source}
        </span>
        <label>
          시작{' '}
          <input
            aria-label="전체 분석 시작 시각"
            type="time"
            value={filters.from}
            onChange={(e) =>
              change({
                from: e.target.value || '00:00',
                hour: null,
                cellId: null,
                missingLocation: false,
              })
            }
          />
        </label>
        <span>—</span>
        <label>
          종료{' '}
          <input
            aria-label="전체 분석 종료 시각"
            type="time"
            value={filters.to}
            onChange={(e) =>
              change({
                to: e.target.value || '23:59',
                hour: null,
                cellId: null,
                missingLocation: false,
              })
            }
          />
        </label>
        <span className={styles.muted}>저품질 기준 QoE &lt; {threshold}</span>
      </div>
      {filters.from > filters.to && (
        <p className={styles.notice}>
          시작 시각이 종료 시각보다 늦습니다. 시간 범위를 확인하세요.
        </p>
      )}
      <section aria-label="전체 분석 요약" className={styles.summary}>
        <div>
          분석 계약 <strong>{count(summary.customers)}</strong>
        </div>
        <div>
          평가 가능 통화 <strong>{count(summary.evaluated)}</strong>
          <span> / {count(summary.total)}</span>
        </div>
        <div>
          저품질 통화{' '}
          <strong className={styles.poor}>{count(summary.poor)}</strong>
          <span>
            {' '}
            / {count(summary.evaluated)} ·{' '}
            <b className={styles.poor}>{rate(summary.poorRate)}</b>
          </span>
        </div>
        <div>
          영향 계약 <strong>{count(summary.affectedCustomers)}</strong>
        </div>
        <div className={styles.summaryNote}>
          전체 분석 범위 기준 · 평가 불가 {count(summary.unscored)}통화
          <button
            className={styles.link}
            onClick={() =>
              change({ missingLocation: true, cellId: null, poorOnly: true })
            }
          >
            위치 없는 저품질 {count(summary.unlocatedPoor)}통화 보기
          </button>
        </div>
      </section>
      <section aria-label="현재 조사 조건" className={styles.investigation}>
        <strong>현재 조사</strong>
        {filters.hour !== null ? (
          <button
            className={styles.badge}
            onClick={() => change({ hour: null })}
          >
            {String(filters.hour).padStart(2, '0')}시 해제 ×
          </button>
        ) : (
          <span>전체 시간</span>
        )}
        {filters.cellId ? (
          <button
            className={styles.badge}
            onClick={() => change({ cellId: null })}
          >
            {labels.get(filters.cellId) || filters.cellId} 해제 ×
          </button>
        ) : (
          <span>전체 구역</span>
        )}
        {filters.missingLocation && (
          <button
            className={styles.badge}
            onClick={() => change({ missingLocation: false })}
          >
            위치 없음 해제 ×
          </button>
        )}
        <span>
          조사 {count(area.total)}통화 · 평가 {count(area.evaluated)} · 목록{' '}
          {count(rows.length)}건
        </span>
        <button
          onClick={() =>
            change({
              hour: null,
              cellId: null,
              missingLocation: false,
              poorOnly: true,
            })
          }
        >
          조사 조건 전체 해제
        </button>
        <span>전체 요약·시간 분포의 분모 유지</span>
      </section>
      <div className={styles.viewTools} aria-label="작업 공간 보기">
        <button
          aria-pressed={viewMode === 'map'}
          onClick={() => setViewMode('map')}
        >
          지도 중심
        </button>
        <button
          aria-pressed={viewMode === 'list'}
          onClick={() => setViewMode('list')}
        >
          목록 확장
        </button>
        <span>
          현재 페이지 {count(visible.length)}행 · 보기 전환은 조사 조건을
          유지합니다.
        </span>
      </div>
      <div className={styles.spatial}>
        <section className={styles.panel} aria-label="지역별 품질 지도">
          <div className={styles.panelHead}>
            <h2>지역별 품질</h2>
            <span>
              60m 격자 · 위치 확보 저품질{' '}
              {count(getOverviewSummary(investigation, threshold).locatedPoor)}
              통화
            </span>
          </div>
          <div className={styles.map}>
            <AnalystMap
              cells={cells}
              focusTarget={
                focusTarget?.key.startsWith(
                  `${overview.source}-${overview.date}:`,
                )
                  ? focusTarget
                  : undefined
              }
              selectedCellId={filters.cellId}
              onCellSelect={(id: string) =>
                change({ cellId: id, missingLocation: false })
              }
              focusKey={`${overview.source}-${overview.date}`}
              source={overview.source}
            />
          </div>
          <div className={styles.legend}>
            <span>
              원 크기: 저품질 통화 수 · 작음 ● → <b>●</b> 많음
            </span>
            <span>색상: 저품질 비율</span>
            {getOverviewRateLegend().map((item) => (
              <span key={item.label}>
                <i style={{ background: item.color }} />
                {item.label}
              </span>
            ))}
          </div>
        </section>
        <section className={styles.panel} aria-label="조사할 구역 순위">
          <div className={styles.panelHead}>
            <h2>조사할 구역</h2>
            <select
              aria-label="구역 순위 정렬"
              value={rankSort}
              onChange={(e) => setRankSort(e.target.value as typeof rankSort)}
            >
              <option value="poor">저품질 통화 순</option>
              <option value="rate">저품질 비율 순</option>
              <option value="customers">영향 계약 순</option>
            </select>
          </div>
          <div className={styles.rankScroll}>
            <table className={styles.rankTable}>
              <thead>
                <tr>
                  <th>구역</th>
                  <th>저품질 / 평가</th>
                  <th>비율</th>
                  <th>영향 계약</th>
                </tr>
              </thead>
              <tbody>
                {ranked.slice(0, 100).map((cell) => (
                  <tr
                    key={cell.id}
                    className={
                      cell.id === filters.cellId ? styles.selected : ''
                    }
                  >
                    <td>
                      <button
                        className={styles.cellButton}
                        aria-pressed={cell.id === filters.cellId}
                        title={`${cell.id} · 중심 ${cell.lat.toFixed(6)}, ${cell.lon.toFixed(6)}`}
                        onClick={() => {
                          change({ cellId: cell.id, missingLocation: false });
                          setFocusTarget({
                            key: `${overview.source}-${overview.date}:${++focusSequence.current}`,
                            lat: cell.lat,
                            lon: cell.lon,
                          });
                        }}
                      >
                        {cell.label || cell.id}
                      </button>
                    </td>
                    <td>
                      <b className={styles.poor}>{count(cell.poor)}</b> /{' '}
                      {count(cell.evaluated)}
                    </td>
                    <td>{rate(cell.poorRate)}</td>
                    <td>{count(cell.affectedCustomers)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!cells.length && (
              <p className={styles.empty}>
                이 조사 범위에 위치가 있는 통화가 없습니다.
              </p>
            )}
          </div>
          <p className={styles.footnote}>
            지도와 같은 60m 격자 · 반복 관측은 통화별 1건
            <br />
            여러 격자에 걸친 통화는 격자별 중복 포함 · 평가 불가 통화는 비율
            분모에서 제외
          </p>
        </section>
      </div>
      <section className={styles.panel} aria-label="시간대별 저품질 통화">
        <div className={styles.panelHead}>
          <h2>시간대별 저품질 통화</h2>
          <span>전체 분석 범위 · 통화 시작 시각 기준</span>
          <div>
            <button
              aria-pressed={hourMode === 'count'}
              onClick={() => setHourMode('count')}
            >
              건수
            </button>
            <button
              aria-pressed={hourMode === 'rate'}
              onClick={() => setHourMode('rate')}
            >
              비율
            </button>
          </div>
        </div>
        <div className={styles.chart}>
          {hourly.map((bin) => {
            const display = getHourlyDisplay(bin, hourMode);
            return (
              <button
                key={bin.hour}
                className={`${styles.bin} ${filters.hour === bin.hour ? styles.activeBin : ''}`}
                title={`${bin.hour}시 · ${display.label}${hourMode === 'count' ? '통화' : ''} · ${display.context}`}
                aria-pressed={filters.hour === bin.hour}
                aria-label={`${bin.hour}시 저품질 ${bin.poor}통화, 평가 가능 ${bin.evaluated}통화${hourMode === 'rate' ? `, 비율 ${display.label}` : ''}${filters.hour === bin.hour ? ', 선택 해제' : ''}`}
                onClick={() =>
                  change({
                    hour: filters.hour === bin.hour ? null : bin.hour,
                  })
                }
              >
                <span className={styles.barZone}>
                  <span
                    className={styles.bar}
                    style={{
                      height: `${((display.value ?? 0) / maximum) * 70 + (display.value ? 3 : 0)}px`,
                    }}
                  />
                  <span className={styles.barValue}>
                    {hourMode === 'rate' && display.value === null
                      ? '—'
                      : display.label}
                  </span>
                </span>
                <span>{String(bin.hour).padStart(2, '0')}시</span>
              </button>
            );
          })}
        </div>
        <p className={styles.footnote}>
          비율 = 저품질 / 같은 시간대 평가 가능 통화 · — 평가 불가 · 건수 0은
          저품질 없음 (통화 없음과 구별은 막대 상세). 시간 선택은
          지도·순위·목록에 적용됩니다.
        </p>
      </section>
      <section className={styles.panel} aria-label="조사 통화 목록">
        <div className={styles.listHead}>
          <h2>
            {filters.missingLocation
              ? '위치 없는 저품질 통화'
              : filters.cellId
                ? '선택 구역의 통화'
                : '전체 구역의 통화'}
          </h2>
          {(filters.cellId || filters.missingLocation) && (
            <button
              className={styles.badge}
              onClick={() => change({ cellId: null, missingLocation: false })}
            >
              {filters.missingLocation
                ? '위치 없음'
                : selected?.label || filters.cellId}{' '}
              해제 ×
            </button>
          )}
          <span>
            평가 {count(area.evaluated)} ·{' '}
            <b className={styles.poor}>
              저품질 {count(area.poor)} ({rate(area.poorRate)})
            </b>{' '}
            · 영향 계약 {count(area.affectedCustomers)}
          </span>
          <div className={styles.tabs}>
            <button
              aria-pressed={filters.poorOnly || filters.missingLocation}
              className={
                filters.poorOnly || filters.missingLocation
                  ? styles.activeTab
                  : ''
              }
              onClick={() => change({ poorOnly: true })}
            >
              저품질 {count(area.poor)}
            </button>
            <button
              disabled={filters.missingLocation}
              aria-pressed={!filters.poorOnly && !filters.missingLocation}
              className={
                !filters.poorOnly && !filters.missingLocation
                  ? styles.activeTab
                  : ''
              }
              onClick={() => change({ poorOnly: false })}
            >
              전체 평가 {count(area.evaluated)}
            </button>
          </div>
        </div>
        <div className={styles.tableTools}>
          <label>
            정렬{' '}
            <select
              value={filters.sort}
              onChange={(e) =>
                change({ sort: e.target.value as OverviewFilters['sort'] })
              }
            >
              <option value="poor">저품질 순</option>
              <option value="time">시작 시각 순</option>
            </select>
          </label>
          <span>
            평가 불가 {count(area.unscored)}통화 · 위치 없는 통화는 격자에
            귀속하지 않습니다.
          </span>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.calls}>
            <thead>
              <tr>
                <th>서비스 계약번호</th>
                <th>시작 시각</th>
                <th>통화 시간</th>
                <th>QoE</th>
                <th>위치 근거</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((call) => (
                <tr key={`${call.customerId}-${call.id}`}>
                  <td
                    className={styles.contract}
                    title={call.contractId ?? undefined}
                  >
                    {call.contractId ?? '계약번호 미제공'}
                  </td>
                  <td>{call.start}</td>
                  <td>{duration(call)}</td>
                  <td
                    className={
                      call.qoe !== null && call.qoe < threshold
                        ? styles.poor
                        : ''
                    }
                  >
                    {call.qoe === null ? '평가 불가' : call.qoe.toFixed(2)}
                  </td>
                  <td>{locationLabels[call.locationSource]}</td>
                  <td>
                    <button
                      className={styles.link}
                      onClick={() => onAnalyze(call)}
                      aria-label={`${call.contractId ?? '계약번호 미제공'} ${call.start} 통화 분석`}
                    >
                      분석 →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <p className={styles.empty}>
              선택한 조건에 해당하는 통화가 없습니다.
            </p>
          )}
        </div>
        <div className={styles.pagination}>
          <span>통화의 분석을 선택하면 계약·통화 분석으로 이동합니다.</span>
          <label>
            표시{' '}
            <select
              aria-label="페이지당 통화 수"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                change({ page: 0 });
              }}
            >
              <option value={25}>25통화</option>
              <option value={50}>50통화</option>
            </select>
          </label>
          <span>
            {count(rows.length)}건 중 {rows.length ? page * pageSize + 1 : 0}–
            {Math.min((page + 1) * pageSize, rows.length)}
          </span>
          <button
            disabled={page === 0}
            onClick={() => change({ page: page - 1 })}
            aria-label="이전 페이지"
          >
            ‹
          </button>
          <button
            disabled={page >= pages - 1}
            onClick={() => change({ page: page + 1 })}
            aria-label="다음 페이지"
          >
            ›
          </button>
        </div>
      </section>
    </div>
  );
}
