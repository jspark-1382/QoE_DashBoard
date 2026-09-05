export type MetricKey = 'qoe' | 'mos' | 'rsrp' | 'sinr' | 'pci';
export type ServiceKey = 'all' | 'video' | 'voice' | 'gaming' | 'web';
export type RootCauseKey = 'coverage' | 'interference' | 'capacity' | 'mobility' | 'core';

export interface HeatCell { pci: number; x: number; y: number; qoe: number; mos: number; rsrp: number; sinr: number; load: number; users: number; cause: RootCauseKey; }
export interface ServiceScore { key: Exclude<ServiceKey, 'all'>; label: string; score: number; color: string; hint: string; }
export interface TimePoint { hour: number; qoe: number; throughput: number; load: number; }
export interface RootCause { key: RootCauseKey; label: string; rule: string; probability: number; }
export interface JourneyPoint { time: string; location: string; pci: number; rsrp: number; sinr: number; mos: number; qoe: number; event: string; x: number; }
export interface VocItem { quote: string; meta: string; severity: 'critical' | 'normal'; }
export interface Recommendation { text: string; selected: boolean; }

export interface QoeSnapshot {
  cells: HeatCell[];
  services: ServiceScore[];
  timeSeries: Record<number, TimePoint[]>;
  rootCauses: RootCause[];
  journey: JourneyPoint[];
  voc: VocItem[];
  recommendations: Recommendation[];
}

export interface QoeDataAdapter {
  readonly sourceName: string;
  loadSnapshot(): Promise<QoeSnapshot>;
}
