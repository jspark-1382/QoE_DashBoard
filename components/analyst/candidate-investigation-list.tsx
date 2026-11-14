'use client';

import { useState } from 'react';
import { Layers, MapPin, PhoneCall } from 'lucide-react';
import type { CandidateAnalysisJob, CandidateEvidenceTarget, CandidateCauseCategory } from '../../lib/analyst/candidate-ai-analysis';
import { isAnalysisActive } from '../../lib/analyst/customer-ai-analysis';
import { getCandidateSelectedFindings, getCandidateSourceCauseAssessments } from '../../lib/analyst/candidate-ai-selections';
import { formatInvestigationBand, investigationCoverage, investigationHeadline, type InvestigationCoverage } from '../../lib/analyst/candidate-investigation-presentation';
import { getCandidateGridContrast, getCandidateRepresentativeCause, type CandidateSelectedGrid } from '../../lib/analyst/candidate-representative-cause';
import { getCandidateCallInsights } from '../../lib/analyst/candidate-call-insight';
import { getCandidateCallPotRelation } from '../../lib/analyst/candidate-call-pot-relation';
import { useCandidateCallObservations } from './use-candidate-call-observations';
import { getCandidateComparisonView } from '../../lib/analyst/candidate-comparison-view';
import { potCauseLabel } from '../../lib/analyst/candidate-pot-review';
import Link from './document-link';
import styles from './candidate-investigation-list.module.css';

type Investigation = { title: string; reason: string; nextCheck: string; targets: CandidateEvidenceTarget[] };
const metricValue = (value: number | string | null) => value == null ? '미확보' : String(value);
const metricLabel = (label: string) => ({ txPacketLoss: 'Tx 패킷 손실 (원본 방향 · txPacketLoss)', rxPacketLoss: 'Rx 패킷 손실 (원본 방향 · rxPacketLoss)', txJitter: 'Tx 지터 (원본 방향 · txJitter)', rxJitter: 'Rx 지터 (원본 방향 · rxJitter)', txLossCount: 'Tx 손실 개수 (원본 방향 · txLossCount)', rxLossCount: 'Rx 손실 개수 (원본 방향 · rxLossCount)' }[label] ?? label);
function metricList(metrics: CandidateEvidenceTarget['metrics']) {
  return <dl className={styles.metrics}>{metrics.map((metric, i) => <div key={i}><dt>{metricLabel(metric.label)}</dt><dd>{metricValue(metric.value)}{metric.unit ? ' ' + metric.unit : ''}</dd></div>)}</dl>;
}

const sourceObject = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const sourceText = (value: unknown) => value == null ? '미확보' : typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' ? String(value) : JSON.stringify(value) ?? '미확보';

export function CandidateTargetCriteria({ target }: { target: CandidateEvidenceTarget }) {
  if (!target.criteria) return null;
  const newCriteria = 'overlap' in target.criteria || 'frequencyChange' in target.criteria;
  const labels = {
    dl: 'DL 하향 RSRP 기준', ul: 'UL PHR 기준 · 원본값·단위 미확인',
    pollution: newCriteria ? '서빙 PCI·Cell-ID 반복 변경' : 'Pollution 관측 구간',
    overlap: '동일 주파수에서 서빙 셀 복귀', frequencyChange: '인접 관측의 EARFCN 변경',
  };
  return <details className={styles.criteriaDetail}><summary>{newCriteria ? '통화 무선 관측 기준 상세' : 'DL·UL·Pollution 관측 기준 상세'}</summary>
    <p>관측 기준을 충족해도 실제 원인이나 실제 전환 실패를 확정하지 않습니다. PHR은 원본값·단위 미확인입니다.</p>
    {(Object.keys(labels) as (keyof typeof labels)[]).map(key => {
      const criterion = sourceObject(target.criteria?.[key]); if (!criterion) return null;
      const window = sourceObject(criterion.window), events = Array.isArray(window?.events) ? window.events.map(sourceObject).filter((event): event is Record<string, unknown> => !!event) : [];
      return <section key={key}><strong>{labels[key]}</strong>
        <p>{criterion.status === 'matched' ? '관측 기준 충족' : criterion.status === 'not-matched' ? '해당 관측에서 기준 미충족' : '자료 부족'}{criterion.threshold != null && ' · 기준 ' + sourceText(criterion.threshold)}{criterion.validSamples != null ? ' · 유효 관측 ' + sourceText(criterion.validSamples) : ''}{criterion.observedCount != null ? ' · 기준 해당 ' + sourceText(criterion.observedCount) : ''}</p>
        {criterion.aggregation === 'source-grid-distribution' && <p>배경 격자 분포 · 기준 이하 비율 {sourceText(criterion.tailPct)}%</p>}
        {criterion.aggregation === 'source-grid-mean' && <p>배경 격자 평균 {sourceText(criterion.mean)} · 개별 관측 횟수·비율과 다름 · 원본값·단위 미확인</p>}
        {window && <p>시작 {sourceText(window.startedAt)} · 종료 {sourceText(window.endedAt)}{window.changes != null && ' · 변화 ' + sourceText(window.changes) + '회'}{window.eventCount != null && ' · 이벤트 ' + sourceText(window.eventCount) + '건'}</p>}
        {events.length > 0 && <ul>{events.map((event, index) => <li key={index}>{[
          sourceText(event.at), event.cellChanged && 'Cell 변경', event.pciChanged && 'PCI 변경', event.frequencyChanged && '주파수 변경',
          event.earfcn != null && 'EARFCN ' + sourceText(event.earfcn), event.servingPci != null && 'PCI ' + sourceText(event.servingPci),
          event.rsrp != null && 'RSRP ' + sourceText(event.rsrp) + ' dBm', event.rsrq != null && 'RSRQ ' + sourceText(event.rsrq) + ' dB',
        ].filter(Boolean).join(' · ')}</li>)}</ul>}
        {Array.isArray(criterion.missing) && criterion.missing.length > 0 && <p>미확인: {criterion.missing.map(sourceText).join(' · ')}</p>}
      </section>;
    })}
    <details><summary>기준별 원본 관측 전체</summary><pre aria-label="기준별 원본 관측">{JSON.stringify(target.criteria, null, 2)}</pre></details>
  </details>;
}

