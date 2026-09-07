import type {
  ExecutiveDay, ExecutiveRawSample, ExecutiveSample, ExecutiveSummary,
  JourneyEvent, PoorEpisode, RootCauseResult,
} from './types';

export const POOR_QOE_THRESHOLD = 2.5;
export const EPISODE_GAP_MULTIPLIER = 3;
export const MIN_EPISODE_GAP_SECONDS = 2;
export const MAX_EPISODE_GAP_SECONDS = 5;

const average = (values: Array<number | null>) => {
  const usable = values.filter((value): value is number => value != null && Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
};

const mode = <T extends string | number>(input: (T | null)[]): T | null => {
  const values = input.filter((value): value is T => value != null);
  if (!values.length) return null;
  const counts = new Map<T, number>();
  values.forEach(value => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
};

export function decodeSample(raw: ExecutiveRawSample): ExecutiveSample {
  return {
    morphology: raw[18] ?? '정보 없음', callId: raw[19] ?? '', ci: raw[20] ?? '',
    second: raw[0], time: raw[1], lat: raw[2], lon: raw[3], site: raw[4], areaType: raw[5],
    floorCode: raw[6], floorName: raw[7], rat: raw[8], pci: raw[9], rsrp: raw[10], rsrq: raw[11],
    sinr: raw[12], mos: raw[13], jitter: raw[14], delay: raw[15], qoe: raw[16], sourceCause: raw[17],
  };
}

export function getCustomerDaySamples(day: ExecutiveDay | undefined, site: string, rat: string): ExecutiveSample[] {
  if (!day) return [];
  return day.samples.map(decodeSample).filter(sample =>
    Boolean(sample.callId && sample.ci) &&
    (site === 'ALL' || sample.site === site) && (rat === 'ALL' || sample.rat === rat)
  );
}

export function samplingInterval(samples: ExecutiveSample[]): number {
  const deltas = samples.slice(1).map((sample, index) => sample.second - samples[index].second)
    .filter(delta => delta > 0 && delta < 30).sort((a, b) => a - b);
  return deltas.length ? deltas[Math.floor(deltas.length / 2)] : 1;
}

export function findPoorEpisodes(samples: ExecutiveSample[], threshold = POOR_QOE_THRESHOLD): PoorEpisode[] {
  if (!samples.length) return [];
  const interval = samplingInterval(samples);
  const gapThreshold = Math.min(MAX_EPISODE_GAP_SECONDS, Math.max(MIN_EPISODE_GAP_SECONDS, interval * EPISODE_GAP_MULTIPLIER));
  const episodes: PoorEpisode[] = [];
  let start = -1;
  let previousPoor = -1;

  const closeEpisode = (end: number) => {
    if (start < 0 || end < start) return;
    const segment = samples.slice(start, end + 1);
    const minOffset = segment.reduce((best, sample, index) => sample.qoe < segment[best].qoe ? index : best, 0);
    const primaryPci = mode(segment.map(sample => sample.pci)) ?? segment[minOffset].pci;
    const site = mode(segment.map(sample => sample.site)) ?? segment[minOffset].site;
    episodes.push({
      id: `episode-${episodes.length + 1}`,
      startIndex: start,
      endIndex: end,
      minIndex: start + minOffset,
      startTime: samples[start].time,
      endTime: samples[end].time,
      durationSeconds: Math.max(1, Math.round(samples[end].second - samples[start].second + interval)),
      pointCount: end - start + 1,
      minQoe: segment[minOffset].qoe,
      primaryPci,
      site,
    });
    start = -1;
    previousPoor = -1;
  };

  samples.forEach((sample, index) => {
    if (sample.qoe < threshold) {
      if (start < 0) start = index;
      else if (previousPoor >= 0 && sample.second - samples[previousPoor].second > gapThreshold) {
        closeEpisode(previousPoor);
        start = index;
      }
      previousPoor = index;
    } else if (start >= 0) {
      closeEpisode(previousPoor);
    }
  });
  if (start >= 0) closeEpisode(previousPoor);
  return episodes;
}

export function findWorstEpisode(episodes: PoorEpisode[]): PoorEpisode | null {
  return episodes.length ? [...episodes].sort((a, b) => a.minQoe - b.minQoe || b.durationSeconds - a.durationSeconds)[0] : null;
}

export function calculateQoESummary(samples: ExecutiveSample[], episodes: PoorEpisode[], threshold = POOR_QOE_THRESHOLD): ExecutiveSummary {
  if (!samples.length) return {
    averageQoe: null, minQoe: null, sampleCount: 0, poorPointCount: 0, poorRate: null,
    episodeCount: 0, totalPoorDurationSeconds: 0, longestPoorDurationSeconds: 0,
    primaryRat: null, primaryPci: null, averageMos: null,
  };
  const poorPointCount = samples.filter(sample => sample.qoe < threshold).length;
  return {
    averageQoe: average([...new Map(samples.map(sample => [sample.callId, sample.qoe])).values()]),
    minQoe: Math.min(...samples.map(sample => sample.qoe)),
    sampleCount: samples.length,
    poorPointCount,
    poorRate: poorPointCount / samples.length * 100,
    episodeCount: episodes.length,
    totalPoorDurationSeconds: episodes.reduce((sum, episode) => sum + episode.durationSeconds, 0),
    longestPoorDurationSeconds: Math.max(0, ...episodes.map(episode => episode.durationSeconds)),
    primaryRat: mode(samples.map(sample => sample.rat)),
    primaryPci: mode(samples.map(sample => sample.pci)),
    averageMos: average(samples.map(sample => sample.mos)),
  };
}

const strength = (matches: number, sampleCount: number): RootCauseResult['strength'] => {
  if (!matches) return '근거 없음';
  const ratio = matches / Math.max(1, sampleCount);
  if (ratio >= .6) return '강';
  if (ratio >= .25) return '중';
  return '약';
};

export function analyzeRootCause(samples: ExecutiveSample[], episode: PoorEpisode | null): RootCauseResult[] {
  if (!episode || !samples.length) return [];
  const segment = samples.slice(episode.startIndex, episode.endIndex + 1);
  const count = (predicate: (sample: ExecutiveSample) => boolean) => segment.filter(predicate).length;
  const lowSinr = count(sample => sample.sinr != null && sample.sinr < 3);
  const normalRsrp = count(sample => sample.rsrp != null && sample.rsrp >= -105);
  const lowRsrp = count(sample => sample.rsrp != null && sample.rsrp < -105);
  const indoorWeak = count(sample => sample.areaType === 'indoor' && sample.rsrp != null && sample.rsrp < -95);
  const transport = count(sample => (sample.jitter != null && sample.jitter > 30) || (sample.delay != null && sample.delay > 150));
  const lowMos = count(sample => sample.mos != null && sample.mos < 2.8);
  const radioNormalLowMos = count(sample => sample.mos != null && sample.mos < 2.8 && (sample.rsrp == null || sample.rsrp >= -100));
  const simultaneous = count(sample => sample.sinr != null && sample.sinr < 3 && sample.mos != null && sample.mos < 3.2);

  const causes: RootCauseResult[] = [
    {
      key: 'interference', label: '간섭 의심 (PCI)', strength: strength(Math.min(lowSinr, normalRsrp), segment.length),
      evidenceCount: Math.min(lowSinr, normalRsrp) + simultaneous,
      evidence: [`SINR 3 dB 미만 ${lowSinr.toLocaleString()}건`, `RSRP 정상 범위 ${normalRsrp.toLocaleString()}건`, `MOS 동시 저하 ${simultaneous.toLocaleString()}건`],
    },
    {
      key: 'coverage', label: 'Coverage 부족', strength: strength(lowRsrp, segment.length), evidenceCount: lowRsrp,
      evidence: [`RSRP -105 dBm 미만 ${lowRsrp.toLocaleString()}건`],
    },
    {
      key: 'indoor', label: '실내 전파 저하', strength: strength(indoorWeak, segment.length), evidenceCount: indoorWeak,
      evidence: [`실내·RSRP -95 dBm 미만 ${indoorWeak.toLocaleString()}건`],
    },
    {
      key: 'transport', label: '코어/전송 구간', strength: strength(transport, segment.length), evidenceCount: transport,
      evidence: [`Jitter 30 ms 초과 또는 Delay 150 ms 초과 ${transport.toLocaleString()}건`],
    },
    {
      key: 'service', label: '단말/서비스·음성', strength: strength(radioNormalLowMos, segment.length), evidenceCount: radioNormalLowMos,
      evidence: [`MOS 2.8 미만 ${lowMos.toLocaleString()}건`, `무선 정상·MOS 저하 ${radioNormalLowMos.toLocaleString()}건`, '단말 자체 상태 데이터 없음'],
    },
  ];
  return causes.sort((a, b) => b.evidenceCount - a.evidenceCount);
}

export function buildCustomerJourney(samples: ExecutiveSample[], episode: PoorEpisode | null): JourneyEvent[] {
  if (!samples.length) return [];
  if (!episode) {
    const events: JourneyEvent[] = [{ id: 'start', type: 'context', time: samples[0].time, title: '측정 시작', detail: `QoE ${samples[0].qoe.toFixed(2)}`, sampleIndex: 0 }];
    const pciChange = samples.findIndex((sample, index) => index > 0 && sample.pci !== samples[index - 1].pci);
    if (pciChange > 0) events.push({ id: 'pci', type: 'pci', time: samples[pciChange].time, title: 'PCI 변경 관찰', detail: `${samples[pciChange - 1].pci} → ${samples[pciChange].pci}`, sampleIndex: pciChange });
    const last = samples.length - 1;
    events.push({ id: 'end', type: 'context', time: samples[last].time, title: '측정 종료', detail: `QoE ${samples[last].qoe.toFixed(2)}`, sampleIndex: last });
    return events;
  }

  const events: JourneyEvent[] = [];
  const contextIndex = Math.max(0, episode.startIndex - 1);
  events.push({ id: `${episode.id}-context`, type: 'context', time: samples[contextIndex].time, title: '저하 직전', detail: `QoE ${samples[contextIndex].qoe.toFixed(2)}`, sampleIndex: contextIndex, episodeId: episode.id });
  events.push({ id: `${episode.id}-poor`, type: 'poor', time: samples[episode.startIndex].time, title: 'QoE 임계치 하향', detail: `QoE ${samples[episode.startIndex].qoe.toFixed(2)}`, sampleIndex: episode.startIndex, episodeId: episode.id });
  if (episode.minIndex !== episode.startIndex) events.push({ id: `${episode.id}-minimum`, type: 'poor', time: samples[episode.minIndex].time, title: 'QoE 최저', detail: `QoE ${samples[episode.minIndex].qoe.toFixed(2)}`, sampleIndex: episode.minIndex, episodeId: episode.id });

  const segmentIndices = Array.from({ length: episode.endIndex - episode.startIndex + 1 }, (_, offset) => episode.startIndex + offset);
  const sinrIndex = segmentIndices.filter(index => samples[index].sinr != null).sort((a, b) => samples[a].sinr! - samples[b].sinr!)[0];
  if (sinrIndex != null) events.push({ id: `${episode.id}-sinr`, type: 'signal', time: samples[sinrIndex].time, title: 'SINR 최저', detail: `${samples[sinrIndex].sinr!.toFixed(1)} dB`, sampleIndex: sinrIndex, episodeId: episode.id });
  const mosIndex = segmentIndices.filter(index => samples[index].mos != null).sort((a, b) => samples[a].mos! - samples[b].mos!)[0];
  if (mosIndex != null) events.push({ id: `${episode.id}-mos`, type: 'mos', time: samples[mosIndex].time, title: 'MOS 최저', detail: samples[mosIndex].mos!.toFixed(2), sampleIndex: mosIndex, episodeId: episode.id });

  const windowStart = Math.max(1, episode.startIndex - 5);
  const windowEnd = Math.min(samples.length - 1, episode.endIndex + 5);
  const pciIndex = Array.from({ length: windowEnd - windowStart + 1 }, (_, offset) => windowStart + offset)
    .find(index => samples[index].pci !== samples[index - 1].pci);
  if (pciIndex != null) events.push({ id: `${episode.id}-pci`, type: 'pci', time: samples[pciIndex].time, title: 'PCI 변경 관찰', detail: `${samples[pciIndex - 1].pci} → ${samples[pciIndex].pci}`, sampleIndex: pciIndex, episodeId: episode.id });

  const recoveryIndex = samples.slice(episode.endIndex + 1).findIndex(sample => sample.qoe >= POOR_QOE_THRESHOLD);
  if (recoveryIndex >= 0) {
    const index = episode.endIndex + 1 + recoveryIndex;
    events.push({ id: `${episode.id}-recovery`, type: 'recovery', time: samples[index].time, title: '품질 회복', detail: `QoE ${samples[index].qoe.toFixed(2)}`, sampleIndex: index, episodeId: episode.id });
  }
  return events.sort((a, b) => samples[a.sampleIndex].second - samples[b.sampleIndex].second)
    .filter((event, index, all) => index === 0 || event.sampleIndex !== all[index - 1].sampleIndex || event.type === 'pci')
    .slice(0, 6);
}

export function buildRuleSummary(summary: ExecutiveSummary, worst: PoorEpisode | null): string {
  if (!summary.sampleCount) return '선택한 고객과 일자에 해당하는 측정 데이터가 없습니다.';
  if (!worst) return `측정 ${summary.sampleCount.toLocaleString()}건에서 QoE ${POOR_QOE_THRESHOLD.toFixed(1)} 미만의 연속 저하 구간이 관찰되지 않았습니다.`;
  return `대부분의 측정 구간과 별도로 ${worst.startTime}경 ${worst.site}·PCI ${worst.primaryPci}에서 최저 QoE ${worst.minQoe.toFixed(2)}의 연속 저하가 관찰되었습니다.`;
}
