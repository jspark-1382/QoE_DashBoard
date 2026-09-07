import { FREQUENCY_MULTIPLIER as F, TX_POWER } from './config';
import type { FrequencyEncoding } from './types';
// ETSI TS 136 101 table 5.7.3-1, LTE DL EARFCN. Explicit mode only, never magnitude detection.
// https://etsi.org/deliver/etsi_ts/136100_136199/136101/09.05.00_60/ts_136101v090500p.pdf
const LTE_BANDS = [[0,599,2110],[600,1199,1930],[1200,1949,1805],[1950,2399,2110],
  [2400,2649,869],[2650,2749,875],[2750,3449,2620],[3450,3799,925]];
export function frequencyToMhz(value: number | null, encoding: FrequencyEncoding): number | null {
  if (value == null || !Number.isFinite(value) || value < 0 || encoding === 'unknown') return null;
  if (encoding === 'mhz') return value > 0 ? value : null;
  if (!Number.isInteger(value)) return null;
  const band = LTE_BANDS.find(([start, end]) => value >= start && value <= end);
  return band ? band[2] + .1 * (value - band[0]) : null;
}
export function getFrequencyMultiplier(value: number | null, encoding: FrequencyEncoding) {
  const mhz = frequencyToMhz(value, encoding);
  return { mhz, multiplier: mhz == null ? 1 : mhz < F.lowUpperMhz ? F.low : mhz <= F.midUpperMhz ? F.mid : F.high };
}
export function getTxPowerMultiplier(power: number | null | undefined, type?: string) {
  // TOTAL is a small relative heuristic, NEVER TOTAL - RSRP or a physical path loss.
  // RS has its own extension point; no physical model is implemented without calibration.
  if (type?.toUpperCase() !== 'TOTAL' || power == null || !Number.isFinite(power)) return 1;
  return Math.max(TX_POWER.minimumMultiplier, Math.min(TX_POWER.maximumMultiplier,
    10 ** ((power - TX_POWER.referenceDbm) / TX_POWER.divisor)));
}