type GridContrast = ReturnType<typeof getCandidateGridContrast>;

function WeakSignalPlot({ point, contrast }: { point: CandidateSelectedGrid; contrast?: GridContrast }) {
  const metric = point.metric;
  const percent = contrast?.own ?? (metric?.kind === 'dl-rsrp' ? metric.percent : null);
  if (percent == null || !Number.isFinite(percent)) return null;
  const threshold = contrast?.threshold ?? (metric?.kind === 'dl-rsrp' ? metric.thresholdDbm : undefined);
  const values = [
    {role:'survey', label:'선택 지점', value:percent},
    ...(contrast ? [{role:'neighbors', label:'25m 인접 ' + contrast.peers.length + '곳' + (contrast.peers.length > 1 ? ' 평균' : ''), value:contrast.average}] : []),
  ];
  return <figure className={styles.signalPlot} data-grid-contrast={point.targetId} data-contrast-threshold={threshold}>
    <figcaption><div><strong>신호가 약하게 측정된 비율</strong><span>RSRP {threshold} dBm 이하</span></div>
      {contrast && <small className={styles.difference}>차이 <b>{Math.abs(contrast.gap) < .005 ? '0.00' : (contrast.gap > 0 ? '+' : '−') + Math.abs(contrast.gap).toFixed(2)}%p</b></small>}
    </figcaption>
    <div className={styles.plotRows}>{values.map(row => <div className={styles.plotRow} key={row.role} data-contrast-role={row.role}>
      <span>{row.label}</span><strong data-contrast-value={row.role}>{row.value.toFixed(2)}%</strong>
      <div aria-hidden="true" className={styles.track}><i style={{width:row.value+'%'}} /></div>
    </div>)}<div className={styles.axis} aria-hidden="true"><span>0%</span><span>50%</span><span>100%</span></div></div>
    {!contrast && <small className={styles.measureNote}>같은 조건의 인접 비교값 미확보</small>}
  </figure>;
}

