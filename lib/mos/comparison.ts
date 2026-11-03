import type { AnalystOverview } from '../analyst/types';
import { mosGrade, type MosGrade } from './call-evidence';

export interface MosCandidateRow {
  callId: string;
  mosImproved: number | null;
}
export interface MosCandidateFile {
  algorithmVersion: string;
  sourceRevision: string;
  date: string;
  records: MosCandidateRow[];
}
export type MosComparisonRow = {
  callId: string;
  fullId: string;
  customerId: string;
  original: number;
  candidate: number;
  delta: number;
  originalGrade: MosGrade;
  candidateGrade: MosGrade;
};
export type MosComparison = {
  algorithmVersion: string;
  sourceRevision: string;
  date: string;
  submittedRows: number;
  matchedIds: number;
  unknownIds: number;
  unscoredOriginal: number;
  missingCandidate: number;
  paired: number;
  meanOriginal: number | null;
  meanCandidate: number | null;
  meanDifference: number | null;
  shiftedUp: number;
  shiftedDown: number;
  unchanged: number;
  gradeOriginal: Record<'POOR' | 'WARNING' | 'GOOD', number>;
  gradeCandidate: Record<'POOR' | 'WARNING' | 'GOOD', number>;
  greatestDifferences: MosComparisonRow[];
};

const hasObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const valid = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 5;
const baseline = (value: unknown) => valid(value) ? value : null;
const gradeIndex = (grade: MosGrade) => grade === 'POOR' ? 0 : grade === 'WARNING' ? 1 : grade === 'GOOD' ? 2 : -1;
const freshGradeCounts = () => ({ POOR: 0, WARNING: 0, GOOD: 0 });

export function compareMosCandidate(payload: unknown, overview: AnalystOverview): MosComparison {
  if (!hasObject(payload)) throw Error('개선 모델 파일의 최상위 구조가 올바르지 않습니다.');
  const {algorithmVersion, sourceRevision, date, records} = payload;
  if (typeof algorithmVersion !== 'string' || !/^[\w.-]{2,80}$/.test(algorithmVersion))
    throw Error('algorithmVersion은 영문·숫자·하이픈 등으로 구성된 2~80자 버전명이어야 합니다.');
  if (typeof sourceRevision !== 'string' || !overview.sourceRevision ||
      sourceRevision !== overview.sourceRevision)
    throw Error('sourceRevision이 현재 10월 30일 MOS 원본 데이터의 버전과 일치하지 않습니다.');
  if (date !== overview.date)
    throw Error('date가 현재 분석 일자와 다릅니다.');
  if (!Array.isArray(records) || records.length > 150000 || records.length === 0)
    throw Error('records에는 1~150,000개의 결과 행이 필요합니다.');

  const originalByCall = new Map(overview.calls.map((call) => [call.rawCallId ?? call.id, call]));
  const seen = new Set<string>();
  let sumOriginal = 0, sumImproved = 0, matchedIds = 0, unknownIds = 0, unscoredOriginal = 0, missingCandidate = 0;
  let shiftedUp = 0, shiftedDown = 0, unchanged = 0;
  const gradeOriginal = freshGradeCounts(), gradeCandidate = freshGradeCounts();
  const paired: MosComparisonRow[] = [];

  for (const row of records) {
    if (!hasObject(row) || typeof row.callId !== 'string' || !row.callId ||
        row.callId.length > 160 || (!valid(row.mosImproved) && row.mosImproved !== null)) {
      throw Error('records의 callId 또는 mosImproved 값이 잘못되었습니다 (유효 범위 1~5 또는 null).');
    }
    if (seen.has(row.callId)) throw Error('중복된 callId가 있습니다. 모델 결과는 통화당 최대 한 건이어야 합니다.');
    seen.add(row.callId);
    const call = originalByCall.get(row.callId);
    if (!call) { unknownIds++; continue; }
    matchedIds++;
    const original = baseline(call.mos);
    if (original === null) { unscoredOriginal++; continue; }
    if (row.mosImproved === null) { missingCandidate++; continue; }
    const before = mosGrade(original);
    const after = mosGrade(row.mosImproved);
    if (before === 'UNAVAILABLE' || after === 'UNAVAILABLE') continue;
    gradeOriginal[before]++;
    gradeCandidate[after]++;
    const change = gradeIndex(after) - gradeIndex(before);
    if (change > 0) shiftedUp++;
    else if (change < 0) shiftedDown++;
    else unchanged++;
    sumOriginal += original;
    sumImproved += row.mosImproved;
    paired.push({
      callId: row.callId,
      fullId: call.id,
      customerId: call.customerId,
      original,
      candidate: row.mosImproved,
      delta: row.mosImproved - original,
      originalGrade: before,
      candidateGrade: after,
    });
  }
  const total = paired.length;
  paired.sort((a,b) => Math.abs(b.delta) - Math.abs(a.delta) || a.callId.localeCompare(b.callId));
  return {
    algorithmVersion, sourceRevision, date, submittedRows: records.length,
    matchedIds, unknownIds, unscoredOriginal, missingCandidate,
    paired: total,
    meanOriginal: total ? sumOriginal / total : null,
    meanCandidate: total ? sumImproved / total : null,
    meanDifference: total ? (sumImproved - sumOriginal) / total : null,
    shiftedUp, shiftedDown, unchanged, gradeOriginal, gradeCandidate,
    greatestDifferences: paired.slice(0, 20),
  };
}
