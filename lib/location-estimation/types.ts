export type FrequencyEncoding = 'unknown' | 'mhz' | 'lte-earfcn';
export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';
export type Point = { latitude: number; longitude: number };
export type BaseStation = Point & {
  baseStationId: string; cellId: string; frequency: number | null;
  txPowerDbm?: number | null; txPowerType?: string; isVirtual: boolean;
};
export type MdtSample = {
  timestamp: number; cellId: string; baseStationId: string; frequency: number | null;
  rsrp: number | null; rsrq?: number | null; sinr?: number | null;
  streamId: string; sampleIndex: number;
};
export type RadiusEstimate = {
  estimatedRadiusM: number; innerRadiusM: number; outerRadiusM: number;
  uncertaintyRatio: number; frequencyMultiplier: number; txPowerMultiplier: number;
  frequencyMhz: number | null; warnings: string[];
};
export type Candidate = Point & { score: number };
export type Transition = { from: BaseStation; to: BaseStation; timestamp: number; trend: boolean };
export type PositionEstimate = Point & {
  sample: MdtSample; station: BaseStation; radius: RadiusEstimate; candidates: Candidate[];
  confidence: Confidence; reasons: string[]; candidateArea: number; confidenceRadiusM: number;
  transition: Transition | null; transitionCandidates: Candidate[]; historyCount: number;
  warnings: string[]; gridResolutionM: number; evidenceConsistent: boolean;
};
export type EstimationOptions = {
  frequencyEncoding: FrequencyEncoding; movementMode: 'unknown' | 'walking' | 'vehicle';
  calibrationMode: 'default' | 'site-specific'; siteKey?: string;
};
export type Match = { station: BaseStation; mode: 'cell' | 'station-fallback' };
