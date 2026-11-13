import type { CandidateAnalysisEvidence, CandidateCauseAssessment, CandidateEvidenceTarget } from './candidate-ai-analysis';
import { buildCoveragePoints, coveragePointMetric } from './candidate-coverage-points.mjs';
import { potCauseLabel } from './candidate-pot-review';

export function formatInvestigationBand(band: string) {
  if (band === '900') return '900 MHz';
  if (band === '1.8협') return '1.8 GHz 협대역';
  if (band === '1.8광') return '1.8 GHz 광대역';
  if (band === '2.1') return '2.1 GHz';
  return band;
}

export function gridWeakPercent(target: CandidateEvidenceTarget, thresholdDbm = -105) {
  const labels = ['RSRP ≤' + thresholdDbm, 'RSRP ≤' + thresholdDbm + ' dBm'];
  const raw = target.metrics.find(metric => labels.includes(metric.label.replace(/≤\s+/, '≤')) && metric.unit === '%')?.value;
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : null;
}

export function gridReading(target?: CandidateEvidenceTarget) {
  if (target?.kind !== 'mdt-grid') return;
  const point = target.mapPoints[0];
  if (!point?.pot || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return;
  const samples = target.metrics.find(metric => metric.label === '측정 수')?.value;
  return { target, point,
    percent: gridWeakPercent(target),
    samples: typeof samples === 'number' && Number.isSafeInteger(samples) && samples >= 0 ? samples : null,
  };
}

/** A comparison must have two distinct, dated measurements of the same frequency. */
export function investigationGridPair(evidence?: CandidateAnalysisEvidence) {
  const pair = evidence?.coverageComparison;
  if (!pair || pair.thresholdDbm !== -105 || !Number.isFinite(pair.distanceM) || pair.distanceM <= 0) return;
  const read = (id: string) => gridReading(evidence.analysisTargets.find(target => target.id === id));
  const primary = read(pair.primaryTargetId), comparison = read(pair.comparisonTargetId);
  if (!primary || !comparison || primary.percent == null || comparison.percent == null ||
      primary.point.pot === comparison.point.pot || [primary, comparison].some(reading =>
        reading.point.date !== pair.sourceDate || reading.target.band !== pair.band ||
        reading.point.band !== pair.band || reading.target.earfcn !== pair.earfcn)) return;
  const other = pair.otherBandTargetId ? read(pair.otherBandTargetId) : undefined;
  const otherBand = other?.point.pot === primary.point.pot && other?.point.date === pair.sourceDate &&
    other.target.earfcn && other.target.earfcn !== pair.earfcn && other.percent != null ? other : undefined;
  return { primary, comparison, otherBand, distanceM: pair.distanceM };
}

export type SourceCauseRow = CandidateCauseAssessment & { targets: CandidateEvidenceTarget[] };
export function investigationHeadline(row: SourceCauseRow, legacyFour: boolean) {
  if (row.headline?.trim()) return row.headline.trim();
  const label = potCauseLabel(row.category, legacyFour);
  if (row.status === 'insufficient') return label + ' 판단 자료 필요';
  return label + ' 검토';
}

export function investigationPriority(rows: SourceCauseRow[]) {
  const supported = rows.filter(row => row.status !== 'insufficient' && row.targets.length);
  return supported.length === 1 ? supported[0] : undefined;
}

/** Join computed field priorities to their own dated measurements, including saved projections. */
export function investigationCoverage(evidence?: CandidateAnalysisEvidence) {
  const targets = evidence?.analysisTargets ?? [];
  const byId = new Map(targets.map(t => [t.id, t]));
  const catalog = evidence?.coveragePoints ?? buildCoveragePoints(targets, evidence?.neighbourLinks ?? []);
  const points = catalog.points.flatMap(item => {
    const reading = gridReading(byId.get(item.targetId));
    if (!reading || byId.size !== targets.length || item.pot !== reading.point.pot ||
      item.sourceDate !== reading.point.date || item.band !== reading.point.band ||
      item.band !== reading.target.band || item.earfcn !== reading.target.earfcn) return [];
    const comparisons = item.comparisons.flatMap(ref => {
      const peer = gridReading(byId.get(ref.targetId));
      if (!peer || peer.point.date !== item.sourceDate || peer.percent == null || peer.target.id === item.targetId) return [];
      const adjacent = ref.kind === 'adjacent-same-carrier' && peer.point.pot !== item.pot &&
        peer.target.band === item.band && peer.target.earfcn === item.earfcn && ref.distanceM > 0;
      const otherBand = ref.kind === 'same-pot-other-band' && peer.point.pot === item.pot &&
        peer.target.band !== item.band && peer.target.earfcn !== item.earfcn;
      return adjacent || otherBand ? [{...ref, reading: peer}] : [];
    });
    return [{...item, metric:item.metric ?? coveragePointMetric(reading.target), reading, comparisons}];
  });
  return {catalog, points, savedSubset: !evidence?.coveragePoints};
}
export type InvestigationCoverage = ReturnType<typeof investigationCoverage>;
