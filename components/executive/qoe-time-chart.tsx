'use client';

import { useMemo, useState } from 'react';
import type { ExecutiveSample, PoorEpisode } from '@/lib/executive';

interface Props {
  selectedCallId: string | null;
  samples: ExecutiveSample[];
  episodes: PoorEpisode[];
  selectedEpisodeId: string | null;
  selectedSampleIndex: number | null;
  onEpisodeSelect: (id: string) => void;
  onSampleSelect: (index: number) => void;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const normalizedSignal = (sample: ExecutiveSample): number | null => {
  const rsrp = sample.rsrp == null ? null : 1 + 4 * clamp((sample.rsrp + 120) / 50, 0, 1);
  const sinr = sample.sinr == null ? null : 1 + 4 * clamp((sample.sinr + 5) / 30, 0, 1);
  const values = [rsrp, sinr].filter((value): value is number => value != null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
};

interface Bin { second: number; qoe: number; mos: number | null; signal: number | null; sampleCount: number }

// Time-window aggregation (10s / 30s / 60s, median) so raw point noise does not
// dominate the executive view. Episode minimums are preserved separately and
// never lost by this aggregation.
function aggregate(samples: ExecutiveSample[]): { bins: Bin[]; windowSeconds: number } {
  if (!samples.length) return { bins: [], windowSeconds: 30 };
  const span = Math.max(60, samples[samples.length - 1].second - samples[0].second);
  const target = 90;
  const windowSeconds = span / target <= 10 ? 10 : span / target <= 30 ? 30 : 60;
  const start = samples[0].second;
  const bucket = new Map<number, ExecutiveSample[]>();
  samples.forEach(sample => {
    const key = Math.floor((sample.second - start) / windowSeconds);
    const list = bucket.get(key);
    if (list) list.push(sample);
    else bucket.set(key, [sample]);
  });
  const median = (values: number[]) => {
    if (!values.length) return null;
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };
  let bins: Bin[] = [...bucket.entries()].sort((a, b) => a[0] - b[0]).map(([key, list]) => ({
    second: start + (key + 0.5) * windowSeconds,
    qoe: median(list.map(item => item.qoe)) ?? 0,
    mos: median(list.map(item => item.mos).filter((value): value is number => value != null)),
    signal: median(list.map(normalizedSignal).filter((value): value is number => value != null)),
    sampleCount: list.length,
  }));
  // Light 3-bin moving median so short-lived single-sample flicker does not
  // read as a new quality level (episode minimums are preserved separately).
  if (bins.length > 3) {
    const smooth = (field: 'qoe' | 'mos' | 'signal') => bins.map((bin, index) => {
      const values = [bins[index - 1]?.[field], bin[field], bins[index + 1]?.[field]]
        .filter((value): value is number => value != null && Number.isFinite(value));
      return values.length ? median(values) : bin[field];
    });
    const smoothQoe = smooth('qoe');
    const smoothMos = smooth('mos');
    bins = bins.map((bin, index) => ({ ...bin, qoe: smoothQoe[index] ?? bin.qoe, mos: smoothMos[index] ?? bin.mos }));
  }
  return { bins, windowSeconds };
}

const fmt = (second: number) => `${String(Math.floor(second / 3600)).padStart(2, '0')}:${String(Math.floor(second % 3600 / 60)).padStart(2, '0')}`;

export function ExecutiveTimeChart({ samples, episodes, selectedCallId, selectedEpisodeId, selectedSampleIndex, onEpisodeSelect, onSampleSelect }: Props) {
  const [showSignal, setShowSignal] = useState(false);
  const { bins, windowSeconds } = useMemo(() => aggregate(samples), [samples]);
  const selected = selectedSampleIndex != null ? samples[selectedSampleIndex] : null;
  const callSamples = useMemo(() => selectedCallId ? samples.filter(sample => sample.callId === selectedCallId) : [], [samples, selectedCallId]);
  const minimumByEpisode = useMemo(() => Object.fromEntries(episodes.map(episode => [episode.id, samples[episode.minIndex]])), [episodes, samples]);

  if (!samples.length) return <div className="exec-empty"><b>시간대별 품질 데이터가 없습니다.</b><span>선택한 고객과 일자를 확인해 주세요.</span></div>;

  const width = 760, height = 212, left = 34, right = 738, top = 16, bottom = 182;
  const start = samples[0].second, end = Math.max(start + 1, samples[samples.length - 1].second);
  const x = (second: number) => left + (second - start) / (end - start) * (right - left);
  const y = (value: number) => bottom - (clamp(value, 1, 5) - 1) / 4 * (bottom - top);
  const path = (getter: (bin: Bin) => number | null) => {
    let d = '';
    let prev: number | null = null;
    bins.forEach(bin => {
      const value = getter(bin);
      if (value == null) { prev = null; return; }
      d += `${prev == null || bin.second - prev > windowSeconds * 1.6 ? 'M' : 'L'}${x(bin.second).toFixed(1)},${y(value).toFixed(1)} `;
      prev = bin.second;
    });
    return d;
  };
  const ticks = Array.from({ length: 7 }, (_, index) => start + (end - start) * index / 6);
  const displayEpisodes = [...episodes].sort((a, b) => a.minQoe - b.minQoe || b.durationSeconds - a.durationSeconds)
    .filter((episode, index) => index < 24 || episode.id === selectedEpisodeId);

  return <div className="exec-chart-wrap">
    <div className="exec-chart-bar">
      <div className="exec-chart-legend">
        <span className="qoe">QoE</span>
        <span className="mos">MOS</span>
        {showSignal && <span className="signal">신호품질 <em>정규화</em></span>}
        <span className="mos"><em className="exec-lab">저하구간</em></span>
      </div>
      <span className="exec-chart-aggregate">QoE 콜 단위 · MOS {windowSeconds}초 중앙값</span>
      <div className="exec-chart-toggle">
        <button type="button" className={showSignal ? 'on' : ''} onClick={() => setShowSignal(value => !value)}>RSRP/SINR {showSignal ? '숨김' : '보기'}</button>
      </div>
    </div>
    <svg className="exec-time-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-label="선택 고객 시간대별 QoE, MOS" onClick={event=>{
      const bounds=event.currentTarget.getBoundingClientRect();
      const at=start+clamp(((event.clientX-bounds.left)/bounds.width*width-left)/(right-left),0,1)*(end-start);
      const index=samples.reduce((best,sample,i)=>Math.abs(sample.second-at)<Math.abs(samples[best].second-at)?i:best,0);
      onSampleSelect(index);
    }}>
      {[1, 2, 3, 4, 5].map(value => <g key={value}><line className="grid" x1={left} y1={y(value)} x2={right} y2={y(value)} /><text x="15" y={y(value) + 4}>{value}</text></g>)}
      {callSamples.length > 0 && <rect x={x(callSamples[0].second)} y={top} width={Math.max(4, x(callSamples[callSamples.length - 1].second) - x(callSamples[0].second))} height={bottom - top} fill="#38c5ff" fillOpacity={.16} stroke="#38c5ff" strokeWidth={1}><title>선택 콜 CI {callSamples[0].ci}</title></rect>}
      {displayEpisodes.map(episode => <rect
        key={episode.id}
        className={`episode-zone ${episode.id === selectedEpisodeId ? 'active' : ''}`}
        x={x(samples[episode.startIndex].second)}
        y={top}
        width={Math.max(5, x(samples[episode.endIndex].second) - x(samples[episode.startIndex].second))}
        height={bottom - top}
        fill="var(--exec-red)"
        fillOpacity={episode.id === selectedEpisodeId ? 0.18 : 0.08}
        onClick={event => { event.stopPropagation(); onEpisodeSelect(episode.id); }}
      ><title>{episode.startTime}~{episode.endTime} · 최저 QoE {episode.minQoe.toFixed(2)}</title></rect>)}
      {showSignal && <path className="signal-path" d={path(bin => bin.signal)} />}
      <path className="mos-path" d={path(bin => bin.mos)} />
      <path className="qoe-path" d={samples.map((sample, index) => {
        const previous = samples[index - 1];
        const command = !previous || previous.callId !== sample.callId || sample.second - previous.second > 120 ? 'M' : 'L';
        return `${command}${x(sample.second).toFixed(1)},${y(sample.qoe).toFixed(1)}`;
      }).join(' ')} />
      {displayEpisodes.map(episode => {
        const sample = minimumByEpisode[episode.id];
        const active = episode.id === selectedEpisodeId;
        return <g key={episode.id} style={{ cursor: 'pointer' }} onClick={event => { event.stopPropagation(); onEpisodeSelect(episode.id); onSampleSelect(episode.minIndex); }}>
          <line x1={x(sample.second)} y1={top} x2={x(sample.second)} y2={y(sample.qoe)} stroke={active ? '#ff8ba2' : '#b3455f'} strokeWidth={active ? 1.2 : 0.8} strokeDasharray="3 2" />
          <circle cx={x(sample.second)} cy={y(sample.qoe)} r={active ? 6 : 4.5} fill="var(--exec-red)" stroke="#fff" strokeWidth={active ? 2.4 : 1.4} />
          <text x={x(sample.second)} y={y(sample.qoe) - 9} textAnchor="middle" fill="#ff8ba2" fontWeight={700}>{sample.qoe.toFixed(2)}</text>
        </g>;
      })}
      {selected && <g className="selected-time"><line x1={x(selected.second)} y1={top} x2={x(selected.second)} y2={bottom} /><circle cx={x(selected.second)} cy={y(selected.qoe)} r="5" /></g>}
      {ticks.map(second => <text className="time-tick" key={second} x={x(second)} y="202" textAnchor="middle">{fmt(second)}</text>)}
    </svg>
    {selected && <div className="exec-chart-tooltip"><b>{selected.time}</b><span>QoE <strong>{selected.qoe.toFixed(2)}</strong></span><span>MOS <strong>{selected.mos?.toFixed(2) ?? '-'}</strong></span><span>RSRP <strong>{selected.rsrp?.toFixed(1) ?? '-'} dBm</strong></span><span>SINR <strong>{selected.sinr?.toFixed(1) ?? '-'} dB</strong></span></div>}
  </div>;
}
