import { normalizeDay, isPoorCall } from './data';
import {effectiveCallQoe} from './derived-qoe';
import type {
  AnalystDataset,
  AnalystOverview,
  AnalystSource,
  SourceDay,
  OverviewCall,
  OverviewCellRow,
  AnalystSummary,
  AnalystDay,
} from './types';
const R = 6371008.8,
  cos = Math.cos((37.5 * Math.PI) / 180);
export function appendOverview(
  overview: AnalystOverview,
  day: AnalystDay,
): void {
  const cells = new Map(overview.cells.map((c) => [c.id, c]));
  for (const call of day.calls) {
    const id = `${day.customerId}:${call.id}`,
      gridIds = new Set<string>();
    for (const sample of day.samples) {
      if (sample.callId !== call.id || sample.lat == null || sample.lon == null)
        continue;
      const x = Math.floor((((sample.lon * Math.PI) / 180) * R * cos) / 60),
        y = Math.floor((((sample.lat * Math.PI) / 180) * R) / 60),
        key = `grid60:${x}:${y}`;
      gridIds.add(key);
      let cell = cells.get(key);
      if (!cell) {
        cell = {
          id: key,
          lat: ((((y + 0.5) * 60) / R) * 180) / Math.PI,
          lon: ((((x + 0.5) * 60) / (R * cos)) * 180) / Math.PI,
          label:
            sample.site && sample.site !== '지역 정보 없음' ? sample.site : key,
          callIds: [],
        };
        cells.set(key, cell);
      }
      if (!cell.callIds.includes(id)) cell.callIds.push(id);
    }
    overview.calls.push({
      id,
      rawCallId: call.id,
      customerId: day.customerId,
      contractId: day.contractId,
      start: call.start,
      end: call.end,
      startSecond: call.startSecond,
      startTimestamp: call.startTimestamp,
      // CDR END serving Cell ID is not the UE location. Kept so the offline
      // mapper can select a BYE tower reference and preserve its selection basis.
      endCellId: call.endCellId,
      endRat: call.endRat ?? null,
      qoe: effectiveCallQoe(call),
      mos: call.mos,
      endType: call.endType,
      sipCause: call.sipCause,
      q850Cause: call.q850Cause,
      fc: call.fc,
      locationSource: call.locationSource,
      gridIds: [...gridIds],
      site: call.site,
    });
  }
  overview.cells = [...cells.values()];
}
export function buildOverview(
  dataset: AnalystDataset,
  days: SourceDay[],
  source: AnalystSource,
  date: string,
): AnalystOverview {
  const overview: AnalystOverview = {
    schemaVersion: 'analyst-overview-v1',
    analyticsVersion: 'overview-analytics-v1',
    source,
    date,
    sourceRevision: dataset.meta.revision,
    gridSizeM: 60,
    calls: [],
    cells: [],
  };
  for (const day of days.filter((d) => d.date === date))
    appendOverview(overview, normalizeDay(dataset, day, source));
  return overview;
}
const unique = (calls: OverviewCall[]) => {
  const byId = new Map<string, OverviewCall>();
  for (const call of calls) byId.set(call.id, call);
  return [...byId.values()];
};
export function getOverviewSummary(
  calls: OverviewCall[],
  threshold: number,
): AnalystSummary {
  const all = unique(calls);
  const customers = new Set<string>(), affected = new Set<string>();
  let evaluated = 0, poor = 0, located = 0;
  for (const call of all) {
    customers.add(call.customerId);
    if (call.qoe != null && Number.isFinite(call.qoe)) evaluated++;
    if (!isPoorCall(call.qoe, threshold)) continue;
    poor++;
    affected.add(call.customerId);
    if (call.gridIds.length) located++;
  }
  return {
    customers: customers.size,
    total: all.length,
    evaluated,
    unscored: all.length - evaluated,
    poor,
    poorRate: evaluated ? (poor / evaluated) * 100 : null,
    affectedCustomers: affected.size,
    locatedPoor: located,
    unlocatedPoor: poor - located,
  };
}
export function getOverviewCells(
  overview: AnalystOverview,
  calls: OverviewCall[],
  threshold: number,
): OverviewCellRow[] {
  const selected = new Map(unique(calls).map((c) => [c.id, c]));
  return overview.cells.flatMap((cell) => {
    const all = cell.callIds.flatMap((id) =>
      selected.has(id) ? [selected.get(id)!] : [],
    );
    if (!all.length) return [];
    const s = getOverviewSummary(all, threshold);
    return [
      {
        ...cell,
        total: s.total,
        evaluated: s.evaluated,
        poor: s.poor,
        affectedCustomers: s.affectedCustomers,
        poorRate: s.poorRate,
      },
    ];
  });
}
export function getHourlyCalls(
  calls: OverviewCall[],
  threshold: number,
): { hour: number; total: number; evaluated: number; poor: number }[] {
  // A duplicate ID can occur in different hours in legacy data. Deduplicate
  // inside each hour, exactly as the previous filtered summaries did.
  const buckets = Array.from({ length: 24 }, () => new Map<string, OverviewCall>());
  for (const call of calls) buckets[Math.floor(call.startSecond / 3600)]?.set(call.id, call);
  return buckets.map((bucket, hour) => {
    let evaluated = 0, poor = 0;
    for (const call of bucket.values()) {
      if (call.qoe != null && Number.isFinite(call.qoe)) evaluated++;
      if (isPoorCall(call.qoe, threshold)) poor++;
    }
    return { hour, total: bucket.size, evaluated, poor };
  });
}
export function filterOverviewCalls(
  overview: AnalystOverview,
  filters: {
    fromSecond: number;
    toSecond: number;
    hour?: number | null;
    cellId?: string | null;
    location?: 'all' | 'missing';
    poorOnly?: boolean;
    threshold: number;
  },
): OverviewCall[] {
  return overview.calls.filter(
    (c) =>
      c.startSecond >= filters.fromSecond &&
      c.startSecond <= filters.toSecond &&
      (filters.hour == null ||
        Math.floor(c.startSecond / 3600) === filters.hour) &&
      (!filters.cellId || c.gridIds.includes(filters.cellId)) &&
      (filters.location !== 'missing' || !c.gridIds.length) &&
      (!filters.poorOnly || isPoorCall(c.qoe, filters.threshold)),
  );
}
