'use client';
import React, { useEffect, useState } from 'react';
import type { AnalystDay } from '../../lib/analyst/types';
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
};
export function ContractWorkspace({
  day,
  callId,
  sampleIndex,
  threshold,
  onSelectCall,
  onSelectSample,
  settingsOpen,
}: Props) {
  const [poorOnly, setPoorOnly] = useState(false),
    [sort, setSort] = useState('time'),
    [metric, setMetric] = useState<'qoe' | 'rsrp' | 'rsrq' | 'sinr'>('rsrp');
  const [gnss, setGnss] = useState(true),
    [estimates, setEstimates] = useState(true),
    [stations, setStations] = useState(false);
  const [showEstimationEvidence, setShowEstimationEvidence] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [railOpen, setRailOpen] = useState(true);
  const [focus, setFocus] = useState<'balanced' | 'map' | 'evidence'>(
    'balanced',
  );
  useEffect(() => {
    const media = window.matchMedia('(min-width:1501px)');
    const update = () => setDetailsOpen(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const call = day.calls.find((c) => c.id === callId) ?? null;
  const samples = call
    ? day.samples.filter((s) => s.callId === call.id && s.inCallWindow)
    : [];
  const positionSummary = estimationSummary(samples);
  const sample = samples.find((s) => s.index === sampleIndex) ?? null;
  const evaluated = day.calls.filter(
      (c) => c.qoe !== null && Number.isFinite(c.qoe),
    ),
    poor = evaluated.filter((c) => isPoorCall(c.qoe, threshold));
  const valid = day.samples.filter((s) => s.inCallWindow),
    gnssCount = valid.filter((s) => s.locationSource === 'gnss').length;
  // A coordinate in legacy measured input does not identify its GNSS provenance.
  // Require explicit metadata on every denominator event before reporting coverage.
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
    .filter((c) => !poorOnly || isPoorCall(c.qoe, threshold))
    .sort((a, b) =>
      sort === 'poor'
        ? (a.qoe ?? Infinity) - (b.qoe ?? Infinity) ||
          a.startSecond - b.startSecond
        : a.startSecond - b.startSecond,
    );
  const stationKeys = new Set(
    samples.flatMap((s) => [s.baseStationId, s.cellId]).filter(Boolean),
  );
  return (
    <div className={styles.workspace}>
      <div className={styles.summary}>
        <span>
          통화 <b>{day.calls.length}</b>건
        </span>
        <span>
          평가 가능 <b>{evaluated.length}</b>건
        </span>
        <span>
          저품질{' '}
          <b className={styles.poor}>
            {poor.length}/{evaluated.length}
          </b>
          건 <small>QoE &lt; {threshold}</small>
        </span>
        <span
          title={
            gnssCoverageKnown
              ? `통화 중 유효 관측 ${valid.length}건 중 GNSS ${gnssCount}건`
              : 'GNSS 출처를 확인할 수 있는 원본 정보가 없어 확보율을 계산하지 않습니다.'
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
      {settingsOpen && (
        <div className={styles.settings}>
          <strong>분석 설정</strong>
          <p>
            위치 출처는 제공된 관측·추정 결과를 사용합니다. GNSS 원본은
            EPSG:5179이며, 기지국 좌표는 고객 위치로 간주하지 않습니다. 이
            화면에서는 위치 모델 파라미터를 변경하지 않습니다.
          </p>
          <p>
            무선 시간축은 30초를 초과하는 관측 공백에서 선을 끊습니다. 조사
            조건은 RSRP −105 dBm 미만 / SINR 0 dB 미만입니다.
          </p>
        </div>
      )}
      <div className={styles.workspaceTools}>
        <button
          type="button"
          aria-expanded={railOpen}
          aria-controls="contract-call-rail"
          onClick={() => setRailOpen(!railOpen)}
        >
          {railOpen ? '통화 목록 접기' : '통화 목록 펼치기'}
        </button>
        <span>작업 공간</span>
        {(['balanced', 'map', 'evidence'] as const).map((view) => (
          <button
            type="button"
            key={view}
            aria-pressed={focus === view}
            onClick={() => {
              setFocus(view);
              if (view === 'evidence') setDetailsOpen(true);
            }}
          >
            {view === 'balanced'
              ? '균형 보기'
              : view === 'map'
                ? '지도 중심'
                : '근거 중심'}
          </button>
        ))}
      </div>
      <div
        className={`${styles.columns} ${!railOpen ? styles.railCollapsed : ''} ${focus === 'map' ? styles.mapFocus : focus === 'evidence' ? styles.evidenceFocus : ''}`}
      >
        {railOpen && (
          <aside id="contract-call-rail" className={styles.callPanel}>
            <div className={styles.panelHeading}>
              <h3>통화 목록</h3>
              <span>{calls.length}건</span>
            </div>
            <div className={styles.callTools}>
              <label>
                <input
                  type="checkbox"
                  checked={poorOnly}
                  onChange={(e) => setPoorOnly(e.target.checked)}
                />{' '}
                저품질만
              </label>
              <select
                aria-label="통화 정렬"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="time">시각순</option>
                <option value="poor">저품질순</option>
              </select>
            </div>
            <div className={styles.callList}>
              {calls.length ? (
                calls.map((c) => (
                  <button
                    key={c.id}
                    className={`${styles.callRow} ${c.id === callId ? styles.selected : ''}`}
                    aria-pressed={c.id === callId}
                    onClick={() => onSelectCall(c.id)}
                  >
                    <span className={styles.callTime}>
                      {c.start} <span>→ {c.end}</span>
                    </span>
                    <span className={styles.callMeta}>
                      <span>{Math.max(0, c.endSecond - c.startSecond)}초</span>
                      <span
                        className={
                          isPoorCall(c.qoe, threshold) ? styles.poor : ''
                        }
                      >
                        QoE {c.qoe === null ? '미제공' : c.qoe.toFixed(2)}
                      </span>
                    </span>
                    <span className={styles.helper}>
                      {c.qoe === null
                        ? '평가 불가'
                        : isPoorCall(c.qoe, threshold)
                          ? '저품질'
                          : '평가 가능'}{' '}
                      · 관측 {c.sampleIndices.length}건
                    </span>
                  </button>
                ))
              ) : (
                <p className={styles.empty}>표시할 통화가 없습니다.</p>
              )}
            </div>
          </aside>
        )}
        <main className={styles.center}>
          <section className={styles.mapPanel}>
            <div className={styles.panelHeading}>
              <div>
                <h3>
                  {call ? `${call.start} – ${call.end}` : '통화를 선택하세요'}
                </h3>
                <span>
                  통화 QoE{' '}
                  {call?.qoe !== null && call?.qoe !== undefined
                    ? call.qoe.toFixed(2)
                    : '미제공'}
                </span>
              </div>
              <select
                aria-label="지도 색상 지표"
                value={metric}
                onChange={(e) => setMetric(e.target.value as typeof metric)}
              >
                <option value="rsrp">RSRP (dBm)</option>
                <option value="rsrq">RSRQ (dB)</option>
                <option value="sinr">SINR (dB)</option>
                <option value="qoe">통화 QoE</option>
              </select>
            </div>
            {day.source === 'MDT' && (
              <div
                className={styles.estimationStatus}
                aria-label="자동 위치 추정 상태"
              >
                <strong>
                  자동 위치 추정 · GNSS 우선, 없으면 무선 근거로 추정
                </strong>
                <p>
                  선택 통화: GNSS {positionSummary.gnss}건 · 3개 이상 기지국
                  삼변·다변측량 {positionSummary.multi}건 · 2개 기지국 가중중심{' '}
                  {positionSummary.two}건 · 위치 보류{' '}
                  {positionSummary.unavailable}건
                </p>
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
                  무선 추정 시점으로 이동 ({positionSummary.radioIndices.length}
                  건)
                </button>
                {sample && <p>{estimationReason(sample)}</p>}
                <p>
                  기지국 2개는 가중중심입니다. 기지국 1개는 고객 위치로 표시하지
                  않습니다.
                </p>
              </div>
            )}
            <div className={styles.layers}>
              <label>
                <input
                  type="checkbox"
                  checked={gnss}
                  onChange={(e) => setGnss(e.target.checked)}
                />
                GNSS
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
              {day.source === 'MDT' && (
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
              )}
            </div>
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
            <div className={styles.legend} aria-label="지도 색상 수치 기준">
              {getMetricLegend(metric, threshold).map((item) => (
                <span key={item.kind}>
                  <i
                    className={styles.legendDot}
                    style={{ backgroundColor: item.color }}
                  />
                  {item.label}
                </span>
              ))}
              {metric === 'sinr' && (
                <span>지도 색상 3 dB 기준 · 관측 탐색 0 dB 기준</span>
              )}
            </div>
            <div className={styles.legend}>
              <span>○ GNSS 관측</span>
              <span>◇ 보간·무선 추정</span>
              <span>△ 기지국</span>
              <span>선택: 파랑 테두리</span>
            </div>
          </section>
          <RadioTimeline
            key={`${day.customerId}/${day.date}/${callId}`}
            samples={samples}
            selectedIndex={sampleIndex}
            onSelectSample={onSelectSample}
          />
        </main>
        <details
          className={styles.detailsPanel}
          open={detailsOpen}
          onToggle={(e) => setDetailsOpen(e.currentTarget.open)}
        >
          <summary>관측 근거 펼치기 / 접기</summary>
          <ObservationDetails
            sample={sample}
            call={call}
            samples={samples}
            source={day.source}
          />
        </details>
      </div>
    </div>
  );
}
