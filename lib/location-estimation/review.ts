import type { AdaptivePosition } from './adaptive';
import { ADAPTIVE_CONFIG } from './adaptive-config';

/**
 * A conservative publication gate, NOT a ground-truth accuracy estimator.
 * Keep the solver output for diagnostics; never represent a rejected
 * RSRP-derived candidate as a customer coordinate.
 */
export const POSITION_REVIEW_POLICY = {
  minDistinctSites: 3,
  maxModelUncertaintyM: 1500,
  maxResidualM: 800,
  minGeometry: 0.10,
  maxObservationOffsetSec: 10,
  maxWindowSec: 30,
  minConfidenceScore: 40,
  maxCappedSiteFraction: 0.5,
} as const;

export type PositionReview = {
  accepted: boolean;
  reasons: string[];
  cappedSites: number;
  maxSiteOffsetSec: number;
  cappedSiteFraction: number;
  policy: 'strict-3-site-v1';
};

export function reviewAdaptivePosition(
  position: AdaptivePosition,
  policy = POSITION_REVIEW_POLICY,
): PositionReview {
  const reasons: string[] = [];
  const sites = position.usedSites;
  const cappedSites = sites.filter(site =>
    Number.isFinite(site.estimatedDistanceM) &&
    site.estimatedDistanceM >= ADAPTIVE_CONFIG.maxDistanceM - 0.01,
  ).length;
  const maxSiteOffsetSec = sites.length
    ? Math.max(...sites.map(site => Math.abs(site.deltaTimeSec)))
    : 0;
  const cappedSiteFraction = sites.length ? cappedSites / sites.length : 0;
  if (
    position.method !== 'MULTILATERATION' ||
    position.siteCount < policy.minDistinctSites ||
    new Set(sites.map(site => site.siteId)).size < policy.minDistinctSites
  ) reasons.push('독립 기지국 3곳 미만 · 삼각 측량 근거 부족');
  if (cappedSiteFraction > policy.maxCappedSiteFraction)
    reasons.push(`거리 포화 ${cappedSites}/${sites.length}곳 · 거리 구분 불가`);
  if (
    position.estimatedAccuracyM == null ||
    !Number.isFinite(position.estimatedAccuracyM) ||
    position.estimatedAccuracyM > policy.maxModelUncertaintyM
  ) reasons.push(`모델 불확실성 ${position.estimatedAccuracyM == null ? '미확인' : Math.round(position.estimatedAccuracyM)+'m'} · 허용 ${policy.maxModelUncertaintyM}m 초과`);
  if (
    position.residualErrorM == null ||
    !Number.isFinite(position.residualErrorM) ||
    position.residualErrorM > policy.maxResidualM
  ) reasons.push('거리 잔차 초과 또는 미확인');
  if (!Number.isFinite(position.geometry) || position.geometry < policy.minGeometry)
    reasons.push('기지국 배치 조건 불량');
  if (maxSiteOffsetSec > policy.maxObservationOffsetSec)
    reasons.push(`관측 시간차 최대 ${maxSiteOffsetSec.toFixed(1)}초 · 시간 동시성 부족`);
  if (position.windowSec > policy.maxWindowSec)
    reasons.push('관측 시간창 과다');
  if (position.confidenceScore < policy.minConfidenceScore)
    reasons.push('모델 신뢰 점수 낮음');
  if (position.jump) reasons.push('비현실적 이동 속도 감지');
  if (
    position.estimatedLat == null ||
    position.estimatedLon == null ||
    !Number.isFinite(position.estimatedLat) ||
    !Number.isFinite(position.estimatedLon)
  ) reasons.push('계산된 위치 좌표 없음');
  if (position.warnings.some(w => w.includes('가상 또는 출처 미확인 기지국')))
    reasons.push('기지국 출처가 검증되지 않음');
  return {
    accepted: reasons.length === 0,
    reasons,
    cappedSites,
    maxSiteOffsetSec,
    cappedSiteFraction,
    policy: 'strict-3-site-v1',
  };
}
