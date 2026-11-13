'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Layers, LoaderCircle, MapPinned, RadioTower, RefreshCw, Sparkles } from 'lucide-react';
import { candidateAnalysisTargetKey, isCandidateAnalysisBusy, isCurrentCandidateAnalysisJob, isReadableCandidateAnalysisJob, type CandidateAnalysisEntry, type CandidateAnalysisTarget, type CandidateAnalysisEvidence, type CandidateEvidenceTarget, type CandidateSopTemplate, type CandidateCauseCategory, type CandidateAnalysisJob } from '../../lib/analyst/candidate-ai-analysis';
import { fetchCandidatePotContext, type CandidatePotContext } from '../../lib/analyst/candidate-pot-context';
import { getCandidateSelectedFindings, getCandidateSourceCauseAssessments, getCandidateReviewComparison, type CandidateSelectedFinding } from '../../lib/analyst/candidate-ai-selections';
import { potCauseLabel } from '../../lib/analyst/candidate-pot-review';
import { formatInvestigationBand, gridReading, gridWeakPercent, investigationCoverage, investigationGridPair, investigationHeadline, investigationPriority } from '../../lib/analyst/candidate-investigation-presentation';
import { getCandidateGridContrast, getCandidateRepresentativeCause, getCandidateSelectedGrid } from '../../lib/analyst/candidate-representative-cause';
import type { MdtGridMode } from '../../lib/analyst/mdt-25m-grid';
import { CandidateInvestigationMap } from './candidate-investigation-map';
import { CandidateTargetCriteria, CandidateCauseAssessments, getCandidateInvestigationPlans } from './candidate-investigation-list';
import Link from './document-link';
import styles from './candidate-pot-workspace.module.css';

const value = (v: number | string | null | undefined, unit = '') => v == null ? '미확보' : typeof v === 'number' ? (Number.isFinite(v) ? v.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + unit : '미확보') : v;
const relationText = (relation: string) => relation === 'candidate-bye' ? '후보 통화 BYE Cell 연결' : relation === 'ambiguous-bye' ? '동일 Cell 복수 등록 · 확인 필요' : '주변 등록 위치 · 연관 미확인';
const categoryInfo = (id: CandidateCauseCategory) => ({ id, label: potCauseLabel(id) });
const targetLabel = (t: CandidateEvidenceTarget) => t.mapPoints[0] ? t.mapPoints[0].pot + ' · ' + (t.band ?? t.mapPoints[0].band) : t.kind === 'termination-group' ? '통화 종료 원인 · POT 미연결' : t.kind === 'call-quality' ? '통화 품질·RTP 관측 · POT 미연결' : t.kind === 'call-pattern' ? '반복 관측 통화 · POT 미연결' : t.kind === 'call-criteria' ? '통화별 DL·UL·Pollution 기준 · POT 미연결' : '통화 무선 변화 · POT 미연결';
const findingLabel = (finding: CandidateSelectedFinding) => finding.category === 'equipment' && finding.targets.some(t => t.kind === 'termination-group') ? '통화 중단 구간 점검' : categoryInfo(finding.category).label;
const metricValue = (target: CandidateEvidenceTarget, labels: string[]) => {
  const m = target.metrics.find(m => labels.includes(m.label));
  return value(m?.value, m?.unit ? ' ' + m.unit : '');
};

type RulePriority = NonNullable<CandidateAnalysisEvidence['independentReview']>['priorities'][number];
type InvestigationSelection = { targetId: string; selection: number; source?: 'criteria'; category?: CandidateCauseCategory };

/** Investigation overlap compares source IDs only; cause agreement keeps its category contract. */
function independentComparison(entry?: CandidateAnalysisEntry) {
  const job = entry?.job, plans = getCandidateInvestigationPlans(job);
  const readable = isReadableCandidateAnalysisJob(job);
  const investigationMode = readable && job?.report?.hypotheses.length === 0 && plans.length > 0 && plans.length === job.report.investigations?.length;
  const selectedCauseCount = job?.report?.hypotheses.filter(hypothesis => hypothesis.assessment === 'supported' || hypothesis.assessment === 'possible').length ?? 0;
  const causeMode = readable && !!job?.report?.hypotheses.length && getCandidateSelectedFindings(job).length === selectedCauseCount;
  const ready = investigationMode || causeMode;
  const causes = getCandidateReviewComparison(job);
  if (!investigationMode) return { mode: causeMode ? 'causes' : 'unavailable', ready, comparison: causes };
  const targets = new Map((job?.evidence?.analysisTargets ?? []).map(target => [target.id, target]));
  const ai = new Set(plans.flatMap(plan => plan.targets.map(target => target.id)));
  const rules = new Set(job?.evidence?.independentReview?.priorities.flatMap(priority => priority.targetIds).filter(id => targets.has(id)) ?? []);
  const resolve = (id: string) => ({ target: targets.get(id) });
  return { mode: 'investigations', ready, comparison: {
    agreement: [...ai].filter(id => rules.has(id)).map(resolve),
    extra: [...ai].filter(id => !rules.has(id)).map(resolve),
    missing: [...rules].filter(id => !ai.has(id)).map(resolve),
  } };
}

