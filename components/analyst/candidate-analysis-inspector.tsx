'use client';
/* oxlint-disable react/react-compiler -- Request lifecycle intentionally resets loading/error when the user opens the read-only inspector. */
import { useEffect, useId, useRef, useState } from 'react';
import {
  fetchCandidateAnalysisDiagnostics,
  type CandidateAnalysisDiagnostics,
  type CandidateAnalysisJob,
} from '../../lib/analyst/candidate-ai-analysis';
import styles from './candidate-ai-analysis.module.css';

type InspectorTab = 'system' | 'user' | 'data' | 'response';
const tabs: { id: InspectorTab; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'user', label: 'User' },
  { id: 'data', label: '전송 데이터' },
  { id: 'response', label: '응답·검증' },
];
const json = (value: unknown) => JSON.stringify(value, null, 2);
const timestamp = (value: string) => new Date(value).toLocaleString('ko-KR');
function RawSnapshot({ text, label }: { text: string; label: string }) {
  const [status, setStatus] = useState('');
  return (
    <div className={styles.rawSnapshot}>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setStatus('복사 완료');
          } catch {
            setStatus('복사 실패 · 아래 원문을 선택해 복사하세요.');
          }
        }}
      >
        원문 복사
      </button>
      <output>{status}</output>
      <pre aria-label={label}>{text}</pre>
    </div>
  );
}
export function CandidateDiagnosticsContent({
  diagnostics,
  tab,
}: {
  diagnostics: CandidateAnalysisDiagnostics;
  tab: InspectorTab;
}) {
  if (diagnostics.status === 'unavailable')
    return (
      <p className={styles.empty}>
        이전 실행에는 실제 전송 사본이 보관되지 않았습니다. System/User를
        재구성해 실제 전송본처럼 표시하지 않습니다.
      </p>
    );
  if (diagnostics.status === 'not-sent' && !diagnostics.request)
    return (
      <p className={styles.empty}>
        이 작업은 아직 모델에 전송되지 않았습니다. 수집 단계의 실패·취소 상태를
        확인하세요.
      </p>
    );
  if (tab === 'system' || tab === 'user') {
    const messages =
      diagnostics.request?.messages.filter((m) => m.role === tab) ?? [];
    return messages.length ? (
      <>
        {messages.map((message, i) => (
          <RawSnapshot
            key={i}
            text={message.content}
            label={tab + ' 실제 전송 원문'}
          />
        ))}
      </>
    ) : (
      <p>이 실행에 보관된 {tab} 메시지가 없습니다.</p>
    );
  }
  if (tab === 'data')
    return (
      <>
        <p className={styles.scopeNote}>
          보유량과 모델에 보낸 요약량은 집계 단위가 다를 수 있습니다. 전송
          필드·제외 자료를 함께 확인하세요.
        </p>
        <div className={styles.tableScroll}>
          <table>
            <thead>
              <tr>
                <th>자료</th>
                <th>보유</th>
                <th>전송</th>
                <th>전송 필드</th>
                <th>제외·미확보</th>
              </tr>
            </thead>
            <tbody>
              {diagnostics.transmission.map((row, i) => (
                <tr key={i}>
                  <th scope="row">{row.label}</th>
                  <td>{row.available ?? '미확인'}</td>
                  <td>{row.sent ?? '미확인'}</td>
                  <td>{row.fields.join(', ') || '없음'}</td>
                  <td>{row.excluded.join(', ') || '없음'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <RawSnapshot
          text={json(diagnostics.transmission)}
          label="전송 자료 집계 원문"
        />
      </>
    );
  return (
    <>
      <p
        className={
          diagnostics.validation?.status === 'failed'
            ? styles.error
            : styles.scopeNote
        }
      >
        <strong>
          {diagnostics.validation?.status === 'failed'
            ? '검증 실패'
            : diagnostics.validation?.status === 'passed'
              ? '검증 통과'
              : diagnostics.validation?.status === 'partial' ? (diagnostics.validation.code==='QWEN_INVALID_CORE' ? '비교 해석 검증 통과 · 기본 보고서 보류' : '기본 보고서 검증 통과 · 비교 해석 보류')
              : '검증 대기'}
        </strong>
        {diagnostics.validation?.code && ' · ' + diagnostics.validation.code}
        {diagnostics.validation?.message &&
          ' · ' + diagnostics.validation.message}
      </p>
      {diagnostics.referenceResolution && (
        <details>
          <summary>대상·근거 연결 확인</summary>
          <p className={styles.scopeNote}>모델 응답 원문은 그대로 보관하고, 전송한 근거와 정확히 일치하는 대상만 연결했습니다.</p>
          <pre aria-label="서버의 대상 연결 기록">{json(diagnostics.referenceResolution)}</pre>
        </details>
      )}
      {diagnostics.response ? (
        <>
          <p className={styles.scopeNote}>
            응답 {timestamp(diagnostics.response.receivedAt)} · 응답 모델{' '}
            {diagnostics.response.model ?? '미확인'} · 종료 사유{' '}
            {diagnostics.response.finishReason ?? '미확인'}
          </p>
          <RawSnapshot
            text={diagnostics.response.content ?? '응답 본문 없음'}
            label="모델 실제 응답 원문"
          />
          {diagnostics.response.usage && (
            <details>
              <summary>토큰 사용량</summary>
              <pre>{json(diagnostics.response.usage)}</pre>
            </details>
          )}
        </>
      ) : (
        <p>
          보관된 응답이 아직 없습니다. 전송 후 취소·연결 실패 여부를 확인하세요.
        </p>
      )}
    </>
  );
}
export function CandidateAnalysisInspector({
  job,
  open,
  id,
}: {
  job?: CandidateAnalysisJob | null;
  open: boolean;
  id: string;
}) {
  const [snapshot, setSnapshot] = useState<{
    jobId: string;
    value: CandidateAnalysisDiagnostics;
  } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<InspectorTab>('system');
  const [revision, setRevision] = useState(0);
  const tabPrefix = useId();
  const tabRefs = useRef(new Map<InspectorTab, HTMLButtonElement>());
  const jobId = job?.id;
  useEffect(() => {
    if (!open || !jobId) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void fetchCandidateAnalysisDiagnostics(jobId, fetch, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setSnapshot({ jobId, value });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : '실제 요청·응답을 불러오지 못했습니다.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // Read only when opened or explicitly refreshed; job status polls do not fetch snapshots.
  }, [open, jobId, revision]);
  if (!open) return null;
  const diagnostics =
    snapshot && snapshot.jobId === jobId ? snapshot.value : null;
  return (
    <aside className={styles.inspector} id={id} aria-label="AI 입력·응답 확인">
      <div className={styles.inspectorHeading}>
        <strong>AI 입력·응답 확인</strong>
        <button
          type="button"
          disabled={!jobId || loading}
          onClick={() => setRevision((v) => v + 1)}
        >
          기록 새로고침
        </button>
      </div>
      <p className={styles.scopeNote}>
        해당 실행에서 보관한 실제 전송 내용과 응답입니다. 열기·새로고침은 새 AI
        분석을 요청하지 않습니다.
      </p>
      {!jobId && <p>생성된 분석 작업이 없습니다.</p>}
      {loading && <output>실제 요청·응답 기록을 읽고 있습니다.</output>}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {diagnostics && (
        <>
          <div className={styles.inspectorMeta}>
            <span>
              {diagnostics.reused || job?.reused
                ? '기존 실행 재사용'
                : '새 요청'}
            </span>
            <span>
              요청 모델 {diagnostics.request?.model ?? job?.model ?? '미확인'}
            </span>
            {diagnostics.request && (
              <span>전송 {timestamp(diagnostics.request.capturedAt)}</span>
            )}
            {job?.modelVerification && (
              <span>
                소요 {(job.modelVerification.durationMs / 1000).toFixed(1)}초 ·
                응답 모델{' '}
                {job.modelVerification.responseModelVerified
                  ? '확인됨'
                  : '미확인'}
              </span>
            )}
          </div>
          {diagnostics.request?.redacted && (
            <p className={styles.refreshNotice}>
              민감정보를 마스킹한 사본입니다. 표시 원문에 마스킹이 포함되어
              있습니다.
            </p>
          )}
          {diagnostics.request && (
            <details className={styles.requestOptions}>
              <summary>전송 옵션·사본 식별값</summary>
              <pre>{json(diagnostics.request.parameters)}</pre>
              <p>사본 해시 {diagnostics.request.hash}</p>
            </details>
          )}
          <div
            role="tablist"
            aria-label="AI 실행 기록 구분"
            className={styles.inspectorTabs}
          >
            {tabs.map((item, index) => (
              <button
                key={item.id}
                ref={(node) => {
                  if (node) tabRefs.current.set(item.id, node);
                  else tabRefs.current.delete(item.id);
                }}
                type="button"
                role="tab"
                id={tabPrefix + '-' + item.id}
                aria-controls={tabPrefix + '-panel'}
                aria-selected={tab === item.id}
                tabIndex={tab === item.id ? 0 : -1}
                onClick={() => setTab(item.id)}
                onKeyDown={(event) => {
                  const next =
                    event.key === 'ArrowRight'
                      ? (index + 1) % tabs.length
                      : event.key === 'ArrowLeft'
                        ? (index + tabs.length - 1) % tabs.length
                        : event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? tabs.length - 1
                            : null;
                  if (next !== null) {
                    event.preventDefault();
                    setTab(tabs[next].id);
                    tabRefs.current.get(tabs[next].id)?.focus();
                  }
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={tabPrefix + '-panel'}
            aria-labelledby={tabPrefix + '-' + tab}
          >
            <CandidateDiagnosticsContent diagnostics={diagnostics} tab={tab} />
          </div>
        </>
      )}
    </aside>
  );
}
