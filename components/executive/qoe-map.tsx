'use client';

import { useEffect, useRef, useState } from 'react';
import type { ExecutiveSample, PoorEpisode } from '@/lib/executive';
import 'leaflet/dist/leaflet.css';
import { groupMapCalls, mapMetrics, metricColor, type MapMetric } from '@/lib/executive/map-metrics';

interface Props {
  fixedLocation?: boolean;
  overviewRevision: number;
  apiKey: string;
  metric: MapMetric;
  selectedCallId: string | null;
  samples: ExecutiveSample[];
  episodes: PoorEpisode[];
  selectedEpisodeId: string | null;
  selectedSampleIndex: number | null;
  causeLabels: Record<string, string>;
  onEpisodeSelect: (episodeId: string) => void;
}

export const pointColor = (qoe: number) => qoe <= 3.5 ? '#ff365f' : qoe < 4 ? '#f2d447' : '#35c779';
const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);

export function ExecutiveQoeMap({ fixedLocation = false, overviewRevision, metric, apiKey, samples, episodes, selectedCallId, selectedEpisodeId, selectedSampleIndex, causeLabels, onEpisodeSelect }: Props) {
  const metricInfo = mapMetrics[metric];
  const colorFor = (sample: ExecutiveSample) => metricColor(sample[metric], metric);
  const valueLabel = (sample: ExecutiveSample) => `${metricInfo.label} ${sample[metric]?.toFixed(metric === 'qoe' ? 2 : 1) ?? '미측정'} ${metricInfo.unit}`;
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const tileRef = useRef<import('leaflet').TileLayer | null>(null);
  const layerRef = useRef<import('leaflet').LayerGroup | null>(null);
  const selectedMarkerRef = useRef<import('leaflet').CircleMarker | null>(null);
  const selectRef = useRef(onEpisodeSelect);
  const [ready, setReady] = useState(false);
  const [tileFailed, setTileFailed] = useState(false);
  useEffect(() => { selectRef.current = onEpisodeSelect; }, [onEpisodeSelect]);

  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    let active = true;
    void import('leaflet').then(L => {
      if (!active || !hostRef.current) return;
      const map = L.map(hostRef.current, { zoomControl: false, attributionControl: true, preferCanvas: true }).setView([37.5, 127], 12);
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      mapRef.current = map;
      const resizeObserver = new ResizeObserver(() => map.invalidateSize());
      resizeObserver.observe(hostRef.current);
      map.on('unload', () => resizeObserver.disconnect());
      layerRef.current = L.layerGroup().addTo(map);
      setReady(true);
    }).catch(() => setReady(false));
    return () => { active = false; mapRef.current?.remove(); mapRef.current = null; layerRef.current = null; };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    tileRef.current?.remove();
    tileRef.current = null;
    setTileFailed(false);
    if (!apiKey) return;
    void import('leaflet').then(L => {
      if (!mapRef.current) return;
      const tiles = L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${apiKey}/Satellite/{z}/{y}/{x}.jpeg`, { maxZoom: 19, attribution: '© VWorld 공간정보 오픈플랫폼' });
      tiles.on('tileerror', () => setTileFailed(true));
      tiles.on('load', () => setTileFailed(false));
      tiles.addTo(mapRef.current);
      tileRef.current = tiles;
    }).catch(() => setTileFailed(true));
  }, [apiKey, ready]);

  useEffect(() => {
    if (!ready || !mapRef.current || !layerRef.current) return;
    const map = mapRef.current;
    void import('leaflet').then(L => {
      if (!layerRef.current) return;
      layerRef.current.clearLayers();
      selectedMarkerRef.current = null;
      if (!samples.length) return;
      const renderer = L.canvas({ padding: .5 });
      const visible = samples;
      const callSamples = selectedCallId ? samples.filter(sample => sample.callId === selectedCallId) : [];
      const focused = callSamples.length > 0;

      if (fixedLocation) {
        const shown = focused ? callSamples : samples;
        const values = metric === 'qoe'
          ? groupMapCalls(shown).map(call => call[0].qoe)
          : selectedSampleIndex != null && samples[selectedSampleIndex] ? [samples[selectedSampleIndex][metric]] : shown.map(sample => sample[metric]);
        const valid = values.filter((v): v is number => v != null);
        const value = valid.length ? valid.reduce((sum, v) => sum + v, 0) / valid.length : null;
        const anchor = shown[0];
        L.circleMarker([anchor.lat, anchor.lon], { renderer, radius: 15, color: '#fff', weight: 3, fillColor: metricColor(value, metric), fillOpacity: 1 })
          .bindTooltip(`힐스테이트신용더리버아파트 · 지정 좌표<br/>${metricInfo.label} ${value?.toFixed(2) ?? '미측정'} ${metricInfo.unit} · ${metric === 'qoe' ? focused ? '선택 콜' : '콜 평균' : selectedSampleIndex != null ? '선택 이벤트' : '이벤트 평균'}`)
          .addTo(layerRef.current!);
      } else if (metric === 'qoe') {
        // One score, path and tooltip per CI call; GPS points only define its geometry.
        groupMapCalls(samples).forEach(call => {
          const first = call[0], last = call[call.length - 1];
          const tooltip = `CI ${escapeHtml(first.ci)} · ${first.time} ~ ${last.time} · ${valueLabel(first)} (콜 단위)`;
          const segments: [number, number][][] = [];
          call.forEach((sample, index) => {
            if (!index || sample.second - call[index - 1].second > 120) segments.push([]);
            segments[segments.length - 1].push([sample.lat, sample.lon]);
          });
          L.polyline(segments, { renderer, color: colorFor(first), weight: 4, opacity: .9 })
            .bindTooltip(tooltip).addTo(layerRef.current!);
          const anchor = call[Math.floor(call.length / 2)];
          L.circleMarker([anchor.lat, anchor.lon], { renderer, radius: first.callId === selectedCallId ? 8 : 5, color: '#fff', weight: 1, fillColor: colorFor(first), fillOpacity: 1 })
            .bindTooltip(tooltip).addTo(layerRef.current!);
        });
      } else {
        visible.forEach((sample, index) => {
          const previous = visible[index - 1];
          if (previous && previous.callId === sample.callId && sample.second - previous.second <= 120) {
            L.polyline([[previous.lat, previous.lon], [sample.lat, sample.lon]], {
              renderer, color: colorFor(sample), weight: 3.1, opacity: .88,
            }).addTo(layerRef.current!);
          }
          L.circleMarker([sample.lat, sample.lon], { renderer, radius: 3, color: colorFor(sample), weight: .5, fillColor: colorFor(sample), fillOpacity: 1 })
            .bindTooltip(`${sample.time} · ${valueLabel(sample)}`).addTo(layerRef.current!);
        });
      }

      if (focused && !fixedLocation) {
        callSamples.forEach((sample, index) => {
          const previous = callSamples[index - 1];
          if (previous && sample.second - previous.second <= 120) {
            const segment: [number, number][] = [[previous.lat, previous.lon], [sample.lat, sample.lon]];
            L.polyline(segment, { renderer, color: '#07131f', weight: 15, opacity: .9 }).addTo(layerRef.current!);
            L.polyline(segment, { renderer, color: colorFor(sample), weight: 10, opacity: 1 }).addTo(layerRef.current!);
          }
          if (metric !== 'qoe') L.circleMarker([sample.lat, sample.lon], { renderer, radius: 7, color: '#ffffff', weight: 1.5, fillColor: colorFor(sample), fillOpacity: 1 })
            .bindTooltip(`CI ${escapeHtml(sample.ci)} · ${sample.time} · ${valueLabel(sample)}`)
            .addTo(layerRef.current!);
        });
      }

      if (!fixedLocation && metric !== 'qoe' && selectedSampleIndex != null && samples[selectedSampleIndex]) {
        const sample = samples[selectedSampleIndex];
        const marker = L.circleMarker([sample.lat, sample.lon], { renderer, radius: 6, color: '#38c5ff', weight: 3, fillColor: '#07131f', fillOpacity: 1 });
        marker.bindTooltip(`${sample.time} · QoE ${sample.qoe.toFixed(2)}`, { permanent: false, direction: 'top' });
        marker.addTo(layerRef.current!);
        selectedMarkerRef.current = marker;
      }

      const bounds = L.latLngBounds(visible.map(sample => [sample.lat, sample.lon] as [number, number]));
      if (bounds.isValid()) {
        const overviewZoom = Math.min(17, map.getBoundsZoom(bounds, false, L.point(44, 44)));
        if (focused) {
          const callBounds = L.latLngBounds(callSamples.map(sample => [sample.lat, sample.lon] as [number, number]));
          // Keep surrounding routes visible while making the selected call easier to inspect.
          const callZoom = map.getBoundsZoom(callBounds, false, L.point(130, 130));
          map.setView(callBounds.getCenter(), Math.min(overviewZoom + 2, callZoom, 18), { animate: false });
        } else {
          map.fitBounds(bounds, { padding: [22, 22], maxZoom: 17, animate: false });
        }
      }
      if (!focused && selectedSampleIndex != null && samples[selectedSampleIndex]) {
        const sample = samples[selectedSampleIndex];
        map.panTo([sample.lat, sample.lon], { animate: false });
      }
    }).catch(() => undefined);
  }, [fixedLocation, overviewRevision, metric, samples, episodes, selectedCallId, selectedEpisodeId, selectedSampleIndex, causeLabels, ready]);

  useEffect(() => {
    if (selectedCallId || !mapRef.current || selectedSampleIndex == null || !samples[selectedSampleIndex]) return;
    const sample = samples[selectedSampleIndex];
    mapRef.current.panTo([sample.lat, sample.lon], { animate: true, duration: .35 });
    selectedMarkerRef.current?.openTooltip();
  }, [selectedSampleIndex, samples, selectedCallId]);

  return <div className="exec-map-stage">
    <div ref={hostRef} className="exec-vworld-map" />
    {fixedLocation && <div className="exec-map-status" style={{ left: 8, right: 'auto', maxWidth: '75%' }}>MDT · 지정 좌표 35.2123, 126.8647 · 실제 이동 경로 아님</div>}
    {!samples.length && <div className="exec-empty map"><b>표시할 측정 경로가 없습니다.</b><span>고객, 일자 또는 지역 필터를 변경해 주세요.</span></div>}
    {!apiKey && <div className="exec-map-status">VWorld 키 없음 · 측정 경로만 표시</div>}
    {tileFailed && <div className="exec-map-status error">VWorld 지도 연결 확인 필요</div>}
    <div className="exec-map-legend" style={{ width: 235 }}>
      <b>{metricInfo.label} · {metric === 'qoe' ? fixedLocation ? '콜별 무선 추정' : '콜 단위' : fixedLocation ? 'MDT 이벤트' : '초 단위 실측'}{selectedCallId ? ' · 선택 콜 강조' : ''}</b>
      <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
        {['#ff365f', '#f2d447', '#35c779', ...(metric === 'qoe' ? [] : ['#8896a3'])].map((color, index) =>
          <div key={color} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}><span style={{ width: 18, height: 8, borderRadius: 2, background: color }} />{metricInfo.legends[index] ?? '미측정'}</div>)}
      </div>
    </div>
  </div>;
}
