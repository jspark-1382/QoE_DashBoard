import { estimateAdaptive } from '../location-estimation/adaptive';
import type {
  AnalystDataset,
  AnalystDay,
  AnalystSample,
  AnalystSource,
  SourceDay,
  SourceCustomer,
  SourceCall,
  LocationSource,
} from './types';
export const locationLabels: Record<LocationSource, string> = {
  gnss: 'GNSS 관측',
  interpolated: '보간',
  radio: '무선 추정',
  station: '기지국',
  measured: '실측 위치',
  unavailable: '위치 근거 없음',
};
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
export function timeToSecond(time: string): number {
  const match = time.match(/(?:T|^)(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?/);
  return match
    ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0)
    : 0;
}
export function getContractId(
  customer: SourceCustomer | undefined,
  day?: SourceDay,
): string | null {
  return day?.sourceContractId ?? customer?.sourceContractId ?? null;
}
export function isPoorCall(qoe: number | null, threshold = 2.5): boolean {
  return qoe != null && Number.isFinite(qoe) && qoe < threshold;
}
const average = (values: (number | null)[]) => {
  const finite = values.filter((v): v is number => v != null);
  return finite.length
    ? finite.reduce((a, b) => a + b, 0) / finite.length
    : null;
};
export function normalizeDay(
  dataset: AnalystDataset,
  detail: SourceDay,
  source: AnalystSource,
): AnalystDay {
  const contractId = getContractId(
      dataset.customers.find((c) => c.id === detail.customerId),
      detail,
    ),
    baseStations = detail.baseStations ?? dataset.meta.baseStations ?? [];
  const callRecords = new Map<string, SourceCall>(
    (detail.calls ?? []).map((c) => [c.id, c]),
  );
  for (const row of detail.samples) {
    const id = str(row[19]);
    if (!id || callRecords.has(id)) continue;
    const meta = detail.callMeta?.[id] ?? dataset.meta.callMeta?.[id];
    const rows = detail.samples.filter((r) => r[19] === id);
    callRecords.set(id, {
      id,
      ci: str(row[20]),
      start: meta?.start ?? str(rows[0][1]),
      end: meta?.end ?? str(rows.at(-1)?.[1]),
      qoe: num(row[16]),
    });
  }
  const samples: AnalystSample[] = detail.samples.flatMap((raw, index) => {
    const callId = str(raw[19]);
    if (!callId || !callRecords.has(callId)) return [];
    const m = (raw[21] ?? {}) as Record<string, unknown>,
      call = callRecords.get(callId)!;
    const second = num(raw[0]) ?? timeToSecond(str(raw[1])),
      start = timeToSecond(call.start),
      end = timeToSecond(call.end);
    const inWindow =
      m.inCallWindow !== false &&
      (end >= start
        ? second >= start && second < end + 1
        : second >= start || second < end + 1);
    if (!inWindow) return [];
    let lat = num(raw[2]),
      lon = num(raw[3]);
    const coordinate =
      lat != null &&
      lon != null &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180 &&
      (lat !== 0 || lon !== 0);
    let locationSource: LocationSource = 'unavailable';
    if (coordinate) {
      if (m.gnss === true || m.locationSource === 'gnss')
        locationSource = 'gnss';
      else if (!raw[21]) locationSource = 'measured';
      else if (m.locationSource === 'interpolated')
        locationSource = 'interpolated';
    }
    if (locationSource === 'unavailable') {
      lat = null;
      lon = null;
    }
    const matching = baseStations.filter(
      (s) => s.baseStationId === str(m.baseStationId),
    );
    const exact = matching.filter(
      (s) => s.cellId && s.cellId === str(m.cellId),
    );
    const candidates = exact.length ? exact : matching;
    const coordinates = new Set(
      candidates.map((s) => s.latitude + ',' + s.longitude),
    );
    const station =
      m.baseStationMatched === false ||
      m.masterMatchLevel === 'unmatched' ||
      coordinates.size !== 1
        ? undefined
        : candidates[0];
    return [
      {
        id: `${callId}:${index}`,
        index,
        second,
        time: str(raw[1]),
        timestamp:
          Date.parse(str(m.timestamp)) ||
          Date.parse(`${detail.date}T00:00:00+09:00`) + second * 1000,
        callId,
        ci: str(raw[20]),
        lat,
        lon,
        site: str(raw[4]),
        rat: str(raw[8]),
        rsrp: num(raw[10]),
        rsrq: num(raw[11]),
        sinr: num(raw[12]),
        mos: num(raw[13]),
        qoe: num(raw[16]),
        pci: num(raw[9]),
        locationSource,
        inCallWindow: true,
        baseStationId: str(m.baseStationId),
        cellId: str(m.cellId),
        frequency: num(m.frequency),
        gnssCrs: str(m.gnssCrs) || dataset.meta.gnssCrs || null,
        gnssX: num(m.gnssUtmkx),
        gnssY: num(m.gnssUtmky),
        stationLat: station?.latitude ?? null,
        stationLon: station?.longitude ?? null,
        confidence: null,
        accuracyM: null,
        raw,
      },
    ];
  });
  const grouped = new Map<string, AnalystSample[]>();
  for (const sample of samples) {
    const list = grouped.get(sample.callId) ?? [];
    list.push(sample);
    grouped.set(sample.callId, list);
  }
  for (const [callId, rows] of grouped) {
    // The existing estimator is isolated to this call. Single-site fallback is never a customer point.
    if (source !== 'MDT' || !rows.some((s) => s.lat == null)) continue;
    const observedStations = baseStations.filter((station) =>
      rows.some(
        (s) =>
          s.stationLat === station.latitude &&
          s.stationLon === station.longitude &&
          s.baseStationId === station.baseStationId,
      ),
    );
    const estimates = estimateAdaptive(
      rows.map((s) => ({
        timestamp: s.timestamp,
        cellId: s.cellId,
        baseStationId: s.stationLat == null ? '' : s.baseStationId,
        frequency: s.frequency,
        rsrp: s.rsrp,
        rsrq: s.rsrq,
        sinr: s.sinr,
        streamId: callId,
        sampleIndex: s.index,
        measuredLat: s.lat,
        measuredLon: s.lon,
      })),
      observedStations,
    );
    const byIndex = new Map(rows.map((s) => [s.index, s]));
    for (const estimate of estimates.positions) {
      const sample = byIndex.get(estimate.sample.sampleIndex)!;
      sample.estimation = {
        method: estimate.method,
        siteCount: estimate.siteCount,
        windowSec: estimate.windowSec,
        usedSites: estimate.usedSites.map((site) => ({
          ...site,
          cellIds: [...site.cellIds],
          baseStationIds: [
            ...new Set(
              (
                estimates.sites.find((s) => s.siteId === site.siteId)?.cells ??
                []
              ).map((cell) => cell.baseStationId),
            ),
          ],
        })),
        residualErrorM: estimate.residualErrorM,
        geometry: estimate.geometry,
        jump: estimate.jump,
        warnings: [...estimate.warnings],
      };
      if (
        sample.lat != null ||
        estimate.siteCount < 2 ||
        estimate.method === 'CELL_SITE' ||
        estimate.estimatedLat == null ||
        estimate.estimatedLon == null
      )
        continue;
      sample.lat = estimate.estimatedLat;
      sample.lon = estimate.estimatedLon;
      sample.locationSource = 'radio';
      sample.confidence = estimate.confidenceScore;
      sample.accuracyM = estimate.estimatedAccuracyM;
    }
  }
  const calls = [...callRecords.values()].map((call) => {
    const rows = grouped.get(call.id) ?? [];
    const sources = rows.map((s) => s.locationSource);
    const locationSource: LocationSource = sources.includes('gnss')
      ? 'gnss'
      : sources.includes('measured')
        ? 'measured'
        : sources.includes('interpolated')
          ? 'interpolated'
          : sources.includes('radio')
            ? 'radio'
            : 'unavailable';
    const startSecond = timeToSecond(call.start),
      endSecond = timeToSecond(call.end),
      startTimestamp = Date.parse(call.startTimestamp ?? ''),
      endTimestamp = Date.parse(call.endTimestamp ?? '');
    // Full dates preserve multiday duration; clocks alone can establish at most one midnight crossing.
    const durationSeconds =
      Number.isFinite(startTimestamp) &&
      Number.isFinite(endTimestamp) &&
      endTimestamp >= startTimestamp
        ? (endTimestamp - startTimestamp) / 1000
        : endSecond - startSecond + (endSecond < startSecond ? 86400 : 0);
    return {
      id: call.id,
      ci: call.ci ?? rows[0]?.ci ?? '',
      customerId: detail.customerId,
      contractId,
      start: call.start,
      end: call.end,
      startCellId: str(call.startCellId),
      endCellId: str(call.endCellId),
      startSecond,
      endSecond,
      durationSeconds,
      qoe: num(call.qoe),
      rsrp: num(call.rsrp) ?? average(rows.map((s) => s.rsrp)),
      rsrq: num(call.rsrq) ?? average(rows.map((s) => s.rsrq)),
      sinr: num(call.sinr) ?? average(rows.map((s) => s.sinr)),
      mos: num(call.mos) ?? average(rows.map((s) => s.mos)),
      pci: num(call.pci) ?? rows[0]?.pci ?? null,
      site: call.site ?? rows[0]?.site ?? '',
      sampleIndices: rows.map((s) => s.index),
      mdtCount: call.mdtCount ?? rows.length,
      radioCount:
        call.radioCount ??
        rows.filter((s) => s.rsrp != null || s.rsrq != null || s.sinr != null)
          .length,
      hasMdt: call.hasMdt ?? rows.length > 0,
      gnssCount: rows.filter((s) => s.locationSource === 'gnss').length,
      validEventCount: rows.length,
      locationSource,
      endType: call.endType ?? '',
      sipCause: call.sipCause ?? '',
      q850Cause: call.q850Cause ?? '',
      fc: call.fc ?? '',
      direction: call.direction ?? '',
    };
  });
  return {
    source,
    customerId: detail.customerId,
    contractId,
    date: detail.date,
    calls,
    samples,
    baseStations,
  };
}
