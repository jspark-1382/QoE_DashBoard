'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { LayerGroup, Map as LeafletMap } from 'leaflet';
import type { CandidatePotContext } from '../../lib/analyst/candidate-pot-context';
import { layoutCandidateCallouts } from '../../lib/analyst/candidate-map-callouts';
import {
  grid25mCorners,
  grid25mRsrpColor,
  type Mdt25mAnalysis,
  type Mdt25mCell,
  type MdtGridMode,
} from '../../lib/analyst/mdt-25m-grid';
import 'leaflet/dist/leaflet.css';
import styles from './candidate-investigation-map.module.css';

export interface CandidateInvestigationPoint {
  pot: string;
  lat: number;
  lon: number;
  band: string;
  date: string;
  earfcn?: string | null;
  samples?: number | null;
  percent?: number | null;
  metricLabel?: string;
  direction?: string;
  distanceM?: number;
}

export interface CandidateInvestigationMapProps {
  context: CandidatePotContext;
  selectedPot: string;
  primaryPot?: string;
  band: MdtGridMode;
  date: string;
  showPots: boolean;
  showStations: boolean;
  suspectPots?: string[];
  investigationPoints?: CandidateInvestigationPoint[];
  focusPoint?: CandidateInvestigationPoint;
  comparisonPot?: string;
  comparisonPoints?: CandidateInvestigationPoint[];
  earfcn?: string;
  weakSignalRatio?: boolean;
  thresholdDbm?: number;
  onSelectPot: (pot: string) => void;
  onSelectStation?: (id: string) => void;
  selectedStation?: string;
  selectablePotIds?: string[];
}

const emptyPoints: CandidateInvestigationPoint[] = [];
const emptyIds: string[] = [];
const bandOrder = ['900', '1.8협', '1.8광', '2.1'];
const validPoint = (point: { lat: number; lon: number }) =>
  Number.isFinite(point.lat) &&
  Number.isFinite(point.lon) &&
  Math.abs(point.lat) <= 90 &&
  Math.abs(point.lon) <= 180;
const number = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value) ? '미확보' : value.toFixed(digits);
const ratioScale = [
  { below: 1, color: '#eff3ff', label: '<1%' }, { below: 10, color: '#dce4ff', label: '1–10%' },
  { below: 25, color: '#b5c7fc', label: '10–25%' }, { below: 45, color: '#899ff0', label: '25–45%' },
  { below: Infinity, color: '#5f7fe1', label: '≥45%' },
];

/** No cross-date averaging: every polygon uses the chosen date and frequency. */
function datedMetric(
  cell: Mdt25mCell,
  band: MdtGridMode,
  date: string,
  earfcn?: string,
): Mdt25mAnalysis | null {
  if (band === 'hidden') return null;
  const rows = (cell.analysis ?? []).filter(
    (row) =>
      row.date === date &&
      (!earfcn || row.earfcn === earfcn) &&
      row.samples > 0 &&
      Number.isFinite(row.rsrpMean),
  );
  if (band !== 'top1') return rows.find((row) => row.band === band) ?? null;
  return [...rows].sort(
    (a, b) =>
      b.samples - a.samples ||
      bandOrder.indexOf(a.band) - bandOrder.indexOf(b.band) ||
      a.earfcn.localeCompare(b.earfcn),
  )[0] ?? null;
}

function textElement(tag: string, value: string, className?: string) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}

