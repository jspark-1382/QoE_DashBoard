'use client';
import React, { useState } from 'react';
import {
  clampWindow,
  nextObservation,
  observationSecond,
} from '../../lib/analyst/timeline-navigation';
import type { AnalystSample } from '../../lib/analyst/types';
import styles from './contract-workspace.module.css';

type Props = {
  samples: AnalystSample[];
  selectedIndex: number | null;
  onSelectSample: (index: number) => void;
};
const bands = [
  { key: 'rsrp', label: 'RSRP', unit: 'dBm', min: -140, max: -40 },
  { key: 'rsrq', label: 'RSRQ', unit: 'dB', min: -30, max: 0 },
  { key: 'sinr', label: 'SINR', unit: 'dB', min: -20, max: 40 },
] as const;
export function RadioTimeline({
  samples,
  selectedIndex,
  onSelectSample,
}: Props) {
  const [windowSeconds, setWindowSeconds] = useState<number | null>(null);
  const allOrdered = [...samples].sort(
    (a, b) => observationSecond(a) - observationSecond(b) || a.index - b.index,
  );
  const [windowStart, windowEnd] = clampWindow(
    allOrdered,
    selectedIndex,
    windowSeconds,
  );
  const ordered = allOrdered.filter(
    (s) =>
      observationSecond(s) >= windowStart && observationSecond(s) <= windowEnd,
  );
  if (!ordered.length)
    return (
      <section className={styles.timeline} aria-label="선택 통화 무선 시간축">
        <div className={styles.panelHeading}>
          <h3>무선 관측 시간축</h3>
        </div>
        <p className={styles.empty}>관측 이벤트가 없습니다.</p>
      </section>
    );
  const start = windowStart,
    span = Math.max(1, windowEnd - start);
  const selected = allOrdered.findIndex((s) => s.index === selectedIndex);
  const position = Math.max(0, selected);
  const x = (s: AnalystSample) =>
    42 + ((observationSecond(s) - start) / span) * 700;
  return (
    <section className={styles.timeline} aria-label="선택 통화 무선 시간축">
      <div className={styles.panelHeading}>
        <h3>무선 관측 시간축</h3>
        <span>원래 단위 · 동일 시점 커서</span>
      </div>
      <div className={styles.navigationTools}>
        <label>
          시간 범위{' '}
          <select
            aria-label="시간축 표시 범위"
            value={windowSeconds ?? 'all'}
            onChange={(e) =>
              setWindowSeconds(
                e.target.value === 'all' ? null : Number(e.target.value),
              )
            }
          >
            <option value="all">전체 시간</option>
            <option value="60">선택 시점 주변 1분</option>
            <option value="300">선택 시점 주변 5분</option>
          </select>
        </label>
        <button
          type="button"
          disabled={windowSeconds === null}
          onClick={() => setWindowSeconds(null)}
        >
          전체 시간으로 복원
        </button>
        {(['condition', 'cell', 'gap'] as const).map((target) => {
          const next = nextObservation(allOrdered, selectedIndex, target);
          return (
            <button
              key={target}
              type="button"
              disabled={next === null}
              onClick={() => next !== null && onSelectSample(next)}
            >
              {target === 'condition'
                ? '다음 조건 관측'
                : target === 'cell'
                  ? '다음 Cell 변경'
                  : '다음 30초 초과 공백'}
            </button>
          );
        })}
      </div>
      <p className={styles.timelineNote}>
        관측 탐색: RSRP −105 dBm 미만 또는 SINR 0 dB 미만 · 원인 판정 아님.
        공백은 이후 첫 관측으로 이동합니다.
      </p>
      {bands.map((b) => {
        const segments: string[] = [];
        let path = '';
        let previous: AnalystSample | null = null;
        for (const s of ordered) {
          const value = s[b.key];
          if (value === null || !Number.isFinite(value)) {
            if (path) segments.push(path);
            path = '';
            previous = null;
            continue;
          }
          const y =
            12 +
            ((b.max - Math.max(b.min, Math.min(b.max, value))) /
              (b.max - b.min)) *
              48;
          const gap =
            previous && observationSecond(s) - observationSecond(previous) > 30;
          if (gap && path) {
            segments.push(path);
            path = '';
          }
          path += `${path ? 'L' : 'M'}${x(s).toFixed(2)},${y.toFixed(2)} `;
          previous = s;
        }
        if (path) segments.push(path);
        return (
          <div key={b.key} className={styles.band}>
            <div className={styles.bandLabel}>
              <strong>{b.label}</strong> <span>{b.unit}</span>
              <b>{allOrdered[position][b.key] ?? '—'}</b>
            </div>
            <button
              type="button"
              className={styles.chartSurface}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  e.preventDefault();
                  onSelectSample(
                    allOrdered[
                      Math.max(
                        0,
                        Math.min(
                          allOrdered.length - 1,
                          position + (e.key === 'ArrowRight' ? 1 : -1),
                        ),
                      )
                    ].index,
                  );
                }
              }}
              aria-label={`${b.label} (${b.unit}), ${ordered.length}개 이벤트`}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const t =
                  start +
                  ((((e.clientX - r.left) / r.width) * 760 - 42) / 700) * span;
                const nearest = ordered.reduce((a, s) =>
                  Math.abs(observationSecond(s) - t) <
                  Math.abs(observationSecond(a) - t)
                    ? s
                    : a,
                );
                onSelectSample(nearest.index);
              }}
            >
              <svg viewBox="0 0 760 80" aria-hidden="true">
                <text x="0" y="15">
                  {b.max}
                </text>
                <text x="0" y="64">
                  {b.min}
                </text>
                <line x1="42" x2="742" y1="60" y2="60" stroke="#e3e6ea" />
                {segments.map((d, i) => (
                  <path
                    key={i}
                    d={d}
                    fill="none"
                    stroke="#697c92"
                    strokeWidth="1.7"
                  />
                ))}
                {ordered.map(
                  (s) =>
                    s[b.key] !== null &&
                    Number.isFinite(s[b.key]) && (
                      <circle
                        key={s.index}
                        cx={x(s)}
                        cy={
                          12 +
                          ((b.max -
                            Math.max(b.min, Math.min(b.max, s[b.key]!))) /
                            (b.max - b.min)) *
                            48
                        }
                        r="2"
                        fill="#697c92"
                      />
                    ),
                )}
                <line
                  x1={x(allOrdered[position])}
                  x2={x(allOrdered[position])}
                  y1="6"
                  y2="67"
                  stroke="#2459A6"
                  strokeWidth="2"
                />
              </svg>
            </button>
          </div>
        );
      })}
      <div className={styles.timelineControls}>
        <button
          disabled={position === 0}
          onClick={() => onSelectSample(allOrdered[position - 1].index)}
        >
          이전 관측
        </button>
        <output>
          {allOrdered[position].time} · {position + 1}/{allOrdered.length}
        </output>
        <button
          disabled={position === allOrdered.length - 1}
          onClick={() => onSelectSample(allOrdered[position + 1].index)}
        >
          다음 관측
        </button>
      </div>
      <input
        className={styles.range}
        type="range"
        aria-label="관측 시점 선택"
        min={0}
        max={allOrdered.length - 1}
        value={position}
        onChange={(e) =>
          onSelectSample(allOrdered[Number(e.target.value)].index)
        }
      />
      <div className={styles.timeBounds}>
        <span>{allOrdered[0].time}</span>
        <span>{allOrdered[allOrdered.length - 1].time}</span>
      </div>
    </section>
  );
}
