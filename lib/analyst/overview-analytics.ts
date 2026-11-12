import { parseFullTimestamp } from './call-time';
import {classifyConsecutiveBlocks,type ConsecutiveBlock} from './consecutive-poor';
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
  const poorLimit = threshold;
  const goodLimit = metric === 'mos' || poorLimit>=3 ? Math.max(3.5,poorLimit) : Math.max(4, poorLimit);
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
    // Every source call participates, including healthy and unscored breakers.
    // Equal starts are unknown only when their possible orders change the result.
    const blocks=new Map<number|null,ConsecutiveBlock>();
    for(const row of list){
      const block=blocks.get(row.timestamp)??{timestamp:row.timestamp,total:0,poor:0};
      block.total++;
      if(row.value!=null&&row.value<threshold)block.poor++;
      blocks.set(row.timestamp,block);
    }
    const consecutive=classifyConsecutiveBlocks([...blocks.values()]);
    if (consecutive===null) {
      result.consecutive = null;
      continue;
    }
    if (consecutive) {
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
  threshold = metric === 'mos' ? 3.0 : threshold;
  const unique = new Map<string, OverviewCall>();
  for (const call of calls) unique.set(call.id, call);
  const all = [...unique.values()];
  const rows: ScoredCall[] = [];
  const hourlyRows: ScoredCall[][] = Array.from({ length: 24 }, () => []);
  const customers = new Set<string>();
  const counts: Record<ScoreBand, number> = { good: 0, fair: 0, poor: 0 };
  let evaluated = 0, sum = 0, outOfRange = 0, unknownPoorHour = false;
  const bands: ScoreBand[] = ['good', 'fair', 'poor'];
  const labels = { good: '양호', fair: metric === 'mos' ? '주의' : '보통', poor: '불량' };
  const bins = Array.from({ length: 20 }, (_, i) => {
    const from = i / 4,
      to = (i + 1) / 4;
    const band = getScoreBand((from + to) / 2, metric, threshold);
    return { from, to, count: 0, color: colors[band], band };
  });
  for (const call of all) {
    const value = scoreValue(call, metric);
    const timestamp = parseFullTimestamp(call.startTimestamp);
    const row = { call, value, timestamp };
    rows.push(row);
    customers.add(call.customerId);
    if (timestamp != null) {
      // Assign each call once rather than rescanning it for all 24 hours.
      // Source timestamps are reported in Korean local time.
      const localHour = Math.floor((timestamp + 9 * 3600000) / 3600000);
      hourlyRows[((localHour % 24) + 24) % 24].push(row);
    } else if (value != null && value < threshold) {
      unknownPoorHour = true;
    }
    if (value != null) {
      evaluated++;
      sum += value;
      counts[getScoreBand(value, metric, threshold)]++;
      if (value >= 0 && value <= 5)
        bins[Math.min(19, Math.floor(value * 4))].count++;
    }
    const raw = metric === 'mos' ? call.mos : call.qoe;
    if (typeof raw === 'number' && Number.isFinite(raw) &&
      (raw < (metric === 'mos' ? 1 : 0) || raw > 5)) outOfRange++;
  }
  const groups = customersByGroup(rows, threshold);
  const totalCustomers = customers.size;
  const hourly = hourlyRows.map((hour) => customersByGroup(hour, threshold));
  const experienceLabels: Record<ExperienceGroup, string> = {
    affected: '저품질 1회 이상',
    repeat: '2회 이상 반복',
    consecutive: '2회 이상 연속',
  };
  return {
    metric,
    threshold,
    total: all.length,
    evaluated,
    unscored: all.length - evaluated,
    average: evaluated ? sum / evaluated : null,
    outOfRange,
    bands: bands.map((id) => {
      const count = counts[id];
      return {
        id,
        label: labels[id],
        count,
        percent: evaluated ? (count / evaluated) * 100 : null,
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
          count != null && totalCustomers && evaluated
            ? (count / totalCustomers) * 100
            : null,
        customerIds: ids ?? [],
        hourly:
          !evaluated ||
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
