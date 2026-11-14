'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Crosshair,
  ExternalLink,
  LoaderCircle,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import {
  candidateAnalysisTargetKey,
  createCandidateAnalysisManager,
  isCandidateAnalysisBusy,
  candidateAnalysisDisplayState,
  isCurrentCandidateAnalysisJob,
  isReadableCandidateAnalysisJob,
  hasPreviousCandidateCondition,
  type CandidateAnalysisEntry,
  type CandidateAnalysisJob,
  type CandidateAnalysisTarget,
  type CandidateAnalysisEvidence,
  type CandidateSopTemplate,
  type CandidatePromptDraft,
} from '../../lib/analyst/candidate-ai-analysis';
import Link from './document-link';
import {
  CandidateTargetFindings,
  CandidateTargetDetails,
  TargetSource,
} from './candidate-analysis-targets';
import { CandidateAnalysisInspector } from './candidate-analysis-inspector';
import { CandidatePotWorkspace } from './candidate-pot-workspace';
import { CandidatePromptEditor, useCandidatePromptDraft } from './candidate-prompt-editor';
import { getCandidateRepresentativeCause } from '../../lib/analyst/candidate-representative-cause';
import { getCandidateDisplayJob, getCandidateSavedReports, getCandidateCauseSelection } from '../../lib/analyst/candidate-ai-selections';
import styles from './candidate-ai-analysis.module.css';

const n = (value: number | null | undefined) =>
  value == null ? '미산정' : value.toLocaleString('ko-KR');
const metric = (value: number | null | undefined) =>
  value == null ? '미확인' : value.toFixed(2);
const statuses = {
  queued: '분석 대기',
  collecting: '후보 근거 수집 중',
  analyzing: 'Qwen 분석 중',
  completed: '분석 완료',
  failed: '분석 실패',
  cancelled: '분석 취소',
};
const assessments = {
  supported: '관측 근거 있음',
  possible: '가능성 검토',
  insufficient: '근거 부족',
};
const stateLabels = {
  ...statuses,
  'status-error': '상태 조회 실패',
  idle: '미분석',
};
const statusText = (entry?: CandidateAnalysisEntry) =>
  isCandidateAnalysisBusy(entry) && entry?.job?.attempt && (entry.job.attempt.status === 'retrying' || entry.job.attempt.attempt > 1)
    ? 'Qwen 응답 교정 중 · ' + entry.job.attempt.attempt + '차'
    : entry?.pending && !entry.job && !entry.error
    ? '분석 요청 중'
    : !entry?.error && entry?.job?.status === 'completed' && entry.job.report?.mode === 'comparison-only'
    ? '비교 해석 완료 · 전체 보고서 미확보'
    : stateLabels[candidateAnalysisDisplayState(entry)];
const needsRefresh = (entry?: CandidateAnalysisEntry) =>
  !!entry?.job?.report && !isCurrentCandidateAnalysisJob(entry.job);
export const candidateAiButtonLabel = (entry?: CandidateAnalysisEntry) =>
  isCandidateAnalysisBusy(entry)
    ? '분석 중'
    : needsRefresh(entry)
      ? '재분석 필요'
      : entry?.error || entry?.job?.status === 'failed'
        ? '다시 시도'
        : entry?.job?.status === 'completed'
          ? '분석 보기'
          : 'AI 분석';

export function useCandidateAiAnalysis() {
  const [entries, setEntries] = useState<Map<string, CandidateAnalysisEntry>>(
    new Map(),
  );
  const manager = useRef<ReturnType<
    typeof createCandidateAnalysisManager
  > | null>(null);
  const [dialogTarget, setDialogTarget] =
    useState<CandidateAnalysisTarget | null>(null);
  const [dialogTitle, setDialogTitle] = useState('');
  const ensureManager = useCallback(() => {
    if (!manager.current) manager.current = createCandidateAnalysisManager({ onChange: setEntries });
    return manager.current;
  }, []);
  useEffect(() => {
    const current = ensureManager();
    current.restore();
    return () => {
      current.dispose();
      if (manager.current === current) manager.current = null;
    };
  }, [ensureManager]);
  return {
    entries,
    dialogTarget,
    dialogTitle,
    entry: (target: CandidateAnalysisTarget) =>
      entries.get(candidateAnalysisTargetKey(target)),
    changed: (target: CandidateAnalysisTarget) =>
      !entries.has(candidateAnalysisTargetKey(target)) &&
      hasPreviousCandidateCondition(target),
    previous: (target: CandidateAnalysisTarget) =>
      [...entries.values()]
        .filter(
          (entry) =>
            entry.target.candidateId === target.candidateId &&
            candidateAnalysisTargetKey(entry.target) !==
              candidateAnalysisTargetKey(target),
        )
        .at(-1),
    start: (target: CandidateAnalysisTarget) => {
      void ensureManager().start(target);
    },
    rerun: (target: CandidateAnalysisTarget) => {
      void ensureManager().start(target, { rerun: true });
    },
    sendPrompt: (target: CandidateAnalysisTarget, draft: CandidatePromptDraft) => {
      void ensureManager().start(target, { rerun: true, promptOverride: { ...draft } });
    },
    selectSaved: (target: CandidateAnalysisTarget, id: string) => ensureManager().selectSaved(target, id),
    cancel: (target: CandidateAnalysisTarget) => {
      void ensureManager().cancel(target);
    },
    open: (target: CandidateAnalysisTarget, title: string) => {
      setDialogTarget(target);
      setDialogTitle(title);
      void ensureManager().loadHistory(target);
    },
    close: () => setDialogTarget(null),
  };
}

