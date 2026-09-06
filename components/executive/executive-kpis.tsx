'use client';

import type { ExecutiveSummary, RootCauseResult } from '@/lib/executive';

const grade = (value: number | null) => {
  if (value == null) return { label: '데이터 없음', tone: '' };
  if (value >= 4.5) return { label: '매우 양호', tone: 'good' };
  if (value >= 3.5) return { label: '양호', tone: 'good' };
  if (value >= 2.5) return { label: '보통', tone: 'watch' };
  return { label: '열악', tone: 'poor' };
};

const duration = (seconds: number) => seconds >= 60 ? `${Math.floor(seconds / 60)}분 ${seconds % 60}초` : `${seconds}초`;

function Kpi({ label, value, unit, status, tone = '', note }: { label: string; value: string; unit?: string; status?: string; tone?: string; note?: string }) {
  return <article className={`exec-kpi ${tone}`}>
    <small>{label}</small>
    <strong>{value}{unit && <em>{unit}</em>}</strong>
    {status && <b>{status}</b>}
    {note && <span>{note}</span>}
  </article>;
}

export function ExecutiveKpiCards({ summary, mainCause }: { summary: ExecutiveSummary; mainCause: RootCauseResult | null }) {
  const overall = grade(summary.averageQoe);
  const minimum = grade(summary.minQoe);
  return <section className="exec-kpi-grid" aria-label="선택 고객 일자별 핵심 지표">
    <Kpi label="종합 QoE" value={summary.averageQoe?.toFixed(2) ?? '-'} unit="/ 5.0" status={overall.label} tone={overall.tone} />
    <Kpi label="최저 QoE" value={summary.minQoe?.toFixed(2) ?? '-'} status={minimum.label} tone={minimum.tone} />
    <Kpi label="열악 경험" value={summary.sampleCount ? summary.episodeCount.toLocaleString() : '-'} unit="회" note="연속 Point를 Episode로 집계" tone={summary.episodeCount ? 'poor' : ''} />
    <Kpi label="총 열악 지속시간" value={summary.sampleCount ? duration(summary.totalPoorDurationSeconds) : '-'} note="표본 간격 기반 추정" tone={summary.totalPoorDurationSeconds ? 'poor' : ''} />
    <Kpi label="주요 원인" value={mainCause?.label ?? (summary.sampleCount ? '분석 근거 부족' : '-')} status={mainCause ? `근거 ${mainCause.evidenceCount.toLocaleString()}건` : undefined} tone={mainCause?.evidenceCount ? 'watch' : ''} />
    <Kpi label="조치 상태" value={summary.sampleCount ? (summary.episodeCount ? '분석 필요' : '모니터링') : '-'} tone={summary.episodeCount ? 'watch' : 'good'} />
  </section>;
}