function InvestigationTargetAnalysis({ plan, target, evidence, onSelect, sourceCriteria = false, sourceField = false, missingEvidence = [] }: { plan: ReturnType<typeof getCandidateInvestigationPlans>[number]; target: CandidateEvidenceTarget; evidence?: CandidateAnalysisEvidence; onSelect: (id: string) => void; sourceCriteria?: boolean; sourceField?: boolean; missingEvidence?: string[] }) {
  const calls = new Map([...(evidence?.calls ?? []), ...(evidence?.members ?? [])].map(call => [call.id, call]));
  return <div data-investigation-target-analysis={target.id}>
    <header className={styles.selectedHeader}><div><span className={styles.eyebrow}>{sourceField ? '원본 측정 · 커버리지 조사 POT' : sourceCriteria ? '원본 관측 기준 · 원인 추정' : 'AI 조사 제안 · 원인 미확정'}</span><h3>{target.mapPoints[0]?.pot ?? '연결된 원본 통화'}</h3><p>{target.sourceDates.join(', ')}{target.band ? ' · ' + formatInvestigationBand(target.band) : ''}</p></div><span className={styles.status}>{sourceCriteria || sourceField ? 'Qwen 원인 선택과 별도' : '관측 근거 조사'}</span></header>
    <section className={styles.stage} data-investigation-stage="1"><h4><b>1</b> 관측 근거</h4><p className={styles.headline}>{plan.title}</p><p className={styles.observation}>{target.observation}</p>{!sourceField && <div className={styles.rankedTargets} aria-label={sourceCriteria ? '원본 기준 조사 대상' : 'AI 조사 제안 대상'}>{plan.targets.map((item, index) => <button key={item.id} type="button" data-investigation-ranked-target={item.id} aria-pressed={item.id === target.id} onClick={() => onSelect(item.id)}><b>{index + 1}</b><span><strong>{item.mapPoints[0]?.pot ?? item.title}</strong><small>{item.sourceDates.join(', ')}{item.band ? ' · ' + item.band : ''}</small></span></button>)}</div>}</section>
    <section className={styles.stage} data-investigation-stage="2"><h4><b>2</b> 왜 조사하나요</h4><p className={styles.observation}>{plan.reason}</p>{target.limitations.length + missingEvidence.length > 0 && <div className={styles.visibleLimits}><strong>아직 확인되지 않은 점</strong><ul>{[...target.limitations, ...missingEvidence].map((limit, index) => <li key={index}>{limit}</li>)}</ul></div>}<CandidateTargetCriteria target={target} /></section>
    <section className={styles.stage} data-investigation-stage="3"><h4><b>3</b> 무엇을 확인하나요</h4><div className={styles.actionRow}><span><Check size={15} /> 먼저 확인</span><p>{plan.nextCheck}</p></div>{target.callIds.length > 0 && <details className={styles.evidence}><summary>이 대상에 연결된 원본 통화</summary><ul>{target.callIds.map(id => { const call = calls.get(id); return call && /^\/(?:qoe(?:\/|\?|$)|\?)/.test(call.href) ? <li key={id}><Link href={call.href} target="_blank" rel="noreferrer">{call.date} {call.start} · 원본 통화 ↗</Link></li> : null; })}</ul></details>}</section>
    <details className={styles.evidence}><summary>전체 원본 측정값</summary><div className={styles.tableScroll}><table><thead><tr><th>지표</th><th>관측값</th></tr></thead><tbody>{target.metrics.map((metric, index) => <tr key={index}><th>{metric.label}</th><td>{metric.value == null ? '미확보' : String(metric.value)}{metric.unit ? ' ' + metric.unit : ''}</td></tr>)}</tbody></table></div></details>
  </div>;
}

export function CandidateRuleTargetAnalysis({ priority, target, targets, sourceLabel, templates, onSelect }: {
  priority: RulePriority; target: CandidateEvidenceTarget; targets: CandidateEvidenceTarget[];
  sourceLabel: string; templates: CandidateSopTemplate[]; onSelect: (id: string) => void;
}) {
  const limits = [...new Set([...priority.limitations, ...target.limitations])];
  const point = target.mapPoints[0];
  const action = templates.flatMap(t => t.conditionalActions)[0];
  return <div data-rule-target-analysis={target.id}>
    <header className={styles.selectedHeader}><div><span className={styles.eyebrow}>{sourceLabel}</span><h3>{point?.pot ?? '통화 중단 구간'}</h3><p>{target.band ? target.band + ' · ' : ''}{target.sourceDates.join(', ')}</p></div><span className={styles.status}>관측 규칙 · 원인 미확정</span></header>
    <div className={styles.origin}>Qwen 응답과 별도로 선정한 조사 대상 <span>규칙의 관측값과 확인 절차</span></div>
    <section className={styles.stage} data-rule-stage="1"><h4><b>1</b> 관측된 문제</h4><p className={styles.headline}>{priority.title}</p><p className={styles.observation}>{priority.observation}</p><p className={styles.observation}>{target.observation}</p>
      <div className={styles.rankedTargets} aria-label="근거 규칙 POT 우선순위">{targets.map((t, i) => <button key={t.id} type="button" data-rule-ranked-target={t.id} aria-pressed={t.id === target.id} onClick={() => onSelect(t.id)}><b>{i + 1}</b><span><strong>{targetLabel(t)}</strong><small>{t.kind === 'mdt-grid' ? '≤−105 ' + metricValue(t, ['RSRP ≤-105 dBm', 'RSRP ≤ -105']) + ' · ≤−110 ' + metricValue(t, ['RSRP ≤-110 dBm', 'RSRP ≤ -110']) + ' · 측정 ' + metricValue(t, ['측정 수']) : t.observation}</small></span></button>)}</div>
    </section>
    <section className={styles.stage} data-rule-stage="2"><h4><b>2</b> 판단 범위·미확인</h4><p className={styles.diagnosticGap}>{priority.category === 'coverage' ? '저신호 분포가 관측된 위치를 조사 대상으로 묶었습니다. 해당 통화의 저하 순간 위치와 원인은 추가 정합이 필요합니다.' : '종료 원문은 중단 현상을 가리킵니다. 양방향 RTP·SIP의 먼저 중단된 방향과 구간을 확인해야 원인을 좁힐 수 있습니다.'}</p>{!!limits.length && <div className={styles.visibleLimits}><strong>아직 확인되지 않은 점</strong><ul>{limits.map((text, i) => <li key={i}>{text}</li>)}</ul></div>}</section>
    <section className={styles.stage} data-rule-stage="3"><h4><b>3</b> 확인·개선</h4><div className={styles.actionRow}><span><Check size={15} /> 먼저 확인</span><p>{priority.nextCheck}</p></div>{action && <div className={styles.actionRow}><span><Check size={15} /> 확인 후 조치</span><p>{action.when} {action.action}</p></div>}</section>
    <details className={styles.evidence}><summary>원본 측정값·연결 절차 <ChevronDown size={18} /></summary><div className={styles.tableScroll}><table><thead><tr><th>지표</th><th>관측값</th></tr></thead><tbody>{target.metrics.map((m, i) => <tr key={i}><th>{m.label}</th><td>{value(m.value, m.unit ? ' ' + m.unit : '')}</td></tr>)}</tbody></table></div>{templates.map(t => <div key={t.id}><h5>{t.title}</h5><ol>{t.checkNow.map((text, i) => <li key={i}>{text}</li>)}</ol><h5>조치 후 검증</h5><ul>{t.verifyAfter.map((text, i) => <li key={i}>{text}</li>)}</ul></div>)}</details>
  </div>;
}

