'use client';
import type { CandidateEvidenceTarget } from '../../lib/analyst/candidate-ai-analysis';
import { CandidateTargetMap } from './candidate-target-map';
import styles from './candidate-ai-analysis.module.css';

export function targetMetric(value: number | string | null) {
  return value == null
    ? '미확보'
    : typeof value === 'number'
      ? value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })
      : value;
}
const isCountMetric = (label: string) =>
  /^(?:측정 수|표본 수|관측 수|(?:동일 종료 사유 |Drop )?통화 수|samples|count)$/i.test(
    label,
  );
const causeLabels: Record<string, string> = {
  fcRaw: 'FC',
  byeReasonRaw: 'BYE',
  reasonRaw: 'REASON',
  releaseCauseRaw: 'Release Cause',
};
function primaryMetrics(target: CandidateEvidenceTarget) {
  if (target.kind === 'mdt-grid')
    return target.metrics.filter(
      (metric) =>
        isCountMetric(metric.label) ||
        /^(?:RSRP|RSRQ) 평균$/.test(metric.label) ||
        /^RSRP *≤ *-(?:100|105|110)(?: *dBm)?$/.test(metric.label),
    );
  if (target.kind === 'termination-group')
    return target.metrics.filter(
      (metric) => isCountMetric(metric.label) || metric.label in causeLabels,
    );
  return target.metrics;
}
function TargetMetrics({
  metrics,
  primary = false,
}: {
  metrics: CandidateEvidenceTarget['metrics'];
  primary?: boolean;
}) {
  return (
    <dl
      className={styles.targetMetrics}
      aria-label={primary ? '주요 측정값' : '전체 원본 측정값'}
    >
      {metrics.map((metric, index) => (
        <div key={index}>
          <dt>
            {primary
              ? (causeLabels[metric.label] ?? metric.label)
              : metric.label}
          </dt>
          <dd>
            {targetMetric(metric.value)}
            {metric.value == null ? '' : metric.unit ? ' ' + metric.unit : ''}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function TargetSource({ target }: { target: CandidateEvidenceTarget }) {
  return (
    <div className={styles.targetSource}>
      <span>
        <b>{target.kind === 'mdt-grid' ? '배경 MDT 측정일' : '관측일'}</b>{' '}
        {target.sourceDates.join(', ') || '미확보'}
      </span>
      {target.band && (
        <span>
          <b>대역</b> {target.band}
        </span>
      )}
      {target.earfcn && (
        <span>
          <b>EARFCN</b> {target.earfcn}
        </span>
      )}
      {target.metrics
        .filter((m) => isCountMetric(m.label))
        .map((m, i) => (
          <span key={i}>
            <b>{m.label}</b> {targetMetric(m.value)} {m.unit}
          </span>
        ))}
    </div>
  );
}
export function CandidateTargetFindings({
  targets,
  onSelect,
}: {
  targets: CandidateEvidenceTarget[];
  onSelect: (id: string) => void;
}) {
  return (
    <div
      className={styles.targetFindings}
      aria-label="우선 확인할 실제 분석 대상"
    >
      {targets.map((target, i) => (
        <button
          key={target.id}
          type="button"
          data-target-id={target.id}
          onClick={() => onSelect(target.id)}
        >
          <strong>
            <small>대상 {i + 1}</small> {target.title}
          </strong>
          <span>{target.observation}</span>
          <TargetSource target={target} />
          <em>대상 근거·위치 보기 →</em>
        </button>
      ))}
    </div>
  );
}
export function CandidateTargetDetails({
  targets,
  selectedId,
  onSelect,
  callPeriod,
}: {
  targets: CandidateEvidenceTarget[];
  selectedId: string;
  onSelect: (id: string) => void;
  callPeriod: string;
}) {
  const selected = targets.find((t) => t.id === selectedId) ?? targets[0];
  if (!selected) return null;
  return (
    <div className={styles.targetDetails} aria-label="대상별 관측 근거와 위치">
      <label className={styles.targetSelect}>
        확인할 대상
        <select
          value={selected.id}
          onChange={(e) => onSelect(e.target.value)}
          aria-label="확인할 분석 대상"
        >
          {targets.map((t, i) => (
            <option key={t.id} value={t.id}>
              {i + 1}. {t.title}
            </option>
          ))}
        </select>
      </label>
      <div data-target-id={selected.id}>
        <h4>{selected.title}</h4>
        <p>{selected.observation}</p>
        <TargetSource target={selected} />
        <p className={styles.scopeNote}>
          통화 분석 기간 {callPeriod}
          {selected.kind === 'mdt-grid'
            ? ' · 배경 MDT는 별도 날짜의 참고 측정이며 통화 당시 위치·서빙 셀을 확정하지 않습니다.'
            : ''}
        </p>
        <TargetMetrics metrics={primaryMetrics(selected)} primary />
        {primaryMetrics(selected).length < selected.metrics.length && (
          <details className={styles.allTargetMetrics}>
            <summary>모든 측정값·집계 기준</summary>
            <TargetMetrics metrics={selected.metrics} />
          </details>
        )}
        {selected.mapPoints.length ? (
          <CandidateTargetMap target={selected} />
        ) : (
          <p className={styles.scopeNote}>
            이 대상에는 확보된 POT 좌표가 없습니다. 연결된 원본 통화와 관측일을
            기준으로 확인하세요.
          </p>
        )}
        {selected.limitations.length > 0 && (
          <ul className={styles.targetLimits}>
            {selected.limitations.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
