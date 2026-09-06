export type IndoorMetric = 'qoe' | 'rsrp' | 'rsrq' | 'sinr' | 'mos';

export interface IndoorPci {
  rat: 'LTE' | 'NR5G';
  pci: number;
  samples: number;
  qoe: number | null;
  rsrp: number | null;
  sinr: number | null;
}

export interface IndoorFloor {
  code: string;
  name: string;
  order: number;
  samples: number;
  validSamples: number;
  mosSamples: number;
  qoe: number | null;
  rsrp: number | null;
  rsrq: number | null;
  sinr: number | null;
  mos: number | null;
  poorRate: number;
  ratCounts: Record<string, number>;
  topPcis: IndoorPci[];
}

export interface IndoorBuilding {
  name: string;
  category: string;
  samples: number;
  center: { lat: number | null; lon: number | null };
  floors: IndoorFloor[];
}

export interface IndoorDataset {
  meta: {
    source: string;
    measurementDate: string;
    totalRows: number;
    validSamples: number;
    buildingCount: number;
    floorCount: number;
    hours: number[];
  };
  buildings: IndoorBuilding[];
}
