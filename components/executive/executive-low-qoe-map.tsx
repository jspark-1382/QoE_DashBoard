'use client';

import { useEffect, useRef, useState } from 'react';
import type { ExecutiveSample } from '@/lib/executive';
import { LOW_QOE_LANDING_MAX } from '@/lib/executive';
import 'leaflet/dist/leaflet.css';

// ~60m grid so a 100k+ point landing view stays interactive; each cell collapses to one severity dot.
const GRID_LAT = 0.00055;
const GRID_LON = 0.0007;

type Cell = { lat: number; lon: number; count: number; qoeSum: number; worst: ExecutiveSample; worstIndex: number; owners: Set<string>; calls: Set<string> };

const severityColor = (qoe: number) => qoe <= 1 ? '#b3123f' : qoe <= 1.75 ? '#e5174c' : qoe <= 2.5 ? '#ff5470' : '#ff8d5c';
const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);

function aggregate(samples: ExecutiveSample[]): Cell[] {
  const cells = new Map<string, Cell>();
  samples.forEach((sample, index) => {
    const key = `${Math.round(sample.lat / GRID_LAT)},${Math.round(sample.lon / GRID_LON)}`;
    const cell = cells.get(key);
    if (!cell) {
      const owners = new Set<string>(); if (sample.ownerId) owners.add(sample.ownerId);
      const calls = new Set<string>(); calls.add(sample.callId);
      cells.set(key, { lat: sample.lat, lon: sample.lon, count: 1, qoeSum: sample.qoe, worst: sample, worstIndex: index, owners, calls });
    } else {
      cell.count += 1; cell.qoeSum += sample.qoe;
      if (sample.qoe < cell.worst.qoe) cell.worst = sample, cell.worstIndex = index;
      if (sample.ownerId) cell.owners.add(sample.ownerId);
      cell.calls.add(sample.callId);
    }
  });
  return [...cells.values()];
}

