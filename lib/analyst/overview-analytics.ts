import { parseFullTimestamp } from './call-time';
import type { AnalystOverview, OverviewCall } from './types';

export type ScoreMetric = 'qoe' | 'mos';
export type ScoreBand = 'good' | 'fair' | 'poor';
export type ExperienceGroup = 'affected' | 'repeat' | 'consecutive';
export interface OverviewAnalytics {
  metric: ScoreMetric;
  threshold: number;
  total: number;
  evaluated: number;
  unscored: number;
  average: number | null;
  outOfRange: number;
  bands: {
    id: ScoreBand;
    label: string;
    count: number;
    percent: number | null;
    color: string;
  }[];
  bins: {
    from: number;
    to: number;
    count: number;
    color: string;
    band: ScoreBand;
  }[];
  experience: {
    id: ExperienceGroup;
    label: string;
    count: number | null;
    total: number;
    percent: number | null;
    customerIds: string[];
    hourly: number[] | null;
  }[];
  termination: { count: number | null; rate: number | null; unknown: number };
}
const colors: Record<ScoreBand, string> = {
  good: '#43b581',
  fair: '#f1bc32',
  poor: '#e46161',
};

export function scoreValue(
  call: OverviewCall,
  metric: ScoreMetric,
): number | null {
  const value = metric === 'mos' ? call.mos : call.qoe;
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    (metric !== 'mos' || (value >= 1 && value <= 5))
    ? value
    : null;
}

export function getScoreBand(
  value: number,
  metric: ScoreMetric,
  threshold: number,
): ScoreBand {
  const poorLimit = metric === 'mos' ? 3.5 : threshold;
  const goodLimit = Math.max(4, poorLimit);
  return value < poorLimit ? 'poor' : value < goodLimit ? 'fair' : 'good';
}

export function projectOverviewMetric(
  overview: AnalystOverview,
  metric: ScoreMetric,
): AnalystOverview {
  return {
    ...overview,
    calls: overview.calls.map((call) => ({
      ...call,
      qoe: scoreValue(call, metric),
      gridIds: [...call.gridIds],
    })),
    cells: overview.cells.map((cell) => ({
      ...cell,
      callIds: [...cell.callIds],
    })),
  };
}

type ScoredCall = {
  call: OverviewCall;
  value: number | null;
  timestamp: number | null;
};
function customersByGroup(
  rows: ScoredCall[],
  threshold: number,
): Record<ExperienceGroup, string[] | null> {
  const customers = new Map<string, ScoredCall[]>();
  for (const row of rows) {
    const list = customers.get(row.call.customerId) ?? [];
    list.push(row);
    customers.set(row.call.customerId, list);
  }
  const result: Record<ExperienceGroup, string[] | null> = {
    affected: [],
    repeat: [],
    consecutive: [],
  };
  for (const [id, list] of customers) {
    const poor = list.filter(
      (row) => row.value != null && row.value < threshold,
    ).length;
    if (poor === 0) continue;
    result.affected!.push(id);
    if (poor < 2) continue;
    result.repeat!.push(id);
    // Every call participates in adjacency, including healthy and unscored calls.
    if (
      list.some((row) => row.timestamp == null) ||
      new Set(list.map((row) => row.timestamp)).size !== list.length
    ) {
      result.consecutive = null;
      continue;
    }
    const ordered = [...list].sort((a, b) => a.timestamp! - b.timestamp!);
    if (
      ordered.some(
        (row, i) =>
          i > 0 &&
          row.value != null &&
          row.value < threshold &&
          ordered[i - 1].value != null &&
          ordered[i - 1].value! < threshold,
      )
    ) {
      result.consecutive?.push(id);
    }
  }
  for (const ids of Object.values(result)) ids?.sort();
  return result;
}

export function getOverviewAnalytics(
  calls: OverviewCall[],
  metric: ScoreMetric,
  threshold: number,
): OverviewAnalytics {
  threshold = metric === 'mos' ? 3.5 : threshold;
  const all = [...new Map(calls.map((call) => [call.id, call])).values()];
  const rows: ScoredCall[] = all.map((call) => ({
    call,
    value: scoreValue(call, metric),
    timestamp: parseFullTimestamp(call.startTimestamp),
  }));
  const values = rows.flatMap((row) => (row.value == null ? [] : [row.value]));
  const bands: ScoreBand[] = ['good', 'fair', 'poor'];
  const labels = { good: '양호', fair: '보통', poor: '불량' };
  const bins = Array.from({ length: 20 }, (_, i) => {
    const from = i / 4,
      to = (i + 1) / 4;
    const band = getScoreBand((from + to) / 2, metric, threshold);
    return { from, to, count: 0, color: colors[band], band };
  });
  for (const value of values) {
    if (value >= 0 && value <= 5)
      bins[Math.min(19, Math.floor(value * 4))].count++;
  }
  const groups = customersByGroup(rows, threshold);
  const totalCustomers = new Set(all.map((call) => call.customerId)).size;
  const unknownPoorHour = rows.some(
    (row) =>
      row.value != null && row.value < threshold && row.timestamp == null,
  );
  const hourly = Array.from({ length: 24 }, (_, hour) =>
    customersByGroup(
      rows.filter((row) => {
        // Source clocks and original full timestamps describe Korean local reporting hours.
        return (
          row.timestamp != null &&
          new Date(row.timestamp + 9 * 3600000).getUTCHours() === hour
        );
      }),
      threshold,
    ),
  );
  const experienceLabels: Record<ExperienceGroup, string> = {
    affected: '저품질 1회 이상',
    repeat: '2회 이상 반복',
    consecutive: '2회 이상 연속',
  };
  return {
    metric,
    threshold,
    total: all.length,
    evaluated: values.length,
    unscored: all.length - values.length,
    average: values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null,
    outOfRange: all.filter((call) => {
      const value = metric === 'mos' ? call.mos : call.qoe;
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (value < (metric === 'mos' ? 1 : 0) || value > 5)
      );
    }).length,
    bands: bands.map((id) => {
      const count = values.filter(
        (value) => getScoreBand(value, metric, threshold) === id,
      ).length;
      return {
        id,
        label: labels[id],
        count,
        percent: values.length ? (count / values.length) * 100 : null,
        color: colors[id],
      };
    }),
    bins,
    experience: (
      ['affected', 'repeat', 'consecutive'] as ExperienceGroup[]
    ).map((id) => {
      const ids = groups[id],
        count = ids?.length ?? null;
      return {
        id,
        label: experienceLabels[id],
        count,
        total: totalCustomers,
        percent:
          count != null && totalCustomers && values.length
            ? (count / totalCustomers) * 100
            : null,
        customerIds: ids ?? [],
        hourly:
          !values.length ||
          count == null ||
          unknownPoorHour ||
          hourly.some((hour) => hour[id] == null)
            ? null
            : hourly.map((hour) => hour[id]!.length),
      };
    }),
    // Raw termination codes have no approved dictionary yet; every call remains unknown.
    termination: { count: null, rate: null, unknown: all.length },
  };
}