export function CandidateIndependentReview({ entry, onSelect }: { entry?: CandidateAnalysisEntry; onSelect?: (priorityId: string, targetId: string) => void }) {
  const job = entry?.job, review = job?.evidence?.independentReview;
  if (!review) return null;
  const { comparison, ready: comparisonReady, mode } = independentComparison(entry);
  const investigationMode = mode === 'investigations';
  const labels = investigationMode ? { agreement: '조사 대상 겹침', extra: 'AI에만', missing: '규칙에만' } : { agreement: 'Qwen과 일치', extra: 'Qwen 추가', missing: 'Qwen 미선정' };
  const targets = job?.evidence?.analysisTargets ?? [];
  return <details className={styles.independentReview} data-review-comparison={mode}>
    <summary><strong>{review.label}</strong><span>{review.priorities.length ? review.priorities.map(p => p.title).join(' · ') : '우선 점검 기준을 충족한 대상 없음'}</span><span className={styles.reviewCounts}>{comparisonReady ? <>{labels.agreement} {comparison.agreement.length} · {labels.extra} {comparison.extra.length} · {labels.missing} {comparison.missing.length}</> : isCandidateAnalysisBusy(entry) ? 'Qwen 해석 대기' : job?.status === 'completed' ? '비교 불가 · 저장 결과의 대상 연결 미확인' : 'Qwen 분석 미완료'}</span><ChevronDown size={17} /></summary>
    <p className={styles.reviewMethod}>{review.method} · Qwen 응답과 별도로 계산한 검토입니다. {investigationMode ? 'AI 조사 제안과 근거 규칙에 연결된 실제 대상 ID의 중복만 비교합니다. 원인 분류의 일치나 원인 확정을 뜻하지 않습니다. AI에 전송하지 않은 대상도 규칙에만 포함될 수 있습니다.' : '일치는 동일 원인 분류와 대상의 중복이며 원인 확정을 뜻하지 않습니다. Qwen에 전송하지 않은 대상도 미선정에 포함될 수 있습니다.'} 실제 전송 범위는 AI 입력·응답에서 확인합니다.</p>
    <div className={styles.reviewCards}>{review.priorities.map((priority, index) => <article key={priority.id}>
      <h4><b>{index + 1}</b>{priority.title}</h4><p>{priority.observation}</p>
      <div className={styles.reviewTargets}>{priority.targetIds.map(id => {
        const target = targets.find(t => t.id === id);
        if (!target) return null;
        return <button type="button" key={id} data-review-target={id} onClick={() => onSelect?.(priority.id, id)} disabled={!onSelect}><strong>{targetLabel(target)}</strong>{target.kind === 'mdt-grid' ? <span>≤−105 {metricValue(target, ['RSRP ≤-105 dBm', 'RSRP ≤ -105'])} · ≤−110 {metricValue(target, ['RSRP ≤-110 dBm', 'RSRP ≤ -110'])} · 측정 {metricValue(target, ['측정 수'])}</span> : <span>{target.observation}</span>}</button>;
      })}</div>
      <p className={styles.reviewNext}><b>먼저 확인</b> {priority.nextCheck}</p>
      {!!priority.limitations.length && <ul>{priority.limitations.map((text, i) => <li key={i}>{text}</li>)}</ul>}
    </article>)}</div>
    {comparisonReady && <div className={styles.reviewDifference}>{(['agreement', 'extra', 'missing'] as const).map(key => <div key={key}><strong>{labels[key]} {comparison[key].length}</strong><span>{comparison[key].map(pair => pair.target ? targetLabel(pair.target) : '대상 연결 미확인').join(' · ') || '해당 없음'}</span></div>)}</div>}
    <p className={styles.reviewMethod}>검토 대상 MDT {review.reviewed.mdtTargets} · 종료 원문 {review.reviewed.terminationTargets} · 무선 변화 {review.reviewed.radioTargets} · 저신호 꼬리 0인 대상 {review.reviewed.zeroTailTargets} · 희소 표본 {review.reviewed.sparseTargets}</p>
    {!!review.limitations.length && <ul className={styles.reviewLimits}>{review.limitations.map((text, i) => <li key={i}>{text}</li>)}</ul>}
  </details>;
}

export function CandidatePotWorkspace({ target, entry, investigationSelection, sourceCriteriaJob, onSelectCause }: { target: CandidateAnalysisTarget; entry?: CandidateAnalysisEntry; investigationSelection?: InvestigationSelection; sourceCriteriaJob?: CandidateAnalysisJob | null; onSelectCause?: (category: CandidateCauseCategory, targetId: string) => void }) {
  const key = candidateAnalysisTargetKey(target);
  const [snapshot, setSnapshot] = useState<{ key: string; context?: CandidatePotContext; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetchCandidatePotContext(target, controller.signal).then(context => {
      if (!controller.signal.aborted) setSnapshot({ key, context });
    }).catch(error => {
      if (!controller.signal.aborted) setSnapshot({ key, error: error instanceof Error ? error.message : '조사 후보 지도를 불러오지 못했습니다.' });
    });
    return () => controller.abort();
  }, [key, target, retry]);
  const current = snapshot?.key === key ? snapshot : null;
  const retryContext = () => { setSnapshot(null); setRetry(x => x + 1); };
  return <PotInvestigationContent key={[key, entry?.job?.id, sourceCriteriaJob?.id].join(':')} context={current?.context} entry={entry} sourceCriteriaJob={sourceCriteriaJob} investigationSelection={investigationSelection} onSelectCause={onSelectCause} contextError={current?.error} contextLoading={!current?.error && !current?.context} onRetryContext={retryContext} />;
}

