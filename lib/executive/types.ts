export type ExecutiveRat = 'LTE' | 'NR5G' | 'UNKNOWN';
export type AreaType = 'outdoor' | 'indoor';

export type ExecutiveRawSample = [
  number, string, number, number, string, AreaType, string, string,
  ExecutiveRat, number | null, number | null, number | null, number | null,
  number | null, number | null, number | null, number, string, string?, string?, string?,
];

export interface ExecutiveCustomer {
  id: string;
  maskedPhone: string;
  displayName: string;
  dates: string[];
  sampleCount: number;
  hasName: boolean;
}

export interface ExecutiveDay {
  key: string;
  customerId: string;
  date: string;
  service: 'Voice';
  sampleCount: number;
  sites: string[];
  rats: ExecutiveRat[];
  areaTypes: AreaType[];
  samples: ExecutiveRawSample[];
}

export interface ExecutiveDataset {
  meta: {
    callMeta?: Record<string, { start: string; end: string }>;
    unscoredCalls?: number;
    sourceFiles: string[];
    sourceRows: Record<string, number>;
    dates: string[];
    poorQoeThreshold: number;
    sampleFields: string[];
    classification: {
      measured: string[];
      derived: string[];
      estimated: string[];
    };
  };
  customers: ExecutiveCustomer[];
  days: ExecutiveDay[];
}

export interface ExecutiveSample {
  morphology: string;
  callId: string;
  ci: string;
  second: number;
  time: string;
  lat: number;
  lon: number;
  site: string;
  areaType: AreaType;
  floorCode: string;
  floorName: string;
  rat: ExecutiveRat;
  pci: number | null;
  rsrp: number | null;
  rsrq: number | null;
  sinr: number | null;
  mos: number | null;
  jitter: number | null;
  delay: number | null;
  qoe: number;
  sourceCause: string;
}

export interface PoorEpisode {
  id: string;
  startIndex: number;
  endIndex: number;
  minIndex: number;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  pointCount: number;
  minQoe: number;
  primaryPci: number | null;
  site: string;
}

export interface RootCauseResult {
  key: string;
  label: string;
  strength: '강' | '중' | '약' | '근거 없음';
  evidenceCount: number;
  evidence: string[];
}

export interface JourneyEvent {
  id: string;
  type: 'context' | 'poor' | 'signal' | 'mos' | 'pci' | 'recovery';
  time: string;
  title: string;
  detail: string;
  sampleIndex: number;
  episodeId?: string;
}

export interface ExecutiveSummary {
  averageQoe: number | null;
  minQoe: number | null;
  sampleCount: number;
  poorPointCount: number;
  poorRate: number | null;
  episodeCount: number;
  totalPoorDurationSeconds: number;
  longestPoorDurationSeconds: number;
  primaryRat: ExecutiveRat | null;
  primaryPci: number | null;
  averageMos: number | null;
}
