'use client';
import React, { useState } from 'react';
import type { AnalystCall, AnalystDay } from '../../lib/analyst/types';
import {
  estimationReason,
  estimationSummary,
} from '../../lib/analyst/estimation-evidence';
import { isPoorCall } from '../../lib/analyst/data';
import { getMetricLegend } from '../../lib/analyst/map';
import { AnalystMap } from './analyst-map';
import { RadioTimeline } from './radio-timeline';
import { ObservationDetails } from './observation-details';
import styles from './contract-workspace.module.css';
type Props = {
  day: AnalystDay;
  callId: string | null;
  sampleIndex: number | null;
  threshold: number;
  onSelectCall: (id: string) => void;
  onSelectSample: (index: number) => void;
  settingsOpen?: boolean;
  toolbar?: React.ReactNode;
};
const hasMdt = (c: AnalystCall) =>
  c.hasMdt ?? (c.mdtCount > 0 || c.sampleIndices.length > 0);
const duration = (c: AnalystCall) => {
  const clockSeconds = c.endSecond - c.startSecond;
  const s =
    c.durationSeconds ??
    (clockSeconds < 0 ? clockSeconds + 86400 : clockSeconds);
  return `${Math.floor(s / 60)
    .toString()
    .padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
};
export function ContractWorkspace({
  day,
  callId,
  sampleIndex,
  threshold,
  onSelectCall,
  onSelectSample,
  settingsOpen,
  toolbar,
}: Props) {
  const [poorOnly, setPoorOnly] = useState(false),
    [mdtFilter, setMdtFilter] = useState('all'),
    [sort, setSort] = useState('time');
  const [metric, setMetric] = useState<'qoe' | 'rsrp' | 'rsrq' | 'sinr'>(
    'rsrp',
  );
  const [gnss, setGnss] = useState(true),
    [estimates, setEstimates] = useState(true),
    [stations, setStations] = useState(false);
  const [showEstimationEvidence, setShowEstimationEvidence] = useState(false);
  const call = day.calls.find((c) => c.id === callId) ?? null;
  const samples = call
    ? day.samples.filter((s) => s.callId === call.id && s.inCallWindow)
    : [];
  const sample = samples.find((s) => s.index === sampleIndex) ?? null;
  const positionSummary = estimationSummary(samples);
  const evaluated = day.calls.filter(
      (c) => c.qoe !== null && Number.isFinite(c.qoe),
    ),
    poor = evaluated.filter((c) => isPoorCall(c.qoe, threshold));
  const valid = day.samples.filter((s) => s.inCallWindow),
    gnssCount = valid.filter((s) => s.locationSource === 'gnss').length;
  const gnssCoverageKnown =
    valid.length > 0 &&
    valid.every((s) => {
      const metadata = s.raw[21];
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
        return false;
      const m = metadata as Record<string, unknown>;
      return (
        typeof m.gnss === 'boolean' ||
        (typeof m.locationSource === 'string' &&
          [
            'gnss',
            'interpolated',
            'radio',
            'station',
            'measured',
            'unavailable',
          ].includes(m.locationSource)) ||
        Object.hasOwn(m, 'gnssUtmkx') ||
        Object.hasOwn(m, 'gnssUtmky')
      );
    });
  const calls = [...day.calls]
    .filter(
      (c) =>
        (!poorOnly || isPoorCall(c.qoe, threshold)) &&
        (day.source !== 'MDT' ||
          mdtFilter === 'all' ||
          (mdtFilter === 'mdt' ? hasMdt(c) : !hasMdt(c))),
    )
    .sort((a, b) =>
      sort === 'poor'
        ? (a.qoe ?? Infinity) - (b.qoe ?? Infinity) ||
          a.startSecond - b.startSecond
        : a.startSecond - b.startSecond,
    );
  const stationKeys = new Set(
    samples.flatMap((s) => [s.baseStationId, s.cellId]).filter(Boolean),
  );
  const cdrOnly = day.source === 'MDT' && call !== null && !hasMdt(call);
  return (
    <div className={styles.workspace}>
      <div className={styles.contextBar}>
        {toolbar}
        <div className={styles.summary} aria-label="현재 계약 일자 요약">
          <span>
            통화 <b>{day.calls.length}</b>건
          </span>
          <span>
            평가 가능 <b>{evaluated.length}</b>건
          </span>
          <span title={`저품질 QoE < ${threshold}`}>
            저품질{' '}
            <b className={styles.poor}>
              {poor.length} / {evaluated.length}
            </b>
            건
          </span>
          <span
            title={
              gnssCoverageKnown
                ? `통화 중 유효 관측 ${valid.length}건 중 GNSS ${gnssCount}건`
                : 'GNSS 출처 정보 미제공'
            }
          >
            GNSS 확보율{' '}
            <b>
              {gnssCoverageKnown
                ? `${((gnssCount / valid.length) * 100).toFixed(1)}%`
                : '미제공'}
            </b>
          </span>
        </div>
      </div>
      {settingsOpen && (
        <div className={styles.settings}>
          <strong>분석 설정</strong>
          <p>
            GNSS 원본 EPSG:5179 · 기지국 좌표는 고객 위치가 아닙니다. RSRP −105
            dBm / SINR 0 dB 관측을 탐색하며 시간축은 30초 초과 공백에서 선을
            끊습니다.
          </p>
        </div>
      )}
      <div className={styles.columns}>
        <aside className={styles.callPanel} id="contract-call-rail">
          <div className={styles.panelHeading}>
            <h3>
              통화 목록 <span>{day.calls.length}</span>
            </h3>
            <select
              aria-label="통화 정렬"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="time">시각순</option>
              <option value="poor">저품질순</option>
            </select>
          </div>
          <div className={styles.callTools}>
            <div className={styles.tabs} aria-label="통화 품질 필터">
              <button
                type="button"
                aria-pressed={!poorOnly}
                onClick={() => setPoorOnly(false)}
              >
                전체
              </button>
              <button
                type="button"
                aria-pressed={poorOnly}
                onClick={() => setPoorOnly(true)}
              >
                저품질
              </button>
            </div>
            {day.source === 'MDT' && (
              <select
                aria-label="MDT 관측 여부"
                value={mdtFilter}
                onChange={(e) => setMdtFilter(e.target.value)}
              >
                <option value="all">자료 전체</option>
                <option value="mdt">MDT 있음</option>
                <option value="cdr">CDR만</option>
              </select>
            )}
          </div>
          <div className={styles.callList}>
            <table aria-label="계약 통화 목록">
              <thead>
                <tr>
                  <th>시작 시각</th>
                  <th>통화 시간</th>
                  <th>QoE</th>
                  <th>자료</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <tr
                    key={c.id}
                    className={c.id === callId ? styles.selected : ''}
                    aria-selected={c.id === callId}
                  >
                    <td>
                      <button
                        type="button"
                        aria-label={`${c.start} 통화 분석`}
                        aria-pressed={c.id === callId}
                        onClick={() => onSelectCall(c.id)}
                      >
                        {c.start}
                      </button>
                    </td>
                    <td>{duration(c)}</td>
                    <td
                      className={
                        isPoorCall(c.qoe, threshold) ? styles.poor : ''
                      }
                    >
                      {c.qoe === null ? (
                        <span className={styles.muted}>평가 불가</span>
                      ) : (
                        <>
                          {isPoorCall(c.qoe, threshold) && (
                            <i className={styles.poorDot} />
                          )}{' '}
                          {c.qoe.toFixed(2)}
                        </>
                      )}
                    </td>
                    <td>
                      <span
                        className={styles.dataBadge}
                        title={
                          day.source === 'MDT'
                            ? hasMdt(c)
                              ? `MDT ${c.mdtCount ?? c.sampleIndices.length}건`
                              : 'CDR만 있음 · MDT 관측 없음'
                            : '실측 자료'
                        }
                      >
                        {day.source === 'MDT'
                          ? hasMdt(c)
                            ? 'MDT'
                            : 'CDR'
                          : '실측'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!calls.length && (
              <p className={styles.empty}>표시할 통화가 없습니다.</p>
            )}
          </div>
          {call && !calls.some((c) => c.id === call.id) && (
            <p className={styles.filterNote}>
              선택 통화는 현재 목록 필터 밖입니다.
            </p>
          )}
          <div className={styles.callFoot}>
            <i className={styles.poorDot} /> 저품질: QoE &lt; {threshold}
          </div>
        </aside>
        <main className={styles.center}>
          <section className={styles.mapPanel} aria-label="선택 통화 지도">
            <div className={styles.mapHeading}>
              <div className={styles.callTitle}>
                <h3>
                  {call
                    ? `선택 통화 ${call.start} – ${call.end}`
                    : '통화를 선택하세요'}
                </h3>
                <span>
                  QoE{' '}
                  <b
                    className={
                      call && isPoorCall(call.qoe, threshold) ? styles.poor : ''
                    }
                  >
                    {call?.qoe != null ? call.qoe.toFixed(2) : '평가 불가'}
                  </b>
                </span>
                <span className={styles.mapSource}>
                  {cdrOnly
                    ? 'CDR만 · MDT 없음'
                    : day.source === 'MDT'
                      ? `MDT ${samples.length}건`
                      : '실측 관측'}
                </span>
              </div>
              <div className={styles.mapTools}>
                <div className={styles.layers}>
                  <label>
                    <input
                      type="checkbox"
                      checked={gnss}
                      onChange={(e) => setGnss(e.target.checked)}
                    />
                    {day.source === 'MDT' ? 'GNSS' : '실측'}
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={estimates}
                      onChange={(e) => setEstimates(e.target.checked)}
                    />
                    추정 위치
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={stations}
                      onChange={(e) => setStations(e.target.checked)}
                    />
                    기지국
                  </label>
                </div>
                <details className={styles.mapOptions} aria-label="지도 옵션">
                  <summary>지도 옵션</summary>
                  <div className={styles.optionBody}>
                    <label className={styles.metricField}>
                      색상{' '}
                      <select
                        aria-label="지도 색상 지표"
                        value={metric}
                        onChange={(e) =>
                          setMetric(e.target.value as typeof metric)
                        }
                      >
                        <option value="rsrp">RSRP (dBm)</option>
                        <option value="rsrq">RSRQ (dB)</option>
                        <option value="sinr">SINR (dB)</option>
                        <option value="qoe">통화 QoE</option>
                      </select>
                    </label>
                    <div
                      aria-label="지도 색상 수치 기준"
                      className={styles.colorLegend}
                    >
                      {getMetricLegend(metric, threshold).map((item) => (
                        <span key={item.kind}>
                          <i style={{ backgroundColor: item.color }} />
                          {item.label}
                        </span>
                      ))}
                    </div>
                    {metric === 'sinr' && (
                      <p>지도 색상 3 dB 기준 · 관측 탐색 0 dB 기준</p>
                    )}
                    {day.source === 'MDT' && (
                      <div
                        className={styles.estimationStatus}
                        aria-label="자동 위치 추정 상태"
                      >
                        <strong>자동 위치 추정</strong>
                        <p>
                          GNSS {positionSummary.gnss}건 · 3개 이상 기지국
                          삼변·다변측량 {positionSummary.multi}건 · 2개 기지국
                          가중중심 {positionSummary.two}건 · 위치 보류{' '}
                          {positionSummary.unavailable}건
                        </p>
                        <label>
                          <input
                            type="checkbox"
                            checked={showEstimationEvidence}
                            onChange={(e) =>
                              setShowEstimationEvidence(e.target.checked)
                            }
                          />
                          추정 근거 보기
                        </label>
                        <button
                          type="button"
                          disabled={!positionSummary.radioIndices.length}
                          onClick={() => {
                            setEstimates(true);
                            const next =
                              positionSummary.radioIndices.find(
                                (index) => index > (sampleIndex ?? -1),
                              ) ?? positionSummary.radioIndices[0];
                            if (next !== undefined) onSelectSample(next);
                          }}
                        >
                          무선 추정 시점으로 이동 (
                          {positionSummary.radioIndices.length}건)
                        </button>
                        {sample && <p>{estimationReason(sample)}</p>}
                        <p>
                          GNSS 우선 · 기지국 2개는 가중중심, 1개는 고객 위치를
                          보류합니다.
                        </p>
                      </div>
                    )}
                  </div>
                </details>
              </div>
            </div>
            {cdrOnly ? (
              <div className={styles.cdrOnly} aria-label="CDR 통화 위치 정보">
                <strong>CDR만 있는 통화</strong>
                <p>MDT 관측과 고객 이동 경로가 없습니다.</p>
                <dl>
                  <div>
                    <dt>시작 · Invite</dt>
                    <dd>
                      {call.start}
                      <span>Cell-ID {call.startCellId || '미제공'}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>종료 · Bye</dt>
                    <dd>
                      {call.end}
                      <span>Cell-ID {call.endCellId || '미제공'}</span>
                    </dd>
                  </div>
                </dl>
                <p>
                  Cell 위치 미제공 · Cell-ID와 기지국 좌표를 연결하는 매핑
                  정보가 필요합니다.
                </p>
              </div>
            ) : (
              <div className={styles.map}>
                <AnalystMap
                  threshold={threshold}
                  samples={samples}
                  selectedIndex={sampleIndex}
                  onSampleSelect={onSelectSample}
                  stations={day.baseStations.filter(
                    (s) =>
                      stationKeys.has(s.baseStationId) ||
                      stationKeys.has(s.cellId),
                  )}
                  metric={metric}
                  showGnss={gnss}
                  showEstimates={estimates}
                  showStations={stations}
                  showEstimationEvidence={showEstimationEvidence}
                  focusKey={`${day.customerId}/${day.date}/${callId}`}
                  source={day.source}
                />
              </div>
            )}
            <div className={styles.legend}>
              <span>○ {day.source === 'MDT' ? 'GNSS 관측' : '실측 관측'}</span>
              <span>◇ 추정 위치</span>
              <span>△ 기지국</span>
              <span className={styles.legendNote}>
                위치 출처는 모양 · 품질은 색상
              </span>
            </div>
          </section>
          <RadioTimeline
            key={`${day.customerId}/${day.date}/${callId}`}
            samples={samples}
            selectedIndex={sampleIndex}
            onSelectSample={onSelectSample}
          />
        </main>
        <aside className={styles.detailsPanel}>
          <ObservationDetails
            sample={sample}
            call={call}
            samples={samples}
            source={day.source}
          />
        </aside>
      </div>
      <p className={styles.footer}>
        {day.source === 'MDT'
          ? 'MDT QoE는 통화별 무선 기반 추정값'
          : '실측 자료 기준'}{' '}
        · 현재 계약 / 선택 일자 기준
      </p>
    </div>
  );
}
