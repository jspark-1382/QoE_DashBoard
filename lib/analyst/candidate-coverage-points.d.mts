import type {CandidateAnalysisEvidence, CandidateCoverageMetric, CandidateCoveragePoints, CandidateEvidenceTarget} from './candidate-ai-analysis';

export const MDT_SUPPORT_WEIGHT: number;
export function coveragePointMetric(target: CandidateEvidenceTarget): CandidateCoverageMetric | undefined;
export function buildCoveragePoints(targets?: CandidateEvidenceTarget[], links?: CandidateAnalysisEvidence['neighbourLinks']): CandidateCoveragePoints;
