import { getHourlyCalls, getOverviewSummary } from './overview';
import {effectiveCallQoe} from './derived-qoe';
import type { AnalystOverview, OverviewCall, OverviewCallLocation } from './types';

export type ImprovedLocationFilter = 'all' | 'gnss' | 'estimated' | 'bye-cell';
export interface ImprovedScope {
  from: string;
  to: string;
  hour: number | null;
  districtId: string | null;
  evidence: ImprovedLocationFilter;
  /** Optional MOS grade for the mapped call investigation. Default: poor. */
  band?:'poor'|'fair'|'good';
  /** Optional unique-customer drilldown; global CDR KPIs remain unchanged. */
  customerIds?: ReadonlySet<string> | null;
}
export interface DistrictHotspot {
  id: string;
  label: string;
  lat: number;
  lon: number;
  poorCalls: number;
  gnssCalls: number;
  estimatedCalls: number;
  byeCellCalls: number;
  customerCount: number;
}
const validMos = (mos: number | null | undefined) =>
  typeof mos === 'number' && Number.isFinite(mos) && mos >= -1.5 && mos <= 5;
const seconds = (clock: string) => {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock)) return null;
  const [h, m] = clock.split(':').map(Number);
  return h * 3600 + m * 60;
};

export function buildImprovedView(overview: AnalystOverview, scope: ImprovedScope) {
  const from = seconds(scope.from), to = seconds(scope.to);
  const validRange = from !== null && to !== null && from <= to;
  const timeCalls = validRange ? overview.calls.filter(
    (call) => call.startSecond >= from && call.startSecond <= to + 59,
  ) : [];
  const globalSummary = getOverviewSummary(timeCalls.map(c=>({...c,qoe:effectiveCallQoe(c)})), 3);
  const mosValues = timeCalls.flatMap((call) => {const v=effectiveCallQoe(call);return v===null?[]:[v];});
  const meanMos = mosValues.length ? mosValues.reduce((sum, mos) => sum + mos, 0) / mosValues.length : null;
  const hourly = getHourlyCalls(timeCalls.map(c=>({...c,qoe:effectiveCallQoe(c)})), 3);
  const visibleHours = timeCalls.filter(
    (call) => (scope.hour == null || Math.floor(call.startSecond / 3600) === scope.hour)
      && (!scope.customerIds || scope.customerIds.has(call.customerId)),
  );
  const byId = new Map(visibleHours.map((call) => [call.id, call]));
  const band=scope.band??'poor';
  const belongs=(mos:number|null|undefined)=>validMos(mos)&&(
    band==='poor'?mos!<3:band==='fair'?mos!>=3&&mos!<3.5:mos!>=3.5
  );
  const locations = (overview.callLocations ?? []).filter((location) => {
    const call = byId.get(location.callId);
    return Boolean(
      call && belongs(effectiveCallQoe(call)) &&
      (scope.evidence === 'all' || scope.evidence === location.evidence),
    );
  });
  const byArea = new Map<string, OverviewCallLocation[]>();
  for (const point of locations) {
    const group = byArea.get(point.areaId) ?? [];
    group.push(point);
    byArea.set(point.areaId, group);
  }
  const regions: DistrictHotspot[] = (overview.administrativeDongs ?? [])
    .flatMap((dong) => {
      const markers = byArea.get(dong.id) ?? [];
      if (markers.length === 0) return [];
      const unique = new Map(markers.map((marker) => [marker.callId, marker]));
      const items = [...unique.values()];
      return [{
        id: dong.id,
        label: dong.label,
        lat: dong.lat,
        lon: dong.lon,
        poorCalls: items.length,
        gnssCalls: items.filter((p) => p.evidence === 'gnss').length,
        estimatedCalls: items.filter((p) => p.evidence === 'estimated').length,
        byeCellCalls: items.filter((p) => p.evidence === 'bye-cell').length,
        customerCount: new Set(items.map((p) => byId.get(p.callId)?.customerId)).size,
      }];
    })
    .sort((a, b) => b.poorCalls - a.poorCalls || a.label.localeCompare(b.label, 'ko'));
  const focusedLocations = locations.filter(
    (point) => !scope.districtId || scope.districtId === point.areaId,
  );
  const focusedCallIds = new Set(focusedLocations.map((point) => point.callId));
  const focusedCalls = visibleHours.filter((call) => focusedCallIds.has(call.id))
    .sort((a, b) => (effectiveCallQoe(a) ?? 5) - (effectiveCallQoe(b) ?? 5) ||
      a.startSecond - b.startSecond || a.id.localeCompare(b.id));
  const regionById = new Map((overview.administrativeDongs ?? []).map((d) => [d.id, d]));
  const markerByCall = new Map<string, OverviewCallLocation>();
  for (const point of focusedLocations) if (!markerByCall.has(point.callId))
    markerByCall.set(point.callId, point);

  // This sample was selected for low MOS. Do not estimate per-district bad rates.
  // The entire CDR summary is kept separate from the partial geographic sample.
  const mapCells = regions.map((region) => ({
    id: region.id,
    lat: region.lat, lon: region.lon,
    label: region.label,
    callIds: [...new Set((byArea.get(region.id) ?? []).map((p) => p.callId))],
    gnssCalls: region.gnssCalls,
    estimatedCalls: region.estimatedCalls,
    byeCellCalls: region.byeCellCalls,
    total: region.poorCalls,
    evaluated: region.poorCalls,
    poor: band==='poor'?region.poorCalls:0,
    affectedCustomers: region.customerCount,
    poorRate: null,
  }));
  return {
    validRange, globalSummary, meanMos, hourly,
    visibleHours, regions, locations: focusedLocations, focusedCalls, mapCells,
    locatedPoorCalls: focusedCallIds.size,
    poorInTimeWindow: visibleHours.filter((call) => {const v=effectiveCallQoe(call);return v!==null&&v<3;}).length,
    distinctLocatedCustomers: new Set(locations.map((point) => byId.get(point.callId)?.customerId)).size,
    markerByCall, regionById,
  };
}

