import { DEFAULT_UNCERTAINTY, SINR_UNCERTAINTY_TABLE, RSRQ_UNCERTAINTY as Q } from './config';
import { estimateBaseRadius } from './rsrp-distance';
import { getFrequencyMultiplier, getTxPowerMultiplier } from './frequency-adjustment';
import type { BaseStation, MdtSample, RadiusEstimate, EstimationOptions } from './types';
export function calculateUncertainty(sample: Pick<MdtSample, 'sinr' | 'rsrq'>) {
  let ratio = sample.sinr != null && Number.isFinite(sample.sinr)
    ? SINR_UNCERTAINTY_TABLE.find(row => sample.sinr! >= row.min)!.ratio : DEFAULT_UNCERTAINTY;
  if (sample.rsrq != null) ratio += sample.rsrq <= Q.severe ? Q.severeAddition : sample.rsrq <= Q.poor ? Q.poorAddition : 0;
  return Math.min(Q.maximum, ratio);
}
export function calculateRadius(sample: MdtSample, station: BaseStation, options: EstimationOptions): RadiusEstimate | null {
  if (sample.rsrp == null) return null;
  const base = estimateBaseRadius(sample.rsrp, options.calibrationMode, options.siteKey);
  if (base == null) return null;
  const frequency = getFrequencyMultiplier(sample.frequency ?? station.frequency, options.frequencyEncoding);
  const power = getTxPowerMultiplier(station.txPowerDbm, station.txPowerType);
  const radius = base * frequency.multiplier * power, uncertaintyRatio = calculateUncertainty(sample);
  return { estimatedRadiusM: radius, innerRadiusM: radius * (1 - uncertaintyRatio), outerRadiusM: radius * (1 + uncertaintyRatio),
    uncertaintyRatio, frequencyMultiplier: frequency.multiplier, txPowerMultiplier: power, frequencyMhz: frequency.mhz,
    warnings: [...(frequency.mhz == null ? ['주파수 형식 미확인 또는 미지원 · 보정 1.0'] : []),
      ...(station.txPowerType?.toUpperCase() === 'RS' ? ['RS Power 물리 모델 미적용 · 보정 1.0'] : [])] };
}
