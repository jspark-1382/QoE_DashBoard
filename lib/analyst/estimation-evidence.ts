import type { AnalystEstimationEvidence, AnalystSample } from './types';
export function estimationMethodLabel(
  method: AnalystEstimationEvidence['method'],
): string {
  return {
    MEASURED: 'GPS·측정 좌표 우선',
    MULTILATERATION: '3개 이상 기지국 기반 삼각 측량',
    WEIGHTED_2_SITE: '2개 기지국 가중중심',
    CELL_SITE: '기지국 1개 · 고객 위치 보류',
    INVALID: '위치 근거 부족 · 고객 위치 보류',
  }[method];
}
export function estimationReason(sample: AnalystSample): string {
  if (sample.locationSource === 'gnss')
    return 'GPS 관측 좌표를 우선 사용합니다.';
  if (sample.estimation?.review && !sample.estimation.review.accepted)
    return '고객 위치 추정 보류 · ' + sample.estimation.review.reasons.join(' · ') +
      ' · BYE Cell 기지국 위치는 단말 좌표가 아닙니다.';
  if (sample.lat != null && sample.lon != null)
    return sample.estimation
      ? estimationMethodLabel(sample.estimation.method)
      : '제공된 위치 좌표를 사용합니다.';
  if (!sample.estimation || sample.estimation.siteCount === 0)
    return '사용 가능한 기지국 근거가 없어 고객 위치를 표시하지 않습니다.';
  if (sample.estimation.siteCount === 1)
    return '기지국 1개만으로 고객 위치를 정하지 않습니다.';
  return '엔진이 고객 좌표를 보류했습니다. 경고와 사용 기지국을 확인하세요.';
}
export function estimationSummary(samples: AnalystSample[]) {
  return {
    gnss: samples.filter((s) => s.locationSource === 'gnss').length,
    multi: samples.filter(
      (s) =>
        s.locationSource === 'radio' &&
        s.estimation?.method === 'MULTILATERATION',
    ).length,
    two: samples.filter(
      (s) =>
        s.locationSource === 'radio' &&
        s.estimation?.method === 'WEIGHTED_2_SITE',
    ).length,
    unavailable: samples.filter((s) => s.lat == null || s.lon == null).length,
    withheld: samples.filter((s) => s.estimation?.review && !s.estimation.review.accepted && s.lat == null).length,
    saturated: samples.filter((s) => (s.estimation?.review?.cappedSites??0)>=2).length,
    withheldIndices: samples
      .filter(s=>s.estimation?.review&&!s.estimation.review.accepted&&s.lat==null)
      .map(s=>s.index),
    radioIndices: samples
      .filter(
        (s) => s.locationSource === 'radio' && s.lat != null && s.lon != null,
      )
      .map((s) => s.index),
  };
}