export function ExecutiveLowQoeMap({ samples, apiKey, onSelectSample }: {
  samples: ExecutiveSample[]; apiKey: string; onSelectSample: (index: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const layerRef = useRef<import('leaflet').LayerGroup | null>(null);
  const selectRef = useRef(onSelectSample);
  const [ready, setReady] = useState(false);
  const [tileFailed, setTileFailed] = useState(false);
  useEffect(() => { selectRef.current = onSelectSample; }, [onSelectSample]);

  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    let active = true;
    void import('leaflet').then(L => {
      if (!active || !hostRef.current) return;
      const map = L.map(hostRef.current, { zoomControl: false, attributionControl: true, preferCanvas: true }).setView([37.47, 127.05], 13);
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      mapRef.current = map;
      const resizeObserver = new ResizeObserver(() => map.invalidateSize());
      resizeObserver.observe(hostRef.current);
      map.on('unload', () => resizeObserver.disconnect());
      layerRef.current = L.layerGroup().addTo(map);
      if (apiKey) L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${apiKey}/Satellite/{z}/{y}/{x}.jpeg`, { maxZoom: 19, attribution: '© VWorld 공간정보 오픈플랫폼' })
        .on('tileerror', () => setTileFailed(true)).addTo(map);
      setReady(true);
    }).catch(() => setReady(false));
    return () => { active = false; mapRef.current?.remove(); mapRef.current = null; layerRef.current = null; };
  }, [apiKey]);

  useEffect(() => {
    if (!ready || !mapRef.current || !layerRef.current) return;
    const map = mapRef.current;
    let disposed = false;
    void import('leaflet').then(L => {
      if (disposed) return;
      layerRef.current?.clearLayers();
      const cells = aggregate(samples);
      const canvas = L.canvas();
      for (const cell of cells) {
        const average = cell.qoeSum / cell.count;
        L.circleMarker([cell.lat, cell.lon], { renderer: canvas, radius: Math.min(14, 4 + Math.sqrt(cell.count) * .7), color: severityColor(average), weight: 0, fillColor: severityColor(average), fillOpacity: .8 })
          .bindTooltip(`관측 ${cell.count}건 · 평균 QoE ${average.toFixed(2)} · 최저 ${cell.worst.qoe.toFixed(2)} · 계약 ${cell.owners.size} · 콜 ${cell.calls.size}<br/>클릭 시 최악 콜의 고객·그날 전제 데이터로`, { direction: 'top' })
          .on('click', () => selectRef.current(cell.worstIndex))
          .addTo(layerRef.current!);
      }
      if (cells.length) map.fitBounds(L.latLngBounds(cells.map(cell => [cell.lat, cell.lon] as [number, number])), { padding: [60, 60], maxZoom: 14, animate: false });
    }).catch(() => undefined);
    return () => { disposed = true; };
  }, [ready, samples]);

  const owners = new Set(samples.map(sample => sample.ownerId).filter(Boolean) as string[]);
  const calls = new Set(samples.map(sample => sample.callId));
  return <div className="exec-map-stage">
    <div ref={hostRef} className="exec-vworld-map" />
    {!apiKey && <div className="exec-map-status">VWorld 키 없음 · 저QoE 점만 표시</div>}
    {tileFailed && <div className="exec-map-status error">VWorld 지도 연결 확인 필요</div>}
    <div className="exec-map-legend" style={{ width: 250 }}>
      <b>전체 고객 저QoE 지도 · QoE {LOW_QOE_LANDING_MAX.toFixed(1)} 이하</b>
      <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
        {[['#b3123f', '평균 QoE ≤ 1.00 (최악)'], ['#e5174c', '≤ 1.75'], ['#ff5470', '≤ 2.50'], ['#ff8d5c', '≤ 3.00']].map(([color, label]) =>
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}><span style={{ width: 18, height: 8, borderRadius: 2, background: color }} />{label}</div>)}
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: '#9db6c6' }}>점 크기 = 관측 밀도(60m 격자) · 점 클릭 → 해당 고객 선택 + 그날 전체 표시 · 대상 {samples.length.toLocaleString ? samples.length.toLocaleString() : samples.length}건 / 계약 {owners.size.toLocaleString()} / 콜 {calls.size.toLocaleString()}</div>
    </div>
  </div>;
}

// Hourly load of the low-QoE set for the landing view (the per-sample chart is too dense here).
export function LowQoeHourChart({ samples }: { samples: ExecutiveSample[] }) {
  const buckets = Array.from({ length: 24 }, () => ({ count: 0, qoeSum: 0 }));
  for (const sample of samples) {
    const hour = Number(sample.time.slice(0, 2));
    if (Number.isInteger(hour) && hour >= 0 && hour < 24) { buckets[hour].count += 1; buckets[hour].qoeSum += sample.qoe; }
  }
  const max = Math.max(1, ...buckets.map(bucket => bucket.count));
  return <div className="exec-all-hour-chart" role="img" aria-label="시간대별 저QoE 관측 분포">
    <svg viewBox="0 0 240 96" preserveAspectRatio="none" style={{ width: '100%', height: 130 }}>
      {buckets.map((bucket, hour) => bucket.count ? <rect key={hour} x={hour * 10 + 1} y={78 - bucket.count / max * 72} width={8} height={bucket.count / max * 72} rx={1} fill="#ff5470" opacity={.9}>
        <title>{`${String(hour).padStart(2, '0')}시 · ${bucket.count.toLocaleString()}건 · 평균 QoE ${(bucket.qoeSum / bucket.count).toFixed(2)}`}</title>
      </rect> : null)}
      {[0, 6, 12, 18, 23].map(hour => <text key={hour} x={hour * 10 + 5} y={90} fontSize={6} fill="#8faabb" textAnchor="middle">{`${hour}시`}</text>)}
    </svg>
    <p className="exec-call-note">전체 고객 저QoE(QoE 3.0 이하) 관측의 시간대 분포 · 지도에서 점을 눌러 고객으로 이동</p>
  </div>;
}