export function CandidateCauseAssessments({ job, coverage: providedCoverage, representative: providedRepresentative, activeSurveyId, selectedGrid, gridContrast, selectedTargetId, showPointNavigation = true, onInspectPoint, onInspectPlan, onInspectTarget }: {
  job?: CandidateAnalysisJob | null;
  coverage?: InvestigationCoverage;
  representative?: ReturnType<typeof getCandidateRepresentativeCause>;
  activeSurveyId?: string;
  selectedGrid?: CandidateSelectedGrid;
  gridContrast?: GridContrast;
  selectedTargetId?: string;
  showPointNavigation?: boolean;
  onInspectPoint?: (targetId: string) => void;
  onInspectPlan?: (targetId: string) => void;
  onInspectTarget?: (targetId: string, category: CandidateCauseCategory) => void;
}) {
  const evidence = job?.evidence;
  const rows = getCandidateSourceCauseAssessments(job);
  const findings = getCandidateSelectedFindings(job);
  const legacyFour = evidence?.versions.evidence === 'candidate-evidence-v6';
  const calls = new Map([...(evidence?.calls ?? []), ...(evidence?.members ?? [])].map(call => [call.id, call]));
  const plans = getCandidateInvestigationPlans(job);
  const firstPlan = plans[0];
  const coverage = providedCoverage ?? investigationCoverage(evidence);
  const representative = providedRepresentative ?? getCandidateRepresentativeCause(job, coverage);
  const { points } = coverage;
  const representativePoint = points.find(point => point.targetId === representative.targetId);
  const representativeContrast = representative.category === 'coverage' && representative.thresholdDbm != null && representativePoint?.metric?.kind === 'dl-rsrp'
    ? getCandidateGridContrast(evidence, representativePoint, { thresholdDbm: representative.thresholdDbm }) : undefined;
  const selectedPoint = points.find(point => point.targetId === (activeSurveyId ?? selectedTargetId));
  const survey = points.find(point => point.targetId === (selectedTargetId ?? activeSurveyId ?? representative.targetId));
  const plotPoint = selectedGrid ?? (survey ? { ...survey, role:'survey' as const } : undefined);
  const thresholdDbm = (plotPoint?.targetId === representative.targetId ? representative.thresholdDbm : undefined) ??
    (plotPoint?.metric?.kind === 'dl-rsrp' ? plotPoint.metric.thresholdDbm : undefined);
  const contrast = plotPoint && plotPoint.metric?.kind !== 'ul-phr'
    ? gridContrast?.point.targetId === plotPoint.targetId ? gridContrast : getCandidateGridContrast(evidence, plotPoint, {thresholdDbm})
    : undefined;
  const showGridPlot = !!plotPoint && (!!contrast || plotPoint.metric?.kind === 'dl-rsrp');
  const callInsights = getCandidateCallInsights(job, representative);
  const [chosenCallId, setChosenCallId] = useState('');
  const insight = callInsights.find(item => item.call.id === chosenCallId) ?? callInsights[0];
  const { observations, status:observationStatus } = useCandidateCallObservations(job, insight);
  const callSource = insight && getCandidateCallPotRelation(evidence, insight, plotPoint?.pot, observations);
  const checkingLocation = observationStatus === 'loading' && !!plotPoint;
  const callRelationLabel = {
    direct:callSource?.locationScope === 'event' ? '이 구간에서 선택 POT 관측' : '통화 중 선택 POT 관측',
    'other-pot':'선택 POT와 다른 지점에서 관측', 'candidate-only':'같은 후보 지역 · 선택 POT 직접 연결 미확인',
    'no-selection':'비교할 POT 미선택', unknown:'선택 POT와의 연결 자료 부족',
  };
  const representativeDates = [...new Set(representative.callIds.flatMap(id => calls.get(id)?.date ?? []))].sort((a,b) => a.localeCompare(b));
  const potCount = new Set(points.map(item => item.pot)).size;
  const bandLabels = [...new Set(points.map(item => formatInvestigationBand(item.band)))];
  const callLinks = (ids: string[]) => [...new Set(ids)].flatMap(id => {
    const call = calls.get(id);
    return call?.href && /^\/(?:qoe(?:\/|\?|$)|\?)/.test(call.href) ? [call] : [];
  });
  const priorityCalls = callLinks(firstPlan?.targets.flatMap(target => target.callIds) ?? []);
  const view = getCandidateComparisonView(job);
  const linkedComparison = view && insight?.basis === 'qwen' && [view.primary, view.alternative].some(side =>
    side?.sources.some(source=>source.target.id === insight.targetId && insight.evidenceIds.includes(source.id)));
  const comparisonState = view ? 'verified' : job && isAnalysisActive(job.status) ? 'pending'
    : job?.status === 'completed' && !!job.report && evidence?.versions.prompt !== 'candidate-prompt-v11' ? 'archived' : 'unavailable';
  const currentTaxonomy = evidence?.versions.evidence === 'candidate-evidence-v7';
  const orderedRows = currentTaxonomy
    ? rows.slice().sort((a, b) => Number(a.status === 'insufficient') - Number(b.status === 'insufficient'))
    : rows;
  const collecting = !!job && isAnalysisActive(job.status);
  return <>
    <section className={styles.fieldPriority} aria-label="후보 지역 대표 원인 가설" data-result-block="regional" data-representative-cause={representative.category ?? 'insufficient'} data-investigation-priority={representative.category ?? 'unavailable'} data-priority-source={representative.category ? 'source' : 'unavailable'}>
      <header className={styles.regionHeading}><small className={styles.dateLabel}><Layers size={17} aria-hidden="true" />후보 지역 대표 원인 가설</small><span className={styles.hypothesisBadge}>{representative.category ? '우선 조사 · 원인 미확정' : '대표 원인 판단 보류'}</span></header>
      <h3 data-representative-title>{collecting && !evidence ? '후보 근거 수집 중' : representative.title.replace(/커버리지 검토 필요$/, '커버리지 우선 점검')}</h3>
      {representativePoint ? <div className={styles.sourceLine} data-representative-origin>
        <b>대표 POT {representativePoint.pot}</b><span>MDT {representativePoint.sourceDate}</span>
        <span>{formatInvestigationBand(representativePoint.band)} · EARFCN {representativePoint.earfcn}</span>
      </div> : representativeDates.length > 0 && <div className={styles.sourceLine} data-representative-origin>
        <b>근거 통화 {representative.callIds.length}건</b><span>{representativeDates.join(' · ')}</span>
      </div>}
      {representativeContrast ? <section className={styles.representativeMetrics} aria-label="대표 POT와 인접 POT 측정 비교">
        <dl><dt>약전 비율</dt><dd>{representativeContrast.own.toFixed(2)}%</dd></dl>
        <dl><dt>인접 {representativeContrast.peers.length}곳{representativeContrast.peers.length > 1 ? ' 평균' : ''}</dt><dd>{representativeContrast.average.toFixed(2)}%</dd></dl>
        <dl><dt>차이</dt><dd>{Math.abs(representativeContrast.gap) < .005 ? '0.00' : (representativeContrast.gap > 0 ? '+' : '−') + Math.abs(representativeContrast.gap).toFixed(2)}%p</dd></dl>
        <small>RSRP {representativeContrast.threshold} dBm 이하로 측정된 비율</small>
      </section> : <p data-representative-summary>{collecting && !evidence ? '통화 및 MDT 측정값을 확인하고 있습니다.' : representative.summary}</p>}
      {(representative.details.length > 0 || representativeContrast) && <details className={styles.heroDetails} data-representative-details>
        <summary>판단 근거 상세</summary>
        {representativeContrast && <p data-representative-summary>{representative.summary}</p>}
        <ul>{representative.details.map((detail, index) => <li key={index}>{detail}</li>)}</ul>
      </details>}
    </section>
    {plotPoint ? <section className={styles.potMeasurement} aria-label="선택 POT 측정 결과" data-result-block="measurement" data-selected-pot-result={plotPoint.pot} data-selected-pot-role={plotPoint.role}>
      <div className={styles.sectionHeading}><span className={styles.sectionIcon} aria-hidden="true">{plotPoint.role !== 'comparison' && survey ? survey.rank : <MapPin size={17} />}</span><h3>선택 POT 측정 결과</h3><b>{plotPoint.role === 'comparison' ? '비교 지점' : '조사 지점' + (survey ? ' ' + survey.rank : '')} · {plotPoint.pot}</b></div>
      <div className={styles.sourceLine}>
        <span data-pot-measure-date>MDT 측정일 <b>{plotPoint.sourceDate || '미확인'}</b></span>
        <span data-pot-measure-frequency>{formatInvestigationBand(plotPoint.band) || '주파수 미확인'}{plotPoint.earfcn && ' · EARFCN ' + plotPoint.earfcn}</span>
      </div>
      {showGridPlot ? <WeakSignalPlot point={plotPoint} contrast={contrast} /> :
        <p className={styles.measureNote}>{plotPoint.metric?.kind === 'ul-phr' ? 'PHR 원본 평균 ' + plotPoint.metric.mean + ' · 기준 3 이하 (단위 미확인)' : '이 격자의 약전 비율 미확보'}</p>}
    </section> : evidence && <section className={styles.potMeasurement} aria-label="선택 POT 측정 결과" data-result-block="measurement" data-selected-pot-result="">
      <div className={styles.sectionHeading}><h3>선택 POT 측정 결과</h3></div>
      <p className={styles.measureNote}>{points.length ? '지도에서 조사 지점을 선택하면 해당 POT의 측정값을 볼 수 있습니다.' : '이 분석에서 조사 기준을 충족한 POT가 없습니다.'}</p>
    </section>}
    {insight && callSource && <section className={styles.callEvidence} data-result-block="call" data-call-insight={insight.kind} data-call-evidence-target={insight.targetId}>
      <header><h3><PhoneCall size={20} aria-hidden="true" />선택 통화 관측</h3>
        <span>{linkedComparison && view ? (view.comparison.assessment === 'prioritize' ? potCauseLabel(view.primary.category)+' 우선 조사' : '통화 원인 미확정') : '원본 관측'}</span></header>
      <div className={styles.callSelector}>
        <details className={styles.relation} data-call-pot-relation={checkingLocation ? 'loading' : callSource.relation} data-call-pot={plotPoint?.pot} data-call-location-scope={callSource.locationScope}>
          <summary>{checkingLocation ? '통화 위치 확인 중' : callRelationLabel[callSource.relation]}</summary>
          <p>{checkingLocation ? '선택한 통화의 원본 위치 기록을 불러오고 있습니다.' : callSource.relation === 'direct' ? (callSource.locationScope === 'event' ? '이 구간의 통화 위치 기록 중에 선택한 POT ' + plotPoint?.pot + '가 있습니다.' :
            '통화 중 위치 기록에 POT ' + plotPoint?.pot + '가 있습니다. 이 구간의 관측 시각과 위치는 별도로 대조해야 합니다.')
            : callSource.relation === 'other-pot' ? '아래 관측 시각의 통화 위치는 모두 선택한 POT ' + plotPoint?.pot + ' 밖에 기록됐습니다.'
            : callSource.relation === 'candidate-only' ? '해당 통화는 이 후보 지역에서 선정됐습니다. 통화의 관측 위치를 POT ' + plotPoint?.pot + '로 확인할 수 있는 원본 연결이 없습니다.'
            : callSource.relation === 'no-selection' ? '지도에서 지점을 선택하면 통화 위치와의 연결 여부를 확인할 수 있습니다.'
            : '저장된 위치 기록만으로 이 통화와 선택 POT의 연결을 확인하기 어렵습니다.'}</p>
          {callSource.observedPots.length > 2 && <p>기록된 POT 전체 · {callSource.observedPots.join(' · ')}</p>}
        </details>
        {callInsights.length > 1 && <select aria-label="조사 통화 선택" value={insight.call.id} onChange={event => setChosenCallId(event.target.value)}>
          {callInsights.map(item => <option key={item.call.id} value={item.call.id}>{item.call.date.slice(5).replace('-','.')+' '+item.call.start}</option>)}
        </select>}
      </div>
      <div className={styles.sourceLine}>
        <span data-call-date>통화일 <b>{callSource.callDate ?? '미확인'}</b> · {insight.call.start}</span>
        <span data-call-frequency data-call-frequency-scope={callSource.frequencyScope}>
          {callSource.frequencyScope === 'event' ? '이 구간 주파수 ' : callSource.frequencyScope === 'call' ? '통화 중 관측 주파수 ' : '주파수 '}{callSource.frequencyLabel}
        </span>
        {callSource.observedPots.length > 0 && <span data-call-observed-pots>{callSource.locationScope === 'event' ? '이 구간 관측 POT ' : '통화 중 관측 POT '}
          {callSource.observedPots.slice(0,2).join(' · ')}{callSource.observedPots.length > 2 && ' 외 ' + (callSource.observedPots.length - 2) + '곳'}{callSource.locationScope === 'event' && !callSource.locationComplete && ' · 일부 시점만 확인'}</span>}
      </div>
      <h4>{insight.question}</h4>
      {insight.rows.length > 0 && <ol className={styles.eventRows} data-event-ordered={insight.rows.length > 1 && insight.rows.every(row=>!!row.time)}>
        {insight.rows.map((row,index) => <li key={index} data-call-event title={row.time || undefined}>
          <span>{row.label}</span><strong>{row.value}</strong>{row.time && <time>{row.time}</time>}
        </li>)}
      </ol>}
      <strong className={styles.eventConclusion} data-insight-conclusion>{insight.conclusion}</strong>
      {insight.context && <p className={styles.eventContext} data-insight-context>{insight.context}</p>}
      <div className={styles.eventAction}><b>먼저 확인</b><span>{insight.firstCheck}</span>
        <Link href={insight.call.href} data-insight-source-call={insight.call.id} target="_blank" rel="noreferrer">해당 통화 보기 ↗</Link>
      </div>
    </section>}
    {view ? <section className={styles.comparison} aria-label="Qwen 원인 비교" data-ai-comparison="verified" data-comparison-job={job?.id}>
      <details className={styles.modelDetail} data-model-detail open={insight ? undefined : true} key={job?.id}>
        <summary>{insight ? 'Qwen 비교 해석·인용 근거' : 'Qwen 원인 비교'}</summary>
      <header><h3>Qwen {view.alternative ? '원인 비교' : '근거 해석'}</h3>
        <small>{view.model}</small></header>
      <p className={styles.comparedCauses} data-comparison-categories>
        {view.comparison.assessment === 'prioritize' ? '우선 조사 ' : '판단 보류 · '}
        <strong>{potCauseLabel(view.primary.category)}</strong>
        {view.alternative && <> {view.comparison.assessment === 'prioritize' ? '· 대안' : ' / '} {potCauseLabel(view.alternative.category)}</>}
      </p>
      <p className={styles.interpretation} data-comparison-interpretation>{view.comparison.interpretation}</p>
      <dl className={styles.comparisonSteps}>
        {view.readingText && <div><dt>비교 관측값</dt><dd data-comparison-reading>{view.readingText}</dd></div>}
        <div><dt>남은 의문</dt><dd data-comparison-limitation>{view.comparison.limitation}</dd></div>
        <div><dt>먼저 확인</dt><dd data-comparison-check>{view.comparison.nextCheck}</dd></div>
      </dl>
      <details data-comparison-sources className={styles.comparisonSources}>
        <summary>Qwen이 인용한 근거</summary>
        {evidence?.publicCoverage && <p className={styles.comparisonScope}>
          원본 검토 {evidence.publicCoverage.reviewedTargets}개 대상 중 모델에 전달된 대상 {evidence.publicCoverage.modelSentTargets}개
        </p>}
        {[view.primary,...(view.alternative ? [view.alternative] : [])].map(side =>
          <section key={side.category}><h4>{potCauseLabel(side.category)}</h4><ul>
            {side.sources.map(({id,fact,target}) => <li key={id} data-comparison-source-id={id}>
              <strong>{target.title}</strong><p>{fact.detail}</p>
              {points.some(point => point.targetId === target.id) && onInspectPoint &&
                <button type="button" onClick={() => onInspectPoint(target.id)}>지도에서 선택</button>}
              {callLinks(target.callIds).map(call => <Link key={call.id} href={call.href} target="_blank" rel="noreferrer">
                {call.date.slice(5).replace('-', '/')} {call.start} 원본 통화 ↗</Link>)}
            </li>)}</ul></section>)}
      </details>
      </details>
    </section> : job && <section className={styles.comparisonStatus} data-ai-comparison={comparisonState} aria-label="Qwen 원인 비교 상태">
      <strong>Qwen 원인 비교</strong>
      <p>{comparisonState === 'archived' ? '원인 간 비교가 도입되기 전에 저장된 결과입니다.' :
        comparisonState === 'pending' ? 'Qwen 분석 결과를 기다리고 있습니다.' :
        job.status === 'failed' ? '이번 Qwen 분석이 실패했습니다.' :
        job.status === 'cancelled' ? '이번 분석은 취소됐습니다.' :
        job.report?.comparison === null ? '서로 비교할 수 있는 원인 근거가 부족합니다.' : '이번 Qwen 응답에서 검증된 비교 해석을 확보하지 못했습니다.'}</p>
      {firstPlan && <details className={styles.heroDetails} data-investigation-procedure>
        <summary>이번 응답의 조사 제안</summary>
        <strong>{firstPlan.title}</strong>
        <p>{firstPlan.nextCheck}</p>
        <div className={styles.priorityLinks}>
          <button type="button" data-priority-target={firstPlan.targets[0].id} onClick={() => onInspectPlan?.(firstPlan.targets[0].id)}>조사 대상 자세히 보기</button>
          {priorityCalls.map(call => <Link key={call.id} data-investigation-call={call.id} href={call.href} target="_blank" rel="noreferrer">{call.date.slice(5).replace('-', '/')} {call.start} 통화 ↗</Link>)}
        </div>
      </details>}
    </section>}
    <details className={styles.resultGroup} aria-label="원인별 조사 항목" data-cause-evidence-fold data-source-cause-assessments="true" data-source-assessment-job={job?.id}>
      <summary>원인별 근거{rows.length > 0 && ' ' + rows.length + '개'}{legacyFour && <small>저장 당시 4개 분류</small>}</summary>
      {!rows.length && <p>{evidence?.causeAssessments ? '원본 기준 평가 연결을 확인할 수 없습니다.' : evidence ? '이 실행에 저장된 원인별 평가가 없습니다.' : collecting ? '원인별 평가를 기다리고 있습니다.' : '분석 후 원인별 관측 근거와 확인 항목이 표시됩니다.'}</p>}
      {orderedRows.map(row => {
        const pots = new Set(row.targets.flatMap(target => target.mapPoints.map(point => point.pot)));
        const callIds = [...new Set(row.targets.flatMap(target => target.callIds))];
        const linkedCalls = callIds.flatMap(id => { const call = calls.get(id); return call?.href && /^\/(?:qoe(?:\/|\?|$)|\?)/.test(call.href) ? [call] : []; });
        const firstCall = linkedCalls[0];
        const countLabel = [pots.size ? 'POT ' + pots.size + '곳' : '', callIds.length ? '통화 ' + callIds.length + '건' : ''].filter(Boolean).join(' · ');
        const model = findings.filter(finding => finding.category === row.category);
        const unlistedFacts = (evidence?.facts ?? []).filter(fact => row.evidenceIds.includes(fact.id) &&
          !row.targets.some(target => target.evidenceIds.includes(fact.id)));
        const coverageSummary = currentTaxonomy && row.category === 'coverage' && !!points.length;
        const identifier = coverageSummary ? bandLabels.join(' · ') : firstCall ? firstCall.date.slice(5).replace('-', '/') + ' ' + firstCall.start : '';
        const status = row.status === 'insufficient' ? '판정 보류' : legacyFour ? '원본 관측 기준'
          : row.category === 'coverage' && row.targets.some(t => t.kind === 'mdt-grid' && t.metrics.some(m => m.label === 'RSRP ≤-105 dBm' && typeof m.value === 'number' && m.value > 0)) ? '약전계 분포 관측'
          : row.category === 'interference' ? '중첩 가설'
          : row.category === 'equipment' && row.targets.some(t => t.kind === 'termination-group') ? '종료 원문 관측'
          : row.category === 'mobility' && row.targets.some(t => sourceObject(t.criteria?.frequencyChange)?.status === 'matched') ? 'EARFCN 변경 관측'
          : row.status === 'possible' ? '원인 가설' : '관측 기준 충족';
        return <details key={row.category} className={styles.resultRow} data-source-cause={row.category} data-source-cause-status={row.status}>
          <summary><span className={styles.rowTitle}><small>{potCauseLabel(row.category, legacyFour)}</small><strong>{coverageSummary ? '대역별 커버리지 · 조사 POT ' + potCount + '곳' : investigationHeadline(row, legacyFour)}</strong></span>
            <span className={styles.rowMeta}><b>{status}</b>{identifier && <small>{identifier}</small>}<small>{coverageSummary ? '통화 ' + callIds.length + '건' : countLabel || '조사 대상 미확보'}</small></span><span aria-hidden="true" className={styles.chevron}>⌄</span></summary>
          <div className={styles.rowEvidence}>
            {firstCall && <small>원본 통화 {firstCall.date} {firstCall.start}{linkedCalls.length > 1 && ' 외 ' + (linkedCalls.length - 1) + '건'}</small>}
            <h4>조사 이유</h4><p>{row.reason}</p>
            <h4>확인할 항목</h4><p>{row.nextCheck}</p>
            {!!row.missingEvidence.length && <><h4>미확인 자료</h4><ul>{row.missingEvidence.map(text => <li key={text}>{text}</li>)}</ul></>}
            {unlistedFacts.map(fact => <section key={fact.id} data-source-fact={fact.id}><h4>{fact.title}</h4><p>{fact.detail}</p></section>)}
            {model.map(({ id, category, hypothesis }) => <section key={id} data-cause-category={category} data-analysis-source="qwen"><h4>Qwen 해석</h4><strong>{hypothesis.title}</strong><p>{hypothesis.reason}</p></section>)}
            {row.targets.length > 0 && <details><summary>원본 측정값 · {row.targets.length}개 대상</summary>{row.targets.map(target => <section key={target.id} className={styles.assessmentTarget}>
              <strong>{target.title}</strong><p>{target.observation}</p>{metricList(target.metrics)}<CandidateTargetCriteria target={target} />
              <button type="button" data-source-criteria-inspect={target.id} onClick={() => onInspectTarget?.(target.id, row.category)}>이 대상 자세히 보기</button>
            </section>)}</details>}
            {linkedCalls.length > 0 && <div className={styles.callLinks}><h4>연결된 원본 통화</h4><ul>{linkedCalls.map(call => <li key={call.id}><Link href={call.href} target="_blank" rel="noreferrer">{call.date} {call.start} · 원본 통화 ↗</Link></li>)}</ul></div>}
          </div>
        </details>;
      })}
    </details>
    {evidence && showPointNavigation && <CandidateInvestigationPoints coverage={coverage} selectedTargetId={selectedPoint?.targetId} onInspectPoint={onInspectPoint} />}
  </>;
}

