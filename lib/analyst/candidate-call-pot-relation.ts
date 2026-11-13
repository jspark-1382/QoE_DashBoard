import type { CandidateAnalysisEvidence, CandidateEvidenceTarget } from './candidate-ai-analysis';
import type { CandidateCallInsight } from './candidate-call-insight';

type Relation = {
  relation: 'direct' | 'other-pot' | 'candidate-only' | 'no-selection' | 'unknown';
  callDate: string | null;
  observedPots: string[];
  locationScope: 'event' | 'call' | 'unknown';
  locationComplete: boolean;
  frequencyScope: 'event' | 'call' | 'unknown';
  frequencyLabel: string;
  channels: string[];
};

export type CandidateCallObservations = {
  sourceRevision: string;
  callId: string;
  callDate: string;
  samples: { timestamp: string; pot: string | null; earfcn: number | null; technology: 'LTE' | 'NR' | null }[];
};

type Channel = { id: string; technology: 'LTE' | 'NR' | 'unknown' };
const lteBands: Record<string, string> = {
  '3743': '900 MHz', '1694': '1.8 GHz 협대역', '1550': '1.8 GHz 광대역', '475': '2.1 GHz',
};

function asRecord(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
}

function channel(value: unknown, technology: unknown): Channel | undefined {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 0) return;
  return { id: String(id), technology: technology === 'LTE' || technology === 'NR' ? technology : 'unknown' };
}

type EventKind = 'overlap' | 'frequencyChange' | 'pollution';
function eventRecords(target: CandidateEvidenceTarget, kind: EventKind) {
  const criterion = asRecord(target.criteria?.[kind]);
  const observations = asRecord(criterion?.window)?.events;
  if (criterion?.status !== 'matched' || !Array.isArray(observations)) return [];
  return observations.map(asRecord).filter((row): row is Record<string, unknown> => !!row);
}
function eventChannels(target: CandidateEvidenceTarget, kind: EventKind) {
  return eventRecords(target, kind).flatMap(row => {
    // Pollution records identify the two sides of a transition, while the
    // return/carrier windows record individual timestamped observations.
    return kind === 'pollution'
      ? [channel(row.fromFrequency, row.technology), channel(row.toFrequency, row.technology)]
      : [channel(row.earfcn, row.technology)];
  });
}

// Match original instants, including sub-millisecond precision. Without a
// date, retain the source's Korean call date; never pick the nearest row.
function instant(timestamp: unknown, date: string) {
  if (typeof timestamp !== 'string') return;
  const m = /^(?:(\d{4}-\d{2}-\d{2})[T ])?(\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)?$/.exec(timestamp);
  if (!m) return;
  const time = Date.parse((m[1] ?? date) + 'T' + m[2] + (m[4] ?? '+09:00'));
  if (Number.isFinite(time)) return time + ':' + (m[3] ?? '').padEnd(9, '0');
}

function readLocations(result: Relation, selectedPot: string | null | undefined, samples: CandidateCallObservations['samples'],
  eventTimes: unknown[], declared: string[], date: string) {
  if (!selectedPot) result.relation = 'no-selection';
  else result.relation = 'candidate-only';
  const pots = (rows: CandidateCallObservations['samples']) => [...new Set(rows.flatMap(r => r.pot?.trim() || []))];
  if (eventTimes.length && samples.length) {
    const byInstant = new Map<string, CandidateCallObservations['samples']>();
    for (const row of samples) {
      const key = instant(row.timestamp, date);
      if (!key) continue;
      const list = byInstant.get(key);
      if (list) list.push(row);
      else byInstant.set(key, [row]);
    }
    const times = new Set(eventTimes.map(at => instant(at,date)));
    const located = [...times].flatMap(at => {
      const matches = at && byInstant.get(at);
      if (!matches) return [];
      // Conflicting locations in the same instant leave that instant unresolved.
      const known = pots(matches);
      return known.length === 1 ? known : [];
    });
    if (located.length) {
      result.locationScope = 'event';
      result.observedPots = [...new Set(located)];
      result.locationComplete = located.length === times.size;
      if (selectedPot) {
        if (result.observedPots.includes(selectedPot)) result.relation = 'direct';
        else if (result.locationComplete) result.relation = 'other-pot';
      }
      return;
    }
  }
  const duringCall = [...new Set([...pots(samples), ...declared])];
  if (duringCall.length) {
    result.locationScope = 'call';
    result.observedPots = duringCall;
    if (selectedPot && duringCall.includes(selectedPot)) result.relation = 'direct';
  }
}

