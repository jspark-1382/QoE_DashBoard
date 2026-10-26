import type { AnalystSample } from './types';
// Timestamp keeps midnight-spanning calls chronological; legacy fixtures use seconds.
export function observationSecond(sample: AnalystSample): number {
  return Number.isFinite(sample.timestamp)
    ? sample.timestamp / 1000
    : sample.second;
}
export type ObservationTarget = 'condition' | 'cell' | 'gap';
export function nextObservation(
  samples: AnalystSample[],
  selectedIndex: number | null,
  target: ObservationTarget,
): number | null {
  const selected = samples.find((s) => s.index === selectedIndex);
  if (!selected) return null;
  const ordered = samples
    .filter((s) => s.callId === selected.callId)
    .sort(
      (a, b) =>
        observationSecond(a) - observationSecond(b) || a.index - b.index,
    );
  const position = ordered.findIndex((s) => s.index === selectedIndex);
  for (let i = position + 1; i < ordered.length; i++) {
    const current = ordered[i],
      previous = ordered[i - 1];
    const gap = observationSecond(current) - observationSecond(previous) > 30;
    if (
      target === 'condition' &&
      ((current.rsrp !== null &&
        Number.isFinite(current.rsrp) &&
        current.rsrp < -105) ||
        (current.sinr !== null &&
          Number.isFinite(current.sinr) &&
          current.sinr < 0))
    )
      return current.index;
    if (target === 'gap' && gap) return current.index;
    if (
      target === 'cell' &&
      !gap &&
      previous.cellId &&
      current.cellId &&
      current.cellId !== previous.cellId
    )
      return current.index;
  }
  return null;
}
export function clampWindow(
  samples: AnalystSample[],
  selectedIndex: number | null,
  width: number | null,
): [number, number] {
  if (!samples.length) return [0, 0];
  const start = Math.min(...samples.map(observationSecond)),
    end = Math.max(...samples.map(observationSecond));
  if (width === null || width >= end - start) return [start, end];
  const selected = samples.find((s) => s.index === selectedIndex);
  const center = selected ? observationSecond(selected) : start;
  const left = Math.max(start, Math.min(end - width, center - width / 2));
  return [left, Math.min(end, left + width)];
}
