'use client';
import React from 'react';
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
  const ordered = [...samples].sort(
    (a, b) => a.second - b.second || a.index - b.index,
  );
  if (!ordered.length)
    return <section className={styles.timeline} aria-label="선택 통화 무선 시간축"><div className={styles.panelHeading}><h3>무선 관측 시간축</h3></div><p className={styles.empty}>관측 이벤트가 없습니다.</p></section>;
  const start = ordered[0].second,
    span = Math.max(1, ordered[ordered.length - 1].second - start);
  const selected = ordered.findIndex((s) => s.index === selectedIndex);
  const position = Math.max(0, selected);
  const x = (s: AnalystSample) => 42 + ((s.second - start) / span) * 700;
  return (
    <section className={styles.timeline} aria-label="선택 통화 무선 시간축">
      <div className={styles.panelHeading}>
        <h3>무선 관측 시간축</h3>
        <span>원래 단위 · 동일 시점 커서</span>
      </div>
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
          const gap = previous && s.second - previous.second > 30;
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
              <b>{ordered[position][b.key] ?? '—'}</b>
            </div>
            <button
              type="button"
              className={styles.chartSurface}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  e.preventDefault();
                  onSelectSample(
                    ordered[
                      Math.max(
                        0,
                        Math.min(
                          ordered.length - 1,
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
                  Math.abs(s.second - t) < Math.abs(a.second - t) ? s : a,
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
                    s[b.key] !== null && (
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
                  x1={x(ordered[position])}
                  x2={x(ordered[position])}
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
          onClick={() => onSelectSample(ordered[position - 1].index)}
        >
          이전 관측
        </button>
        <output>
          {ordered[position].time} · {position + 1}/{ordered.length}
        </output>
        <button
          disabled={position === ordered.length - 1}
          onClick={() => onSelectSample(ordered[position + 1].index)}
        >
          다음 관측
        </button>
      </div>
      <input
        className={styles.range}
        type="range"
        aria-label="관측 시점 선택"
        min={0}
        max={ordered.length - 1}
        value={position}
        onChange={(e) => onSelectSample(ordered[Number(e.target.value)].index)}
      />
      <div className={styles.timeBounds}>
        <span>{ordered[0].time}</span>
        <span>{ordered[ordered.length - 1].time}</span>
      </div>
    </section>
  );
}
