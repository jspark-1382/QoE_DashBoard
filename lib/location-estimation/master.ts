import type { BaseStation, MdtSample, Match } from './types';
export function matchBaseStation(sample: MdtSample, stations: BaseStation[]): Match | null {
  const sameFrequency = (s: BaseStation) => sample.frequency == null || s.frequency == null || s.frequency === sample.frequency;
  const exact = stations.filter(s => s.cellId === sample.cellId && (!sample.baseStationId || s.baseStationId === sample.baseStationId) && sameFrequency(s));
  if (exact.length === 1) return {station:exact[0],mode:'cell'};
  if (exact.length > 1) return null;
  // Unknown sector may use a unique station coordinate, with explicit reduced evidence.
  const fallback = stations.filter(s => s.baseStationId === sample.baseStationId && sameFrequency(s));
  return fallback.length === 1 ? {station:fallback[0],mode:'station-fallback'} : null;
}
