import type { ExecutiveSample } from './types';

export type MapMetric = 'qoe' | 'rsrp' | 'rsrq' | 'sinr';
export const mapMetrics = {
  qoe: { label: 'QoE', unit: '', low: 3.5, high: 4, legends: ['3.5 이하', '3.5 초과 ~ 4.0 미만', '4.0 이상'] },
  rsrp: { label: 'RSRP', unit: 'dBm', low: -105, high: -90, legends: ['-105 dBm 이하', '-105 초과 ~ -90 dBm 미만', '-90 dBm 이상'] },
  rsrq: { label: 'RSRQ', unit: 'dB', low: -15, high: -10, legends: ['-15 dB 이하', '-15 초과 ~ -10 dB 미만', '-10 dB 이상'] },
  sinr: { label: 'SINR', unit: 'dB', low: 3, high: 15, legends: ['3 dB 이하', '3 초과 ~ 15 dB 미만', '15 dB 이상'] },
};
export function metricColor(value: number | null, metric: MapMetric) {
  if (value == null || !Number.isFinite(value)) return '#8896a3';
  const { low, high } = mapMetrics[metric];
  return value <= low ? '#ff365f' : value < high ? '#f2d447' : '#35c779';
}
export function groupMapCalls(samples: ExecutiveSample[]) {
  const groups = new Map<string, ExecutiveSample[]>();
  samples.forEach(sample => {
    if (!sample.callId) return;
    const group = groups.get(sample.callId) ?? [];
    group.push(sample);
    groups.set(sample.callId, group);
  });
  return [...groups.values()];
}
