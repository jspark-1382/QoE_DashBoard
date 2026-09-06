'use client';

import { AlertCircle, Bot, CheckCircle2, Database, MapPin, RadioTower, Route, ShieldQuestion } from 'lucide-react';
import type { ExecutiveSample, ExecutiveSummary, JourneyEvent, PoorEpisode, RootCauseResult } from '@/lib/executive';

export function ExecutivePanel({ number, title, subtitle, badge, className = '', children }: { number: number; title: string; subtitle?: string; badge?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return <section className={`exec-panel ${className}`}>
    <header><div><span>{number}</span><h2>{title}</h2>{subtitle && <small>{subtitle}</small>}</div>{badge}</header>
    <div className="exec-panel-body">{children}</div>
  </section>;
}

const duration = (seconds: number) => seconds >= 60 ? `${Math.floor(seconds / 60)}분 ${seconds % 60}초` : `${seconds}초`;
const average = (values: Array<number | null>) => {
  const usable = values.filter((value): value is number => value != null);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
};
const ratLabel = (rat: string | null) => (rat === 'NR5G' ? '5G' : rat ?? '-');

const gradeOf = (value: number | null) => {
  if (value == null) return { label: '데이터 없음', tone: '' };
  if (value >= 4.5) return { label: '매우 양호', tone: '' };
  if (value >= 3.5) return { label: '양호', tone: '' };
  if (value >= 2.5) return { label: '보통', tone: 'watch' };
  return { label: '열악', tone: 'poor' };
};

export function CustomerExperienceSummary({ summary, ruleSummary }: { summary: ExecutiveSummary; ruleSummary: string }) {
  const overall = gradeOf(summary.averageQoe);
  return <div className="exec-summary2">
    <div className="s2-head"><small>오늘의 고객체감</small><span className={`s2-grade ${overall.tone}`}>{overall.label}</span></div>
    <div className="s2-average"><strong>{summary.averageQoe?.toFixed(2) ?? '-'}</strong><span>평균 QoE / 5.0</span></div>
    <div className="s2-grid">
      <div><span>측정 Point</span><b>{summary.sampleCount ? summary.sampleCount.toLocaleString() : '-'}</b></div>
      <div><span>Poor Point</span><b>{summary.sampleCount ? summary.poorPointCount.toLocaleString() : '-'}</b></div>
      <div><span>Poor 비율</span><b>{summary.poorRate == null ? '-' : `${summary.poorRate.toFixed(1)}%`}</b></div>
      <div><span>열악 경험</span><b>{summary.sampleCount ? `${summary.episodeCount.toLocaleString()}회` : '-'}</b></div>
      <div><span>주요 RAT</span><b>{ratLabel(summary.primaryRat)}</b></div>
      <div><span>주요 PCI</span><b>{summary.primaryPci?.toString() ?? '-'}</b></div>
    </div>
    <blockquote><em>RULE BASED SUMMARY</em>{ruleSummary}</blockquote>
  </div>;
}

export function WorstSectionCard({ episode, samples, cause, selected, onSelect }: { episode: PoorEpisode | null; samples: ExecutiveSample[]; cause: RootCauseResult | null; selected: boolean; onSelect: () => void }) {
  if (!episode) return <div className="exec-empty"><b>핵심 열악 구간이 없습니다.</b><span>QoE 임계치 미만의 연속 Episode가 관찰되지 않았습니다.</span></div>;
  const first = samples[Math.max(0, episode.startIndex - 1)] ?? samples[episode.startIndex];
  const minimum = samples[episode.minIndex];
  const segment = samples.slice(episode.startIndex, episode.endIndex + 1);
  const avgRsrp = average(segment.map(sample => sample.rsrp));
  const avgSinr = average(segment.map(sample => sample.sinr));
  return <button className={`exec-worst2 ${selected ? 'selected' : ''}`} onClick={onSelect}>
    <div className="w2-top">
      <span className="w2-time">{episode.startTime} ~ {episode.endTime}</span>
      <span className="w2-duration">지속 {duration(episode.durationSeconds)}</span>
      <span className="w2-site">{episode.site}</span>
    </div>
    <div className="w2-metrics">
      <div><span>QoE</span><b>{first.qoe.toFixed(2)} → <em>{minimum.qoe.toFixed(2)}</em></b></div>
      <div><span>RSRP</span><b>{avgRsrp?.toFixed(1) ?? '-'} dBm</b></div>
      <div><span>SINR</span><b>{avgSinr?.toFixed(1) ?? '-'} dB</b></div>
      <div><span>Serving</span><b>PCI {episode.primaryPci}</b></div>
    </div>
    <div className="w2-cause"><RadioTower /><span>{cause ? cause.label : 'Rule 근거 부족'}</span><small>{cause ? `측정 근거 ${cause.evidenceCount.toLocaleString()}건` : '선택 Episode 기준'}</small></div>
  </button>;
}

const eventIcon = (type: JourneyEvent['type']) => type === 'poor' ? <AlertCircle /> : type === 'pci' ? <RadioTower /> : type === 'recovery' ? <CheckCircle2 /> : type === 'signal' ? <Route /> : <MapPin />;

export function CustomerJourney({ events, selectedSampleIndex, onSelect }: { events: JourneyEvent[]; selectedSampleIndex: number | null; onSelect: (event: JourneyEvent) => void }) {
  if (!events.length) return <div className="exec-empty"><b>생성 가능한 Journey가 없습니다.</b><span>측정값 변화에서 확인 가능한 Event가 없습니다.</span></div>;
  return <div className="exec-journey2">
    {events.map((event, index) => <FragmentNode key={event.id} index={index}>
      <button className={`jn jn-${event.type} ${event.sampleIndex === selectedSampleIndex ? 'active' : ''}`} onClick={() => onSelect(event)} aria-label={`${event.time} ${event.title}`}>
        <span className="jn-icon">{eventIcon(event.type)}</span>
        <span className="jn-time">{event.time}</span>
        <span className="jn-title">{event.title}</span>
        <span className="jn-value">{event.detail}</span>
      </button>
    </FragmentNode>)}
  </div>;
}

function FragmentNode({ children, index }: { children: React.ReactNode; index: number }) {
  return <>{index > 0 && <span className="jn-arr" aria-hidden>→</span>}{children}</>;
}

const strengthTone = (strength: RootCauseResult['strength']) => strength === '강' ? 'poor' : strength === '중' ? 'watch' : 'muted';
const dotsFor = (count: number, max: number) => count > 0 && max > 0 ? Math.max(1, Math.round(count / max * 5)) : 0;

const causeSentence = (cause: RootCauseResult) => `${cause.evidence.filter(item => !item.includes('데이터 없음')).join(' · ') || '특정 임계값 초과 관찰'}. “${cause.label}”으로 우선 분류했습니다.`;

export function RootCauseAnalysis({ causes }: { causes: RootCauseResult[] }) {
  if (!causes.length) return <div className="exec-empty"><b>원인분석 대상이 없습니다.</b><span>열악 Episode가 선택되면 실제 측정값 근거를 표시합니다.</span></div>;
  const primary = causes.find(cause => cause.evidenceCount > 0) ?? causes[0];
  const secondary = causes.filter(cause => cause !== primary);
  return <div className="exec-cause2">
    <div className={`cp ${strengthTone(primary.strength)}`}>
      <div className="cp-top"><span className="cp-rank">#1</span><span className="cp-label">{primary.label}</span><em className={`cp-strength ${primary.strength}`}>{primary.strength}</em></div>
      <div className="cp-evidence">
        {(() => {
          const counts = primary.evidence.map(item => Number((item.match(/([\d,]+)\s*건/) ?? [])[1]?.replace(',', '') ?? 0));
          const max = Math.max(...counts, 1);
          return primary.evidence.map((item, index) => {
            const dots = dotsFor(Math.max(counts[index], primary.evidenceCount && index === 0 ? counts[0] : counts[index]), max);
            return <span className="ev" key={item}><span>{item}</span><i>{Array.from({ length: 5 }, (_, dot) => <b className={dot < dots ? 'on' : ''} key={dot} />)}</i></span>;
          });
        })()}
      </div>
      <p className="cp-sentence">{causeSentence(primary)}</p>
    </div>
    <div className="cs">
      <span className="cs-head">기타 가능성 (우선순위 낮은 순)</span>
      {secondary.map(cause => <div className={`cs-row ${cause.evidenceCount ? '' : 'muted'}`} key={cause.key}>
        <span className="cs-label">{cause.label}</span>
        <span className={`cs-chip ${cause.strength === '중' ? '중' : cause.strength === '약' || cause.strength === '근거 없음' ? '약' : ''}`}>{cause.strength}</span>
      </div>)}
      <p className="cp-sentence" style={{ borderTop: 0, paddingTop: 0 }}><ShieldQuestion /> 강도는 장애 확률이 아닌 선택 Episode 내 조건 일치 비율입니다.</p>
    </div>
  </div>;
}

const aiLines = (cause: RootCauseResult | null, episode: PoorEpisode | null, mos: number | null): { quote: string | null } => {
  if (!episode || !cause) return { quote: null };
  if (cause.key === 'interference') return { quote: `통화나 앱 사용 중 신호는 수신되지만 품질이 불안정하게 느껴졌을 가능성이 있습니다. ${episode.startTime}경 ${episode.site} 구간에서 체감 저하가 집중되었습니다.` };
  if (cause.key === 'coverage') return { quote: `신호가 약한 구간에서 통화 끊김이나 지연을 체감했을 가능성이 있습니다. ${episode.startTime}경 ${episode.site} 구간이 가장 취약했습니다.` };
  if (cause.key === 'indoor') return { quote: `건물 내부에서 전파가 약해 서비스 품질이 불안정하게 느껴졌을 가능성이 있습니다. ${episode.startTime}경 열악하게 체감한 구간이 확인됩니다.` };
  if (cause.key === 'transport') return { quote: `전송 구간 지연으로 응답이 느리거나 끊기는 느낌을 받았을 가능성이 있습니다. ${episode.startTime}경 체감 저하가 확인됩니다.` };
  if (mos != null && mos < 3) return { quote: `음성 품질이 평소보다 낮아 소리가 울리거나 끊기는 것처럼 느껴졌을 가능성이 있습니다. ${episode.startTime}경 체감 저하가 확인됩니다.` };
  return { quote: `특정 시간 구간에서 통화 품질이 평소보다 불안정하게 체감되었을 가능성이 있습니다. ${episode.startTime}경 열악 구간이 확인됩니다.` };
};

export function EstimatedCustomerExperience({ cause, episode, averageMos }: { cause: RootCauseResult | null; episode: PoorEpisode | null; averageMos: number | null }) {
  const estimate = aiLines(cause, episode, averageMos);
  return <div className="exec-ai2">
    <span className="ai-chip"><Bot /> AI 추정</span>
    {estimate.quote
      ? <p className="ai-quote">{estimate.quote}</p>
      : <p className="ai-quote empty">현재 추정 가능한 고객 체감 정보가 없습니다.</p>}
    <p className="ai-note">실제 고객 VOC가 아닌, 네트워크 실측 데이터 기반 추정입니다.</p>
  </div>;
}

export interface ActionItem { priority: string; action: string; owner: string; effect: string }

export function ActionPlan({ actions }: { actions: ActionItem[] }) {
  if (!actions.length) return <div className="exec-empty"><b>권장 조치가 없습니다.</b><span>분석 가능한 열악 Episode가 없습니다.</span></div>;
  const top = actions.slice(0, 4);
  return <div className="exec-actions2">
    {top.map(action => <div className="a2" key={`${action.priority}-${action.action}`}>
      <span className="a2-rank">{action.priority}</span>
      <span className="a2-main"><strong>{action.action}</strong><small><em>{action.effect}</em><span>{action.owner}</span></small></span>
    </div>)}
    <p className="a2-foot"><Database /> Rule 기반 권고 · 실제 담당 배정과 성과 추적은 별도 시스템이 필요합니다.</p>
  </div>;
}

export { Database };
