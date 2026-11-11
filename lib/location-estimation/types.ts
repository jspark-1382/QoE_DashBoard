export type FrequencyEncoding = 'unknown' | 'mhz' | 'lte-earfcn';
export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';
export type Point = { latitude: number; longitude: number };
export type BaseStation = Point & {
  baseStationId: string; cellId: string; frequency: number | null;
  txPowerDbm?: number | null; txPowerType?: string; isVirtual: boolean;
  pci?: number | null; provenanceUnknown?: boolean;
  /** Inventory evidence, separate from the original observed PCI. */
  inventorySource?: string;
  /** Radio access technology of an explicitly tagged inventory row. */
  technology?: 'LTE' | 'NR';
  /** Display-only relationship to mapped call locations. */
  mapRelations?: Array<'gps-observation' | 'gps-call-bye' | 'triangulation-input'>;
  inventoryPciStatus?: 'valid' | 'missing' | 'invalid' | 'conflict';
  inventoryPciCandidates?: number[];
};
export type MdtSample = {
  timestamp: number; cellId: string; baseStationId: string; frequency: number | null;
  rsrp: number | null; rsrq?: number | null; sinr?: number | null;
  streamId: string; sampleIndex: number;
  // Presentation-only call scope (never used by the estimation engine).
  callId?: string;
  // Calibrated customer GNSS position of this row when measured (ground truth).
  measuredLat?: number | null; measuredLon?: number | null;
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
  segmentId: number; showRepresentative: boolean; smoothedRsrp: number | null;
};
export type EstimationOptions = {
  frequencyEncoding: FrequencyEncoding; movementMode: 'unknown' | 'walking' | 'vehicle';
  calibrationMode: 'default' | 'site-specific'; siteKey?: string;
  historyWindow?: number;
};
export type Match = { station: BaseStation; mode: 'cell' | 'station-fallback' };