function displayChannel(c: Channel) {
  if (c.technology === 'NR') return 'NR-ARFCN ' + c.id;
  if (c.technology === 'unknown') return '채널 ' + c.id + ' (대역 미확인)';
  const band = lteBands[c.id];
  return (band ? band + ' · ' : '') + 'EARFCN ' + c.id;
}

function describe(readings: (Channel | undefined)[], sequence: boolean) {
  const known = readings.filter((reading): reading is Channel => !!reading);
  if (!known.length) return;
  const labels = [...new Set(known.map(displayChannel))];
  if (known.length !== readings.length) labels.push('일부 미확인');
  return {
    frequencyLabel: labels.join(sequence ? ' → ' : ' / '),
    channels: [...new Set(known.map(reading => reading.id))],
  };
}

/** Keep the call's time/frequency evidence independent of the background MDT
 * selection. A single-call location record can establish a POT for the call
 * without placing the displayed event or the quality drop in that POT. */
export function getCandidateCallPotRelation(
  evidence: CandidateAnalysisEvidence | null | undefined,
  insight: CandidateCallInsight | null | undefined,
  selectedPot?: string | null,
  observations?: CandidateCallObservations | null,
): Relation {
  const result: Relation = { relation: 'unknown', callDate: null, observedPots: [], locationScope:'unknown',
    locationComplete:false, frequencyScope: 'unknown', frequencyLabel: '미확인', channels: [] };
  if (!evidence || !insight) return result;
  const call = insight.call;
  const member = [...(evidence.calls ?? []), ...(evidence.members ?? [])].some(row =>
    row.id === call.id && row.date === call.date && row.start === call.start && row.href === call.href);
  if (!member) return result;
  const facts = new Set((evidence.facts ?? []).map(fact => fact.id));
  const linked = (evidence.analysisTargets ?? []).filter(target =>
    target.callIds.includes(call.id) && target.sourceDates.includes(call.date) &&
    target.evidenceIds.length && target.evidenceIds.every(id => facts.has(id)));
  const source = linked.find(target => target.id === insight.targetId);
  if (!source) return result;
  result.callDate = call.date;
  const individual = linked.filter(target => target.callIds.length === 1 &&
    (target.kind === 'call-radio' || target.kind === 'call-quality' || target.kind === 'call-criteria'));
  const samples = observations && observations.callId === call.id && observations.callDate === call.date &&
    observations.sourceRevision && observations.sourceRevision === evidence.sourceRevision ? observations.samples : [];
  const declared = individual.flatMap(t => t.mapPoints.flatMap(p => p.date === call.date && p.pot ? p.pot : []));
  const kind = insight.kind;
  const isWindow = source.kind === 'call-criteria' && (kind === 'overlap' || kind === 'frequencyChange' || kind === 'pollution');
  const times = isWindow ? eventRecords(source,kind).flatMap(r => kind === 'pollution' ? [r.fromAt,r.at] : [r.at]) : [];
  readLocations(result, selectedPot, samples, times, declared, call.date);
  if (isWindow) {
    const exact = describe(eventChannels(source, kind), kind === 'frequencyChange');
    if (exact) return { ...result, ...exact, frequencyScope: 'event' };
  }
  // These identify frequencies somewhere in the same call, including when
  // the displayed termination or DL minimum has no frequency of its own.
  const timed = individual.filter(t => t.kind === 'call-criteria').flatMap(target =>
    (['overlap', 'frequencyChange', 'pollution'] as const).flatMap(k => eventChannels(target, k)))
    .filter((reading): reading is Channel => !!reading);
  const recorded = individual.filter(t => t.kind === 'call-radio')
    .map(t => channel(t.earfcn, undefined)).filter((reading): reading is Channel => !!reading);
  const all = [...timed, ...recorded, ...samples.flatMap(s => channel(s.earfcn, s.technology) ?? [])];
  const identified = new Set(all.filter(c => c.technology !== 'unknown').map(c => c.id));
  const available = describe(all.filter(c => c.technology !== 'unknown' || !identified.has(c.id)), false);
  return available ? { ...result, ...available, frequencyScope: 'call' } : result;
}
