import {
  isReadableCandidateAnalysisJob,
  areCandidateCauseAssessmentsValid,
  type CandidateAnalysisJob,
  type CandidateAnalysisEntry,
  type CandidateAnalysisReport,
  type CandidateCauseCategory,
  type CandidateEvidenceTarget,
  type CandidateSopTemplate,
} from './candidate-ai-analysis';
import { investigationPriority } from './candidate-investigation-presentation';

/** Present up to five real grids and five calls; no missing criterion becomes a match. */
export function getBalancedCandidateCoverageTargets(targets: CandidateEvidenceTarget[], category: 'coverage' | 'uplink') {
  const key = category === 'coverage' ? 'dl' : 'ul';
  const matched = targets.filter((target, index) => targets.findIndex(other => other.id === target.id) === index &&
    (!target.allowedCauseCategories || target.allowedCauseCategories.includes(category)) &&
    (target.criteria?.[key] as { status?: string } | undefined)?.status === 'matched');
  return [...matched.filter(target => target.kind === 'mdt-grid').slice(0, 5), ...matched.filter(target => target.kind !== 'mdt-grid').slice(0, 5)];
}

/** Reconnect the source rows from this run only. Historical taxonomies stay intact. */
export function getCandidateSourceCauseAssessments(job?: CandidateAnalysisJob | null) {
  const evidence = job?.evidence;
  if (!evidence?.causeAssessments || !areCandidateCauseAssessmentsValid(evidence)) return [];
  const targets = new Map(evidence.analysisTargets.map(target => [target.id, target]));
  return evidence.causeAssessments.map(row => ({
    ...row,
    targets: row.targetIds.map(id => targets.get(id)!),
  }));
}

export type CandidateSelectedFinding = {
  id: string;
  category: CandidateCauseCategory;
  hypothesis: CandidateAnalysisReport['hypotheses'][number];
  targets: CandidateEvidenceTarget[];
  templates: CandidateSopTemplate[];
};

const categories = new Set<CandidateCauseCategory>([
  'capacity', 'interference', 'coverage', 'uplink', 'mobility', 'equipment',
]);

/**
 * Derive the main view exclusively from the current, verified model response.
 * Observation rules, keywords and unselected context POTs never create findings.
 */
export function getCandidateSelectedFindings(
  job: CandidateAnalysisJob | null | undefined,
): CandidateSelectedFinding[] {
  // Historical conditions affect reuse, not faithful inspection of the saved response.
  const structurallyValid = isReadableCandidateAnalysisJob(job);
  if (!structurallyValid || !job?.evidence || !job.report) return [];
  const { evidence, report } = job;
  const targetsById = new Map(evidence.analysisTargets.map(target => [target.id, target]));
  // Ambiguous public IDs cannot safely reconnect a model alias to a location.
  if (targetsById.size !== evidence.analysisTargets.length) return [];
  if (report.hypotheses.some(hypothesis => !categories.has(hypothesis.category))) return [];

  return report.hypotheses.flatMap((hypothesis, index) => {
    if (hypothesis.assessment !== 'supported' && hypothesis.assessment !== 'possible') return [];
    const targets = hypothesis.targetIds.flatMap(id => {
      const target = targetsById.get(id);
      return target ? [target] : [];
    });
    if (!targets.length || targets.length !== hypothesis.targetIds.length) return [];
    const supporting = hypothesis.supportingEvidenceIds;
    if (!Array.isArray(supporting) || !supporting.length ||
      supporting.some(id => !targets.some(target => target.evidenceIds.includes(id))) ||
      targets.some(target => !target.evidenceIds.some(id => supporting.includes(id)))) return [];

    const allowedSops = new Set(targets.flatMap(target => target.sopIds));
    if (hypothesis.sopIds.some(id => !allowedSops.has(id))) return [];
    const selectedSops = new Set(hypothesis.sopIds);
    // Every target the user can open needs a procedure applicable to that target.
    if (targets.some(target => !target.sopIds.some(id => selectedSops.has(id)))) return [];
    const templates = evidence.sop.templates.filter(template =>
      selectedSops.has(template.id) && allowedSops.has(template.id),
    );
    if (!templates.length || templates.length !== selectedSops.size) return [];

    return [{
      id: [job.id, index, hypothesis.category, ...hypothesis.targetIds].join(':'),
      category: hypothesis.category,
      hypothesis,
      targets,
      templates,
    }];
  });
}

/** Keep actual selected POT aliases in model order; an unlocated cause stays unlocated. */
export function getFindingPotIds(findings: readonly CandidateSelectedFinding[]): string[] {
  const pots = new Set<string>();
  for (const finding of findings) {
    for (const target of finding.targets) {
      for (const point of target.mapPoints) {
        if (typeof point.pot === 'string' && point.pot.trim() &&
          Number.isFinite(point.lat) && Number.isFinite(point.lon) &&
          Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180) pots.add(point.pot);
      }
    }
  }
  return [...pots];
}

/** Keep the completed report readable while a new request owns the active job. */
export function getCandidateDisplayJob(entry?: CandidateAnalysisEntry): CandidateAnalysisJob | undefined {
  return (entry?.job?.report ? entry.job : undefined) ?? entry?.history?.find(job => !!job.report);
}

export function getCandidateSavedReports(entry?: CandidateAnalysisEntry): CandidateAnalysisJob[] {
  return (entry?.history ?? []).filter((job, index, jobs) =>
    !!job.report && jobs.findIndex(other => other.id === job.id) === index,
  ).slice(0, 3);
}

/** Compare exact public target IDs within each cause, never keywords in model prose. */
export function getCandidateReviewComparison(job?: CandidateAnalysisJob | null) {
  const review = job?.evidence?.independentReview;
  const findings = getCandidateSelectedFindings(job);
  const targets = job?.evidence?.analysisTargets ?? [];
  const modelPairs = new Set(findings.flatMap(finding => finding.targets.map(target => finding.category + ':' + target.id)));
  const rulePairs = new Set(review?.priorities.flatMap(priority => priority.targetIds.map(id => priority.category + ':' + id)) ?? []);
  const describe = (pair: string) => {
    const separator = pair.indexOf(':');
    return { category: pair.slice(0, separator), target: targets.find(target => target.id === pair.slice(separator + 1)) };
  };
  return {
    agreement: [...rulePairs].filter(pair => modelPairs.has(pair)).map(describe),
    extra: [...modelPairs].filter(pair => !rulePairs.has(pair)).map(describe),
    missing: [...rulePairs].filter(pair => !modelPairs.has(pair)).map(describe),
  };
}

/** Resolve a user selection against this snapshot; an empty cause never borrows a target. */
export function getCandidateCauseSelection(job: CandidateAnalysisJob | null | undefined, category?: CandidateCauseCategory, targetId?: string) {
  const rows = getCandidateSourceCauseAssessments(job);
  const priority = investigationPriority(rows);
  const row = targetId
    ? rows.find(row => row.category === category && row.targetIds.includes(targetId)) ?? rows.find(row => row.targetIds.includes(targetId))
    : rows.find(row => row.category === category) ?? priority ?? rows[0];
  const firstTarget = row?.targets[0]?.id;
  return { category: row?.category ?? 'coverage' as CandidateCauseCategory, targetId: targetId && row?.targetIds.includes(targetId) ? targetId : firstTarget ?? '' };
}