export function CandidateInvestigationPoints({ coverage, selectedTargetId, onInspectPoint }: { coverage: InvestigationCoverage; selectedTargetId?: string; onInspectPoint?: (targetId: string) => void }) {
  const { points } = coverage;
  const selectedPoint = points.find(point => point.targetId === selectedTargetId);
  const potCount = new Set(points.map(point => point.pot)).size;
  return <section className={styles.pointGroup} aria-label="커버리지 조사 POT" data-coverage-source={coverage.savedSubset ? 'saved-measurements' : 'source-measurements'}>
      <header><h3>조사 POT <b>{potCount}곳</b></h3></header>
      {points.length ? <>
        <ol className={styles.points}>{points.map(({targetId, pot, band, earfcn, reason}, index) => <li key={targetId}>
          <button type="button" data-investigation-point={targetId} data-pot-id={pot} data-band={band} aria-pressed={targetId === selectedPoint?.targetId} aria-label={`조사 지점 ${index + 1}, POT ${pot}, ${formatInvestigationBand(band)}`} title={pot+' · '+formatInvestigationBand(band)+' · EARFCN '+earfcn+' · '+reason}
            onClick={() => onInspectPoint?.(targetId)}>
            {index + 1}
          </button>
        </li>)}</ol>
        {selectedPoint && <details className={styles.pointReason}><summary>POT {selectedPoint.pot} · 선정 근거</summary>
          <p>{selectedPoint.reason}</p>
          <p>{coverage.savedSubset ? '저장된 측정' : '원본 측정'} {coverage.catalog.reviewedCombinations.toLocaleString('ko-KR')}개 조합 검토 · 기준 충족 {coverage.catalog.qualifiedPotCount.toLocaleString('ko-KR')}곳 중 {potCount}곳 표시</p>
        </details>}
      </> : <p>{coverage.savedSubset ? '저장된' : '확보한'} 측정값에서 조사 기준을 충족한 POT가 없습니다.</p>}
    </section>;
}

