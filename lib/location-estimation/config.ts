// POC SIMULATION REFERENCES ONLY: these are not measured physical distances.
// No pathloss exponent, indoor loss or hidden RF propagation constants are used.
// Replace with GPS-calibrated site tables when independent ground truth is available.
export const RSRP_RADIUS_TABLE = [
  { rsrp: -115, radiusM: 4000 }, { rsrp: -110, radiusM: 3000 },
  { rsrp: -105, radiusM: 2200 }, { rsrp: -100, radiusM: 1500 },
  { rsrp: -95, radiusM: 1000 }, { rsrp: -90, radiusM: 650 },
  { rsrp: -85, radiusM: 400 }, { rsrp: -80, radiusM: 250 },
  { rsrp: -75, radiusM: 150 }, { rsrp: -70, radiusM: 100 },
];
// -110 to -115 smoothly approaches the user's < -110 weak-signal 4000m cap.
export const SITE_CALIBRATION_TABLES: Record<string, typeof RSRP_RADIUS_TABLE> = {};
export const FREQUENCY_MULTIPLIER = { low: 1.25, mid: 1, high: .8, lowUpperMhz: 1000, midUpperMhz: 2100 };
export const DEFAULT_UNCERTAINTY = .4;
export const SINR_UNCERTAINTY_TABLE = [
  { min: 15, ratio: .25 }, { min: 5, ratio: .35 }, { min: 0, ratio: .45 }, { min: -Infinity, ratio: .6 },
];
export const RSRQ_UNCERTAINTY = { poor: -15, severe: -20, poorAddition: .1, severeAddition: .15, maximum: .75 };
export const TX_POWER = { referenceDbm: 43, divisor: 40, minimumMultiplier: .85, maximumMultiplier: 1.15 };
export const MAX_MOVEMENT_SPEED = { walking: 2, vehicle: 30, unknown: 40 };
export const GRID_RESOLUTION = 100;
export const HISTORY_WINDOW = 8;
export const CONFIG = {
  smoothingWindow: 3, smoothingMaxGapSeconds: 30, representativeMinMovementSupport: .5,
  historyDecay: .8, maxHistoryGapSeconds: 120, maxGridPoints: 24000,
  candidateFraction: .8, currentRingFloor: .08, movementFloor: .08,
  movementWeight: .45, representativeContinuityWeight: .6, movementSoftScaleM: 100, beamSize: 96, transitionBonus: .2, transitionTrendBonus: .15,
  trendDb: 3, consistencyFloor: .32, ringSegments: 96,
  mediumMinHistory: 4, highMinHistory: 8, highMinCells: 3, highMaxAreaKm2: .15,
  mediumMaxAreaKm2: 8, highMinSinr: 15, highMinimumScore: .8,
};
export const DEFAULT_OPTIONS = { frequencyEncoding: 'unknown', movementMode: 'unknown', calibrationMode: 'default' } as const;