function MeasurementCallouts({ map, focus, peers, survey, threshold, selectedPot, onSelect }: {
  map:LeafletMap; focus:CandidateInvestigationPoint; peers:CandidateInvestigationPoint[];
  survey:CandidateInvestigationPoint[]; threshold:number; selectedPot:string; onSelect:(pot:string)=>void;
}) {
  const rows = useMemo(() => [focus,...peers].filter(validPoint).flatMap((p,i) => {
    const valid = typeof p.percent === 'number' && Number.isFinite(p.percent) && p.percent >= 0 && p.percent <= 100;
    const metric = p.metricLabel || (valid ? p.percent!.toFixed(2) + '%' : '');
    if (!metric) return [];
    const direction = i ? p.direction || '인접' : '';
    const label = (i ? (p.pot === selectedPot ? '선택 · ' + direction : direction) : p.pot === selectedPot ? '선택' : '조사') + ' ' + metric;
    return [{...p,direction,label,role:i ? 'comparison' : 'primary'}];
  }),[focus,peers,selectedPot]);
  const [layout,setLayout] = useState<ReturnType<typeof layoutCandidateCallouts>>([]);
  useEffect(() => {
    const update = () => {
      const size = map.getSize();
      if (!size.x || !size.y) return;
      const positions = (p:CandidateInvestigationPoint) => map.latLngToContainerPoint([p.lat,p.lon]);
      const anchors = rows.map(p => {
        const {x,y} = positions(p);
        const hangul = p.label.match(/[가-힣]/g)?.length ?? 0;
        return {x,y,id:p.pot,direction:p.direction,width:Math.ceil(18 + hangul*12 + (p.label.length-hangul)*7.4)};
      });
      const obstacles = [
        {left:size.x-135,top:0,width:135,height:54},
        {left:size.x-44,top:size.y-104,width:44,height:104},
        {left:0,top:size.y-30,width:size.x,height:30},
      ];
      setLayout(layoutCandidateCallouts(anchors,size.x,size.y,survey.map(positions),obstacles));
    };
    update();
    map.on('move zoom resize', update);
    return () => {map.off('move zoom resize',update);};
  },[map,rows,survey]);
  return <div className={styles.callouts} aria-label="선택 지점과 인접 측정값">
    <svg aria-hidden="true">{layout.map(pos => <line key={pos.id} x1={pos.x} y1={pos.y} x2={pos.lineX} y2={pos.lineY} />)}</svg>
    {layout.map(pos => {
      const row = rows.find(r => r.pot === pos.id);
      if (!row) return null;
      return <button type="button" key={pos.id} className={styles.callout}
        data-pot-callout={row.pot} data-callout-role={row.role} data-direction={row.direction}
        data-percent={row.percent ?? undefined} data-distance={row.distanceM} aria-pressed={row.pot===selectedPot}
        aria-label={(row.role==='primary'?'조사 지점':row.direction+' '+row.distanceM+'m 비교 지점') + ' ' + row.pot + ' · '+row.label}
        title={[row.pot,row.date,row.band,'EARFCN '+row.earfcn,row.metricLabel || 'RSRP ≤ '+threshold+' dBm'].filter(Boolean).join(' · ')}
        style={{left:pos.left,top:pos.top,width:pos.width,height:pos.height}} onClick={()=>onSelect(row.pot)}>{row.label}</button>;
    })}
  </div>;
}

const stationSvg =
  '<svg viewBox="0 0 36 42" width="36" height="42" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<rect x="2" y="2" width="32" height="37" rx="9" fill="white" stroke="currentColor" stroke-width="1.7"/>' +
  '<g stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M18 13L12 32H24L18 13ZM15 24H21M11 32H25"/>' +
  '<path d="M12 10Q8 14 12 18M24 10Q28 14 24 18M8 7Q1 14 8 21M28 7Q35 14 28 21"/>' +
  '</g><circle cx="18" cy="12" r="2.5" fill="currentColor"/></svg>';

function StationLegend({ className }: { className: string }) {
  return (
    <svg className={styles.stationLegendIcon + ' ' + className} viewBox="0 0 36 42" aria-hidden="true">
      <rect x="2" y="2" width="32" height="37" rx="9" fill="white" stroke="currentColor" strokeWidth="1.7" />
      <g stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 13L12 32H24L18 13ZM15 24H21M11 32H25" />
        <path d="M12 10Q8 14 12 18M24 10Q28 14 24 18M8 7Q1 14 8 21M28 7Q35 14 28 21" />
      </g>
      <circle cx="18" cy="12" r="2.5" fill="currentColor" />
    </svg>
  );
}

