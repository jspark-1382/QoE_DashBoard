import { normalizeDay, isPoorCall } from './data';
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
      qoe: call.qoe,
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
const unique = (calls: OverviewCall[]) => [
  ...new Map(calls.map((c) => [c.id, c])).values(),
];
export function getOverviewSummary(
  calls: OverviewCall[],
  threshold: number,
): AnalystSummary {
  const all = unique(calls),
    evaluated = all.filter((c) => c.qoe != null && Number.isFinite(c.qoe)),
    poor = all.filter((c) => isPoorCall(c.qoe, threshold)),
    located = poor.filter((c) => c.gridIds.length);
  return {
    customers: new Set(all.map((c) => c.customerId)).size,
    total: all.length,
    evaluated: evaluated.length,
    unscored: all.length - evaluated.length,
    poor: poor.length,
    poorRate: evaluated.length ? (poor.length / evaluated.length) * 100 : null,
    affectedCustomers: new Set(poor.map((c) => c.customerId)).size,
    locatedPoor: located.length,
    unlocatedPoor: poor.length - located.length,
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
  return Array.from({ length: 24 }, (_, hour) => {
    const summary = getOverviewSummary(
      calls.filter((c) => Math.floor(c.startSecond / 3600) === hour),
      threshold,
    );
    return {
      hour,
      total: summary.total,
      evaluated: summary.evaluated,
      poor: summary.poor,
    };
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
