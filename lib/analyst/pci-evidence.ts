import type { BaseStation } from '../location-estimation/types';

type StationIdentity = { baseStationId: string; cellId: string; technology?: 'LTE' | 'NR' };
type PciObservation = StationIdentity & { pci?: number | null };
export type PciComparison = 'match' | 'mismatch' | 'unknown';
export type PciEvidence = StationIdentity & {
  registeredPci: number | null;
  /** Original value; normalization is used only for comparison. */
  observedPci: number | null;
  comparison: PciComparison;
  reason: 'missing-identity' | 'unregistered' | 'registry-conflict' |
    'registered-missing' | 'registered-invalid' | 'observed-missing' |
    'observed-invalid' | 'comparable';
  registeredCandidates: number[];
  inventorySources: string[];
};
export type CallPciRow = PciEvidence & {
  observedPcis: number[];
  observationCount: number;
  matched: number;
  mismatched: number;
  unknown: number;
};

const validPci = (value: unknown, technology: 'LTE' | 'NR' = 'LTE'): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= (technology === 'NR' ? 1007 : 503);
const completeIdentity = ({ baseStationId, cellId }: StationIdentity) =>
  Boolean(baseStationId?.trim() && cellId?.trim());
const identityKey = ({ baseStationId, cellId, technology }: StationIdentity) =>
  JSON.stringify([technology ?? 'LTE', baseStationId, cellId]);

/** Presentation-only selection. A shared RU, Cell, or PCI alone is insufficient. */
export function selectExactCallStations(
  stations: readonly BaseStation[],
  observations: readonly StationIdentity[],
): BaseStation[] {
  const keys = new Set(observations.filter(completeIdentity).map(identityKey));
  return stations.filter((station) => completeIdentity(station) && keys.has(identityKey(station)));
}

/** Compare one original observation against unambiguous RU+Cell inventory evidence. */
export function getPciEvidence(
  stations: readonly BaseStation[],
  identity: StationIdentity,
  observedPci: number | null | undefined,
): PciEvidence {
  const exact = completeIdentity(identity)
    ? selectExactCallStations(stations, [identity])
    : [];
  const registeredCandidates = [...new Set(exact.flatMap((station) => [
    station.pci, ...(station.inventoryPciCandidates ?? []),
  ]).filter(value => validPci(value, identity.technology)))].sort((a, b) => a - b);
  const inventorySources = [...new Set(exact.map((station) => station.inventorySource)
    .filter((source): source is string => Boolean(source)))].sort();
  const evidence: PciEvidence = {
    baseStationId: identity.baseStationId, cellId: identity.cellId, technology: identity.technology,
    registeredPci: null, observedPci: observedPci ?? null,
    comparison: 'unknown', reason: 'unregistered', registeredCandidates, inventorySources,
  };
  if (!completeIdentity(identity)) return { ...evidence, reason: 'missing-identity' };
  if (!exact.length) return evidence;
  if (registeredCandidates.length > 1 || exact.some((station) => station.inventoryPciStatus === 'conflict'))
    return { ...evidence, reason: 'registry-conflict' };
  if (exact.some((station) => station.inventoryPciStatus === 'invalid' ||
    (station.pci != null && !validPci(station.pci, station.technology))))
    return { ...evidence, reason: 'registered-invalid' };
  if (exact.some((station) => station.isVirtual || station.inventoryPciStatus === 'missing' || !validPci(station.pci, station.technology)))
    return { ...evidence, reason: 'registered-missing' };
  evidence.registeredPci = registeredCandidates[0] ?? null;
  if (observedPci == null) return { ...evidence, reason: 'observed-missing' };
  if (!validPci(observedPci, identity.technology)) return { ...evidence, reason: 'observed-invalid' };
  return {
    ...evidence, comparison: observedPci === evidence.registeredPci ? 'match' : 'mismatch',
    reason: 'comparable',
  };
}

/** One compact row per exact observed RU+Cell, plus any separately provided BYE site. */
export function buildCallPciRows(
  stations: readonly BaseStation[],
  observations: readonly PciObservation[],
  extraStations: readonly BaseStation[] = [],
): CallPciRow[] {
  const groups = new Map<string, { identity: StationIdentity; observations: PciObservation[] }>();
  for (const observation of observations) {
    const key = identityKey(observation);
    const group = groups.get(key) ?? { identity: {
      baseStationId: observation.baseStationId, cellId: observation.cellId, technology: observation.technology,
    }, observations: [] };
    group.observations.push(observation);
    groups.set(key, group);
  }
  for (const station of extraStations) {
    const key = identityKey(station);
    if (!groups.has(key)) groups.set(key, { identity: station, observations: [] });
  }
  // Extra stations are selected BYE tower references. Prefer the day inventory
  // if its exact pair exists, avoiding a second independently sourced choice.
  const registry = [...stations, ...extraStations.filter((station) =>
    !selectExactCallStations(stations, [station]).length)];
  return [...groups.values()].map(({ identity, observations: group }) => {
    const evidence = getPciEvidence(registry, identity, group[0]?.pci);
    const results = group.map((observation) => getPciEvidence(registry, identity, observation.pci));
    const matched = results.filter((result) => result.comparison === 'match').length;
    const mismatched = results.filter((result) => result.comparison === 'mismatch').length;
    const unknown = results.filter((result) => result.comparison === 'unknown').length;
    return {
      ...evidence,
      comparison: mismatched > 0 ? 'mismatch' : unknown > 0 || !group.length ? 'unknown' : 'match',
      reason: mismatched > 0 ? 'comparable' : results.find((result) => result.comparison === 'unknown')?.reason ?? evidence.reason,
      observedPcis: [...new Set(group.map((observation) => observation.pci)
        .filter((pci): pci is number => typeof pci === 'number'))].sort((a, b) => a - b),
      observationCount: group.length, matched, mismatched, unknown,
    };
  });
}

export function pciEvidenceReason(evidence: PciEvidence): string {
  const labels: Record<PciEvidence['reason'], string> = {
    'missing-identity': 'RU·Cell 식별자 미제공',
    unregistered: 'RU·Cell과 정확히 일치하는 등록 정보 없음',
    'registry-conflict': '등록 PCI가 여러 값으로 확인되어 비교 보류',
    'registered-missing': '등록 PCI 미제공',
    'registered-invalid': '등록 PCI 유효 범위 확인 필요',
    'observed-missing': '원본 관측 PCI 미제공',
    'observed-invalid': '원본 관측 PCI 유효 범위 확인 필요',
    comparable: 'RU·Cell 정확 일치 기준',
  };
  return labels[evidence.reason];
}