export function CandidateAiSummary({
  entry,
  stale = false,
  onOpen,
  onStart,
  onCancel,
}: {
  entry?: CandidateAnalysisEntry;
  stale?: boolean;
  onOpen: () => void;
  onStart: () => void;
  onCancel: () => void;
}) {
  const displayJob = getCandidateDisplayJob(entry);
  const report = displayJob?.report,
    busy = isCandidateAnalysisBusy(entry),
    refresh = stale || needsRefresh(entry);
  const evidenceJob = entry?.job?.status === 'failed' && entry.job.evidence ? entry.job : displayJob;
  const representative = useMemo(() => evidenceJob?.evidence && getCandidateRepresentativeCause(evidenceJob), [evidenceJob]);
  return (
    <section
      className={styles.summary}
      aria-label="선택 후보 AI 요약"
      data-ai-state={refresh ? 'stale' : candidateAnalysisDisplayState(entry)}
    >
      <div className={styles.summaryHeading}>
        <strong>
          <Sparkles size={14} /> AI 분석 · 조사 대상과 확인 사항
        </strong>
        <output>{refresh ? '재분석 필요' : statusText(entry)}</output>
      </div>
      {refresh ? (
        <p>{displayJob?.currentConditionsMatch === false ? '저장 당시 결과 · 현재 원본·설정과 다름. 이전 분석은 상세 화면에서 확인하고 현재 조건으로 재분석할 수 있습니다.' : '현재 조건으로 재분석하면 POT·통화별 조사 이유와 확인 사항을 볼 수 있습니다.'}</p>
      ) : representative ? (
        <dl className={styles.shortSummary}>
          <div>
            <dt>대표 원인 가설</dt>
            <dd data-summary-representative-title>{representative.title}</dd>
          </div>
          <div>
            <dt>{evidenceJob?.status === 'failed' ? '수집한 원본 근거' : '근거'}</dt>
            <dd>{representative.summary}</dd>
          </div>
        </dl>
      ) : report ? (
        <p>{report.summary.observed}</p>
      ) : (
        <p>
          {entry?.error ||
            entry?.job?.error?.message ||
            (busy
              ? 'POT와 실제 통화의 관측 근거를 대조하고 조사 순서를 정리합니다.'
              : '조사할 POT·통화, 관측 근거, 조사 이유와 확인 사항을 정리합니다.')}
        </p>
      )}
      <div className={styles.summaryActions}>
        {(report || entry?.job?.evidence || busy) && (
          <button
            type="button"
            className={styles.detailButton}
            onClick={onOpen}
          >
            조사 대상·근거 보기 <ArrowRight size={14} />
          </button>
        )}
        {busy && !stale ? (
          <button type="button" className={styles.cancel} onClick={onCancel}>
            <Square size={11} /> 취소
          </button>
        ) : (
          (!report || refresh) && (
            <button
              type="button"
              className={styles.detailButton}
              onClick={onStart}
            >
              <Sparkles size={13} />
              {refresh
                ? '현재 조건 재분석'
                : entry?.job?.status === 'failed' || entry?.error
                  ? '다시 시도'
                  : 'AI 분석'}
            </button>
          )
        )}
      </div>
    </section>
  );
}

const analysisTime = (job: CandidateAnalysisJob) => {
  const date = new Date(job.persistence?.savedAt ?? job.updatedAt);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' })
    : '시각 미확인';
};

export function CandidateSavedAnalysisHistory({ entry, selectedId, onSelect }: {
  entry?: CandidateAnalysisEntry; selectedId?: string; onSelect: (id: string) => void;
}) {
  const jobs = getCandidateSavedReports(entry);
  return <section className={styles.savedHistory} aria-label="최근 저장 분석 비교"><div className={styles.savedCards}>{jobs.map((job, index) => <button key={job.id} type="button" data-saved-analysis={job.id} aria-pressed={selectedId === job.id} onClick={() => onSelect(job.id)}><b>{index === 0 ? '최근 결과' : '이전 ' + index}</b><time dateTime={job.persistence?.savedAt ?? job.updatedAt}>{analysisTime(job)}</time>{job.currentConditionsMatch === false && <small>이전 조건</small>}</button>)}</div><span>저장 {jobs.length}/3</span>{entry?.historyError && <output className={styles.historyError}>저장 결과 조회 실패 · {entry.historyError}</output>}</section>;

}

function selectedTemplates(evidence: CandidateAnalysisEvidence, ids: string[]) {
  return ids.flatMap((id) => {
    const template = evidence.sop.templates.find((item) => item.id === id);
    return template ? [template] : [];
  });
}