/**
 * KPI for the currently displayed call-location map. Only measured GPS and
 * 3-site RSRP-weighted approximate search centres count; BYE cells never count.
 * Display and map share the identical filtered location view and call IDs.
 */
export function summarizeMappedLocationEvidence(view: ReturnType<typeof buildImprovedView>) {
  const byCall = new Map<string, 'gnss' | 'estimated'>();
  for (const point of view.locations) {
    if (point.evidence !== 'gnss' && point.evidence !== 'estimated') continue;
    // In case of duplicate observations, GPS takes precedence for a call.
    if (point.evidence === 'gnss' || !byCall.has(point.callId))
      byCall.set(point.callId, point.evidence);
  }
  const G = [...byCall.values()].filter(kind => kind === 'gnss').length;
  const T = byCall.size - G;
  const hourly = Array.from({length:24}, () => 0);
  for (const call of view.visibleHours) {
    if (!byCall.has(call.id)) continue;
    const hour = Math.floor(call.startSecond / 3600);
    if (hour >= 0 && hour < 24) hourly[hour]++;
  }
  return {G, T, U:G+T, hourly};
}

/**
 * Presentation-only mask for the improvement-2 map. Keep the source overview,
 * call details and analytical ranking intact, but do not send tower proxy
 * coordinates (or tower-derived district shading) to the map renderer.
 */
export function mapWithoutByeCellEvidence(view: ReturnType<typeof buildImprovedView>) {
  const locations=view.locations.filter(point=>point.evidence!=='bye-cell');
  const byArea=new Map<string,typeof locations>();
  for(const point of locations){
    const list=byArea.get(point.areaId)??[];
    list.push(point);
    byArea.set(point.areaId,list);
  }
  const mapCells=view.mapCells.flatMap(cell=>{
    const points=byArea.get(cell.id);
    if(!points?.length)return [];
    const unique=new Map(points.map(point=>[point.callId,point]));
    const values=[...unique.values()];
    const total=values.length;
    return [{...cell,callIds:[...unique.keys()],gnssCalls:values.filter(p=>p.evidence==='gnss').length,
      estimatedCalls:values.filter(p=>p.evidence==='estimated').length,byeCellCalls:0,
      total,evaluated:total,poor:cell.poor>0?total:0}];
  });
  return {locations,mapCells};
}

export function buildOriginalCallLink(call: OverviewCall, date: string) {
  const params = new URLSearchParams({
    source: 'MDT', view: 'contract', date,
    customer: call.customerId,
    call: call.rawCallId ?? call.id.slice(call.customerId.length + 1),
  });
  return '/?' + params.toString();
}