export function PotInvestigationContent({ context, entry, contextError, contextLoading = false, onRetryContext, investigationSelection, sourceCriteriaJob, onSelectCause }: { context?: CandidatePotContext | null; entry?: CandidateAnalysisEntry; contextError?: string; contextLoading?: boolean; onRetryContext?: () => void; investigationSelection?: InvestigationSelection; sourceCriteriaJob?: CandidateAnalysisJob | null; onSelectCause?: (category: CandidateCauseCategory, targetId: string) => void }) {
  const sourceJob = sourceCriteriaJob ?? entry?.job;
  const sameRun = sourceJob?.id === entry?.job?.id;
  const coverage = useMemo(() => investigationCoverage(sourceJob?.evidence), [sourceJob?.evidence]);
  const representative = useMemo(() => getCandidateRepresentativeCause(sourceJob, coverage), [sourceJob, coverage]);
  const fieldOptions = coverage.points.map(item => ({
    target: item.reading.target,
    plan: {title: item.pot + ' · ' + formatInvestigationBand(item.band), reason: item.reason,
      nextCheck: item.reading.target.investigationHint?.check ?? '동일 대역에서 서빙·이웃 셀 신호와 통화 품질을 함께 확인합니다.',
      targets: [item.reading.target]},
  }));
  const findings = useMemo(() => getCandidateSelectedFindings(entry?.job), [entry?.job]);
  const investigationPlans = useMemo(() => getCandidateInvestigationPlans(entry?.job), [entry?.job]);
  const investigationOptions = investigationPlans.flatMap(plan => plan.targets.map(target => ({ plan, target })));
  const sourceAssessments = getCandidateSourceCauseAssessments(sourceJob);
  const criteriaOptions = sourceAssessments.flatMap(assessment => assessment.targets.map(target => ({ target, assessment, plan: { title: investigationHeadline(assessment, sourceJob?.evidence?.versions.evidence === 'candidate-evidence-v6'), reason: assessment.reason, nextCheck: assessment.nextCheck, targets: assessment.targets } })));
  const [investigationChoice, setInvestigationChoice] = useState<{ id: string | null; selection?: number; source?: 'criteria' | 'field' | 'comparison'; category?: CandidateCauseCategory; primaryId?: string }>({ id: null });
  const externalSelection = investigationSelection && investigationChoice.selection !== investigationSelection.selection;
  const selectedInvestigationId = externalSelection ? investigationSelection.targetId : investigationChoice.id;
  const selectionSource = externalSelection ? investigationSelection.source : investigationChoice.source;
  const selectionCategory = externalSelection ? investigationSelection.category : investigationChoice.category;
  const setSelectedInvestigationId = (id: string | null, source?: 'criteria' | 'field', category?: CandidateCauseCategory) => setInvestigationChoice({ id, selection: investigationSelection?.selection, source, category });
  const [selectedFindingId, setSelectedFindingId] = useState('');
  const [selectedTargetId, setSelectedTargetId] = useState('');
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [showMdt, setShowMdt] = useState(true);
  const [showPots, setShowPots] = useState(true);
  const [showStations, setShowStations] = useState(false);
  const expandedTarget = useRef<HTMLDetailsElement>(null);
  const [selectedStation, setSelectedStation] = useState('');
  const prefix = useId();
  const ruleOptions = (entry?.job?.evidence?.independentReview?.priorities ?? []).flatMap(priority => priority.targetIds.flatMap(id => {
    const target = entry?.job?.evidence?.analysisTargets.find(t => t.id === id);
    return target ? [{ key: priority.id + ':' + id, priority, target }] : [];
  }));
  const busy = isCandidateAnalysisBusy(entry);
  const failed = entry?.job?.status === 'failed';
  const initial = selectedInvestigationId === null && !selectedRuleId;
  const defaultField = initial && representative.category === 'coverage' ? fieldOptions.find(option => option.target.id === representative.targetId) : undefined;
  const defaultCriteria = initial && !defaultField ? criteriaOptions.find(option =>
    option.assessment.category === representative.category && option.target.id === representative.targetId) : undefined;
  const defaultModel = sameRun && initial && !defaultField && !defaultCriteria;
  const firstModelPlan = defaultModel ? (representative.category
    ? investigationOptions.find(option => option.target.id === representative.targetId)
    : investigationOptions[0]) : undefined;
  // Preserve the historical cause detail when it opens the very same priority target.
  const defaultPlan = firstModelPlan?.target.id !== findings[0]?.targets[0]?.id ? firstModelPlan : undefined;
  const defaultSource = initial && !defaultField && !defaultCriteria && (!sameRun || (!findings.length && !firstModelPlan));
  const singleSource = defaultSource ? investigationPriority(sourceAssessments) : undefined;
  const defaultRule = sameRun && failed && !busy && !singleSource && !defaultField && !defaultCriteria ? ruleOptions[0] : undefined;
  const selectedRule = selectionSource || selectedInvestigationId ? undefined : ruleOptions.find(option => option.key === selectedRuleId) ?? (selectedRuleId === null ? defaultRule : undefined);
  const selectedCriteria = selectionSource === 'criteria' ? criteriaOptions.find(option => option.target.id === selectedInvestigationId && (!selectionCategory || option.assessment.category === selectionCategory))
    : defaultCriteria ?? (singleSource && criteriaOptions.find(option => option.assessment.category === singleSource.category));
  const comparisonParent = selectionSource === 'comparison' ? coverage.points.find(item => item.targetId === investigationChoice.primaryId) : undefined;
  const sourceEvidence = sourceJob?.evidence;
  // The peer selection is created only from a displayed, source-linked 25m grid
  // in this component. A different saved run remounts the workspace.
  const peerReading = comparisonParent && gridReading(sourceEvidence?.analysisTargets.find(item => item.id === selectedInvestigationId));
  const selectedPeer = peerReading && {reading:peerReading};
  const selectedField = selectedPeer && comparisonParent ? {target: selectedPeer.reading.target, plan: {
    title: comparisonParent.pot + ' 인접 비교 POT', reason: selectedPeer.reading.target.observation,
    nextCheck: '같은 날짜·대역의 두 격자에서 약전계 비율과 표본 수를 대조합니다.', targets: [selectedPeer.reading.target],
  }} : selectionSource === 'field' ? fieldOptions.find(option => option.target.id === selectedInvestigationId) : defaultField;
  const selectedInvestigation = selectedRule ? undefined : selectionSource === 'criteria' ? selectedCriteria : selectedField ?? selectedCriteria ?? investigationOptions.find(option => option.target.id === selectedInvestigationId) ?? defaultPlan;
  const defaultFinding = initial && representative.category
    ? findings.find(item => item.category === representative.category && item.targets.some(t => t.id === representative.targetId))
    : findings[0];
  const finding = selectionSource || !sameRun ? undefined : findings.find(f => f.id === selectedFindingId) ?? defaultFinding;
  const target = selectedRule?.target ?? selectedInvestigation?.target ?? finding?.targets.find(t => t.id === selectedTargetId) ?? finding?.targets[0];
  const currentRuleTargets = ruleOptions.filter(option => option.priority.id === selectedRule?.priority.id).map(option => option.target);
  const point = target?.mapPoints[0];
  const potId = point?.pot ?? '';
  const band = (target?.band ?? point?.band ?? 'top1') as MdtGridMode;
  const measurementDates = context?.grid.measurementDates ?? [];
  const date = point?.date ?? target?.sourceDates[0] ?? measurementDates.at(-1) ?? '';
  const backgroundDate = point ? date : measurementDates.at(-1) ?? '';
  const pair = investigationGridPair(sourceJob?.evidence);
  const activePoint = comparisonParent ?? coverage.points.find(item => item.targetId === target?.id);
  const otherBand = activePoint?.comparisons.find(ref => ref.kind === 'same-pot-other-band')?.reading;
  const chosenThreshold = (activePoint && activePoint.targetId === representative.targetId ? representative.thresholdDbm : undefined)
    ?? (activePoint?.metric?.kind === 'dl-rsrp' ? activePoint.metric.thresholdDbm : undefined);
  const gridContrast = activePoint?.metric?.kind === 'ul-phr' ? undefined :
    getCandidateGridContrast(sourceEvidence, activePoint, {thresholdDbm:chosenThreshold});
  const historicalPair = !gridContrast && !sourceEvidence?.coveragePoints && pair && (pair.primary.target.id === target?.id || pair.comparison.target.id === target?.id)
    ? pair : undefined;
  const thresholdDbm = gridContrast?.threshold ?? (historicalPair ? -105 : chosenThreshold ?? -105);
  const selectedGrid = selectedPeer
    ? getCandidateSelectedGrid(selectedPeer.reading.target, 'comparison', thresholdDbm)
    : activePoint ? {...activePoint, role:'survey' as const} : getCandidateSelectedGrid(target, 'survey', chosenThreshold);
  const selectedContrast = selectedGrid && activePoint?.targetId !== selectedGrid.targetId
    ? getCandidateGridContrast(sourceEvidence, selectedGrid, {thresholdDbm:selectedPeer ? thresholdDbm : undefined}) : gridContrast;
  const peers = (gridContrast?.peers ?? []).flatMap(ref => {
    const peer = gridReading(sourceEvidence?.analysisTargets.find(item => item.id === ref.id));
    return peer ? [{targetId:ref.id,reading:peer,direction:ref.direction,distanceM:ref.distanceM}] : [];
  });
  if (historicalPair) peers.push({targetId:historicalPair.comparison.target.id,reading:historicalPair.comparison,direction:'인접',distanceM:historicalPair.distanceM});
  const reading = gridContrast?.point.reading ?? historicalPair?.primary ?? activePoint?.reading ?? gridReading(target);
  const crossBandReading = otherBand ?? historicalPair?.otherBand;
  const crossBandPercent = crossBandReading && gridWeakPercent(crossBandReading.target, thresholdDbm);
  const comparisonOnly = new Set([
    ...coverage.points.flatMap(item => item.comparisons.map(ref => ref.targetId)),
    pair?.comparison.target.id, pair?.otherBand?.target.id,
  ]);
  const mappedTargets = [...fieldOptions.map(option => option.target),
    ...(sameRun ? [...investigationOptions.map(option => option.target), ...findings.flatMap(item => item.targets)]
      .filter(t => !comparisonOnly.has(t.id)) : [])];
  const markersByPot = new Map<string, ReturnType<typeof marker>>();
  function marker(reading: NonNullable<ReturnType<typeof gridReading>>) {
    return {...reading.point, earfcn:reading.target.earfcn, samples:reading.samples, percent:gridWeakPercent(reading.target, thresholdDbm)};
  }
  for (const candidate of mappedTargets) {
    const saved = gridReading(candidate);
    if (saved && (!markersByPot.has(saved.point.pot) || candidate.id === target?.id)) markersByPot.set(saved.point.pot, marker(saved));
  }
  const investigationPoints = [...markersByPot.values()];
  const investigationPotIds = [...markersByPot.keys()];
  const allRulePotIds = [...new Set(ruleOptions.flatMap(option => option.target.mapPoints.map(point => point.pot)))];
  const station = context?.stations.find(s => s.id === selectedStation);
  const procedures = finding?.templates.filter(t => target?.sopIds.includes(t.id)) ?? [];
  const check = procedures.flatMap(t => t.checkNow)[0];
  const action = procedures.flatMap(t => t.conditionalActions)[0];
  const meta = finding ? categoryInfo(finding.category) : null;
  const options = findings.flatMap(f => f.targets.map(t => ({ key: f.id + ':' + t.id, finding: f, target: t })));
  const isCurrent = isCurrentCandidateAnalysisJob(entry?.job);
  const error = entry?.error || entry?.job?.error?.message;
  const modelError = entry?.job?.error;
  const missing = entry?.job?.report?.summary.missing;
  const selectTarget = (findingId: string, targetId?: string) => {
    setSelectedInvestigationId(''); setSelectedRuleId(''); setSelectedFindingId(findingId); setSelectedTargetId(targetId ?? ''); setSelectedStation('');
  };
  const selectRule = (priorityId: string, targetId: string) => {
    setSelectedInvestigationId(''); setSelectedRuleId(priorityId + ':' + targetId); setSelectedStation(''); setShowPots(true);
  };
  const selectInvestigation = (targetId: string) => { setSelectedInvestigationId(targetId); setSelectedRuleId(''); setSelectedStation(''); setShowPots(true); };
  const selectField = (targetId: string) => { setSelectedInvestigationId(targetId, 'field'); setSelectedRuleId(''); setSelectedStation(''); setShowPots(true); };
  const selectCriteria = (targetId: string, category = selectedCriteria?.assessment.category ?? selectionCategory) => { if (category) onSelectCause?.(category, targetId); setSelectedInvestigationId(targetId, 'criteria', category); setSelectedRuleId(''); setSelectedStation(''); setShowPots(true); };
  const selectPot = (id: string) => {
    const peer = peers.find(item => item.reading.point.pot === id);
    if (peer) {
      if (activePoint) {
        setInvestigationChoice({ id: peer.targetId, selection: investigationSelection?.selection, source: 'comparison', primaryId: activePoint.targetId });
        setSelectedRuleId(''); setSelectedStation('');
      } else if (criteriaOptions.some(option => option.target.id === peer.targetId)) {
        selectCriteria(peer.targetId, 'coverage');
      } else if (investigationOptions.some(option => option.target.id === peer.targetId)) {
        selectInvestigation(peer.targetId);
      }
      return;
    }
    const field = fieldOptions.find(option => option.target.mapPoints[0].pot === id);
    if (field) { selectField(field.target.id); return; }
    const model = sameRun && investigationOptions.find(option => option.target.mapPoints.some(point => point.pot === id));
    if (model) { selectInvestigation(model.target.id); return; }
    if (selectedRule) {
      const option = ruleOptions.find(option => option.priority.id === selectedRule.priority.id && option.target.mapPoints.some(point => point.pot === id)) ?? ruleOptions.find(option => option.target.mapPoints.some(point => point.pot === id));
      if (option) selectRule(option.priority.id, option.target.id);
      return;
    }
    if (selectedInvestigation) { const option = (selectedCriteria ? criteriaOptions.filter(option => option.assessment.category === selectedCriteria.assessment.category) : investigationOptions).find(option => option.target.mapPoints.some(point => point.pot === id)); if (option) { if (selectedCriteria) selectCriteria(option.target.id); else selectInvestigation(option.target.id); } return; }
    const current = finding?.targets.find(t => t.mapPoints.some(p => p.pot === id));
    if (current && finding) { selectTarget(finding.id, current.id); return; }
    const option = options.find(o => o.target.mapPoints.some(p => p.pot === id));
    if (option) selectTarget(option.finding.id, option.target.id);
    else { const investigation = investigationOptions.find(option => option.target.mapPoints.some(point => point.pot === id)); if (investigation) selectInvestigation(investigation.target.id); }
  };
  const showDetail = () => {
    if (expandedTarget.current) expandedTarget.current.open = true;
    requestAnimationFrame(() => {
      expandedTarget.current?.scrollIntoView({ block: 'nearest' });
      expandedTarget.current?.querySelector('summary')?.focus({ preventScroll: true });
    });
  };
  const keyMetrics = target?.kind === 'mdt-grid'
    ? target.metrics.filter(m => ['RSRP 평균', 'RSRQ 평균', 'RSRP ≤-100 dBm', 'RSRP ≤-105 dBm', 'RSRP ≤-110 dBm'].includes(m.label) || /PHR.*평균/.test(m.label))
    : target?.kind === 'call-criteria' ? target.metrics.filter(metric => /DL|UL|PHR|Pollution|시작|종료|변화|이벤트/.test(metric.label)).slice(0, 8)
    : target?.metrics.filter(m => ['Drop 통화 수', '관측 수', '통화 수', 'RSRP 최소', 'RSRP 최대'].includes(m.label)).slice(0, 3) ?? [];
  const interruptionMetrics = target?.kind === 'termination-group' ? target.metrics.filter(m => ['fcRaw', 'byeReasonRaw', 'reasonRaw', 'releaseCauseRaw', 'secondaryReleaseCause1Raw', 'secondaryReleaseCause2Raw'].includes(m.label)) : [];
  const targetLimits = [...new Set([...(target?.limitations ?? []), finding?.hypothesis.missingEvidence ?? ''].filter(Boolean))];
  const emptySourceAssessment = selectionSource === 'criteria' && !selectedCriteria ? sourceAssessments.find(assessment => assessment.category === selectionCategory) : undefined;
  const modelStatus = selectionSource === 'criteria' && !selectedCriteria ? categoryInfo(selectionCategory ?? 'coverage').label + ' · 조사 대상 근거 미확보' : busy ? 'AI가 원인과 조사 대상을 선정 중입니다.' : failed || error ? 'AI 분석을 완료하지 못했습니다.' : isCurrent ? '현재 근거에서 선정된 원인이 없습니다.' : entry?.job?.report ? '현재 원인 분류 기준으로 다시 분석해 주세요.' : 'AI 분석 결과를 기다리고 있습니다.';
  const reviewComparison = independentComparison(entry);
  const investigationOverlap = reviewComparison.mode === 'investigations' && !!selectedRule && investigationOptions.some(option => option.target.id === selectedRule.target.id);
  const ruleSourceLabel = selectedRule ? '근거 규칙 검토 · ' + (reviewComparison.mode === 'investigations' ? investigationOverlap ? 'AI 조사 대상과 겹침' : '규칙에만' : findings.some(f => f.category === selectedRule.priority.category && f.targets.some(t => t.id === selectedRule.target.id)) ? 'Qwen과 일치' : reviewComparison.ready ? 'Qwen 미선정' : busy ? 'Qwen 해석 대기' : failed ? 'Qwen 검증 보류' : entry?.job?.status === 'completed' ? '비교 불가 · 대상 연결 미확인' : 'Qwen 분석 미완료') : '';
  const ruleTemplates = entry?.job?.evidence?.sop.templates.filter(template => target?.sopIds.includes(template.id) && (!template.causeCategory || template.causeCategory === selectedRule?.priority.category)) ?? [];
  const ruleButton = (option: typeof ruleOptions[number], index: number) => <button type="button" key={option.key} data-rule-inspect={option.key} aria-pressed={selectedRule?.key === option.key} onClick={event => { selectRule(option.priority.id, option.target.id); const disclosure = event.currentTarget.closest('details[data-rule-choices-fold]'); if (disclosure instanceof HTMLDetailsElement) { disclosure.open = false; disclosure.querySelector('summary')?.focus(); } }}><b>{index + 1}</b><span><strong>{targetLabel(option.target)}</strong><small>{option.target.kind === 'mdt-grid' ? '≤−105 ' + metricValue(option.target, ['RSRP ≤-105 dBm', 'RSRP ≤ -105']) : option.target.kind === 'termination-group' ? '통화 종료 원문 점검' : option.target.kind === 'call-quality' ? '동일 통화 품질·RTP 대조' : option.target.kind === 'call-pattern' ? '반복 통화 구성 대조' : '동일 통화 무선 관측'}</small></span></button>;
  const _ruleChoices = ruleOptions.length ? <section className={styles.ruleChoices} aria-label="근거 규칙 조사 대상"><header><strong>근거 규칙 검토 · {allRulePotIds.length} POT</strong><span>Qwen과 별도로 선정 · 누르면 지도와 근거 확인</span></header><div>{ruleOptions.slice(0,5).map(ruleButton)}</div>{ruleOptions.length > 5 && <details><summary>다른 규칙 대상 {ruleOptions.length - 5}개</summary><div>{ruleOptions.slice(5).map((option,index) => ruleButton(option,index + 5))}</div></details>}</section> : null;
  return <section className={styles.workspace} aria-label="AI 선정 원인과 조사 대상" data-context-fingerprint={context?.fingerprint ?? 'unavailable'} data-ai-finding-count={findings.length} data-rule-pot-count={allRulePotIds.length} data-investigation-pot-count={investigationPotIds.length}>
    {failed && <aside className={styles.modelFailure} role="alert" aria-label="Qwen 분석 실패 상세"><strong>Qwen 분석 실패{modelError?.code && ' · ' + modelError.code}</strong><p>{modelError?.message || '모델의 분석 결과를 완료하지 못했습니다.'}</p><span>{selectedRule ? '아래는 확보한 관측 근거의 규칙 검토입니다. Qwen 원인 해석·보고서는 적용하지 않았습니다.' : '상단에서 실제 응답을 확인하거나 프롬프트를 수정해 다시 전송할 수 있습니다.'}</span></aside>}
    <div className={styles.columns}>
      <section className={styles.mapPanel} aria-label="조사 후보 지도 패널" data-map-panel="true">
        <header className={styles.mapHeader}><h3>조사 지도</h3><span>조사 지점 {investigationPotIds.length}곳</span></header>
        <div className={styles.mapArea}>
          {context ? <CandidateInvestigationMap context={context} selectedPot={potId} primaryPot={reading?.point.pot} band={showMdt ? (point ? band : 'top1') : 'hidden'}
            date={backgroundDate} showPots={showPots} showStations={showStations} investigationPoints={investigationPoints}
            focusPoint={reading && {...marker(reading),metricLabel:activePoint?.metric?.kind === 'ul-phr' ? 'PHR ' + activePoint.metric.mean : undefined}}
            comparisonPot={peers[0]?.reading.point.pot}
            comparisonPoints={peers.map(peer => ({...marker(peer.reading),direction:peer.direction,distanceM:peer.distanceM}))}
            earfcn={point ? target?.earfcn ?? undefined : undefined} weakSignalRatio={!!reading && activePoint?.metric?.kind !== 'ul-phr'} thresholdDbm={thresholdDbm} selectablePotIds={[...investigationPotIds,...peers.map(peer=>peer.reading.point.pot)]}
            onSelectPot={selectPot} onSelectStation={setSelectedStation} selectedStation={selectedStation} /> : <div className={styles.mapUnavailable}>{contextLoading ? <LoaderCircle size={26} className={styles.spin} /> : <MapPinned size={26} />}<strong>{contextLoading ? '지도 근거 불러오는 중' : '지도 근거 사용 불가'}</strong><p>{contextError || (contextLoading ? '현재 지도의 MDT·기지국 자료를 확인하고 있습니다.' : '현재 지도에 필요한 원본 자료를 확보하지 못했습니다.')}</p><p>저장된 보고서와 관측값은 오른쪽에서 계속 확인할 수 있습니다.</p>{onRetryContext && !contextLoading && <button type="button" onClick={onRetryContext}><RefreshCw size={14} /> 지도 다시 불러오기</button>}</div>}
          {context && <details className={styles.layerMenu}>
            <summary><Layers size={15} /> 지도 레이어 <ChevronDown size={13} /></summary>
            <div className={styles.controls}>
              <label><input type="checkbox" checked={showMdt} onChange={e => setShowMdt(e.target.checked)} /> MDT</label>
              <label><input type="checkbox" checked={showPots} onChange={e => setShowPots(e.target.checked)} /> 조사 POT {investigationPotIds.length}곳</label>
              <label><input type="checkbox" checked={showStations} onChange={e => setShowStations(e.target.checked)} /> 기지국</label>
            </div>
          </details>}
        </div>
        <div className={styles.mapFooter}>
          {selectedGrid && <div className={styles.potIdentity}><strong>{selectedGrid.role === 'comparison' ? '선택한 비교 POT' : '선택한 조사 POT'} {selectedGrid.pot}</strong><span>MDT {selectedGrid.sourceDate || '측정일 미확인'} · {formatInvestigationBand(selectedGrid.band) || '대역 미확인'} · EARFCN {selectedGrid.earfcn || '미확인'}</span></div>}
          {reading && <details className={styles.mapDetails}><summary>격자 측정값</summary><div className={styles.readings}>
            {[{ role: 'primary', key: 'A', label: '조사 POT', data: reading },
              ...peers.map(peer => ({role:'comparison',key:peer.direction,label:peer.distanceM + 'm ' + peer.direction + ' 비교 POT', data:peer.reading}))].map(item => {
              const percent = gridWeakPercent(item.data.target, thresholdDbm);
              return <div key={item.data.target.id} data-map-target-role={item.role} data-pot-id={item.data.point.pot} data-weak-percent={percent ?? undefined} data-threshold-dbm={thresholdDbm}>
                <i>{item.key}</i><span><b>{item.label}</b> {item.data.point.pot}{item.data.samples != null && ' · ' + item.data.samples.toLocaleString('ko-KR') + '측정'}</span>
                <span>≤ {thresholdDbm} dBm</span><strong>{percent == null ? '미측정' : percent.toFixed(2) + '%'}</strong>
              </div>;
            })}
            {crossBandReading && <small>같은 조사 POT의 다른 대역 비교 · {formatInvestigationBand(crossBandReading.target.band ?? '')} (EARFCN {crossBandReading.target.earfcn}) · ≤ {thresholdDbm} dBm {crossBandPercent == null ? '미측정' : crossBandPercent.toFixed(2) + '%'}</small>}
          </div></details>}
          {selectedField ? null :
            selectedInvestigation ? <div className={styles.autoTarget}>{selectedCriteria ? '원본 관측 기준' : 'AI 조사 제안'} <select aria-label={selectedCriteria ? '원본 기준 대상 선택' : 'AI 조사 제안 대상 선택'} value={selectedInvestigation.target.id} onChange={event => selectedCriteria ? selectCriteria(event.target.value) : selectInvestigation(event.target.value)}>{(selectedCriteria ? criteriaOptions.filter(option => option.assessment.category === selectedCriteria.assessment.category) : investigationOptions).map((option, index) => <option key={index} value={option.target.id}>{option.target.mapPoints[0]?.pot ?? option.target.title}</option>)}</select></div> : selectedRule ? <div className={styles.autoTarget}><strong>{ruleSourceLabel}</strong><span>{targetLabel(selectedRule.target)}</span></div> : target && finding ? <div className={styles.autoTarget}>AI 선정 대상 {options.length > 1 ? <select aria-label="AI 선정 조사 대상" value={finding.id + ':' + target.id} onChange={e => { const option = options.find(o => o.key === e.target.value); if (option) selectTarget(option.finding.id, option.target.id); }}>{options.map(o => <option key={o.key} value={o.key}>{targetLabel(o.target)} · {findingLabel(o.finding)}</option>)}</select> : <strong>{targetLabel(target)}</strong>}</div> : <div className={styles.autoTarget}>{busy ? 'Qwen 선정 대기' : 'Qwen 선정 대상 없음'}</div>}
          <small>기지국: 후보 통화 BYE 연결 / 복수 등록 / 주변 참고 위치</small>
        </div>
      </section>
      <div className={styles.priorityPanel} data-results-panel="true">
        <CandidateCauseAssessments job={sourceJob} coverage={coverage} representative={representative} selectedTargetId={target?.id} activeSurveyId={activePoint?.targetId} selectedGrid={selectedGrid} gridContrast={selectedContrast} onInspectPoint={selectField} onInspectPlan={id => { selectInvestigation(id); showDetail(); }} onInspectTarget={(id, category) => {
          selectCriteria(id, category);
          showDetail();
        }} />
        {(entry?.job?.report?.mode !== 'comparison-only' || target || emptySourceAssessment) && <details ref={expandedTarget} className={styles.selectedDetail} data-summary-detail="selected-target"><summary>선택 대상 · 상세 근거·확인 항목</summary>
      <article className={styles.analysisPanel} aria-label={selectedField ? '커버리지 조사 POT 원본 측정' : selectedCriteria ? '원본 관측 기준 대상 분석' : selectedInvestigation ? 'AI 조사 제안 대상 분석' : selectedRule ? '근거 규칙 대상 분석' : 'AI 선정 대상 분석'} data-analysis-source={selectedField ? 'field' : selectedCriteria ? 'criteria' : selectedInvestigation ? 'investigations' : selectedRule ? 'rules' : 'qwen'} data-selected-pot={potId} data-selected-target={target?.id ?? ''} data-selected-band={point ? band : ''}>
        {selectedInvestigation ? <InvestigationTargetAnalysis plan={selectedInvestigation.plan} target={selectedInvestigation.target} evidence={selectedField || selectedCriteria ? sourceJob?.evidence : entry?.job?.evidence} onSelect={selectedField ? selectField : selectedCriteria ? selectCriteria : selectInvestigation} sourceCriteria={!!selectedCriteria} sourceField={!!selectedField} missingEvidence={selectedCriteria?.assessment.missingEvidence} /> : selectedRule ? <CandidateRuleTargetAnalysis priority={selectedRule.priority} target={selectedRule.target} targets={currentRuleTargets} sourceLabel={ruleSourceLabel} templates={ruleTemplates} onSelect={id => selectRule(selectedRule.priority.id,id)} /> : finding && target && meta ? <>
          <header className={styles.selectedHeader}><div><span className={styles.eyebrow}>{point ? 'AI 선정 POT' : 'AI 선정 통화 근거'}</span><h3>{point?.pot ?? (target.kind === 'termination-group' ? '통화 종료 원인' : target.kind === 'call-criteria' ? '통화별 DL·UL·Pollution 관측 기준' : '통화 무선 변화')}</h3><p>{point ? band + (target.earfcn ? ' / EARFCN ' + target.earfcn : '') + ' · ' + date : 'POT 미연결 · ' + target.sourceDates.join(', ')}</p></div><span className={styles.status}>{finding.hypothesis.assessment === 'supported' ? '관측 근거 있음' : '의심 · 확인 필요'}</span></header>
          <div className={styles.origin}>AI 선택 결과 · 연결된 원본 근거 <span>AI 입력·응답은 상단에서 확인</span></div>
          <section className={styles.stage} data-pot-stage="1" aria-labelledby={prefix + '-problem'}>
            <h4 id={prefix + '-problem'}><b>1</b> 문제</h4>
            <p className={styles.headline}>{finding.hypothesis.title}</p>
            <p className={styles.observation}>{target.observation}</p>
            {keyMetrics.length > 0 && <div className={styles.selectedMetrics}>{keyMetrics.map(m => <div key={m.label}><span>{m.label === 'fcRaw' ? 'FC 원문' : m.label === 'byeReasonRaw' ? 'BYE 원문' : m.label}</span><strong>{target.kind === 'call-criteria' ? (m.value == null ? '미확보' : String(m.value)) + (m.unit ? ' ' + m.unit : '') : value(m.value, m.unit ? ' ' + m.unit : '')}</strong></div>)}</div>}
            {finding.targets.some(t => t.kind === 'mdt-grid') && <div className={styles.rankedTargets} aria-label="Qwen 선정 POT 우선순위">{finding.targets.filter(t => t.kind === 'mdt-grid').map((t, i) => <button type="button" key={t.id} data-ranked-target={t.id} aria-pressed={t.id === target.id} onClick={() => selectTarget(finding.id, t.id)}><b>{i + 1}</b><span><strong>{targetLabel(t)}</strong><small>{t.sourceDates.join(', ')} · ≤−105 {metricValue(t, ['RSRP ≤-105 dBm', 'RSRP ≤ -105'])} · ≤−110 {metricValue(t, ['RSRP ≤-110 dBm', 'RSRP ≤ -110'])} · 측정 {metricValue(t, ['측정 수'])}</small></span></button>)}</div>}
            {interruptionMetrics.length > 0 && <dl className={styles.interruptionEvidence} aria-label="관측된 통화 종료 원문">{interruptionMetrics.map(m => <div key={m.label}><dt>{m.label}</dt><dd>{value(m.value)}</dd></div>)}</dl>}
          </section>
          <section className={styles.stage} data-pot-stage="2" aria-labelledby={prefix + '-cause'}>
            <h4 id={prefix + '-cause'}><b>2</b> 추정 원인</h4>
            <div className={styles.cause}><strong>{findingLabel(finding)}</strong><p>{finding.hypothesis.reason}</p></div>
            {target.kind === 'termination-group' && <p className={styles.diagnosticGap}>종료 원문은 중단 현상을 가리킵니다. 동일 통화의 양방향 RTP·SIP 시각을 맞춰 먼저 중단된 방향과 구간을 확인해야 원인을 좁힐 수 있습니다.</p>}
            {!!targetLimits.length && <div className={styles.visibleLimits}><strong>아직 확인되지 않은 점</strong><ul>{targetLimits.map((text, i) => <li key={i}>{text}</li>)}</ul></div>}
          </section>
          <section className={styles.stage} data-pot-stage="3" aria-labelledby={prefix + '-action'}>
            <h4 id={prefix + '-action'}><b>3</b> 확인·개선</h4>
            {check && <div className={styles.actionRow}><span><Check size={15} /> 먼저 확인</span><p>{check}</p></div>}
            {action && <div className={styles.actionRow}><span><Check size={15} /> 확인 후 조치</span><p>{action.when} {action.action}</p></div>}
            {station && <aside className={styles.stationSelection}><strong><RadioTower size={16} /> Cell {station.cellId} · PCI {station.pci ?? '미확인'}</strong><span>{station.ruId} · {relationText(station.relation)}</span></aside>}
          </section>
          <details className={styles.evidence}>
            <summary>선정 근거·전체 확인 절차 <ChevronDown size={18} /></summary>
            <p>{target.observation}</p>
            <h5>분석에 사용한 원본 지표</h5>
            <div className={styles.tableScroll}><table><thead><tr><th>지표</th><th>관측값</th></tr></thead><tbody>{target.metrics.map((m, i) => <tr key={i}><th>{m.label}</th><td>{value(m.value, m.unit ? ' ' + m.unit : '')}</td></tr>)}</tbody></table></div>
            <CandidateTargetCriteria target={target} /><h5>AI가 밝힌 추가 확인 사항</h5><p>{finding.hypothesis.missingEvidence}</p>
            {procedures.map(p => <div key={p.id}><h5>{p.title}</h5><ol>{p.checkNow.map((text, i) => <li key={i}>{text}</li>)}</ol>{p.conditionalActions.map((a, i) => <p key={i}><strong>{a.when}</strong> {a.action}</p>)}<h5>조치 후 확인</h5><ul>{p.verifyAfter.map((text, i) => <li key={i}>{text}</li>)}</ul></div>)}
            <h5>기지국 연결 근거</h5>{context ? <><p>등록 자료 {context.stationSummary.sourceDate ?? '날짜 미확인'}. 기지국 표시는 후보 통화와의 BYE 연결·등록 관계이며, AI가 책임 기지국으로 지정한 결과는 아닙니다.</p>
            <div className={styles.tableScroll}><table><thead><tr><th>Cell / RU</th><th>PCI</th><th>연결 근거</th></tr></thead><tbody>{context.stations.filter(s => s.relation !== 'nearby-inventory').map(s => <tr key={s.id}><th><button type="button" onClick={() => { setSelectedStation(s.id); setShowStations(true); }}>{s.cellId}</button><br /><small>{s.ruId}</small></th><td>{s.pci ?? '미확인'}</td><td>{relationText(s.relation)}</td></tr>)}</tbody></table></div></> : <p>현재 기지국 연결 자료를 불러오지 못했습니다. 저장된 보고서의 원본 관측값만 표시합니다.</p>}
            {point && <p>저장 MDT {date} · 통화 {entry?.target.scope.dateStart}~{entry?.target.scope.dateEnd}. 해당 POT는 무선 조사 대상이며 통화 저하 순간의 위치 확정은 아닙니다.</p>}
          </details>
        </> : <div className={styles.emptyAnalysis}>
          {busy ? <LoaderCircle size={30} className={styles.spin} /> : <Sparkles size={28} />}
          <h3>{modelStatus}</h3>
          <p>{emptySourceAssessment?.reason ?? (busy ? 'AI가 근거가 있는 원인과 대상 POT를 고르면 여기에 문제·원인·확인 조치가 자동으로 표시됩니다.' : error || (isCurrent ? missing || '관측된 데이터만으로 구체적인 원인을 선정하지 못했습니다.' : '상단 AI 분석을 실행하면 조사 대상과 관련 원인이 자동으로 선택됩니다.'))}</p>
          {emptySourceAssessment ? <><p><b>확인할 항목</b> {emptySourceAssessment.nextCheck}</p><ul>{emptySourceAssessment.missingEvidence.map((item, index) => <li key={index}>{item}</li>)}</ul></> : isCurrent && entry?.job?.report?.checks.length ? <details className={styles.evidence}><summary>AI가 요청한 추가 확인 사항</summary><ul>{entry.job.report.checks.map((c, i) => <li key={i}>{c.action}</li>)}</ul></details> : null}
        </div>}
      </article></details>}</div>
    </div>
  </section>;
}


