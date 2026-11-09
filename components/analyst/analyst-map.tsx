'use client';
import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, LayerGroup, SVG, Canvas } from 'leaflet';
import type { BaseStation } from '../../lib/location-estimation/types';
import type {
  AnalystSample,
  OverviewCellRow,
  AdministrativeDongBoundary,
  OverviewCallLocation,
  AnalystSource,
} from '../../lib/analyst/types';
import {
  metricColor,
  visiblePoints,
  splitTracks,
  overviewRateColor,
  overviewPoorCountColor,
  getSelectedEstimationSites,
  type AnalystMetric,
} from '../../lib/analyst/map';
import { locationLabels } from '../../lib/analyst/data';
import { estimationMethodLabel } from '../../lib/analyst/estimation-evidence';
import { byeSelectionDescription } from '../../lib/analyst/bye-selection';
import type { GnssReference } from '../../lib/location-estimation/gnss-reference';
import 'leaflet/dist/leaflet.css';
import styles from './analyst-map.module.css';
interface Props {
  samples?: AnalystSample[];
  cells?: OverviewCellRow[];
  administrativeDongs?: AdministrativeDongBoundary[];
  callLocations?: OverviewCallLocation[];
  /** MOS grade of callLocations when used for selected-grade geographic investigation. */
  scoreBand?:'poor'|'fair'|'good';
  /** Zoom-aware clustering of overlapping call locations. */
  clusterOccurrences?: boolean;
  /** Improvement mode keeps distinct location evidence in separate clusters. */
  separateEvidence?: boolean;
  onCallLocationSelect?: (callId: string) => void;
  selectedIndex?: number | null;
  selectedCellId?: string | null;
  onSampleSelect?: (index: number) => void;
  onCellSelect?: (id: string) => void;
  stations?: BaseStation[];
  /** Selected CDR BYE tower reference; never a measured UE coordinate. */
  byeSiteCellId?:string;
  byeSiteRuId?:string;
  byeSiteTechnology?:'LTE'|'NR';
  byeSiteSelectionLabel?:string;
  /** Last observed same-call GNSS plus time-dependent movement envelope, not a BYE measurement. */
  gnssReference?:GnssReference|null;
  metric?: AnalystMetric;
  showGnss?: boolean;
  showEstimates?: boolean;
  showStations?: boolean;
  showEstimationEvidence?: boolean;
  /** Fixed source colors only for customer-call map, not other maps. */
  emphasizeLocationSource?:boolean;
  focusKey?: string;
  source?: AnalystSource;
  threshold?: number;
  focusTarget?: { key: string; lat: number; lon: number } | null;
}
const EMPTY_SAMPLES: AnalystSample[] = [],
  EMPTY_CELLS: OverviewCellRow[] = [],
  EMPTY_ADMIN_DONGS: AdministrativeDongBoundary[] = [],
  EMPTY_CALL_LOCATIONS: OverviewCallLocation[] = [],
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
  administrativeDongs = EMPTY_ADMIN_DONGS,
  callLocations = EMPTY_CALL_LOCATIONS,
  clusterOccurrences = false,
  separateEvidence = false,
  scoreBand = 'poor',
  onCallLocationSelect,
  stations = EMPTY_STATIONS,
  byeSiteCellId,
  byeSiteRuId,
  byeSiteTechnology,
  byeSiteSelectionLabel,
  gnssReference,
  selectedIndex,
  selectedCellId,
  onSampleSelect,
  onCellSelect,
  metric = 'rsrp',
  showGnss = true,
  showEstimates = true,
  showStations = false,
  showEstimationEvidence = false,
  emphasizeLocationSource = false,
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
  // Leaflet owns the event listeners until geometry changes. Keep those
  // listeners current without rebuilding every polygon when a parent renders.
  const selectionCallbacks = useRef({ onSampleSelect, onCellSelect, onCallLocationSelect });
  useEffect(() => {
    selectionCallbacks.current = { onSampleSelect, onCellSelect, onCallLocationSelect };
  }, [onSampleSelect, onCellSelect, onCallLocationSelect]);
  const canSelectCallLocation = Boolean(onCallLocationSelect);
  const appliedFocus = useRef('');
  const [map, setMap] = useState<LeafletMap | null>(null),
    [error, setError] = useState(''),
    [clusterZoom, setClusterZoom] = useState(13);
  const gradeLabel=scoreBand==='good'?'양호':scoreBand==='fair'?'보통':'저품질';
  const clusterEnabled = useRef(clusterOccurrences);
  useEffect(() => { clusterEnabled.current = clusterOccurrences; }, [clusterOccurrences]);
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
          if(clusterEnabled.current) setClusterZoom(m.getZoom());
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
      if (administrativeDongs.length || callLocations.length) {
        // A single-call dialog can render only its validated CDR-end
        // location without loading or drawing district polygons.
        // Administrative-dong polygons come from local KGD2002 SHP, transformed
        // to WGS84 GeoJSON [longitude, latitude] during the offline build.
        const byDistrict = new Map(cells.map((cell) => [cell.id, cell]));
        for (const district of administrativeDongs) {
          bounds.push([district.lat, district.lon]);
          const cell = byDistrict.get(district.id);
          const selected = district.id === selectedCellId;
          const color = overviewPoorCountColor(cell?.poor ?? 0);
          const feature = {
            type: 'Feature' as const,
            properties: { id: district.id, label: district.label },
            geometry: {
              type: 'MultiPolygon' as const,
              coordinates: district.coordinates,
            },
          };
          const polygon = L.geoJSON(feature, {
            style: {
              color: selected ? '#2459a6' : '#536b84',
              weight: selected ? 3.5 : 1.2,
              opacity: 0.9,
              fillColor: color,
              fillOpacity: cell ? 0.18 : 0.035,
            },
          }).bindTooltip(
            '<b>' + esc(district.label) + '</b><br/>' +
            (cell
              ? gradeLabel + ' ' + cell.total + '통화 · GPS/삼각 측량/BYE 기지국 위치 근거 (지역 불량률 미산출)' +
                '<br/>위치 근거: GPS ' + (cell.gnssCalls ?? 0) +
                '통화 · 삼각 측량 ' + (cell.estimatedCalls ?? 0) +
                '통화 · BYE Cell 기지국 ' + (cell.byeCellCalls ?? 0) +
                '통화 (기지국 좌표, 단말 좌표 아님)'
              : '연계된 통화 위치 없음'),
          );
          if (cell) polygon.on('click', () => selectionCallbacks.current.onCellSelect?.(district.id));
          polygon.addTo(layer);
        }

        // Original observed or modeled call coordinates, NOT dong centroids.
        // Keep coordinates unchanged; only combine points within ~1m
        // to prevent dozens of overlapping markers at the same place.
        const markerGroups = new Map<string, OverviewCallLocation[]>();
        const focusBounds: [number,number][] = [];
        for (const location of callLocations) {
          if (!Number.isFinite(location.lat) || !Number.isFinite(location.lon))
            continue;
          // At zoomed-out levels use a screen-pixel bucket; zoom 17+
          // restores exact observed/model coordinate markers.
          const grouped = clusterOccurrences && clusterZoom < 17;
          const projection = grouped
            ? map.project([location.lat,location.lon],clusterZoom)
            : null;
          const bucketPx = clusterZoom <= 13 ? 55 : 42;
          const evidenceKey = separateEvidence
            ? [location.evidence,location.referenceBasis??'',location.positionQuality??''].join(':')+':' : '';
          const key = evidenceKey + (projection
            ? 'cluster:' + Math.floor(projection.x / bucketPx) + ':' +
              Math.floor(projection.y / bucketPx) +
              (separateEvidence ? ':' + location.evidence : '')
            : [location.areaId, location.evidence,
              location.lat.toFixed(5), location.lon.toFixed(5)].join(':'));
          const bucket = markerGroups.get(key) ?? [];
          bucket.push(location);
          markerGroups.set(key, bucket);
        }
        for (const callsAtPoint of markerGroups.values()) {
          const point = callsAtPoint[0];
          const observed = point.evidence === 'gnss';
          const lastKnown=point.positionQuality==='gnss-last-known';
          const roughThreeSite=point.positionQuality==='three-site-rough';
          const regionName = administrativeDongs.find(
            (dong) => dong.id === point.areaId,
          )?.label ?? '행정동 미확인';
          const position: [number,number] = [point.lat,point.lon];
          focusBounds.push(position);
          const isByeSite = point.evidence==='bye-cell';
          const label = lastKnown ? '마지막 GPS 실측 기준점 (통화 종료 실측 위치 아님)' :
            observed ? 'GPS 관측 (정확도 미제공)' :
            isByeSite ? 'BYE Cell 기지국 위치 (단말 실제 위치 아님)' :
            roughThreeSite ? '삼각 측량 근사 조사 권역 중심 (실제 UE 위치 아님)' :
            '삼각 측량 (정확도 미검증)';
          const count = callsAtPoint.length;
          const uniqueCalls = new Set(callsAtPoint.map(item=>item.callId)).size;
          const isCluster = clusterOccurrences && clusterZoom < 17 && count > 1;
          const iconSize = isCluster && !separateEvidence ? 34 : 26;
          const markerClass = isCluster && !separateEvidence ? styles.occurrenceGrouped :
            lastKnown ? styles.occurrenceGnssReference :
            observed ? styles.occurrenceGnss :
            isByeSite ? styles.occurrenceByeCell :
            (roughThreeSite || point.estimationMethod === 'MULTILATERATION') && (point.usedSiteCount??0)>=3
              ? styles.occurrenceTrilat : styles.occurrenceEstimate;
          const icon = L.divIcon({
            className: styles.occurrenceIcon,
            html: `<span class="${markerClass}">${isCluster?uniqueCalls:count}</span>`,
            iconSize: [iconSize,iconSize],
            iconAnchor: [iconSize/2,iconSize/2],
          });
          const popup = document.createElement('div');
          popup.className = styles.occurrencePopup;
          const heading = document.createElement('strong');
          heading.textContent = isCluster
            ? `주변 ${gradeLabel} 통화 ${uniqueCalls}건 · 위치 ${count}개 (확대 시 분리)`
            : `${regionName} · ${isByeSite?'BYE Cell 기지국 기반 '+gradeLabel+' 통화':gradeLabel+' 통화 대표 위치'} ${count}건`;
          popup.appendChild(heading);
          const provenance = document.createElement('p');
          provenance.textContent = isCluster
            ? separateEvidence
              ? label + ' 군집 · 확대 후 개별 위치 확인'
              : 'GPS/삼각 측량/BYE Cell 기지국 위치 군집 · 확대 후 개별 근거 확인'
            : `${label} · ${point.lat.toFixed(roughThreeSite?3:6)}, ${point.lon.toFixed(roughThreeSite?3:6)}` +
              (isByeSite
                ? ` · ${point.byeTechnology==='NR'?'5G (NR) · ':point.byeTechnology==='LTE'?'LTE · ':''}Cell ID ${point.byeCellId??'미제공'} · RU ${point.byeRuId??'미제공'} · ${byeSelectionDescription(point)} · 기지국 위치를 종료 통화의 대표점으로 사용`
                : point.representativeBasis === 'cdr-end-nearest' && point.secondsBeforeEnd != null
                  ? ` · CDR 종료 ${Math.abs(point.secondsBeforeEnd).toFixed(1)}초 ${point.secondsBeforeEnd<0?'후':'전'} 관측`
                  : '');
          popup.appendChild(provenance);
          if(!isCluster && observed && point.possibleRadiusM!=null){
            const info=document.createElement('p');
            info.textContent='종료 시점 GPS 실측이 아님 · 최근 GPS 기준 관측 '+
              (point.gnssReferenceAgeSec??point.secondsBeforeEnd??0).toFixed(1)+'초 전' +
              ' · 이동 가능 범위 약 '+Math.round(point.possibleRadiusM).toLocaleString()+
              'm (120km/h, 기준점 오차 250m 가정)' +
              (point.byeRuId?' · BYE 종료 기지국 '+point.byeRuId+' · '+byeSelectionDescription(point)+' (단말 좌표 아님)':
                ' · BYE Cell 기지국 참고 위치 미확보');
            popup.appendChild(info);
            // Mini-map only; never draw thousands of large uncertainty circles
            // on the full administrative-dong dashboard.
            if(callLocations.length===1){
              L.circle(position,{
                radius:point.possibleRadiusM,color:'#078e82',
                weight:2,dashArray:'5 5',fillOpacity:0.055,
                fillColor:'#079b86',
              }).bindTooltip('마지막 GPS 기준 이동 가능 영역 · 실제 단말 이동경로 아님').addTo(layer);
              if(point.byeRuId&&point.byeStationLat!=null&&point.byeStationLon!=null){
                const site:[number,number]=[point.byeStationLat,point.byeStationLon];
                // The mini-map must include BOTH actual GNSS and the separate BYE site.
                focusBounds.push(site);
                L.marker(site,{zIndexOffset:600,icon:L.divIcon({
                  className:styles.stationIcon+' '+styles.byeStationIcon,
                  html:'▲',iconSize:[25,25],iconAnchor:[12,12],
                })}).bindTooltip(byeSelectionDescription(point)+' · BYE 기지국 · 단말 위치 아님').addTo(layer);
                L.polyline([position,site],{
                  color:'#b87a31',weight:2,opacity:.75,dashArray:'3 7',
                }).bindTooltip('GPS 기준점–BYE 기지국 연결 · 실제 고객 이동 경로 아님').addTo(layer);
              }
            }
          }
          if (!isCluster && roughThreeSite && point.roughSearchRadiusM != null) {
            const explanation=document.createElement('p');
            explanation.textContent='신호 세기 가중 기지국 위치 중심 · 현장 조사 권역 약 '+
              Math.round(point.roughSearchRadiusM).toLocaleString()+'m · 실제 단말 위치/정확도 90% 영역 아님';
            popup.appendChild(explanation);
            // Draw the rough investigation zone, not an asserted UE accuracy
            // circle or a route; avoid clutter on very dense regional maps.
            if(callLocations.length<=35){
              L.circle(position,{
                radius:point.roughSearchRadiusM,color:'#ca8a20',
                dashArray:'7 6',weight:2,fillColor:'#dba34d',fillOpacity:0.025,
              }).bindTooltip('삼각 측량 기반 대략 조사 권역 · 정확도 검증 구간 아님').addTo(layer);
            }
            if(callLocations.length===1) {
              for(const site of point.usedStations??[]) {
                const positionSite:[number,number]=[site.lat,site.lon];
                focusBounds.push(positionSite);
                const labelSite=document.createElement('span');
                labelSite.textContent='참조 기지국 '+site.ruId+' / '+site.cellId+
                  ' · RSRP '+site.rsrpDbm.toFixed(1)+' dBm (UE 위치 아님)';
                L.marker(positionSite,{zIndexOffset:500,icon:L.divIcon({
                  className:styles.stationIcon+' '+styles.byeStationIcon,
                  html:'▲',iconSize:[23,23],iconAnchor:[11,11],
                })}).bindTooltip(labelSite).addTo(layer);
              }
            }
          }
          if (!isCluster && point.evidence === 'estimated') {
            const detail = document.createElement('p');
            const method = roughThreeSite
                ? `3개 이상 서로 다른 기지국의 RSRP 가중중심 (${point.usedSiteCount} Site) · 정밀 삼변측량 아님`
                : point.usedSiteCount != null && point.usedSiteCount >= 3 &&
              point.estimationMethod === 'MULTILATERATION'
                ? `3개 이상 독립 사이트 무선 위치 추정 (${point.usedSiteCount} Site)`
                : point.usedSiteCount === 2
                  ? '2개 사이트 기반 근사 위치 (삼각 측량 아님)'
                  : '무선 위치 추정 (방법 미확인)';
            const spread = point.modelUncertaintyM != null &&
              Number.isFinite(point.modelUncertaintyM)
                ? ` · 모델 불확실성 약 ${Math.round(point.modelUncertaintyM).toLocaleString()}m (실측 오차 아님)`
                : '';
            const geometry = point.geometry != null && Number.isFinite(point.geometry)
                ? ` · 배치 지표 ${point.geometry.toFixed(3)}` : '';
            const review = roughThreeSite
                ? ` · 대략적 조사 반경 ${Math.round(point.roughSearchRadiusM??0).toLocaleString()}m (현장 참고용 가정, 정확도/신뢰구간 아님)`
                : point.positionQuality === 'trilateration-weak'
                ? ' · 기하/불확실성 품질 조건 미통과'
                : point.positionQuality === 'trilateration-reviewable'
                  ? ' · 기본 품질 조건 통과(정확도 검증 아님)' : '';
            detail.textContent = method + spread + geometry + review;
            popup.appendChild(detail);
          }
          if(canSelectCallLocation) for (const entry of (isCluster ? callsAtPoint.slice(0,10) : callsAtPoint)) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent =
              `${entry.start} · QoE ${entry.mos == null ? '미평가' : entry.mos.toFixed(2)} · 통화 분석`;
            button.addEventListener('click', () => {
              map.closePopup();
              selectionCallbacks.current.onCallLocationSelect?.(entry.callId);
            });
            popup.appendChild(button);
          }
          if(isCluster && callsAtPoint.length>10) {
            const remainder=document.createElement('p');
            remainder.textContent='외 '+(callsAtPoint.length-10)+'개 위치 · 확대해 분리해서 확인';
            popup.appendChild(remainder);
          }
          const visualMarker = L.marker(position, {
            icon,
            zIndexOffset: 800,
            title: isCluster
              ? `주변 ${gradeLabel} 통화 ${uniqueCalls}건 · 확대하여 개별 위치 확인`
              : `${regionName} · ${gradeLabel} 통화 ${count}건 · ${label}`,
            alt: isCluster ? `${gradeLabel} 통화 군집 ${uniqueCalls}건` : `${regionName} 통화 위치 ${count}건`,
          })
            .bindTooltip(
              isCluster ? `${gradeLabel} 통화 군집 ${uniqueCalls}건 · 확대하면 위치별 표시`
                : `${esc(regionName)} · ${count}건 · ${esc(label)}`,
              { direction: 'top', offset: [0, -12] },
            )
            .bindPopup(popup, { maxHeight: 260, maxWidth: 360 })
            .addTo(layer);
          if(isCluster) visualMarker.on('click',()=>{
            map.setView(position, Math.min(17,map.getZoom()+2),{animate:false});
          });
        }
        // Focusing on actual occurrence points avoids zooming out to the
        // centroids of every surrounding, unobserved district.
        if (focusBounds.length && fitKey.current !== focusKey) {
          const saved = views.get(focusKey);
          if (!saved || (callLocations.length===1&&
            callLocations[0].byeStationLat!=null&&callLocations[0].byeStationLon!=null)) {
            fitKey.current = focusKey;
            map.fitBounds(L.latLngBounds(focusBounds), {
              padding: [30, 30], maxZoom: 16, animate: false,
            });
          }
        }
      } else {
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
              `${esc(cell.label)}<br/>저품질 ${cell.poor} / 평가 ${cell.evaluated}통화 · ${cell.poorRate == null ? '평가 불가' : cell.poorRate.toFixed(1) + '%'}<br/>영향 고객 ${cell.affectedCustomers}개`,
            )
            .on('click', () => selectionCallbacks.current.onCellSelect?.(cell.id))
            .addTo(layer);
        }
      }
      for (const track of splitTracks(samples)) {
        if (!showGnss || track.length < 2) continue;
        L.polyline(
          track.map((s) => [s.lat!, s.lon!] as [number, number]),
          { color: emphasizeLocationSource?'#098e83':'#63788a', weight: emphasizeLocationSource?2.2:1.5, opacity: emphasizeLocationSource?0.8:0.55 },
        )
          .bindTooltip(
            'GPS·실측 관측 연결 · 공백/이상 이동 구간은 연결하지 않음',
          )
          .addTo(layer);
      }
      for (const s of points) {
        const point: [number, number] = [s.lat!, s.lon!];
        bounds.push(point);
        const selected = s.index === selectedIndex;
        const qualityColor=metricColor(s[metric], metric, threshold);
        const qualityPoor=qualityColor==='#b64536';
        const estimate=['radio','interpolated'].includes(s.locationSource);
        const color=emphasizeLocationSource
          ? s.locationSource==='radio'?'#6754c7'
            : s.locationSource==='interpolated'?'#d38e28':'#098e83'
          : qualityColor;
        const sourceName=emphasizeLocationSource
          ? s.locationSource==='radio'?'무선 측량 추정 (실측 아님)'
            : s.locationSource==='interpolated'?'보간 추정 (실측 아님)'
              : 'GPS 관측 (실제 제공 좌표)'
          : locationLabels[s.locationSource];
        const label=sourceName+' '+s.time+' · 표본 '+s.index;
        const method=estimate&&s.estimation
          ? '<br/>'+esc(estimationMethodLabel(s.estimation.method))+' · '+s.estimation.siteCount+'개 기지국 근거'
          : '';
        const html='<b>'+esc(sourceName)+' · '+esc(s.time)+'</b><br/>'+
          s.lat!.toFixed(6)+', '+s.lon!.toFixed(6)+
          '<br/>RSRP '+(s.rsrp??'미제공')+' dBm · SINR '+(s.sinr??'미제공')+
          ' dB'+method+'<br/>'+
          (estimate?'추정 좌표로 실제 GPS 실측 위치가 아닙니다. 정확도 검증 전.':
            '원본 GPS/실측 관측 · 측정 정확도 정보 없음')+
          (emphasizeLocationSource&&qualityPoor?'<br/>선택 품질 지표 저하 관측 (빨간 테두리)':'');
        const marker = estimate
          ? L.marker(point, {
              icon:L.divIcon({
                className:styles.diamondIcon+(emphasizeLocationSource?' '+styles.sourceDiamond:''),
                html:'<span style="background:'+color+';outline:'+
                  (selected?'3px solid #2459a6':emphasizeLocationSource&&qualityPoor?'3px solid #d84747':'2px solid #fff')+
                  '"></span>',
                iconSize:emphasizeLocationSource?[20,20]:[14,14],
                iconAnchor:emphasizeLocationSource?[10,10]:[7,7],
              }),
            })
          : L.circleMarker(point, {
              renderer:svg,
              radius:selected?10:emphasizeLocationSource?7:4.5,
              color:selected?'#2459a6':emphasizeLocationSource?(qualityPoor?'#d84747':'#fff'):color,
              weight:selected?3.5:emphasizeLocationSource?2.6:1.5,
              fillColor:color,
              fillOpacity:0.94,
            });
        marker
          .bindTooltip(label)
          .bindPopup(html)
          .on('click', () => selectionCallbacks.current.onSampleSelect?.(s.index))
          .addTo(layer);
        marker.getElement()?.setAttribute('aria-label', label);
      }
      const selectedSample = samples.find(
        (sample) => sample.index === selectedIndex,
      );
      for (const site of getSelectedEstimationSites(
        samples,
        selectedIndex,
        showEstimationEvidence,
      )) {
        const position: [number, number] = [site.latitude, site.longitude];
        const stationNames = site.baseStationIds?.length
          ? site.baseStationIds.join(', ')
          : site.siteId;
        const label = `추정 근거 기지국 ${stationNames}`;
        const marker = L.marker(position, {
          zIndexOffset: 500,
          icon: L.divIcon({
            className: styles.evidenceStation,
            html: '△',
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          }),
        });
        marker
          .bindTooltip(
            `${esc(label)}<br/>RSRP ${site.rsrp} dBm · 시간차 ${site.deltaTimeSec}초`,
          )
          .bindPopup(
            `<b>${esc(label)}</b><br/>모델 거리 ${Math.round(site.estimatedDistanceM)}m · 측정 거리 아님<br/>가중치 ${site.weight.toFixed(3)} · 잔차 ${Math.round(site.residualM)}m`,
          )
          .addTo(layer);
        marker.getElement()?.setAttribute('aria-label', label);
        if (
          Number.isFinite(site.estimatedDistanceM) &&
          site.estimatedDistanceM > 0
        )
          L.circle(position, {
            renderer: canvas,
            radius: site.estimatedDistanceM,
            color: '#826c37',
            weight: 1,
            dashArray: '4 5',
            fill: false,
            interactive: false,
          }).addTo(layer);
        if (selectedSample?.lat != null && selectedSample.lon != null)
          L.polyline([position, [selectedSample.lat, selectedSample.lon]], {
            renderer: canvas,
            color: '#826c37',
            weight: 1.4,
            dashArray: '5 5',
          })
            .bindTooltip('위치 추정에 사용한 기지국 연결 · 고객 이동경로 아님')
            .addTo(layer);
      }
      const visibleStationBounds: [number,number][]=[];
      if (showStations) {
        const seen = new Set<string>();
        for (const station of stations) {
          const id = `${station.latitude}/${station.longitude}`;
          if (seen.has(id)) continue;
          seen.add(id);
          if (!Number.isFinite(station.latitude) || !Number.isFinite(station.longitude)) continue;
          bounds.push([station.latitude, station.longitude]);
          visibleStationBounds.push([station.latitude, station.longitude]);
          const isByeSite=!!byeSiteCellId&&station.cellId===byeSiteCellId&&
            (!byeSiteRuId||station.baseStationId===byeSiteRuId)&&
            (!byeSiteTechnology||(station.technology??'LTE')===byeSiteTechnology);
          L.marker([station.latitude, station.longitude], {
            zIndexOffset:isByeSite?900:0,
            icon:L.divIcon({
              className:styles.stationIcon+(isByeSite?' '+styles.byeStationIcon:''),
              html:isByeSite?'▲':'△',
              iconSize:isByeSite?[25,25]:[20,20],
              iconAnchor:isByeSite?[12,12]:[10,10],
            }),
          })
            .bindTooltip(isByeSite?'BYE 기지국 참고 · '+(byeSiteSelectionLabel?byeSiteSelectionLabel+' · ':'')+'단말 위치 아님':'기지국 참고 위치 · 단말 위치 아님')
            .bindPopup(
              '<b>'+(isByeSite?'BYE 종료 기지국 · 단말 위치 아님':'기지국 참고 좌표 · 고객 위치 아님')+
              '</b><br/>RU '+esc(station.baseStationId)+' · Cell '+esc(station.cellId||'미제공')+
              (isByeSite&&byeSiteSelectionLabel?'<br/>'+esc(byeSiteSelectionLabel):'')+
              (station.technology?'<br/>통신 방식 '+(station.technology==='NR'?'5G (NR)':'LTE'):'')+
              '<br/>등록 PCI '+(station.pci??'미제공')+
              (station.inventorySource?'<br/>인벤토리 '+esc(station.inventorySource):'')+
              '<br/>'+station.latitude.toFixed(6)+', '+station.longitude.toFixed(6)+
              '<br/>기지국 좌표이며 단말의 실측·추정 위치가 아닙니다.',
            )
            .addTo(layer);
        }
      }
      // Show an uncertainty AREA around the original GNSS, not an
      // invented series of customer coordinates or a fabricated route.
      if(emphasizeLocationSource&&showGnss&&gnssReference){
        const fix:[number,number]=[gnssReference.lat,gnssReference.lon];
        const age=Math.round(gnssReference.ageSeconds);
        const radius=gnssReference.movementRadiusM;
        bounds.push(fix);
        L.circle(fix,{
          radius,
          color:'#0b8d82',weight:2,dashArray:'6 5',
          fillColor:'#14a397',fillOpacity:0.065,
        }).bindTooltip(
          '최근 GPS 관측 기준 이동 가능 영역 (가정)' +
          ' · '+age+'초 경과 · 반경 '+radius.toLocaleString()+'m' +
          ' · 위치 정확도나 실제 이동경로를 뜻하지 않음',
        ).addTo(layer);
        L.circleMarker(fix,{renderer:svg,radius:10,color:'#046e64',
          weight:3,dashArray:'3 3',fillColor:'#0b8d82',fillOpacity:.9})
          .bindTooltip('마지막 GPS 실측 기준점 · 종료 시각 GPS 측정 아님')
          .addTo(layer);
        if(showStations&&byeSiteCellId){
          const bye=stations.find(site=>site.cellId===byeSiteCellId&&
            (!byeSiteRuId||site.baseStationId===byeSiteRuId)&&
            (!byeSiteTechnology||(site.technology??'LTE')===byeSiteTechnology));
          if(bye){
            L.polyline([fix,[bye.latitude,bye.longitude]],{
              color:'#af772f',weight:2,opacity:.75,dashArray:'3 7',
            }).bindTooltip(
              'GPS 기준점과 BYE 종료 기지국의 위치 관계만 표시 · 실제 단말 경로가 아닙니다',
            ).addTo(layer);
          }
        }
      }
      // If the station checkbox changes after an empty GNSS view, refit
      // to the RU locations rather than reusing the old offscreen viewport.
      const stationFitKey=focusKey+'/station-layer-'+(showStations?'on':'off');
      if (fitKey.current !== stationFitKey) {
        fitKey.current = stationFitKey;
        const saved = views.get(focusKey);
        if (showStations && visibleStationBounds.length) {
          const positions=[...visibleStationBounds,...points.map(s=>[s.lat!,s.lon!] as [number,number])];
          map.fitBounds(L.latLngBounds(positions), {
            padding: [42, 42], maxZoom: 16, animate: false,
          });
        } else if (saved) map.setView(saved.center, saved.zoom, { animate: false });
        else if (bounds.length)
          map.fitBounds(L.latLngBounds(bounds), {
            padding: [28, 28], maxZoom: 15, animate: false,
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
    administrativeDongs,
    callLocations,
    clusterOccurrences,
    separateEvidence,
    clusterZoom,
    scoreBand,
    gradeLabel,
    canSelectCallLocation,
    stations,
    byeSiteCellId,
    byeSiteRuId,
    byeSiteTechnology,
    byeSiteSelectionLabel,
    gnssReference,
    metric,
    threshold,
    showGnss,
    showEstimates,
    showStations,
    showEstimationEvidence,
    emphasizeLocationSource,
    selectedIndex,
    selectedCellId,
    focusKey,
    focusTarget,
  ]);
  const selectedPoint = visiblePoints(samples, showGnss, showEstimates).find(
    (sample) => sample.index === selectedIndex,
  );
  const selectedCell = cells.find((cell) => cell.id === selectedCellId);
  const selectedLocation = selectedPoint
    ? { lat: selectedPoint.lat!, lon: selectedPoint.lon! }
    : selectedCell;
  const evidenceSites = getSelectedEstimationSites(
    samples,
    selectedIndex,
    showEstimationEvidence,
  );
  const siteOnly =
    (evidenceSites.length > 0 || (showStations && stations.length > 0)) &&
    !cells.length &&
    !callLocations.length &&
    !visiblePoints(samples, showGnss, showEstimates).length;
  return (
    <div className={styles.container} data-source={source}>
      <div
        ref={host}
        className={styles.map}
        aria-label={
          cells.length ? '전체 지역 품질 지도' : '선택 통화 위치 지도'
        }
      />
      {(error || siteOnly) && (
        <span className={styles.notice}>
          {[error, siteOnly ? '기지국 근거만 표시 · 고객 위치 미제공' : '']
            .filter(Boolean)
            .join(' · ')}
        </span>
      )}
      {!cells.length &&
        !callLocations.length &&
        !evidenceSites.length &&
        !(showStations && stations.length > 0) &&
        !visiblePoints(samples, showGnss, showEstimates).length && (
          <span className={styles.empty}>
            {samples.length
              ? '현재 레이어에서 표시할 고객 위치가 없습니다.'
              : '표시할 고객 위치가 없습니다.'}
          </span>
        )}
      <div className={styles.controls}>
        {evidenceSites.length > 0 && (
          <button
            className={styles.fit}
            type="button"
            aria-label="위치 추정 근거 기지국으로 지도 이동"
            onClick={() => {
              const points: [number, number][] = evidenceSites.map((site) => [
                site.latitude,
                site.longitude,
              ]);
              if (selectedPoint)
                points.push([selectedPoint.lat!, selectedPoint.lon!]);
              instance.current?.fitBounds(points, {
                padding: [35, 35],
                maxZoom: 16,
                animate: false,
              });
            }}
          >
            추정 기지국 보기
          </button>
        )}
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
            evidenceSites.forEach((site) =>
              p.push([site.latitude, site.longitude]),
            );
            callLocations.forEach((point) =>
              p.push([point.lat,point.lon]),
            );
            if(showStations)stations.forEach(station=>
              p.push([station.latitude,station.longitude]),
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
