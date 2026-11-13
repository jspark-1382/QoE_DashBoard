'use client';
/* oxlint-disable react/react-compiler -- Prompt drafts and diagnostic snapshots have an explicit, abortable request lifecycle. */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  candidateAnalysisTargetKey,
  CANDIDATE_PROMPT_LIMITS,
  fetchCandidateAnalysisDiagnostics,
  fetchCandidatePromptDraft,
  type CandidateAnalysisDiagnostics,
  type CandidateAnalysisJob,
  type CandidateAnalysisTarget,
  type CandidatePromptDraft,
} from '../../lib/analyst/candidate-ai-analysis';
import { CandidateDiagnosticsContent } from './candidate-analysis-inspector';
import styles from './candidate-ai-analysis.module.css';

const STORAGE_KEY = 'qoe:candidate-prompt-drafts:v1';
const MAX_DRAFTS = 8;
const MAX_STORAGE_CHARS = 1_500_000;
type DraftRecord = {
  key: string;
  draft: CandidatePromptDraft;
  sent: CandidatePromptDraft | null;
  source: string;
  updatedAt: number;
};
const sameDraft = (a: CandidatePromptDraft | null, b: CandidatePromptDraft | null) =>
  !!a && !!b && a.system === b.system && a.user === b.user;

function readDrafts(): DraftRecord[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is DraftRecord =>
      !!item && typeof item.key === 'string' &&
      typeof item.draft?.system === 'string' && typeof item.draft?.user === 'string' &&
      (item.sent === null || (typeof item.sent?.system === 'string' && typeof item.sent?.user === 'string')) &&
      typeof item.updatedAt === 'number' && typeof item.source === 'string',
    ).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_DRAFTS);
  } catch {
    return [];
  }
}

function storeDraft(record: DraftRecord) {
  try {
    const records = [record, ...readDrafts().filter((item) => item.key !== record.key)].slice(0, MAX_DRAFTS);
    while (records.length > 1 && JSON.stringify(records).length > MAX_STORAGE_CHARS) records.pop();
    if (JSON.stringify(records).length > MAX_STORAGE_CHARS) return false;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    return true;
  } catch {
    return false;
  }
}

function capturedDraft(diagnostics: CandidateAnalysisDiagnostics): CandidatePromptDraft | null {
  const system = diagnostics.request?.messages.filter((message) => message.role === 'system') ?? [];
  const user = diagnostics.request?.messages.filter((message) => message.role === 'user') ?? [];
  // Corrective attempts can append User messages; seed the original request only.
  return system.length >= 1 && user.length >= 1
    ? { system: system[0].content, user: user[0].content }
    : null;
}

export function useCandidatePromptDraft(target: CandidateAnalysisTarget, seedJob?: CandidateAnalysisJob) {
  const key = candidateAnalysisTargetKey(target);
  const [record, setRecord] = useState<DraftRecord | null>(null);
  const recordRef = useRef<DraftRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const currentKey = useRef(key);
  currentKey.current = key;
  const targetRef = useRef(target);
  targetRef.current = target;
  const seedRef = useRef(seedJob);
  seedRef.current = seedJob;

  const commit = useCallback((value: DraftRecord) => {
    recordRef.current = value;
    setRecord(value);
    setStorageError(!storeDraft(value));
  }, []);

  const load = useCallback(async (defaultsOnly: boolean) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const requestedKey = currentKey.current;
    const requestedTarget = targetRef.current;
    setLoading(true);
    setError('');
    try {
      let draft: CandidatePromptDraft | null = null;
      let source = '현재 후보의 기본 프롬프트';
      const job = seedRef.current;
      if (!defaultsOnly && job?.id) {
        try {
          const diagnostics = await fetchCandidateAnalysisDiagnostics(job.id, fetch, { signal: controller.signal });
          draft = capturedDraft(diagnostics);
          if (draft) source = diagnostics.request?.redacted ? '이전 전송본 · 민감정보 마스킹 포함' : '이전 실제 전송본';
        } catch (cause) {
          if (controller.signal.aborted) throw cause;
          // Older jobs may have no captured request; the server prepares a fresh default.
        }
      }
      if (!draft) {
        const prepared = await fetchCandidatePromptDraft(requestedTarget, fetch, { signal: controller.signal });
        draft = { system: prepared.system, user: prepared.user };
      }
      if (controller.signal.aborted || requestedKey !== currentKey.current) return;
      if (defaultsOnly) {
        commit({ key: requestedKey, draft, sent: recordRef.current?.key === requestedKey ? recordRef.current.sent : null, source, updatedAt: Date.now() });
      } else {
        commit({ key: requestedKey, draft, sent: draft, source, updatedAt: Date.now() });
      }
    } catch (cause) {
      if (!controller.signal.aborted && requestedKey === currentKey.current)
        setError(cause instanceof Error ? cause.message : '프롬프트를 불러오지 못했습니다.');
    } finally {
      if (!controller.signal.aborted && requestedKey === currentKey.current) setLoading(false);
    }
  }, [commit]);

  useEffect(() => {
    const saved = readDrafts().find((item) => item.key === key);
    setStorageError(false);
    setError('');
    if (saved) {
      recordRef.current = saved;
      setRecord(saved);
      setLoading(false);
    } else {
      recordRef.current = null;
      setRecord(null);
      void load(false);
    }
    return () => request.current?.abort();
  }, [key, load]);

  const activeRecord = record?.key === key ? record : null;
  const draft = activeRecord?.draft ?? null;
  return {
    draft,
    loading,
    error,
    storageError,
    dirty: !!activeRecord && !sameDraft(activeRecord.draft, activeRecord.sent),
    tooLong: !!draft && (draft.system.length > CANDIDATE_PROMPT_LIMITS.system || draft.user.length > CANDIDATE_PROMPT_LIMITS.user),
    source: activeRecord?.source ?? '',
    update: (field: keyof CandidatePromptDraft, value: string) => {
      if (activeRecord) commit({ ...activeRecord, draft: { ...activeRecord.draft, [field]: value }, updatedAt: Date.now() });
    },
    restoreDefault: () => { void load(true); },
    retry: () => { void load(false); },
    markSent: () => {
      if (activeRecord) commit({ ...activeRecord, sent: { ...activeRecord.draft }, source: '전송 요청한 프롬프트', updatedAt: Date.now() });
    },
  };
}

