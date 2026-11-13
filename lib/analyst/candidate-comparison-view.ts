import type { CandidateAnalysisJob, CandidateAnalysisReport, CandidateEvidenceTarget } from './candidate-ai-analysis';

type Comparison = NonNullable<CandidateAnalysisReport['comparison']>;
const causeCategories = new Set(['coverage','capacity','mobility','equipment','interference']);

function sameSide(source: Comparison['alternative'] | undefined, cited: Comparison['alternative']) {
  if (!source || !cited) return source === null && cited === null;
  return source.category === cited.category && Array.isArray(source.evidenceIds) &&
    source.evidenceIds.length === cited.evidenceIds.length && cited.evidenceIds.every(id => source.evidenceIds.includes(id));
}

/** Reconnect each quoted source only to this response's original public measurements. */
export function getCandidateComparisonView(job?: CandidateAnalysisJob | null) {
  const evidence = job?.evidence, comparison = job?.report?.comparison;
  if (!evidence || job.status !== 'completed' || !comparison ||
      evidence.versions?.prompt !== 'candidate-prompt-v11' || comparison.schemaVersion !== 'cause-comparison-v1' ||
      !job.model?.trim() || job.modelVerification?.responseModelVerified !== true ||
      job.modelVerification.responseModel !== job.model ||
      !['prioritize','unresolved'].includes(comparison.assessment) ||
      [comparison.interpretation,comparison.limitation,comparison.nextCheck].some(t => typeof t !== 'string' || !t.trim())) return;

  const sourceFacts = new Map(evidence.facts.map(f => [f.id, f]));
  const byEvidence = new Map<string, CandidateEvidenceTarget>();
  const ambiguous = new Set<string>();
  for (const target of evidence.analysisTargets) {
    for (const id of target.evidenceIds) {
      if (byEvidence.has(id)) ambiguous.add(id);
      byEvidence.set(id, target);
    }
  }
  function side(value: Comparison['primary']) {
    if (!value || !causeCategories.has(value.category) || !Array.isArray(value.evidenceIds) || !value.evidenceIds.length ||
        value.evidenceIds.length > 12 || new Set(value.evidenceIds).size !== value.evidenceIds.length) return;
    const sources = value.evidenceIds.flatMap(id => {
      const fact = sourceFacts.get(id), target = byEvidence.get(id);
      return /^T\d+$/.test(id) && !ambiguous.has(id) && fact && target?.allowedCauseCategories?.includes(value.category)
        ? [{id,fact,target}] : [];
    });
    if (sources.length === value.evidenceIds.length) return {category:value.category,sources};
  }
  const primary = side(comparison.primary), alternative = comparison.alternative && side(comparison.alternative);
  if (!primary || (comparison.alternative === null ? comparison.assessment !== 'unresolved' :
    !alternative || alternative.category === primary.category)) return;
  const reading = evidence.comparisonReading;
  const readingText = reading && typeof reading.text === 'string' && reading.text.trim() &&
    sameSide(reading.primary, comparison.primary) && sameSide(reading.alternative, comparison.alternative) ? reading.text : undefined;
  return {comparison,primary,alternative,model:job.model,readingText};
}