export function CandidateAiDialog({
  target,
  title,
  locality,
  entry,
  onClose,
  onStart,
  onCancel,
  onSelectSaved,
  onSendPrompt,
}: {
  target: CandidateAnalysisTarget;
  title: string;
  locality?: string;
  entry?: CandidateAnalysisEntry;
  onClose: () => void;
  onStart: () => void;
  onCancel: () => void;
  onSelectSaved?: (id: string) => void;
  onSendPrompt?: (draft: CandidatePromptDraft) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    evidenceDisclosure = useRef<HTMLDetailsElement>(null);
  const facts = useRef(new Map<string, HTMLElement>()),
    actionCards = useRef(new Map<number, HTMLElement>());
  const [focusedFact, setFocusedFact] = useState(''),
    [memberPage, setMemberPage] = useState(0);
  const [selectedTargetId, setSelectedTargetId] = useState('');
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [selectedSavedId, setSelectedSavedId] = useState('');
  const [retainedReport, setRetainedReport] = useState<CandidateAnalysisJob | undefined>(undefined);
  const latestReport = getCandidateDisplayJob(entry);
  const displayedJob = getCandidateSavedReports(entry).find(job => job.id === selectedSavedId) ?? latestReport ?? retainedReport;
  const displayedEntry = displayedJob && entry ? { ...entry, job: displayedJob, pending: false, error: '' } : entry;
  const inspectorJob = selectedSavedId ? displayedJob : entry?.job ?? displayedJob;
  const promptEditor = useCandidatePromptDraft(target, inspectorJob);
  const targetDetails = useRef<HTMLDivElement>(null);
  const [investigationSelection, setInvestigationSelection] = useState<{ targetId: string; selection: number; source?: 'criteria'; category?: import('../../lib/analyst/candidate-ai-analysis').CandidateCauseCategory }>();
  const prefix = useId(),
    job = displayedJob ?? entry?.job,
    evidence = job?.evidence,
    report = job?.report;
  const sourceAssessmentJob = !selectedSavedId && entry?.job?.evidence?.causeAssessments ? entry.job : job;
  const effectiveCause = getCandidateCauseSelection(sourceAssessmentJob, investigationSelection?.category, investigationSelection?.targetId);
  const effectiveSelection = investigationSelection && { ...effectiveCause, source: 'criteria' as const, selection: investigationSelection.selection };
  const busy = isCandidateAnalysisBusy(entry),
    refresh = needsRefresh(displayedEntry);
  const readable = isReadableCandidateAnalysisJob(job);
  const hypotheses = readable && report ? report.hypotheses.slice(0, 5) : [];
  const allLimits = [
    ...new Set([
      ...(evidence?.limitations ?? []),
      ...(report?.limitations ?? []),
    ]),
  ];
  const analysisTargets = evidence?.analysisTargets ?? [];
  const activeTargetId = analysisTargets.some(
    (item) => item.id === selectedTargetId,
  )
    ? selectedTargetId
    : (analysisTargets[0]?.id ?? '');
  const callPeriod = target.scope.dateStart + ' ~ ' + target.scope.dateEnd;

  function showTarget(id: string) {
    setSelectedTargetId(id);
    requestAnimationFrame(() => {
      targetDetails.current?.scrollIntoView({
        block: 'start',
        behavior: 'smooth',
      });
      targetDetails.current?.focus({ preventScroll: true });
    });
  }

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const prior =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const oldOverflow = document.body.style.overflow,
      oldPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = Math.max(
      0,
      window.innerWidth - document.documentElement.clientWidth,
    );
    if (scrollbarWidth > 0)
      document.body.style.paddingRight =
        (Number.parseFloat(getComputedStyle(document.body).paddingRight) || 0) +
        scrollbarWidth +
        'px';
    document.body.style.overflow = 'hidden';
    node.showModal();
    return () => {
      node.close();
      document.body.style.overflow = oldOverflow;
      document.body.style.paddingRight = oldPaddingRight;
      queueMicrotask(() => {
        if (prior?.isConnected && !prior.closest('[inert]'))
          prior.focus({ preventScroll: true });
      });
    };
  }, []);

  function showFact(id: string) {
    if (evidenceDisclosure.current) evidenceDisclosure.current.open = true;
    setFocusedFact(id);
    requestAnimationFrame(() => {
      const node = facts.current.get(id);
      node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      node?.focus({ preventScroll: true });
    });
  }
  function showAction(index: number) {
    const actionTarget = analysisTargets[index];
    if (!actionTarget) return;
    setSelectedTargetId(actionTarget.id);
    requestAnimationFrame(() => {
      const node = actionCards.current.get(index);
      node?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      node?.focus({ preventScroll: true });
    });
  }
  function references(ids: string[]) {
    return (
      <div className={styles.references}>
        {ids.map((id) => (
          <button key={id} type="button" onClick={() => showFact(id)}>
            {evidence?.facts.find((fact) => fact.id === id)?.title ??
              '관련 관측 자료'}
          </button>
        ))}
      </div>
    );
  }
  function procedureLists(templates: CandidateSopTemplate[]) {
    return (
      <div className={styles.actionColumns}>
        <div>
          <h5>지금 확인</h5>
          {templates.map((step) => (
            <ul key={step.id}>
              {step.checkNow.map((text, index) => (
                <li key={index}>{text}</li>
              ))}
            </ul>
          ))}
        </div>
        <div>
          <h5>확인 결과에 따른 개선</h5>
          {templates.map((step) => (
            <ul className={styles.conditions} key={step.id}>
              {step.conditionalActions.map((item, index) => (
                <li key={index}>
                  <strong>{item.when}</strong>
                  <p>{item.action}</p>
                </li>
              ))}
            </ul>
          ))}
        </div>
        <div>
          <h5>변경 후 검증</h5>
          {templates.map((step) => (
            <ul key={step.id}>
              {step.verifyAfter.map((text, index) => (
                <li key={index}>{text}</li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    );
  }

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={prefix + '-title'}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className={styles.dialogHeader}>
        <div className={styles.candidateIdentity}>
          <Crosshair size={24} aria-hidden="true" />
          <h2 id={prefix + '-title'}>{title || evidence?.candidate.title}</h2>
          <p className={styles.workspaceSubtitle}>{locality && <span>{locality} · </span>}{evidence?.summary.poorCalls != null && '저QoE 통화 ' + n(evidence.summary.poorCalls) + '건'}</p>
          <p className={styles.callScope} title={callPeriod}>{target.scope.dateStart.replaceAll('-','.')} – {target.scope.dateEnd.startsWith(target.scope.dateStart.slice(0,4)) ? target.scope.dateEnd.slice(5).replace('-','.') : target.scope.dateEnd.replaceAll('-','.')}</p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.detailButton} aria-expanded={promptEditorOpen} aria-controls={prefix + '-prompt-editor'} onClick={() => { setPromptEditorOpen((value) => !value); setInspectorOpen(false); }}>프롬프트 수정</button>
          <button type="button" className={styles.promptSend} disabled={busy || promptEditor.loading || promptEditor.tooLong || !promptEditor.draft?.system.trim() || !promptEditor.draft?.user.trim() || !onSendPrompt} onClick={() => {
            if (!promptEditor.draft || !onSendPrompt) return;
            setRetainedReport(displayedJob);
            setSelectedSavedId('');
            setPromptEditorOpen(true);
            setInspectorOpen(false);
            onSendPrompt({ ...promptEditor.draft });
            promptEditor.markSent();
          }}>전송</button>
          {busy && <button type="button" className={styles.detailButton} onClick={onCancel}>분석 취소</button>}
          <button
            type="button"
            className={styles.close}
            aria-label="후보 분석 팝업 닫기"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
      </header>
      <div className={`${styles.dialogBody} ${styles.investigationBody}`}>
        {job?.currentConditionsMatch === false && <output className={styles.historicalNotice}>저장 당시 결과 · 현재 원본·설정과 다름 · 재분석 필요. 아래 보고서와 원본 근거는 저장된 실행의 내용입니다.</output>}
        <CandidateSavedAnalysisHistory entry={entry} selectedId={job?.id} onSelect={id => { setSelectedSavedId(id); setInvestigationSelection(undefined); setInspectorOpen(false); onSelectSaved?.(id); }} />
        {busy && <output className={styles.runningReport}><LoaderCircle size={15} className={styles.spin} />새 분석 진행 중 · {statusText(entry)} · {displayedJob?.report ? '이전 결과를 계속 확인할 수 있습니다.' : '근거를 수집하고 있습니다.'}</output>}
        {entry?.error && <output className={styles.historyError}>새 분석 상태 확인 실패 · {entry.error}</output>}
        {entry?.job?.status === 'failed' && displayedJob?.id !== entry.job.id && <output className={styles.historyError} role="alert" aria-label="새 분석 실패 상세">새 분석 실패 · {entry.job.error?.code || '응답 검증 보류'} · {entry.job.error?.message || '새 분석을 완료하지 못했습니다.'} · 이전 저장 결과를 계속 표시합니다. AI 입력·응답 확인에서 이번 응답을 볼 수 있습니다.</output>}
        {promptEditorOpen && <CandidatePromptEditor editor={promptEditor} job={inspectorJob} busy={busy} id={prefix + '-prompt-editor'} />}
        <div className={styles.potContent} data-displayed-analysis={job?.id}>
          {sourceAssessmentJob?.id !== job?.id && <p className={styles.scopeNote} aria-label="원본 기준 평가 출처">이번 요청에서 수집한 원본 관측 기준입니다. 아래 AI 조사 제안·원인 보고서는 이전 저장 결과를 계속 표시합니다.</p>}
          <CandidatePotWorkspace
            target={target}
            entry={displayedEntry}
            sourceCriteriaJob={sourceAssessmentJob}
            investigationSelection={effectiveSelection}
            onSelectCause={(category, targetId) => setInvestigationSelection(previous => ({ category, targetId, source: 'criteria', selection: (previous?.selection ?? 0) + 1 }))}
          />
          <div className={styles.reportTools} aria-label="판정 기준 및 AI 도구">
          <details key={sourceAssessmentJob?.id} className={styles.legacyReport} data-summary-detail="criteria" data-summary-disclosure="criteria"><summary>판정 기준</summary>
            <p>{sourceAssessmentJob?.evidence?.versions.evidence === 'candidate-evidence-v7'
              ? '커버리지는 날짜·대역별 RSRP 분포와 통화의 RSRP·PHR를 대조합니다. 셀 중첩은 같은 주파수에서의 서빙 셀 복귀, 전환은 서빙 셀 반복 변경 또는 EARFCN 변경을 확인합니다. 용량과 장비·전송·단말 이상은 각각 셀 자원 기록과 통화 종료 원문을 확인합니다.'
              : '이 실행에 저장된 원본 관측 기준과 조사 대상을 표시합니다.'}</p>
            <pre>{JSON.stringify(sourceAssessmentJob?.evidence?.causeAssessments ?? [], null, 2)}</pre>
          </details>
          <details className={styles.legacyReport} data-summary-disclosure="ai" onToggle={event => setInspectorOpen(event.currentTarget.open)}><summary>AI 입력·응답</summary><CandidateAnalysisInspector job={inspectorJob} open={inspectorOpen} id={prefix + '-inspector'} /></details>
          {report?.mode !== 'comparison-only' && <details className={styles.legacyReport} data-summary-disclosure="evidence">
            <summary>후보 전체 AI 보고서·통화 근거</summary>
        <section
          className={styles.stage}
          data-analysis-stage="1"
          aria-labelledby={prefix + '-stage1'}
        >
          <div className={styles.stageHeading}>
            <h3 id={prefix + '-stage1'}>1 문제 요약</h3>
            <output>{statusText(entry)}</output>
          </div>
          {evidence?.summary ? (
            <>
              <div className={styles.metrics}>
                <div>
                  <span>서로 다른 고객</span>
                  <b>{n(evidence.summary.customers)}명</b>
                </div>
                <div>
                  <span>구성 통화</span>
                  <b>{n(evidence.summary.totalCalls)}건</b>
                </div>
                <div>
                  <span>관측 날짜</span>
                  <b>{n(evidence.summary.observedDays)}일</b>
                </div>
                <div>
                  <span>SIP Drop</span>
                  <b>{n(evidence.summary.dropCalls)}건</b>
                </div>
              </div>
              <p className={styles.problemSentence}>
                {readable && report
                  ? report.summary.observed
                  : '저품질 통화로 선정된 후보 구성 집단에서 ' +
                    n(evidence.summary.customers) +
                    '명의 통화 ' +
                    n(evidence.summary.totalCalls) +
                    '건이 ' +
                    n(evidence.summary.observedDays) +
                    '일에 걸쳐 관측되었습니다.'}
              </p>
              <p className={styles.scopeNote}>
                위 수치는 후보 구성 집단의 집계입니다. 지역 전체 통화의 불량률을
                뜻하지 않습니다.
              </p>
            </>
          ) : (
            <p className={styles.empty}>
              {busy
                ? '후보 구성 통화의 서버 집계를 수집하고 있습니다.'
                : '수집된 서버 집계가 아직 없습니다.'}
            </p>
          )}
          {analysisTargets.length > 0 && (
            <CandidateTargetFindings
              targets={analysisTargets}
              onSelect={showTarget}
            />
          )}
          {busy && (
            <output className={styles.progress}>
              <LoaderCircle size={18} className={styles.spin} />
              {entry?.job ? statuses[entry.job.status] : '분석 요청 중'} · 원인과 개선 조치를
              준비하고 있습니다.
            </output>
          )}
          {(entry?.error || job?.error) && (
            <div className={styles.error} role="alert">
              {entry?.error || job?.error?.message}
              {evidence && (
                <span>
                  수집된 자료는 2단계의 상세 근거에서 확인할 수 있습니다.
                </span>
              )}
            </div>
          )}
          {refresh && (
            <p className={styles.refreshNotice}>
              이전 형식의 저장 보고서입니다. 확보된 원본 연결은 계속 확인할 수 있으며,
              현재 조건으로 재분석하면 최신 조사 제안을 볼 수 있습니다.
            </p>
          )}
          {(busy || !report || refresh || entry?.error) && (
            <div className={styles.summaryActions}>
              {busy ? (
                <button
                  type="button"
                  className={styles.cancel}
                  onClick={onCancel}
                >
                  <Square size={12} /> 분석 취소
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.detailButton}
                  onClick={onStart}
                >
                  {refresh
                    ? '현재 조건 재분석'
                    : entry?.error || job?.status === 'failed'
                      ? '다시 시도'
                      : 'AI 분석'}
                </button>
              )}
            </div>
          )}
          <details className={styles.versionInfo}>
            <summary>분석 범위·설정·판단의 한계</summary>
            <div className={styles.fixedMeta}>
              <span>
                <b>분석 범위</b> {target.scope.dateStart} ~{' '}
                {target.scope.dateEnd} · 매일 {target.scope.from} ~{' '}
                {target.scope.to}
              </span>
              <span>
                <b>군집 조건</b> {evidence?.candidate.algorithm ?? 'DBSCAN'} ·{' '}
                {target.candidateScope.analysisMode === 'all'
                  ? '전체 기간 후보'
                  : '발견·평가 분리'}
                {evidence && ' · ' + parameterText(evidence)}
              </span>
              <span>
                <b>분석 시각</b>{' '}
                {job
                  ? new Date(job.updatedAt).toLocaleString('ko-KR')
                  : '요청 전'}
              </span>
            </div>
            <p>
              모델: {job?.model || '아직 확인되지 않음'}
              <br />
              원본 자료: {target.sourceRevision}
              <br />
              분석 조건: {target.candidateScope.scopeKey}
            </p>
            {evidence && (
              <>
                <p>
                  근거 {evidence.versions.evidence} · 프롬프트{' '}
                  {evidence.versions.prompt} · SOP {evidence.sop.version}
                  <br />
                  분석 지문 {evidence.fingerprint}
                </p>
                <p>
                  전체 군집 설정:{' '}
                  {JSON.stringify(evidence.candidate.parameters)}
                </p>
              </>
            )}
            {allLimits.length > 0 && (
              <ul>
                {allLimits.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            )}
          </details>
        </section>

        <section
          className={styles.stage}
          data-analysis-stage="2"
          aria-labelledby={prefix + '-stage2'}
        >
          <div className={styles.stageHeading}>
            <h3 id={prefix + '-stage2'}>2 원인 분석</h3>
            <span>관측에 기반한 가설 · 확정 원인 아님</span>
          </div>
          {analysisTargets.length > 0 && (
            <div
              ref={targetDetails}
              tabIndex={-1}
              className={styles.targetDetailAnchor}
            >
              <CandidateTargetDetails
                targets={analysisTargets}
                selectedId={activeTargetId}
                onSelect={setSelectedTargetId}
                callPeriod={callPeriod}
              />
            </div>
          )}
          {evidence && hypotheses.length > 0 ? (
            <div className={styles.hypotheses}>
              {hypotheses.map((item, index) => {
                const linkedTargets = analysisTargets.filter((target) =>
                  item.targetIds.includes(target.id),
                );
                return (
                  <div
                    className={styles.hypothesisRow}
                    key={index}
                    data-hypothesis-index={index}
                    data-target-ids={item.targetIds.join(' ')}
                    data-sop-ids={item.sopIds.join(' ')}
                  >
                    <div className={styles.itemHeading}>
                      <h4>{item.title}</h4>
                      <span data-assessment={item.assessment}>
                        {assessments[item.assessment]}
                      </span>
                    </div>
                    <p className={styles.observed}>
                      {linkedTargets
                        .map((target) => target.observation)
                        .join(' / ')}
                    </p>
                    <div className={styles.rowActions}>
                      <details className={styles.reasonDisclosure}>
                        <summary>판단 근거</summary>
                        <p>{item.reason}</p>
                        {references(item.supportingEvidenceIds)}
                        <p>
                          <strong>추가 확인</strong> {item.missingEvidence}
                        </p>
                      </details>
                      <button
                        type="button"
                        className={styles.detailButton}
                        aria-controls={
                          prefix +
                          '-action-' +
                          analysisTargets.findIndex((target) =>
                            item.targetIds.includes(target.id),
                          )
                        }
                        onClick={() =>
                          showAction(
                            analysisTargets.findIndex((target) =>
                              item.targetIds.includes(target.id),
                            ),
                          )
                        }
                      >
                        개선 조치 보기 <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className={styles.empty}>
              {refresh && !readable
                ? '원인별 연결은 재분석 후 표시됩니다.'
                : busy
                  ? '관측 사실을 바탕으로 원인 가설을 분석하고 있습니다.'
                  : report
                    ? '확정할 원인 가설 없음 · 관측된 대상과 추가 확인 절차는 그대로 확인할 수 있습니다.'
                    : '모델의 원인 설명이 아직 없습니다. 수집된 대상별 관측 근거를 먼저 확인하세요.'}
            </p>
          )}
          {evidence && (
            <details
              ref={evidenceDisclosure}
              className={styles.evidenceDisclosure}
            >
              <summary>상세 근거·전체 구성 통화·원본 보기</summary>
              {evidence.publicCoverage && evidence.publicCoverage.omittedTargets > 0 && <p className={styles.scopeNote} aria-label="상세 근거 표시 범위">전체 조사 대상 {n(evidence.publicCoverage.reviewedTargets)}개는 서버에서 검토했으며, Qwen에는 {n(evidence.publicCoverage.modelSentTargets)}개를 전송했습니다. 이 화면은 전송·규칙 검토·보고서와 연결된 {n(evidence.publicCoverage.detailedTargets)}개 대상의 상세 근거를 표시하고, 나머지 {n(evidence.publicCoverage.omittedTargets)}개의 상세 근거는 생략합니다.</p>}
              {report && readable && (
                <div className={styles.evidenceBlock}>
                  <h4>확인된 관측 사실과 추가 점검</h4>
                  {report.observations.map((item, index) => (
                    <div key={index}>
                      <p>{item.text}</p>
                      {references(item.evidenceIds)}
                    </div>
                  ))}
                  {report.checks.map((item, index) => (
                    <div key={index}>
                      <strong>{item.action}</strong>
                      <p>{item.reason}</p>
                      {references(item.evidenceIds)}
                    </div>
                  ))}
                </div>
              )}
              <div className={styles.evidenceBlock}>
                <h4>서버 집계 보충</h4>
                <p>
                  원본 MOS 평균 {metric(evidence.summary?.meanMos)} · 저장된 QoE
                  평균 {metric(evidence.summary?.meanQoe)} · 정상 비교 통화{' '}
                  {evidence.comparison?.status === 'available'
                    ? n(evidence.comparison.calls) + '건'
                    : '없음 / 미산정'}
                  . Drop 집계로 전체 SIP 성공 여부를 판단하지 않습니다.
                </p>
              </div>
              <div>
                <h4>위치와 조사 범위</h4>
                <div className={styles.inlineFacts}>
                  <span>
                    표시 반경 <b>{n(evidence.candidate.radiusM)}m</b>
                  </span>
                  <span>
                    최대 점간 거리{' '}
                    <b>
                      {evidence.candidate.maxPairDistanceM == null
                        ? '미산정'
                        : evidence.candidate.maxPairDistanceM.toLocaleString(
                            'ko-KR',
                            { maximumFractionDigits: 1 },
                          ) + 'm'}
                    </b>
                  </span>
                  <span>
                    범위 검토{' '}
                    <b>
                      {evidence.candidate.rangeReviewRequired
                        ? '필요'
                        : '일반 확인'}
                    </b>
                  </span>
                  <span>
                    GPS <b>{n(evidence.location.gpsCalls)}통화</b>
                  </span>
                  <span>
                    MDT 근사 <b>{n(evidence.location.roughCalls)}통화</b>
                  </span>
                </div>
                <p>
                  표시 원, 구성점의 분포, 위치 추정 오차는 서로 다릅니다. 통화
                  대표 관측 위치가 품질 저하 순간의 위치를 확정하지 않습니다.
                </p>
                <p>
                  발견일: {evidence.candidate.discoveryDates.join(', ')}
                  <br />
                  별도 평가일:{' '}
                  {evidence.candidate.validationDates.length
                    ? evidence.candidate.validationDates.join(', ')
                    : '없음'}
                </p>
              </div>
              <div>
                <h4>정상 비교군과 자료 충분성</h4>
                <p>{evidence.comparison.conditions}</p>
                <ul>
                  {evidence.comparison.limitations.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
                <p>{evidence.coverage.detailsPolicy}</p>
                <div className={styles.inlineFacts}>
                  <span>
                    위치 근거 <b>{n(evidence.coverage.locationCalls)}통화</b>
                  </span>
                  <span>
                    상세 표본 <b>{n(evidence.coverage.sampledCalls)}통화</b>
                  </span>
                  <span>
                    연결 무선 근거 <b>{n(evidence.coverage.radioCalls)}통화</b>
                  </span>
                  <span>
                    RTP 근거 <b>{n(evidence.coverage.rtpCalls)}통화</b>
                  </span>
                </div>
              </div>
              {evidence.coverage.matchedMdt && (
                <div>
                  <h4>후보 통화에 연결된 MDT 측정</h4>
                  <p>{evidence.coverage.matchedMdt.description}</p>
                  <div className={styles.inlineFacts}>
                    <span>
                      연결된 독립 통화{' '}
                      <b>{n(evidence.coverage.matchedMdt.matchedCalls)}통화</b>
                    </span>
                    <span>
                      MDT 측정 행{' '}
                      <b>{n(evidence.coverage.matchedMdt.measurementRows)}행</b>
                    </span>
                    <span>
                      유효 행{' '}
                      <b>{n(evidence.coverage.matchedMdt.validRows)}행</b>
                    </span>
                  </div>
                </div>
              )}
              {evidence.radio && (
                <div>
                  <h4>통화 매칭 무선·RTP 상세 표본</h4>
                  <p>
                    {evidence.radio.weighting} · {evidence.radio.timingStatus}.
                    정상 비교군이나 승인된 기준 없이 양호·불량 등급을 매기지
                    않습니다.
                  </p>
                  <div className={styles.inlineFacts}>
                    <span>
                      RSRP 평균{' '}
                      <b>
                        {metric(evidence.radio.meanRsrp)} dBm /{' '}
                        {n(evidence.radio.rsrpCalls)}통화
                      </b>
                    </span>
                    <span>
                      SINR 평균{' '}
                      <b>
                        {metric(evidence.radio.meanSinr)} dB /{' '}
                        {n(evidence.radio.sinrCalls)}통화
                      </b>
                    </span>
                  </div>
                  {evidence.rtp && (
                    <div className={styles.tableScroll}>
                      <table>
                        <thead>
                          <tr>
                            <th>RTP 원본 필드</th>
                            <th>확보 통화</th>
                            <th>표본 평균</th>
                            <th>단위 상태</th>
                          </tr>
                        </thead>
                        <tbody>
                          {evidence.rtp.map((row) => (
                            <tr key={row.field}>
                              <td>{row.field}</td>
                              <td>{n(row.measuredCalls)}</td>
                              <td>{metric(row.mean)}</td>
                              <td>{row.unit}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
              <div>
                <h4>지도 배경 MDT 25m 참고 격자</h4>
                <p>{evidence.mdtGrid.description}</p>
                <p>
                  측정일:{' '}
                  {evidence.mdtGrid.measurementDates.length
                    ? evidence.mdtGrid.measurementDates.join(', ')
                    : '확인되지 않음'}{' '}
                  · 주파수: {evidence.mdtGrid.frequency || '확인되지 않음'}
                </p>
                <p>
                  후보 구성에 사용한 위치, 후보 통화와 연결된 MDT 측정, 배경
                  격자는 별도 자료입니다. Top1은 측정 행 수가 가장 많은 대역이며
                  최강 신호나 통화 당시 서빙 셀이 아닙니다.
                </p>
              </div>
              <div>
                <h4>분석 문장에 연결된 근거</h4>
                <div className={styles.facts}>
                  {evidence.facts.map((fact) => (
                    <article
                      key={fact.id}
                      tabIndex={-1}
                      ref={(node) => {
                        if (node) facts.current.set(fact.id, node);
                        else facts.current.delete(fact.id);
                      }}
                      className={
                        focusedFact === fact.id ? styles.focusedFact : ''
                      }
                    >
                      <h4>
                        <span>{fact.id}</span>
                        {fact.title}
                      </h4>
                      <p>{fact.detail}</p>
                    </article>
                  ))}
                </div>
              </div>
              <div className={styles.tables}>
                <h4>날짜·Cell·시간대별 후보 구성 통화</h4>
                <div className={styles.tableScroll}>
                  <table>
                    <caption>일별 관측 · 후보 구성 집단</caption>
                    <thead>
                      <tr>
                        <th>날짜</th>
                        <th>구성 통화</th>
                        <th>QoE 평가</th>
                        <th>저품질</th>
                        <th>Drop</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evidence.byDay.map((day) => (
                        <tr key={day.date}>
                          <td>{day.date}</td>
                          <td>{n(day.totalCalls)}</td>
                          <td>{n(day.evaluatedCalls)}</td>
                          <td>{n(day.poorCalls)}</td>
                          <td>{n(day.dropCalls)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className={styles.tableScroll}>
                  <table>
                    <caption>
                      Cell별 관측 · 시간 정합이나 원인 확정과 다름
                    </caption>
                    <thead>
                      <tr>
                        <th>Cell</th>
                        <th>구성 통화</th>
                        <th>QoE 평가</th>
                        <th>저품질</th>
                        <th>Drop</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evidence.byCell.map((cell) => (
                        <tr key={cell.cell}>
                          <td>{cell.cell || '미확인'}</td>
                          <td>{n(cell.totalCalls)}</td>
                          <td>{n(cell.evaluatedCalls)}</td>
                          <td>{n(cell.poorCalls)}</td>
                          <td>{n(cell.dropCalls)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {evidence.byHour && (
                  <details>
                    <summary>시간대별 관측 보기</summary>
                    <div className={styles.tableScroll}>
                      <table>
                        <thead>
                          <tr>
                            <th>시간대</th>
                            <th>구성 통화</th>
                            <th>저품질</th>
                            <th>Drop</th>
                          </tr>
                        </thead>
                        <tbody>
                          {evidence.byHour.map((hour) => (
                            <tr key={hour.hour}>
                              <td>{String(hour.hour).padStart(2, '0')}시</td>
                              <td>{n(hour.totalCalls)}</td>
                              <td>{n(hour.poorCalls)}</td>
                              <td>{n(hour.dropCalls)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </div>
              {evidence.members && (
                <div data-evidence-members>
                  <h4>
                    전체 후보 구성 고객·통화{' '}
                    <small>서버 검증 집합 {n(evidence.members.length)}건</small>
                  </h4>
                  <p>
                    고객 표기는 로컬 별칭입니다. 각 행은 전체 구성 집합에 속한
                    통화이며, 아래 대표 상세 표본과 구분합니다.
                  </p>
                  <div className={styles.tableScroll}>
                    <table>
                      <thead>
                        <tr>
                          <th>고객</th>
                          <th>날짜·시각</th>
                          <th>MOS / QoE</th>
                          <th>Cell</th>
                          <th>원본</th>
                        </tr>
                      </thead>
                      <tbody>
                        {evidence.members
                          .slice(memberPage * 50, (memberPage + 1) * 50)
                          .map((call) => (
                            <tr key={call.id}>
                              <td>{call.customerLabel}</td>
                              <td>
                                {call.date} {call.start}
                              </td>
                              <td>
                                {metric(call.mos)} / {metric(call.qoe)}
                              </td>
                              <td>{call.cell || '미확인'}</td>
                              <td>
                                <Link
                                  href={call.href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  통화 상세 <ExternalLink size={13} />
                                </Link>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  {evidence.members.length > 50 && (
                    <div className={styles.pagination}>
                      <button
                        type="button"
                        disabled={memberPage === 0}
                        onClick={() => setMemberPage((value) => value - 1)}
                      >
                        이전
                      </button>
                      <span>
                        {memberPage + 1} /{' '}
                        {Math.ceil(evidence.members.length / 50)}쪽
                      </span>
                      <button
                        type="button"
                        disabled={
                          (memberPage + 1) * 50 >= evidence.members.length
                        }
                        onClick={() => setMemberPage((value) => value + 1)}
                      >
                        다음
                      </button>
                    </div>
                  )}
                </div>
              )}
              <div data-evidence-calls>
                <h4>대표 상세 표본과 원본 통화</h4>
                <p>
                  아래 표는 상세 표본이며 위 전체 집계의 분모와 다릅니다. 원본
                  상세는 새 탭에서 열어 현재 후보와 분석 결과를 유지합니다.
                </p>
                <div className={styles.tableScroll}>
                  <table>
                    <thead>
                      <tr>
                        <th>날짜·시각</th>
                        <th>MOS / QoE</th>
                        <th>RSRP / SINR</th>
                        <th>Cell·위치 근거</th>
                        <th>원본 확인</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evidence.calls.map((call) => (
                        <tr key={call.id}>
                          <td>
                            {call.date}
                            <br />
                            {call.start}
                            {call.isDrop && (
                              <b className={styles.drop}> SIP Drop</b>
                            )}
                          </td>
                          <td>
                            {metric(call.mos)} / {metric(call.qoe)}
                          </td>
                          <td>
                            {metric(call.rsrp)} / {metric(call.sinr)}
                          </td>
                          <td>
                            {call.cell || '미확인'}
                            <small>
                              {call.locationEvidence === 'gnss'
                                ? 'GPS'
                                : call.locationEvidence === 'rough' ||
                                    call.locationEvidence === 'estimated'
                                  ? 'MDT 근사'
                                  : call.locationEvidence || '위치 미확인'}
                            </small>
                          </td>
                          <td>
                            <Link
                              href={call.href}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              통화 상세 <ExternalLink size={13} />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </details>
          )}
        </section>

        <section
          className={styles.stage}
          data-analysis-stage="3"
          aria-labelledby={prefix + '-stage3'}
        >
          <div className={styles.stageHeading}>
            <h3 id={prefix + '-stage3'}>3 원인별 개선 조치·SOP</h3>
            <span>관측 확인 → 조건부 개선 → 효과 검증</span>
          </div>
          {evidence && analysisTargets.length > 0 ? (
            <div className={styles.actionCards}>
              {analysisTargets.map((analysisTarget, index) => {
                const templates = selectedTemplates(
                  evidence,
                  analysisTarget.sopIds,
                );
                const callIds = new Set(analysisTarget.callIds);
                const calls = evidence.calls.filter((call) =>
                  callIds.has(call.id),
                );
                const members = evidence.members.filter(
                  (call) =>
                    callIds.has(call.id) &&
                    !calls.some((sample) => sample.id === call.id),
                );
                const linkedHypotheses = hypotheses.filter((item) =>
                  item.targetIds.includes(analysisTarget.id),
                );
                return (
                  <article
                    key={analysisTarget.id}
                    id={prefix + '-action-' + index}
                    data-target-action={analysisTarget.id}
                    data-target-id={analysisTarget.id}
                    data-sop-ids={analysisTarget.sopIds.join(' ')}
                    tabIndex={-1}
                    ref={(node) => {
                      if (node) actionCards.current.set(index, node);
                      else actionCards.current.delete(index);
                    }}
                    className={styles.actionCard}
                  >
                    <div className={styles.actionTitle}>
                      <h4>
                        대상 {index + 1} · {analysisTarget.title}
                      </h4>
                      <span>
                        {linkedHypotheses.length
                          ? linkedHypotheses
                              .map((item) => item.title)
                              .join(' · ')
                          : '관측 사실을 확인하기 위한 점검 · 원인 확정 전'}
                      </span>
                      <p className={styles.actionObservation}>
                        {analysisTarget.observation}
                      </p>
                      <button
                        type="button"
                        className={styles.actionToggle}
                        aria-expanded={activeTargetId === analysisTarget.id}
                        aria-controls={prefix + '-action-details-' + index}
                        onClick={() => setSelectedTargetId(analysisTarget.id)}
                      >
                        {activeTargetId === analysisTarget.id
                          ? '선택한 대상의 점검·개선 절차'
                          : '이 대상 점검·개선 절차 보기'}
                      </button>
                    </div>
                    <div
                      id={prefix + '-action-details-' + index}
                      data-target-action-details={analysisTarget.id}
                      hidden={activeTargetId !== analysisTarget.id}
                    >
                      <div className={styles.targetScope}>
                        <strong>2단계와 같은 점검 대상</strong>
                        <TargetSource target={analysisTarget} />
                        <p className={styles.scopeNote}>
                          통화 분석 기간 {callPeriod}
                        </p>
                        {analysisTarget.mapPoints.length > 0 && (
                          <button
                            type="button"
                            className={styles.sourceButton}
                            onClick={() => showTarget(analysisTarget.id)}
                          >
                            대상 POT 위치·측정값 확인 <ArrowRight size={13} />
                          </button>
                        )}
                        {calls.length + members.length > 0 ? (
                          <details className={styles.targetSources}>
                            <summary>
                              연결된 대상 원본 통화{' '}
                              {n(calls.length + members.length)}건
                              {analysisTarget.callIds.length >
                              calls.length + members.length
                                ? ' / 전체 대상 ' +
                                  n(analysisTarget.callIds.length) +
                                  '건'
                                : ''}
                            </summary>
                            <div className={styles.sourceLinks}>
                              {[...calls, ...members].map((call) => (
                                <Link
                                  key={call.id}
                                  href={call.href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {call.date} {call.start}
                                  <ExternalLink size={12} />
                                </Link>
                              ))}
                            </div>
                          </details>
                        ) : (
                          <p className={styles.scopeNote}>
                            {analysisTarget.kind === 'mdt-grid'
                              ? '이 배경 MDT 대상에 직접 연결된 통화는 없습니다. 위 POT·대역·측정일의 원본 측정을 확인하세요.'
                              : '대상에 연결된 통화 상세가 미확보되었습니다. 같은 종료 사유·관측일의 원본 로그를 확보하세요.'}
                          </p>
                        )}
                      </div>
                      {templates.length > 0 ? (
                        procedureLists(templates)
                      ) : (
                        <p className={styles.targetScope}>
                          이 대상에 연결된 점검 절차가 없습니다. 대상 원본과
                          추가 측정을 확보한 뒤 같은 조건으로 분석하세요.
                        </p>
                      )}
                      {templates.length > 0 && (
                        <details className={styles.procedureDetails}>
                          <summary>절차별 자료·상세 확인 방법</summary>
                          {templates.map((step) => (
                            <div key={step.id}>
                              <h5>{step.title}</h5>
                              <p>
                                {report?.sop.find(
                                  (explanation) =>
                                    explanation.sopId === step.id,
                                )?.reason ?? step.reason}
                              </p>
                              <strong>확인할 자료</strong>
                              <ul>
                                {step.materials.map((text, i) => (
                                  <li key={i}>{text}</li>
                                ))}
                              </ul>
                              <strong>확인 방법</strong>
                              <ol>
                                {step.method.map((text, i) => (
                                  <li key={i}>{text}</li>
                                ))}
                              </ol>
                              <strong>결과에 따른 다음 단계</strong>
                              <ul>
                                {step.outcomes.map((text, i) => (
                                  <li key={i}>{text}</li>
                                ))}
                              </ul>
                              <strong>필요한 추가 자료</strong>
                              <ul>
                                {step.additionalData.map((text, i) => (
                                  <li key={i}>{text}</li>
                                ))}
                              </ul>
                              {references(step.evidenceIds)}
                            </div>
                          ))}
                        </details>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className={styles.empty}>
              {refresh && !readable
                ? '이전 형식의 결과입니다. 현재 조건으로 재분석하면 실제 대상별 확인 절차가 표시됩니다.'
                : busy
                  ? '수집된 대상에 연결할 점검 절차를 준비하고 있습니다.'
                  : '구체적인 분석 대상이 확보되지 않았습니다. 동일 POT·대역·측정일의 MDT 분포 또는 해당 통화의 FC·BYE·무선 시계열을 확보한 뒤 다시 분석하세요.'}
            </p>
          )}
        </section>
          </details>}
          </div>
        </div>
      </div>
      <footer className={styles.dialogFoot}><output className={styles.workspaceJobStatus}>{statusText(selectedSavedId && !busy ? displayedEntry : entry)}</output></footer>
    </dialog>
  );
}

function parameterText(evidence: CandidateAnalysisEvidence) {
  const labels: Record<string, [string, string]> = {
    epsM: ['이웃 거리', 'm'],
    epsSpaceM: ['공간 거리', 'm'],
    epsTimeHours: ['시간 간격', '시간'],
    epsHours: ['시간 간격', '시간'],
    minSamples: ['최소 이웃', '개'],
    minClusterSize: ['최소 군집 관측', '개'],
    minPoorCustomers: ['최소 고객', '명'],
    minCustomers: ['최소 고객', '명'],
    minPoorDates: ['최소 관측일', '일'],
    minDays: ['최소 관측일', '일'],
    minNewCustomers: ['최소 신규 고객', '명'],
    bandwidthM: ['공간 대역폭', 'm'],
    spatialBandwidthM: ['공간 대역폭', 'm'],
    gnssBandwidthM: ['GPS 대역폭', 'm'],
    radioBandwidthM: ['무선 위치 대역폭', 'm'],
    candidateSupportM: ['후보 확인 범위', 'm'],
    radiiM: ['탐색 반경', 'm'],
    permutations: ['순열 비교', '회'],
    priorStrength: ['사전 가중치', ''],
    dayDecay: ['일별 가중치', ''],
  };
  return (
    Object.entries(evidence.candidate.parameters)
      .flatMap(([key, value]) => {
        const label = labels[key];
        if (!label) return [];
        const values = Array.isArray(value) ? value : [value];
        if (
          !values.every(
            (item) => typeof item === 'number' && Number.isFinite(item),
          )
        )
          return [];
        return [label[0] + ' ' + values.join(' / ') + label[1]];
      })
      .join(' · ') || '상세 설정은 모델·자료 정보에서 확인'
  );
}