export type CandidatePromptEditorState = ReturnType<typeof useCandidatePromptDraft>;

export function CandidatePromptEditor({ editor, job, busy, id }: {
  editor: CandidatePromptEditorState;
  job?: CandidateAnalysisJob;
  busy: boolean;
  id: string;
}) {
  return <section className={styles.promptWorkspace} id={id} aria-label="프롬프트 수정·테스트">
    <div className={styles.promptEditing}>
      <div className={styles.promptHeading}>
        <div><strong>프롬프트 수정</strong><span>{editor.source}</span></div>
        <button type="button" className={styles.detailButton} disabled={editor.loading || busy} onClick={editor.restoreDefault}>기본값 복원</button>
      </div>
      <p className={styles.promptHelp}>System과 User를 수정한 뒤 위의 전송을 누르면 이 내용으로 새 분석을 실행합니다.</p>
      {editor.loading && <output className={styles.promptLoading}>전송할 프롬프트를 불러오는 중입니다.</output>}
      {editor.error && <p className={styles.error} role="alert">{editor.error} <button type="button" onClick={editor.retry}>다시 불러오기</button></p>}
      {editor.draft && <div className={styles.promptFields}>
        {(['system', 'user'] as const).map((field) => <label key={field}>
          <span><strong>{field === 'system' ? 'System · 분석 지시' : 'User · 분석 요청·자료'}</strong><small>{editor.draft![field].length.toLocaleString('ko-KR')}자</small></span>
          <textarea aria-label={field + ' 프롬프트 수정'} spellCheck={false} value={editor.draft![field]} disabled={editor.loading || busy} onChange={(event) => editor.update(field, event.target.value)} />
        </label>)}
      </div>}
      {editor.dirty && <output className={styles.promptUnsent}>미전송 수정사항 · 전송을 누르기 전까지 분석에 적용되지 않습니다.</output>}
      {editor.tooLong && <p className={styles.error}>전송 가능한 길이는 System {CANDIDATE_PROMPT_LIMITS.system.toLocaleString('ko-KR')}자, User {CANDIDATE_PROMPT_LIMITS.user.toLocaleString('ko-KR')}자까지입니다.</p>}
      {editor.storageError && <p className={styles.historyError}>이 탭에 임시 저장할 수 없습니다. 창을 닫기 전에 수정 내용을 복사하세요.</p>}
      <p className={styles.promptHelp}>같은 후보·분석 조건의 초안은 이 탭에 임시 저장됩니다. 보고서 형식 검증을 통과한 결과는 최근 3개 저장 비교에 추가됩니다.</p>
    </div>
    <CandidatePromptTestResponse job={job} />
  </section>;
}

export function CandidatePromptTestResponse({ job }: { job?: CandidateAnalysisJob }) {
  const [snapshot, setSnapshot] = useState<{ id: string; value: CandidateAnalysisDiagnostics } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const id = job?.id;
  const status = job?.status;
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void fetchCandidateAnalysisDiagnostics(id, fetch, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setSnapshot({ id, value }); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '응답을 불러오지 못했습니다.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, status, revision]);
  const diagnostics = snapshot?.id === id ? snapshot?.value : null;
  return <aside className={styles.promptResponse} aria-label="프롬프트 테스트 응답">
    <div className={styles.promptHeading}>
      <div><strong>실제 응답·검증</strong><span>{job?.promptEdited ? '수정 프롬프트 실행' : '선택한 실행 기록'}</span></div>
      <button type="button" className={styles.detailButton} disabled={!id || loading} onClick={() => setRevision((value) => value + 1)}>응답 새로고침</button>
    </div>
    <p className={styles.promptHelp}>보고서 형식과 다른 응답도 원문으로 확인할 수 있습니다. 검증 실패 응답은 분석 결과로 저장하지 않습니다.</p>
    {loading && <output className={styles.promptLoading}>실제 응답을 불러오는 중입니다.</output>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!id && <p className={styles.empty}>전송하면 모델의 실제 응답과 검증 결과가 여기에 표시됩니다.</p>}
    {job?.error && <p className={styles.historyError}>{job.error.message}</p>}
    {diagnostics?.response && diagnostics.validation?.status === 'failed' && <output className={styles.promptReceived}>응답 수신 · 분석 보고서에는 미적용</output>}
    {diagnostics && <CandidateDiagnosticsContent diagnostics={diagnostics} tab="response" />}
  </aside>;
}