/** Reconnect only complete references in the displayed run's own source snapshot. */
export function getCandidateInvestigationPlans(job?: CandidateAnalysisJob | null): Investigation[] {
  if (!job) return [];
  if (job.status !== 'completed' || !job.report || !job.evidence || !Array.isArray(job.evidence.analysisTargets)) return [];
  const targets = new Map(job.evidence.analysisTargets.map(target => [target.id, target]));
  if (targets.size !== job.evidence.analysisTargets.length) return [];
  const raw = job.report.investigations;
  if (!Array.isArray(raw) || raw.length > 6) return [];
  const plans = raw.flatMap(row => {
    if (!row || !row.title || !row.reason || !row.nextCheck || !Array.isArray(row.targetIds) || !row.targetIds.length || row.targetIds.length > 5 || new Set(row.targetIds).size !== row.targetIds.length || !Array.isArray(row.evidenceIds) || !row.evidenceIds.length) return [];
    const linked = row.targetIds.flatMap(id => targets.has(id) ? [targets.get(id)!] : []);
    if (linked.length !== row.targetIds.length || row.evidenceIds.some(id => !linked.some(target => target.evidenceIds.includes(id))) || linked.some(target => !target.evidenceIds.some(id => row.evidenceIds.includes(id)))) return [];
    return [{ title: row.title, reason: row.reason, nextCheck: row.nextCheck, targets: linked }];
  });
  return plans.length === raw.length ? plans : [];
}

