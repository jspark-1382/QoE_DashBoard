'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';
import type { CandidateEvidenceTarget } from '../../lib/analyst/candidate-ai-analysis';
import 'leaflet/dist/leaflet.css';
import styles from './candidate-ai-analysis.module.css';

/** Only measured source positions are plotted; no inferred serving-cell/site assignment. */
export function CandidateTargetMap({
  target,
}: {
  target: CandidateEvidenceTarget;
}) {
  const host = useRef<HTMLElement>(null);
  const live = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const [map, setMap] = useState<LeafletMap | null>(null);
  const [notice, setNotice] = useState('');
  const points = useMemo(
    () =>
      target.mapPoints.filter(
        (p) =>
          Number.isFinite(p.lat) &&
          Number.isFinite(p.lon) &&
          Math.abs(p.lat) <= 90 &&
          Math.abs(p.lon) <= 180,
      ),
    [target.mapPoints],
  );

  useEffect(() => {
    let current = true;
    let watcher: ResizeObserver | undefined;
    void import('leaflet')
      .then((L) => {
        if (!current || !host.current) return;
        const initialized = L.map(host.current, {
          preferCanvas: false,
          scrollWheelZoom: false,
          zoomControl: true,
        }).setView([37.483, 127.057], 15);
        live.current = initialized;
        const key = (
          import.meta as ImportMeta & { env: { VITE_VWORLD_API_KEY?: string } }
        ).env.VITE_VWORLD_API_KEY?.trim();
        if (key) {
          const tiles = L.tileLayer(
            'https://api.vworld.kr/req/wmts/1.0.0/' +
              key +
              '/Base/{z}/{y}/{x}.png',
            { maxZoom: 19, attribution: '© VWorld 공간정보 오픈플랫폼' },
          );
          tiles.on('tileerror', () => {
            if (current)
              setNotice(
                '배경지도 불러오기 실패 · 실제 POT 위치는 계속 표시됩니다.',
              );
          });
          tiles.addTo(initialized);
        } else
          setNotice('배경지도 키 미설정 · 실제 POT 위치는 계속 표시됩니다.');
        watcher = new ResizeObserver(() => {
          if (current) initialized.invalidateSize();
        });
        watcher.observe(host.current);
        setMap(initialized);
      })
      .catch(() => {
        if (current)
          setNotice('지도 표시 실패 · 아래 POT 좌표에서 위치를 확인하세요.');
      });
    return () => {
      current = false;
      watcher?.disconnect();
      layer.current?.remove();
      layer.current = null;
      live.current?.remove();
      live.current = null;
    };
  }, []);

  useEffect(() => {
    if (!map) return;
    let current = true;
    void import('leaflet')
      .then((L) => {
        if (!current) return;
        const next = L.layerGroup().addTo(map);
        layer.current = next;
        for (const point of points) {
          const label = document.createElement('div');
          label.textContent =
            'POT ' + point.pot + ' · ' + point.band + ' · ' + point.date;
          const marker = L.circleMarker([point.lat, point.lon], {
            radius: 7,
            color: '#fff',
            weight: 2,
            fillColor: '#167f80',
            fillOpacity: 1,
          }).addTo(next);
          marker.bindTooltip(label, { direction: 'top' });
          marker.getElement()?.setAttribute('data-target-pot', point.pot);
        }
        if (points.length)
          map.fitBounds(
            L.latLngBounds(
              points.map((p) => [p.lat, p.lon] as [number, number]),
            ),
            { padding: [36, 36], maxZoom: 17, animate: false },
          );
        map.invalidateSize();
      })
      .catch(() => {
        if (current) setNotice('POT 표시 실패 · 아래 좌표에서 확인하세요.');
      });
    return () => {
      current = false;
      layer.current?.remove();
      layer.current = null;
    };
    // Source targets are immutable snapshots; switching targets never recreates the main map.
  }, [map, points]);

  return (
    <div className={styles.targetMapBlock} data-target-id={target.id}>
      <section
        className={styles.targetMap}
        ref={host}
        aria-label="분석 대상 실제 POT 위치 지도"
      />
      {notice && <output className={styles.scopeNote}>{notice}</output>}
      <p className={styles.scopeNote}>
        실제 POT 위치 · 25m는 원본 격자 해상도입니다. 통화 저하 위치의 정확도나
        책임 기지국을 뜻하지 않습니다.
      </p>
      <details className={styles.potCoordinates}>
        <summary>POT 좌표·대역·측정일 {points.length}개 확인</summary>
        <ul>
          {points.map((p, i) => (
            <li key={i}>
              POT {p.pot} · {p.band} · {p.date} · {p.lat.toFixed(6)},{' '}
              {p.lon.toFixed(6)}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
