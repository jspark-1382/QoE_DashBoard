import type { AnalystSample } from './types';
export type AnalystMetric = 'qoe' | 'rsrp' | 'rsrq' | 'sinr';
export type MetricLegendEntry = {
  kind: 'poor' | 'other' | 'missing';
  label: string;
  color: string;
};
const metricRules = {
  rsrp: { label: 'RSRP', threshold: -105, unit: 'dBm' },
  rsrq: { label: 'RSRQ', threshold: -15, unit: 'dB' },
  sinr: { label: 'SINR', threshold: 3, unit: 'dB' },
  qoe: { label: 'QoE', threshold: 2.5, unit: '' },
};
const measurementColors = {
  poor: '#b64536',
  other: '#586d85',
  missing: '#87929d',
};
export function getMetricLegend(
  metric: AnalystMetric,
  threshold = 2.5,
): MetricLegendEntry[] {
  const rule = metricRules[metric],
    limit = metric === 'qoe' ? threshold : rule.threshold;
  const value = String(limit).replace('-', '−'),
    unit = rule.unit ? ` ${rule.unit}` : '';
  return [
    {
      kind: 'poor',
      label: `${rule.label} < ${value}${unit}`,
      color: measurementColors.poor,
    },
    {
      kind: 'other',
      label: `${rule.label} ≥ ${value}${unit}`,
      color: measurementColors.other,
    },
    { kind: 'missing', label: '미제공', color: measurementColors.missing },
  ];
}
export function overviewRateColor(rate: number | null): string {
  return rate == null || rate === 0
    ? '#9ba6ad'
    : rate < 10
      ? '#d7ada4'
      : rate < 25
        ? '#c47867'
        : '#b64536';
}
export function getOverviewRateLegend(): { label: string; color: string }[] {
  return [
    { label: '0% / 평가 불가', color: overviewRateColor(0) },
    { label: '0% 초과 · 10% 미만', color: overviewRateColor(1) },
    { label: '10% 이상 · 25% 미만', color: overviewRateColor(10) },
    { label: '25% 이상', color: overviewRateColor(25) },
  ];
}
export function metricColor(
  value: number | null,
  metric: AnalystMetric,
  threshold = 2.5,
): string {
  if (value == null || !Number.isFinite(value))
    return measurementColors.missing;
  return value < (metric === 'qoe' ? threshold : metricRules[metric].threshold)
    ? measurementColors.poor
    : measurementColors.other;
}
export function hasCustomerPoint(
  s: AnalystSample,
): s is AnalystSample & { lat: number; lon: number } {
  return (
    s.lat != null &&
    s.lon != null &&
    Number.isFinite(s.lat) &&
    Number.isFinite(s.lon) &&
    Math.abs(s.lat) <= 90 &&
    Math.abs(s.lon) <= 180 &&
    (s.lat !== 0 || s.lon !== 0) &&
    !['station', 'unavailable'].includes(s.locationSource)
  );
}
export function visiblePoints(
  samples: AnalystSample[],
  showGnss: boolean,
  showEstimates: boolean,
) {
  return samples
    .filter(hasCustomerPoint)
    .filter((s) =>
      ['gnss', 'measured'].includes(s.locationSource)
        ? showGnss
        : showEstimates,
    );
}
export function splitTracks(samples: AnalystSample[]): AnalystSample[][] {
  const groups: AnalystSample[][] = [];
  let active: AnalystSample[] = [];
  for (const sample of [...samples].sort(
    (a, b) => a.timestamp - b.timestamp || a.index - b.index,
  )) {
    if (
      !hasCustomerPoint(sample) ||
      !['gnss', 'measured'].includes(sample.locationSource)
    ) {
      active = [];
      continue;
    }
    const prev = active.at(-1);
    let join = false;
    if (prev) {
      const seconds = (sample.timestamp - prev.timestamp) / 1000,
        dLat = (sample.lat - prev.lat!) * 111195,
        dLon =
          (sample.lon - prev.lon!) *
          111195 *
          Math.cos((sample.lat * Math.PI) / 180),
        dist = Math.hypot(dLat, dLon);
      join =
        sample.callId === prev.callId &&
        sample.locationSource === prev.locationSource &&
        seconds >= 0 &&
        seconds <= 120 &&
        (seconds === 0 ? dist < 1 : (dist / seconds) * 3.6 <= 200);
    }
    if (!join) {
      active = [];
      groups.push(active);
    }
    active.push(sample);
  }
  return groups;
}
