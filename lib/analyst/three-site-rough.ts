import type { AnalystOverview, OverviewCallLocation } from './types';

/**
 * Provenance-preserving display overlay for GNSS-missing calls only.
 * This is a 3-site RSRP-weighted search CENTRE, not geometrical
 * trilateration, calibrated UE positioning accuracy, or a true MOS onset.
 * Original CDR records, GNSS points, raw overview and BYE evidence remain unchanged.
 */
export interface ThreeSiteRoughDataset {
  schemaVersion: 'coarse-three-site-v1';
  sourceRevision: string;
  date: string;
  method: 'THREE_SITE_RSRP_CENTROID';
  counts: Record<string, number>;
  notA90PercentAccuracyRegion: true;
  points: OverviewCallLocation[];
}

const valid = (v: number) => Number.isFinite(v);
const stationSeparated = (points: NonNullable<OverviewCallLocation['usedStations']>) =>
  points.every((a, i) => points.slice(i + 1).every((b) => {
    const dy = (a.lat - b.lat) * 111195;
    const dx = (a.lon - b.lon) * 111195 * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180);
    return Math.hypot(dx, dy) >= 20;
  }));

export function overlayThreeSiteRough(
  original: AnalystOverview,
  rough: ThreeSiteRoughDataset | null,
  includeRough: boolean,
): AnalystOverview {
  if (!rough || !includeRough) return original;
  if (
    rough.schemaVersion !== 'coarse-three-site-v1' ||
    rough.sourceRevision !== original.sourceRevision ||
    rough.date !== original.date ||
    rough.method !== 'THREE_SITE_RSRP_CENTROID' ||
    rough.notA90PercentAccuracyRegion !== true
  ) return original; // Fail closed on stale/malformed data, never mix revisions.

  const calls = new Map(original.calls.map((call) => [call.id, call]));
  const boundaries = new Set((original.administrativeDongs ?? []).map((area) => area.id));
  const locations = new Map((original.callLocations ?? []).map((p) => [p.callId, p]));

  for (const point of rough.points) {
    const call = calls.get(point.callId);
    const old = locations.get(point.callId);
    if (!call || !boundaries.has(point.areaId)) continue;
    // GNSS and previously reviewable validated candidates must not be displaced.
    if (old?.evidence === 'gnss' || old?.positionQuality === 'trilateration-reviewable') continue;
    if (
      point.evidence !== 'estimated' ||
      point.positionQuality !== 'three-site-rough' ||
      point.estimationMethod !== 'THREE_SITE_RSRP_CENTROID' ||
      point.representativeBasis !== 'cdr-end-nearest' ||
      !valid(point.lat) || !valid(point.lon) ||
      point.lat < 33 || point.lat > 39.8 || point.lon < 124 || point.lon > 132 ||
      !Number.isInteger(point.usedSiteCount) || (point.usedSiteCount ?? 0) < 3 ||
      !valid(point.roughSearchRadiusM ?? NaN) ||
      (point.roughSearchRadiusM ?? 0) < 600 ||
      (point.roughSearchRadiusM ?? 0) > 5000 ||
      !valid(point.secondsBeforeEnd ?? NaN) ||
      (point.secondsBeforeEnd ?? -2) < -1 ||
      (point.secondsBeforeEnd ?? 999) > 180 ||
      !Array.isArray(point.usedStations) || point.usedStations.length !== point.usedSiteCount ||
      !stationSeparated(point.usedStations) ||
      point.usedStations.some((site) => !valid(site.lat) || !valid(site.lon) ||
        !site.ruId || !site.cellId || !valid(site.rsrpDbm))
    ) continue;
    const safe: OverviewCallLocation = {
      ...point,
      start: call.start, mos: call.mos ?? null,
      // Preserve supporting CDR BYE site, but never confuse it with a handset point.
      ...(old?.evidence === 'bye-cell' ? {
        byeCellId: old.byeCellId,
        byeRuId: old.byeRuId,
        byeInventory: old.byeInventory,
        byeTechnology: old.byeTechnology,
        byeInventorySha256: old.byeInventorySha256,
        byeSelectionMethod: old.byeSelectionMethod,
        byeCandidateCount: old.byeCandidateCount,
        byeSelectionDeltaSeconds: old.byeSelectionDeltaSeconds,
        byeSelectionMdtRu: old.byeSelectionMdtRu,
        byeStationLat: old.lat,
        byeStationLon: old.lon,
      } : {}),
      modelUncertaintyM: null,
      modelConfidenceScore: null,
    };
    locations.set(point.callId, safe);
  }

  // Return a new view only: never rewrite source JSON, source GNSS or CDR metrics.
  return {...original, callLocations: [...locations.values()]};
}
