'use client';
import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, LayerGroup, SVG, Canvas } from 'leaflet';
import type { BaseStation } from '../../lib/location-estimation/types';
import type {
  AnalystSample,
  OverviewCellRow,
  AnalystSource,
} from '../../lib/analyst/types';
import {
  metricColor,
  visiblePoints,
  splitTracks,
  overviewRateColor,
  type AnalystMetric,
} from '../../lib/analyst/map';
import { locationLabels } from '../../lib/analyst/data';
import 'leaflet/dist/leaflet.css';
import styles from './analyst-map.module.css';
interface Props {
  samples?: AnalystSample[];
  cells?: OverviewCellRow[];
  selectedIndex?: number | null;
  selectedCellId?: string | null;
  onSampleSelect?: (index: number) => void;
  onCellSelect?: (id: string) => void;
  stations?: BaseStation[];
  metric?: AnalystMetric;
  showGnss?: boolean;
  showEstimates?: boolean;
  showStations?: boolean;
  focusKey?: string;
  source?: AnalystSource;
  threshold?: number;
  focusTarget?: { key: string; lat: number; lon: number } | null;
}
const EMPTY_SAMPLES: AnalystSample[] = [],
  EMPTY_CELLS: OverviewCellRow[] = [],
  EMPTY_STATIONS: BaseStation[] = [];
