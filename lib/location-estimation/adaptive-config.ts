// Explicit, uncalibrated POC parameters. P0 is reference RSRP, NOT TOTAL Tx power.
export const ADAPTIVE_CONFIG = {
  windowsSec: [5, 10, 20, 30, 60], siteClusterDistanceM: 20, maxSiteDistanceKm: 30,
  referenceDistanceM: 100, referenceRsrpDbm: -65, pathlossExponent: 3,
  minDistanceM: 20, maxDistanceM: 5000, timeDecayTauSec: 10,
  siteRsrpMode: 'max' as 'max'|'median'|'mean', rsrpWeightDivisor: 20, minRsrpWeight: .1,
  maxSpeedKmh: 200, jumpAction: 'reduce-confidence' as 'reduce-confidence'|'exclude'|'smooth',
  pathGapSec: 120, jumpConfidenceFactor: .5, maxIterations: 80,
  solverToleranceM: .01, initialDamping: .01, geometryFloor: .02,
  uncertaintyFloorM: 50, uncertaintyDistanceRatio: .4, uncertaintyWeakRsrpDbm: -95,
  uncertaintyWeakFactor: 1.5, confidenceResidualScaleM: 500,
  singleSiteScoreCap: 49, twoSiteScoreCap: 64, uncertainSourceScoreCap: 79,
  gradeThresholds: [80,65,50,30], displayLimit: 150,
  confidenceWeights: {siteCount:.25,window:.15,rsrp:.15,residual:.25,geometry:.2},
  confidenceRsrpFloorDbm:-120, confidenceRsrpSpanDb:50,
};
export type AdaptiveConfig = typeof ADAPTIVE_CONFIG;