/** Candidate-call station associations are explicit; proximity never implies responsibility. */
export function CandidateInvestigationMap({
  context,
  selectedPot,
  primaryPot = selectedPot,
  band,
  date,
  showPots,
  showStations,
  suspectPots = emptyIds,
  investigationPoints = emptyPoints,
  focusPoint,
  comparisonPot,
  comparisonPoints = emptyPoints,
  earfcn,
  weakSignalRatio = false,
  thresholdDbm = -105,
  onSelectPot,
  onSelectStation,
  selectedStation,
  selectablePotIds,
}: CandidateInvestigationMapProps) {
  const host = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<LeafletMap | null>(null);
  const [notice, setNotice] = useState('');
  const camera = useRef({ scope: '', manuallyMoved: false });
  const lastSelection = useRef<{ map: LeafletMap; pot: string } | null>(null);
  const keyboardSelection = useRef<{ kind: 'pot' | 'station'; id: string } | null>(null);
  const potFocusToRestore = useRef<string | null>(null);
  const stationFocusToRestore = useRef<string | null>(null);
  const callbacks = useRef({ onSelectPot, onSelectStation });
  useEffect(() => {
    callbacks.current = { onSelectPot, onSelectStation };
  }, [onSelectPot, onSelectStation]);

  const sourcePoints = useMemo(() => new Map(
    [...investigationPoints, ...comparisonPoints].filter(validPoint).map(point => [point.pot, point]),
  ), [investigationPoints, comparisonPoints]);
  const cells = useMemo(() => {
    const available = new Map(context.pots.filter(validPoint).map(cell => [cell.pot, {
      pot: cell.pot, lat: cell.lat, lon: cell.lon, measurement: cell as Mdt25mCell | undefined,
    }]));
    for (const point of sourcePoints.values()) {
      available.set(point.pot, {
        pot: point.pot, lat: point.lat, lon: point.lon, measurement: available.get(point.pot)?.measurement,
      });
    }
    return [...available.values()];
  }, [context.pots, sourcePoints]);
  const selectableKey = selectablePotIds?.slice().sort().join('|');
  const selectableSet = useMemo(() => selectableKey === undefined ? null : new Set(selectableKey.split('|').filter(Boolean)), [selectableKey]);
  const suspectKey = [...new Set(suspectPots)].sort().join('|');
  const suspectSet = useMemo(
    () => new Set(suspectKey.split('|').filter(Boolean)),
    [suspectKey],
  );
  const ranks = useMemo(() => new Map(investigationPoints.map((point, index) => [point.pot, index + 1])), [investigationPoints]);
  const comparisons = useMemo(() => new Set([comparisonPot, ...comparisonPoints.map(point => point.pot)].filter(Boolean)), [comparisonPot, comparisonPoints]);
  const inspected = cells.filter(cell => ranks.has(cell.pot) || suspectSet.has(cell.pot) ||
    cell.pot === primaryPot || cell.pot === selectedPot || comparisons.has(cell.pot));
  // Selections, checkbox changes and a new object for the same source must preserve the user's camera.
  const extentKey = JSON.stringify(inspected.map(cell => [cell.lat, cell.lon] as const)
    .sort(([aLat, aLon], [bLat, bLon]) => aLat - bLat || aLon - bLon));
  const extent = useMemo(() => JSON.parse(extentKey) as [number, number][], [extentKey]);
  const basis = context.grid.basisPerMeter;
  const candidate = context.candidate;
  const cameraScope = JSON.stringify([candidate.id, [...ranks.keys()].sort()]);

  useEffect(() => {
    let active = true;
    let initialized: LeafletMap | undefined;
    void import('leaflet')
      .then((L) => {
        if (!active || !host.current) return;
        initialized = L.map(host.current, {
          preferCanvas: false,
          scrollWheelZoom: true,
          zoomControl: false,
          zoomSnap: 0.25,
          zoomDelta: 0.5,
          trackResize: false,
          maxZoom: 19,
          attributionControl: true,
        }).setView([37.49, 127.07], 16);
        L.control.zoom({ position: 'bottomright' }).addTo(initialized);
        L.control.scale({ imperial: false, position: 'bottomleft', maxWidth: 90 }).addTo(initialized);
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
            if (active) setNotice('배경지도 불러오기 실패 · 실제 POT와 기지국 위치는 계속 표시됩니다.');
          });
          tiles.addTo(initialized);
        } else {
          setNotice('배경지도 키 미설정 · 실제 POT와 기지국 위치는 계속 표시됩니다.');
        }
        setMap(initialized);
      })
      .catch(() => {
        if (active) setNotice('지도 표시 실패 · POT 선택 목록에서 분석 대상을 선택하세요.');
      });
    return () => {
      active = false;
      initialized?.remove();
    };
  }, []);

  useEffect(() => {
    if (!map || !validPoint(context.candidate.center)) return;
    let active = true;
    let layer: LayerGroup | undefined;
    void import('leaflet')
      .then((L) => {
        if (!active) return;
        layer = L.layerGroup().addTo(map);
        const center = context.candidate.center;
        const radius = context.candidate.radiusM;
        if (!Number.isFinite(radius) || radius <= 0) return;
        L.circle([center.lat, center.lon], {
          radius,
          color: '#65799c',
          weight: 1.5,
          dashArray: '7 6',
          fillOpacity: 0,
          interactive: false,
        }).addTo(layer);
      })
      .catch(() => {
        if (active) setNotice('후보 범위 표시 실패 · POT 위치를 확인하세요.');
      });
    return () => {
      active = false;
      layer?.remove();
    };
  }, [map, context.candidate]);

  useEffect(() => {
    if (!map) return;
    let active = true;
    let observer: ResizeObserver | undefined;
    let adjusting = false;
    if (camera.current.scope !== cameraScope) camera.current = { scope: cameraScope, manuallyMoved: false };
    const onMove = () => { if (!adjusting) camera.current.manuallyMoved = true; };
    map.on('movestart zoomstart', onMove);
    void import('leaflet').then(L => {
      if (!active) return;
      const bounds = L.latLngBounds([]);
      for (const [lat, lon] of extent) {
        if (basis) grid25mCorners({ lat, lon }, basis).forEach(corner => bounds.extend(corner));
        else bounds.extend([lat, lon]);
      }
      if (!bounds.isValid() && validPoint(candidate.center)) {
        const center = L.latLng(candidate.center.lat, candidate.center.lon);
        bounds.extend(Number.isFinite(candidate.radiusM) && candidate.radiusM > 0
          ? center.toBounds(2 * candidate.radiusM) : center);
      }
      const container = map.getContainer();
      let lastWidth = 0;
      let lastHeight = 0;
      const updateSize = () => {
        const width = container.clientWidth, height = container.clientHeight;
        if (!width || !height || (lastWidth === width && lastHeight === height)) return;
        lastWidth = width;
        lastHeight = height;
        adjusting = true;
        try {
          map.invalidateSize({ animate: false });
          if (!camera.current.manuallyMoved && bounds.isValid()) {
            map.fitBounds(bounds, {
              paddingTopLeft: [Math.min(32, width / 8), Math.min(48, height / 6)],
              paddingBottomRight: [Math.min(44, width / 8), Math.min(48, height / 6)],
              maxZoom: 19, animate: false,
            });
          }
        } finally { adjusting = false; }
      };
      updateSize();
      observer = new ResizeObserver(updateSize);
      observer.observe(container);
    });
    return () => {
      active = false;
      observer?.disconnect();
      map.off('movestart zoomstart', onMove);
    };
  }, [map, extent, basis, candidate, cameraScope]);

  useEffect(() => {
    if (!map) return;
    let active = true;
    let layer: LayerGroup | undefined;
    void import('leaflet')
      .then((L) => {
        if (!active) return;
        layer = L.layerGroup().addTo(map);
        const basis = context.grid.basisPerMeter;
        const paintOrder = (pot: string) => pot === selectedPot ? 3 : comparisons.has(pot) ? 2 :
          ranks.has(pot) || suspectSet.has(pot) || pot === primaryPot ? 1 : 0;
        const ordered = [...cells].sort((a, b) => paintOrder(a.pot) - paintOrder(b.pot));
        for (const cell of ordered) {
          const chosen = cell.pot === selectedPot;
          const primary = cell.pot === primaryPot;
          const comparison = comparisons.has(cell.pot);
          const rank = ranks.get(cell.pot);
          const highlight = showPots && paintOrder(cell.pot) > 0;
          if (!highlight && (band === 'hidden' || !cell.measurement)) continue;
          const value = cell.measurement && datedMetric(cell.measurement, band, date, earfcn);
          const backgroundRatio = value?.belowPct[String(thresholdDbm)];
          const saved = highlight ? sourcePoints.get(cell.pot) : undefined;
          const ratio = saved ? saved.percent : backgroundRatio;
          const validRatio = typeof ratio === 'number' && Number.isFinite(ratio) && ratio >= 0 && ratio <= 100;
          const color = chosen || primary ? '#244bf0' : comparison ? '#26364c' : '#3358d1';
          const ratioFill = typeof backgroundRatio === 'number' && backgroundRatio >= 0 && backgroundRatio <= 100
            ? ratioScale.find(stop => backgroundRatio < stop.below)!.color : '#e5e7ea';
          const fill = chosen && highlight ? '#3156ed' : band === 'hidden' ? color : weakSignalRatio ? ratioFill : grid25mRsrpColor(value?.rsrpMean);
          const options = {
            color: highlight ? color : '#7a97a0',
            weight: highlight ? (chosen || primary ? 2.6 : comparison ? 2 : 1) : 0.5,
            opacity: highlight ? 1 : 0.38,
            fillColor: fill,
            fillOpacity: highlight && chosen ? 0.88 : weakSignalRatio && band !== 'hidden' ? 0.73 : highlight ? 0.22 : value ? 0.16 : 0.07,
            dashArray: highlight && comparison ? '5 3' : undefined,
            interactive: true,
            bubblingMouseEvents: false,
          };
          const polygon = basis
            ? L.polygon(grid25mCorners(cell, basis), options)
            : L.circleMarker([cell.lat, cell.lon], { ...options, radius: chosen ? 7 : 4 });
          polygon.addTo(layer);
          const role = !highlight ? 'POT' : comparison ? '비교 POT' : rank ? '조사 POT ' + rank : '조사 POT';
          const badge = rank ? String(rank) : primary ? 'A' : '•';
          if (highlight && (!comparison || rank)) {
            const tag = textElement('span', badge, styles.badge);
            tag.setAttribute('aria-hidden', 'true');
            tag.dataset.potBadge = cell.pot;
            tag.dataset.active = String(chosen);
            L.marker([cell.lat, cell.lon], {
              interactive: false, keyboard: false, zIndexOffset: chosen ? 500 : 300,
              icon: L.divIcon({ html: tag, className: styles.badgeIcon, iconSize: [20, 20], iconAnchor: [10, 10] }),
            }).addTo(layer);
          }
          const label = textElement('div', '', styles.potLabel);
          label.appendChild(textElement('span', (chosen && highlight ? '선택 · ' : '') + role));
          label.appendChild(textElement('strong', cell.pot));
          if (saved) {
            label.appendChild(textElement('small', [saved.date, saved.band, saved.earfcn && 'EARFCN ' + saved.earfcn].filter(Boolean).join(' · ')));
            if (validRatio) label.appendChild(textElement('small', 'RSRP ≤ ' + thresholdDbm + ' dBm ' + ratio.toFixed(2) + '%'));
            if (saved.samples != null) label.appendChild(textElement('small', '측정 ' + saved.samples.toLocaleString('ko-KR') + '건'));
          } else if (value) {
            label.appendChild(
              textElement('small', value.band + ' · ' + (weakSignalRatio ? validRatio ? ratio.toFixed(2) + '%' : '비율 미확보' : number(value.rsrpMean) + ' dBm')),
            );
          } else if (band !== 'hidden') {
            label.appendChild(textElement('small', date + ' · 해당 대역 미수집'));
          }
          polygon.bindTooltip(label, {
            direction: 'auto',
            offset: [12, 0],
            className: chosen && showPots ? styles.selectedTooltip : styles.potTooltip,
            opacity: 1,
          });
          const selectable = selectableSet === null || selectableSet.has(cell.pot);
          const select = () => { if (selectable) callbacks.current.onSelectPot(cell.pot); };
          polygon.on('click', () => {
            keyboardSelection.current = null;
            select();
          });
          const element = polygon.getElement();
          if (element) {
            element.setAttribute('data-pot-id', cell.pot);
            element.setAttribute('data-pot-band', saved?.band ?? value?.band ?? '');
            element.setAttribute('data-pot-selected', String(chosen && highlight));
            element.setAttribute('data-pot-rsrp', !saved && value ? String(value.rsrpMean) : '');
            element.setAttribute('data-pot-role', !highlight ? 'context' : primary ? 'primary' : comparison ? 'comparison' : 'investigation');
            if (rank && highlight) element.setAttribute('data-investigation-rank', String(rank));
            if (validRatio) element.setAttribute('data-pot-weak-percent', String(ratio));
            element.setAttribute('data-pot-selectable', String(selectable));
            element.setAttribute('role', selectable ? 'button' : 'img');
            element.setAttribute('tabindex', selectable ? '0' : '-1');
            element.setAttribute('aria-label', role + ' ' + cell.pot + (validRatio ? ' '+ratio.toFixed(2)+'%' : '') + (selectable ? ' 선택' : ' 관측'));
            if (selectable) element.setAttribute('aria-pressed', String(chosen && highlight));
            element.addEventListener('focus', () => polygon.openTooltip());
            element.addEventListener('blur', () => polygon.closeTooltip());
            element.addEventListener('keydown', (event) => {
              if (event instanceof KeyboardEvent && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                event.stopPropagation();
                keyboardSelection.current = { kind: 'pot', id: cell.pot };
                select();
              }
            });
          }
        }
        const focusPot = potFocusToRestore.current;
        potFocusToRestore.current = null;
        if (focusPot && (document.activeElement === document.body || document.activeElement === host.current)) {
          host.current?.querySelector<HTMLElement>('[data-pot-id="' + CSS.escape(focusPot) + '"]')?.focus({ preventScroll: true });
        }
      })
      .catch(() => {
        if (active) setNotice('POT 격자 표시 실패 · POT 선택 목록을 이용하세요.');
      });
    return () => {
      active = false;
      const focusedPot = document.activeElement?.getAttribute('data-pot-id');
      potFocusToRestore.current = focusedPot && keyboardSelection.current?.kind === 'pot' &&
        keyboardSelection.current.id === focusedPot ? focusedPot : null;
      layer?.remove();
    };
  }, [map, cells, context.grid.basisPerMeter, selectedPot, primaryPot, band, date, earfcn, weakSignalRatio, thresholdDbm, showPots, suspectSet, comparisons, selectableSet, ranks, sourcePoints]);

  useEffect(() => {
    if (!map || !showStations) return;
    let active = true;
    let layer: LayerGroup | undefined;
    void import('leaflet')
      .then((L) => {
        if (!active) return;
        layer = L.layerGroup().addTo(map);
        for (const station of context.stations.filter(validPoint)) {
          const related = station.relation === 'candidate-bye';
          const ambiguous = station.relation === 'ambiguous-bye';
          const label = related
            ? '후보 통화 BYE 연결'
            : ambiguous
              ? '동일 Cell 복수 등록 · 확인 필요'
              : '주변 등록 기지국 · 참고';
          const marker = L.marker([station.lat, station.lon], {
            keyboard: false,
            zIndexOffset: related ? 200 : ambiguous ? 100 : 0,
            icon: L.divIcon({
              className: [
                styles.stationIcon,
                related ? styles.relatedStation : ambiguous ? styles.ambiguousStation : styles.referenceStation,
                station.id === selectedStation ? styles.selectedStation : '',
              ].join(' '),
              html: stationSvg,
              iconSize: [36, 42],
              iconAnchor: [18, 39],
              tooltipAnchor: [0, -38],
            }),
          }).addTo(layer);
          const content = textElement('div', '', styles.stationDetails);
          content.appendChild(textElement('strong', 'Cell ' + station.cellId));
          content.appendChild(textElement('span', label));
          content.appendChild(textElement('span', 'RU ' + station.ruId));
          content.appendChild(textElement('span', 'PCI ' + (station.pci ?? '미확보')));
          if (station.callCount > 0) {
            content.appendChild(textElement('span', '후보 통화 ' + station.callCount + '건'));
          }
          content.appendChild(textElement('small', '등록 위치 · 선택 POT의 책임 기지국은 미확정'));
          marker.bindTooltip(content, { direction: 'top', className: styles.stationTooltip });
          marker.bindPopup(content.cloneNode(true) as HTMLElement, { maxWidth: 280 });
          const select = () => {
            callbacks.current.onSelectStation?.(station.id);
            marker.openPopup();
          };
          marker.on('click', () => {
            keyboardSelection.current = null;
            select();
          });
          if (station.id === selectedStation) marker.openPopup();
          const element = marker.getElement();
          if (element) {
            element.setAttribute('data-station-id', station.id);
            element.setAttribute('data-station-relation', station.relation);
            element.setAttribute('role', 'button');
            element.setAttribute('tabindex', '0');
            element.setAttribute('aria-label', '기지국 Cell ' + station.cellId + ' · ' + label);
            element.setAttribute('aria-pressed', String(station.id === selectedStation));
            element.addEventListener('keydown', (event) => {
              if (event instanceof KeyboardEvent && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                event.stopPropagation();
                keyboardSelection.current = { kind: 'station', id: station.id };
                select();
              }
            });
          }
        }
        const focusStation = stationFocusToRestore.current;
        stationFocusToRestore.current = null;
        if (focusStation && (document.activeElement === document.body || document.activeElement === host.current)) {
          host.current?.querySelector<HTMLElement>('[data-station-id="' + CSS.escape(focusStation) + '"]')?.focus({ preventScroll: true });
        }
      })
      .catch(() => {
        if (active) setNotice('등록 기지국 표시 실패 · 기지국 연결 근거를 확인하세요.');
      });
    return () => {
      active = false;
      const focusedStation = document.activeElement?.getAttribute('data-station-id');
      stationFocusToRestore.current = focusedStation && keyboardSelection.current?.kind === 'station' &&
        keyboardSelection.current.id === focusedStation ? focusedStation : null;
      layer?.remove();
    };
  }, [map, context.stations, showStations, selectedStation]);

  const activeCell = cells.find(cell => cell.pot === selectedPot);
  useEffect(() => {
    if (!map) return;
    const previous = lastSelection.current;
    lastSelection.current = { map, pot: selectedPot };
    // After a user pans away, selecting a row brings just its location back into view.
    if (previous?.map !== map || previous.pot === selectedPot || !activeCell || !camera.current.manuallyMoved) return;
    map.panInside([activeCell.lat, activeCell.lon], { padding: [28, 28], animate: false });
  }, [map, selectedPot, activeCell]);

  return (
    <div className={styles.frame} data-candidate-pot-map={context.candidate.id}>
      <div className={styles.mapCanvas}>
        <div ref={host} className={styles.map} aria-label="조사 후보 POT·기지국 지도" />
        {map && showPots && focusPoint && <MeasurementCallouts map={map} focus={focusPoint} peers={comparisonPoints}
          survey={investigationPoints} threshold={thresholdDbm} selectedPot={selectedPot} onSelect={onSelectPot} />}
      </div>
      {notice && <output className={styles.notice}>{notice}</output>}
      {!context.grid.basisPerMeter && !notice && (
        <output className={styles.notice}>격자 변환 정보 미확보 · POT 중심점 표시</output>
      )}
      <div className={styles.legend} aria-label="조사 후보 지도 범례">
        {weakSignalRatio && band !== 'hidden' && <span>RSRP ≤ {thresholdDbm} dBm</span>}
        {weakSignalRatio && band !== 'hidden' && [...ratioScale, { color: '#e5e7ea', label: '미측정' }].map(stop =>
          <span key={stop.label}><i style={{ background: stop.color, borderColor: stop.color }} />{stop.label}</span>)}
        {showPots && selectedPot && <span><i className={styles.selectedKey} /> 선택 지점</span>}
        {showPots && (ranks.size > 0 || suspectSet.size > 0) && <span><i className={styles.suspectKey} /> 조사 지점</span>}
        {showPots && comparisons.size > 0 && <span><i className={styles.comparisonKey} /> 25m 비교 지점</span>}
        {showStations && (
          <>
            <span><StationLegend className={styles.relatedStation} /> BYE 연결</span>
            <span><StationLegend className={styles.ambiguousStation} /> 복수 등록</span>
            <span><StationLegend className={styles.referenceStation} /> 주변 참고</span>
          </>
        )}
      </div>
    </div>
  );
}