const views = new Map<string, { center: [number, number]; zoom: number }>();
const esc = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
export function AnalystMap({
  samples = EMPTY_SAMPLES,
  cells = EMPTY_CELLS,
  stations = EMPTY_STATIONS,
  selectedIndex,
  selectedCellId,
  onSampleSelect,
  onCellSelect,
  metric = 'rsrp',
  showGnss = true,
  showEstimates = true,
  showStations = false,
  focusKey = 'map',
  source = 'MDT',
  threshold = 2.5,
  focusTarget,
}: Props) {
  const host = useRef<HTMLDivElement>(null),
    instance = useRef<LeafletMap | null>(null),
    group = useRef<LayerGroup | null>(null),
    fitKey = useRef('');
  const renderers = useRef<{ svg: SVG; canvas: Canvas } | null>(null);
  const appliedFocus = useRef('');
  const [map, setMap] = useState<LeafletMap | null>(null),
    [error, setError] = useState('');
  const keyRef = useRef(focusKey);
  useEffect(() => {
    keyRef.current = focusKey;
  }, [focusKey]);
  useEffect(() => {
    let current = true;
    void import('leaflet')
      .then((L) => {
        if (!current || !host.current) return;
        const m = L.map(host.current, {
          zoomControl: false,
          preferCanvas: true,
        }).setView([37.48, 127.05], 13);
        instance.current = m;
        renderers.current = { svg: L.svg(), canvas: L.canvas() };
        L.control.zoom({ position: 'bottomright' }).addTo(m);
        const key = (
          import.meta as ImportMeta & { env: { VITE_VWORLD_API_KEY?: string } }
        ).env.VITE_VWORLD_API_KEY?.trim();
        if (key) {
          const tiles = L.tileLayer(
            `https://api.vworld.kr/req/wmts/1.0.0/${key}/Base/{z}/{y}/{x}.png`,
            { maxZoom: 19, attribution: '© VWorld 공간정보 오픈플랫폼' },
          );
          tiles.on('tileerror', () => {
            if (current)
              setError(
                '배경 지도 연결을 확인하세요. 관측 위치는 계속 표시됩니다.',
              );
          });
          tiles.addTo(m);
        } else setError('배경 지도 키 미설정 · 관측 위치만 표시');
        const resize = new ResizeObserver(() => m.invalidateSize());
        resize.observe(host.current);
        m.on('moveend', () => {
          if (!current) return;
          const c = m.getCenter();
          views.set(keyRef.current, {
            center: [c.lat, c.lng],
            zoom: m.getZoom(),
          });
        });
        m.on('unload', () => resize.disconnect());
        setMap(m);
      })
      .catch(() => {
        if (current) setError('지도를 불러오지 못했습니다.');
      });
    return () => {
      current = false;
      instance.current?.remove();
      instance.current = null;
      renderers.current = null;
    };
  }, []);
  useEffect(() => {
    if (!map) return;
    let current = true;
    void import('leaflet').then((L) => {
      if (!current) return;
      group.current?.remove();
      const layer = L.layerGroup().addTo(map);
      group.current = layer;
      const bounds: [number, number][] = [],
        points = visiblePoints(samples, showGnss, showEstimates);
      const svg = renderers.current!.svg,
        canvas = renderers.current!.canvas;
      for (const cell of cells) {
        if (!Number.isFinite(cell.lat) || !Number.isFinite(cell.lon)) continue;
        bounds.push([cell.lat, cell.lon]);
        L.circleMarker([cell.lat, cell.lon], {
          renderer: canvas,
          radius: Math.min(18, cell.poor ? 4 + Math.sqrt(cell.poor) * 1.2 : 2),
          color:
            cell.id === selectedCellId
              ? '#2459a6'
              : overviewRateColor(cell.poorRate),
          weight: cell.id === selectedCellId ? 4 : 1,
          fillColor: overviewRateColor(cell.poorRate),
          fillOpacity: cell.poor ? 0.82 : 0.22,
        })
          .bindTooltip(
            `${esc(cell.label)}<br/>저품질 ${cell.poor} / 평가 ${cell.evaluated}통화 · ${cell.poorRate == null ? '평가 불가' : cell.poorRate.toFixed(1) + '%'}<br/>영향 계약 ${cell.affectedCustomers}개`,
          )
          .on('click', () => onCellSelect?.(cell.id))
          .addTo(layer);
      }
      for (const track of splitTracks(samples)) {
        if (!showGnss || track.length < 2) continue;
        L.polyline(
          track.map((s) => [s.lat!, s.lon!] as [number, number]),
          { color: '#63788a', weight: 1.5, opacity: 0.55 },
        )
          .bindTooltip(
            'GNSS·실측 관측 연결 · 공백/이상 이동 구간은 연결하지 않음',
          )
          .addTo(layer);
      }
      for (const s of points) {
        const point: [number, number] = [s.lat!, s.lon!];
        bounds.push(point);
        const selected = s.index === selectedIndex,
          color = metricColor(s[metric], metric, threshold),
          estimate = ['radio', 'interpolated'].includes(s.locationSource);
        const label = `${locationLabels[s.locationSource]} ${s.time} · 표본 ${s.index}`;
        const html = `<b>${esc(locationLabels[s.locationSource])} · ${esc(s.time)}</b><br/>${s.lat!.toFixed(6)}, ${s.lon!.toFixed(6)}<br/>RSRP ${s.rsrp ?? '미제공'} dBm · SINR ${s.sinr ?? '미제공'} dB<br/>${estimate ? '위치 후보 · 정확도 검증값 아님' : '원본 관측 · 측정 정확도 정보 없음'}`;
        const marker = estimate
          ? L.marker(point, {
              icon: L.divIcon({
                className: styles.diamondIcon,
                html: `<span style="background:${color};outline:${selected ? '3px solid #2459a6' : '1px solid #fff'}"></span>`,
                iconSize: [14, 14],
                iconAnchor: [7, 7],
              }),
            })
          : L.circleMarker(point, {
              renderer: svg,
              radius: selected ? 9 : 4.5,
              color: selected ? '#2459a6' : color,
              weight: selected ? 3 : 1.5,
              fillColor: color,
              fillOpacity: 0.85,
            });
        marker
          .bindTooltip(label)
          .bindPopup(html)
          .on('click', () => onSampleSelect?.(s.index))
          .addTo(layer);
        marker.getElement()?.setAttribute('aria-label', label);
      }
      if (showStations) {
        const seen = new Set<string>();
        for (const station of stations) {
          const id = `${station.latitude}/${station.longitude}`;
          if (seen.has(id)) continue;
          seen.add(id);
          bounds.push([station.latitude, station.longitude]);
          L.marker([station.latitude, station.longitude], {
            icon: L.divIcon({
              className: styles.stationIcon,
              html: '△',
              iconSize: [20, 20],
              iconAnchor: [10, 10],
            }),
          })
            .bindPopup(
              `<b>기지국 좌표</b><br/>${esc(station.baseStationId)}<br/>고객 위치와 구분 · 위치 출처/기준일 별도 확인`,
            )
            .addTo(layer);
        }
      }
      if (fitKey.current !== focusKey) {
        fitKey.current = focusKey;
        const saved = views.get(focusKey);
        if (saved) map.setView(saved.center, saved.zoom, { animate: false });
        else if (bounds.length)
          map.fitBounds(L.latLngBounds(bounds), {
            padding: [28, 28],
            maxZoom: 15,
            animate: false,
          });
      }
      if (
        focusTarget &&
        Number.isFinite(focusTarget.lat) &&
        Number.isFinite(focusTarget.lon) &&
        Math.abs(focusTarget.lat) <= 90 &&
        Math.abs(focusTarget.lon) <= 180
      ) {
        const stamp = `${focusKey}:${focusTarget.key}`;
        if (appliedFocus.current !== stamp) {
          appliedFocus.current = stamp;
          map.setView([focusTarget.lat, focusTarget.lon], 16, {
            animate: false,
          });
        }
      }
    });
    return () => {
      current = false;
    };
  }, [
    map,
    samples,
    cells,
    stations,
    metric,
    threshold,
    showGnss,
    showEstimates,
    showStations,
    selectedIndex,
    selectedCellId,
    focusKey,
    onSampleSelect,
    onCellSelect,
    focusTarget,
  ]);
  const selectedPoint = visiblePoints(samples, showGnss, showEstimates).find(
    (sample) => sample.index === selectedIndex,
  );
  const selectedCell = cells.find((cell) => cell.id === selectedCellId);
  const selectedLocation = selectedPoint
    ? { lat: selectedPoint.lat!, lon: selectedPoint.lon! }
    : selectedCell;
  return (
    <div className={styles.container} data-source={source}>
      <div
        ref={host}
        className={styles.map}
        aria-label={
          cells.length ? '전체 지역 품질 지도' : '선택 통화 위치 지도'
        }
      />
      {error && <span className={styles.notice}>{error}</span>}
      {!cells.length &&
        !visiblePoints(samples, showGnss, showEstimates).length && (
          <span className={styles.empty}>
            {samples.length
              ? '현재 레이어에서 표시할 고객 위치가 없습니다.'
              : '표시할 고객 위치가 없습니다.'}
          </span>
        )}
      <div className={styles.controls}>
        {selectedLocation && (
          <button
            className={styles.fit}
            type="button"
            onClick={() => {
              instance.current?.setView(
                [selectedLocation.lat, selectedLocation.lon],
                16,
                { animate: false },
              );
            }}
            aria-label={
              selectedPoint
                ? '선택 관측 위치로 지도 이동'
                : '선택 구역으로 지도 이동'
            }
          >
            {selectedPoint ? '선택 관측 보기' : '선택 구역 보기'}
          </button>
        )}
        <button
          className={styles.fit}
          type="button"
          onClick={() => {
            const m = instance.current;
            if (!m) return;
            const p: [number, number][] = cells
              .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon))
              .map((c) => [c.lat, c.lon]);
            visiblePoints(samples, showGnss, showEstimates).forEach((s) =>
              p.push([s.lat!, s.lon!]),
            );
            if (p.length)
              m.fitBounds(p, {
                padding: [28, 28],
                maxZoom: 15,
                animate: false,
              });
          }}
          aria-label="현재 위치 범위로 지도 맞추기"
        >
          전체 범위
        </button>
      </div>
    </div>
  );
}