function sourceHints(job: CandidateAnalysisJob): Investigation[] {
  if (job.status !== 'failed' || !job.evidence || !Array.isArray(job.evidence.analysisTargets)) return [];
  const targets = job.evidence.analysisTargets;
  if (new Set(targets.map(target => target.id)).size !== targets.length) return [];
  const order = { 'call-criteria': 0, 'call-quality': 1, 'call-radio': 2, 'call-pattern': 3, 'termination-group': 4, 'mdt-grid': 5 };
  const counts = new Map<string, number>();
  return targets.filter(target => target.investigationHint?.why && target.investigationHint.check && target.evidenceIds?.length).sort((a, b) => order[a.kind] - order[b.kind]).filter(target => { const count = counts.get(target.kind) ?? 0; counts.set(target.kind, count + 1); return count < 2; }).slice(0, 6).map(target => ({ title: target.title, reason: target.investigationHint!.why, nextCheck: target.investigationHint!.check, targets: [target] }));
}

export function CandidateInvestigationList({ job, busy = false, onInspectTarget }: { job?: CandidateAnalysisJob | null; busy?: boolean; onInspectTarget?: (id: string) => void }) {
  if (!job?.evidence) return null;
  const ai = getCandidateInvestigationPlans(job);
  const source = getCandidateSourceCauseAssessments(job).flatMap(row => row.targets.map(target => ({ title: target.title, reason: row.reason, nextCheck: row.nextCheck, targets: [target] })));
  const rows = (ai.length ? ai : source.length ? source : busy ? [] : sourceHints(job)).filter((row, index, all) => all.findIndex(other => other.targets[0]?.id === row.targets[0]?.id) === index).slice(0, 3);
  const primaryLabel = (target: CandidateEvidenceTarget) => {
    if (target.mapPoints[0]) return 'POT ' + target.mapPoints[0].pot;
    const call = [...(job.evidence?.calls ?? []), ...(job.evidence?.members ?? [])].find(call => target.callIds.includes(call.id));
    return call ? call.date.slice(5).replace('-', '/') + ' ' + call.start + ' 통화' : target.sourceDates[0] ? target.sourceDates[0].slice(5).replace('-', '/') + ' 원본 근거' : target.id;
  };
  const shortCheck = (target: CandidateEvidenceTarget, fallback: string) => {
    const category = getCandidateSourceCauseAssessments(job).find(row => row.targetIds.includes(target.id))?.category;
    return category === 'coverage' ? '약전계 구간·현장 신호 확인' : category === 'uplink' ? 'PHR 원본·상향 구간 확인' : category === 'interference' ? '서빙 변경·30초 구간 확인' : category === 'equipment' ? 'RTP·장비·Core 로그 대조' : fallback;
  };
  return <section className={styles.section} aria-label="조사 우선순위" data-investigation-source={ai.length ? 'qwen' : 'rules'}><div className={styles.heading}><h3>조사 우선순위</h3><span>대상을 누르면 지도와 원본 통화로 이동합니다.</span></div>
    <ol className={styles.list}>{rows.map((row, index) => <li key={row.targets[0].id} className={styles.card} data-investigation-index={index + 1}>
      <button type="button" className={styles.priorityButton} data-priority-target={row.targets[0].id} onClick={() => onInspectTarget?.(row.targets[0].id)}><b>{index + 1}</b><strong>{primaryLabel(row.targets[0])}</strong><span>{shortCheck(row.targets[0], row.nextCheck)}</span><i>›</i></button>
      <details className={styles.limits}><summary>상세 근거·원본 통화</summary><p>{row.reason}</p>{row.targets.map(target => <div key={target.id}><p>{target.observation}</p>{metricList(target.metrics)}<CandidateTargetCriteria target={target} /><ul>{target.callIds.map(id => { const call = [...(job.evidence?.calls ?? []), ...(job.evidence?.members ?? [])].find(call => call.id === id); return call?.href.startsWith('/') && !call.href.startsWith('//') ? <li key={id}><Link href={call.href} target="_blank" rel="noreferrer">{call.date} {call.start} · 원본 통화 ↗</Link></li> : null; })}</ul></div>)}</details>
    </li>)}</ol>{!rows.length && <p className={styles.missing}>조사 대상 근거 미확보</p>}
  </section>;
}
