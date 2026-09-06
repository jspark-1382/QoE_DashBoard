'use client';

import { useEffect, useRef, useState } from 'react';
import type { ExecutiveSample, PoorEpisode } from '@/lib/executive';
import 'leaflet/dist/leaflet.css';

interface Props {
  apiKey: string;
  samples: ExecutiveSample[];
  episodes: PoorEpisode[];
  selectedEpisodeId: string | null;
  selectedSampleIndex: number | null;
  causeLabels: Record<string, string>;
  onEpisodeSelect: (episodeId: string) => void;
}

const pointColor = (qoe: number) => qoe < 2 ? '#ff365f' : qoe < 2.5 ? '#ff8d32' : qoe < 3.5 ? '#f2d447' : qoe < 4.5 ? '#8edb63' : '#35c779';
const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);

export function ExecutiveQoeMap({ apiKey, samples, episodes, selectedEpisodeId, selectedSampleIndex, causeLabels, onEpisodeSelect }: Props) {
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
      const step = Math.max(1, Math.ceil(samples.length / 850));
      const visible = samples.filter((_, index) => index % step === 0 || index === samples.length - 1);

      for (let index = 1; index < visible.length; index += 1) {
        const previous = visible[index - 1];
        const sample = visible[index];
        if (sample.second - previous.second > 120) continue;
        L.polyline([[previous.lat, previous.lon], [sample.lat, sample.lon]], {
          renderer, color: pointColor(sample.qoe), weight: 3.1, opacity: .88,
        }).addTo(layerRef.current);
      }
      visible.filter((_, index) => index % 4 === 0).forEach(sample => {
        L.circleMarker([sample.lat, sample.lon], { renderer, radius: 2.6, color: '#eaf9ff', weight: .7, fillColor: pointColor(sample.qoe), fillOpacity: 1 }).addTo(layerRef.current!);
      });

      const displayEpisodes = [...episodes].sort((a, b) => a.minQoe - b.minQoe || b.durationSeconds - a.durationSeconds)
        .filter((episode, index) => index < 20 || episode.id === selectedEpisodeId);
      displayEpisodes.forEach(episode => {
        const path = samples.slice(episode.startIndex, episode.endIndex + 1).map(sample => [sample.lat, sample.lon] as [number, number]);
        if (!path.length) return;
        const selected = episode.id === selectedEpisodeId;
        if (path.length > 1) L.polyline(path, { renderer, color: selected ? '#ffffff' : '#ff365f', weight: selected ? 8 : 5, opacity: selected ? .94 : .7 }).addTo(layerRef.current!);
        const sample = samples[episode.minIndex];
        const marker = L.marker([sample.lat, sample.lon], { icon: L.divIcon({
          className: `exec-episode-marker ${selected ? 'selected' : ''}`,
          html: `<button type="button" aria-label="${escapeHtml(`${episode.startTime} QoE 저하 Episode`)}"><span>!</span></button>`,
          iconSize: [24, 24], iconAnchor: [12, 12],
        }) });
        marker.bindPopup(`<div class="exec-map-popup"><b>QoE 저하 구간</b><strong>QoE ${sample.qoe.toFixed(2)}</strong><span>${episode.startTime} ~ ${episode.endTime}</span><span>PCI ${episode.primaryPci}</span><em>${escapeHtml(causeLabels[episode.id] ?? 'Rule 근거 부족')}</em></div>`);
        marker.on('click', () => selectRef.current(episode.id));
        marker.addTo(layerRef.current!);
        if (selected) marker.openPopup();
      });

      if (selectedSampleIndex != null && samples[selectedSampleIndex]) {
        const sample = samples[selectedSampleIndex];
        const marker = L.circleMarker([sample.lat, sample.lon], { renderer, radius: 6, color: '#38c5ff', weight: 3, fillColor: '#07131f', fillOpacity: 1 });
        marker.bindTooltip(`${sample.time} · QoE ${sample.qoe.toFixed(2)}`, { permanent: false, direction: 'top' });
        marker.addTo(layerRef.current!);
        selectedMarkerRef.current = marker;
      }

      const bounds = L.latLngBounds(visible.map(sample => [sample.lat, sample.lon] as [number, number]));
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [22, 22], maxZoom: 17, animate: false });
      if (selectedSampleIndex != null && samples[selectedSampleIndex]) {
        const sample = samples[selectedSampleIndex];
        map.panTo([sample.lat, sample.lon], { animate: false });
      }
    }).catch(() => undefined);
  }, [samples, episodes, selectedEpisodeId, selectedSampleIndex, causeLabels, ready]);

  useEffect(() => {
    if (!mapRef.current || selectedSampleIndex == null || !samples[selectedSampleIndex]) return;
    const sample = samples[selectedSampleIndex];
    mapRef.current.panTo([sample.lat, sample.lon], { animate: true, duration: .35 });
    selectedMarkerRef.current?.openTooltip();
  }, [selectedSampleIndex, samples]);

  return <div className="exec-map-stage">
    <div ref={hostRef} className="exec-vworld-map" />
    {!samples.length && <div className="exec-empty map"><b>표시할 측정 경로가 없습니다.</b><span>고객, 일자 또는 지역 필터를 변경해 주세요.</span></div>}
    {!apiKey && <div className="exec-map-status">VWorld 키 없음 · 측정 경로만 표시</div>}
    {tileFailed && <div className="exec-map-status error">VWorld 지도 연결 확인 필요</div>}
    <div className="exec-map-legend"><b>QoE 수준</b><i /><span><em>1.0 매우 열악</em><em>2.5 열악 기준</em><em>5.0 매우 양호</em></span></div>
  </div>;
}
