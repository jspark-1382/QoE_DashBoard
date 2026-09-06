'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, Database, ShieldCheck } from 'lucide-react';
import { ExecutiveFilters } from './executive-filters';
import { ExecutiveKpiCards } from './executive-kpis';
import { ExecutiveQoeMap } from './qoe-map';
import { ExecutiveTimeChart } from './qoe-time-chart';
import {
  ActionPlan, CustomerExperienceSummary, CustomerJourney, EstimatedCustomerExperience,
  ExecutivePanel, RootCauseAnalysis, WorstSectionCard, type ActionItem,
} from './executive-panels';
import {
  analyzeRootCause, buildCustomerJourney, buildRuleSummary, calculateQoESummary,
  findPoorEpisodes, findWorstEpisode, getCustomerDaySamples,
  type ExecutiveDataset, type JourneyEvent,
} from '@/lib/executive';

const actionsFor = (causeKey: string | undefined, pci: number | null): ActionItem[] => {
  if (!causeKey || pci == null) return [];
  const first: Record<string, [string, string]> = {
    interference: [`PCI ${pci} 간섭 조건 재현 점검`, '간섭 여부 확인'],
    coverage: [`PCI ${pci} 커버리지 음영 점검`, 'Coverage 원인 확인'],
    indoor: ['선택 사이트 실내 전파 경로 점검', '실내 취약구간 확인'],
    transport: ['Jitter·Delay 발생 구간 추적', '전송구간 원인 확인'],
    service: ['MOS 저하 시점 음성 품질 재측정', 'Voice 품질 원인 확인'],
  };
  const primary = first[causeKey] ?? [`PCI ${pci} 품질 재측정`, '근본 원인 확인'];
  return [
    { priority: 'P1', action: primary[0], owner: '미지정', effect: primary[1] },
    { priority: 'P2', action: '동일 시간·동일 동선 재측정', owner: '미지정', effect: '재현성 확인' },
    { priority: 'P3', action: '인접 PCI 측정값 비교', owner: '미지정', effect: '셀 경계 확인' },
    { priority: 'P4', action: '분석 결과와 조치 이력 연결', owner: '미지정', effect: '후속 검증 가능' },
  ];
};

export function ExecutiveDashboard() {
  const [dataset, setDataset] = useState<ExecutiveDataset | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [date, setDate] = useState('');
  const [site, setSite] = useState('ALL');
  const [rat, setRat] = useState('ALL');
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);
  const [selectedSampleIndex, setSelectedSampleIndex] = useState<number | null>(null);
  const [mapKey] = useState(() => (import.meta as ImportMeta & { env: { VITE_VWORLD_API_KEY?: string } }).env.VITE_VWORLD_API_KEY?.trim() ?? '');

  useEffect(() => {
    fetch('/qoe/executive-data.json').then(response => {
      if (!response.ok) throw new Error('Executive data not found');
      return response.json() as Promise<ExecutiveDataset>;
    }).then((next: ExecutiveDataset) => {
      const params = new URLSearchParams(window.location.search);
      const requestedCustomer = params.get('customer');
      const initialCustomer = next.customers.find(item => item.id === requestedCustomer) ?? next.customers[0];
      const requestedDate = params.get('date');
      const initialDate = requestedDate && next.meta.dates.includes(requestedDate) ? requestedDate : initialCustomer?.dates[0] ?? next.meta.dates[0] ?? '';
      setDataset(next);
      setCustomerId(initialCustomer?.id ?? '');
      setDate(initialDate);
      setSite(params.get('site') ?? 'ALL');
      setRat(params.get('rat') ?? 'ALL');
    }).catch(() => setLoadError(true));
  }, []);

  const customer = dataset?.customers.find(item => item.id === customerId);
  const day = dataset?.days.find(item => item.customerId === customerId && item.date === date);
  const sites = useMemo(() => day?.sites ?? [], [day]);
  const rats = useMemo(() => day?.rats ?? [], [day]);
  const activeSite = site === 'ALL' || sites.includes(site) ? site : 'ALL';
  const activeRat = rat === 'ALL' || rats.includes(rat as 'LTE' | 'NR5G') ? rat : 'ALL';

  useEffect(() => {
    if (!dataset || !customerId || !date) return;
    const params = new URLSearchParams(window.location.search);
    params.set('customer', customerId);
    params.set('date', date);
    if (activeSite === 'ALL') params.delete('site'); else params.set('site', activeSite);
    if (activeRat === 'ALL') params.delete('rat'); else params.set('rat', activeRat);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }, [dataset, customerId, date, activeSite, activeRat]);

  const samples = useMemo(() => getCustomerDaySamples(day, activeSite, activeRat), [day, activeSite, activeRat]);
  const episodes = useMemo(() => findPoorEpisodes(samples, dataset?.meta.poorQoeThreshold), [samples, dataset?.meta.poorQoeThreshold]);
  const worstEpisode = useMemo(() => findWorstEpisode(episodes), [episodes]);
  const selectedEpisode = episodes.find(episode => episode.id === selectedEpisodeId) ?? worstEpisode;
  const activeSampleIndex = selectedSampleIndex ?? selectedEpisode?.minIndex ?? (samples.length ? 0 : null);
  const summary = useMemo(() => calculateQoESummary(samples, episodes, dataset?.meta.poorQoeThreshold), [samples, episodes, dataset?.meta.poorQoeThreshold]);
  const causes = useMemo(() => analyzeRootCause(samples, selectedEpisode), [samples, selectedEpisode]);
  const mainCause = causes.find(cause => cause.evidenceCount > 0) ?? null;
  const journey = useMemo(() => buildCustomerJourney(samples, selectedEpisode), [samples, selectedEpisode]);
  const episodeCauseLabels = useMemo(() => Object.fromEntries(episodes.map(episode => [episode.id, analyzeRootCause(samples, episode).find(cause => cause.evidenceCount > 0)?.label ?? 'Rule 근거 부족'])), [episodes, samples]);
  const actions = useMemo(() => actionsFor(mainCause?.key, selectedEpisode?.primaryPci ?? null), [mainCause?.key, selectedEpisode?.primaryPci]);

  const chooseEpisode = (id: string) => {
    const episode = episodes.find(item => item.id === id);
    if (!episode) return;
    setSelectedEpisodeId(id);
    setSelectedSampleIndex(episode.minIndex);
  };
  const chooseJourneyEvent = (event: JourneyEvent) => {
    if (event.episodeId) setSelectedEpisodeId(event.episodeId);
    setSelectedSampleIndex(event.sampleIndex);
  };
  const changeCustomer = (id: string) => {
    const next = dataset?.customers.find(item => item.id === id);
    setCustomerId(id);
    setDate(next?.dates[0] ?? dataset?.meta.dates[0] ?? '');
    setSite('ALL');
    setRat('ALL');
    setSelectedEpisodeId(null);
    setSelectedSampleIndex(null);
  };

  if (loadError) return <main className="executive-dashboard loading"><div><AlertCircleIcon /><h1>Executive 데이터를 불러오지 못했습니다.</h1><p><code>npm run data:executive</code> 실행 후 다시 열어 주세요.</p></div></main>;
  if (!dataset) return <main className="executive-dashboard loading"><div><Activity /><h1>고객 일자 데이터를 준비하고 있습니다.</h1></div></main>;

  const ruleSummary = buildRuleSummary(summary, selectedEpisode);
  const sourceType = day?.areaTypes.includes('indoor') ? '인빌딩 실측' : day ? '실외 실측' : '데이터 없음';

  return <main className="executive-dashboard">
    <header className="exec-hero">
      <div><h1>통신망 데이터로 보는 고객체감품질 (QoE) 분석 플랫폼</h1><p>한 고객의 하루에서 품질 저하의 위치·시간·원인·조치를 연결합니다.</p></div>
      <div className="exec-live"><Activity /><span><b>EXECUTIVE DASHBOARD</b><small>{customer?.displayName ?? '고객 미선택'} · {date || '일자 미선택'}</small></span><em>{sourceType}</em></div>
    </header>

    <ExecutiveFilters customers={dataset.customers} customerId={customerId} date={date} dates={dataset.meta.dates} site={activeSite} sites={sites} rat={activeRat} rats={rats} onCustomerChange={changeCustomer} onDateChange={value => { setDate(value); setSite('ALL'); setRat('ALL'); setSelectedEpisodeId(null); setSelectedSampleIndex(null); }} onSiteChange={value => { setSite(value); setSelectedEpisodeId(null); setSelectedSampleIndex(null); }} onRatChange={value => { setRat(value); setSelectedEpisodeId(null); setSelectedSampleIndex(null); }} />
    <ExecutiveKpiCards summary={summary} mainCause={mainCause} />

    <section className="exec-dashboard-grid">
      <ExecutivePanel number={1} title="고객체감품질 지도" subtitle="QoE Map" className="exec-map-panel" badge={<span className="exec-data-badge measured"><Database /> 실측 경로</span>}>
        <ExecutiveQoeMap apiKey={mapKey} samples={samples} episodes={episodes} selectedEpisodeId={selectedEpisode?.id ?? null} selectedSampleIndex={activeSampleIndex} causeLabels={episodeCauseLabels} onEpisodeSelect={chooseEpisode} />
      </ExecutivePanel>

      <ExecutivePanel number={2} title="시간대별 품질 변화" className="exec-chart-panel" badge={<span className="exec-data-badge derived">QoE 계산 · MOS 실측</span>}>
        <ExecutiveTimeChart samples={samples} episodes={episodes} selectedEpisodeId={selectedEpisode?.id ?? null} selectedSampleIndex={activeSampleIndex} onEpisodeSelect={chooseEpisode} onSampleSelect={setSelectedSampleIndex} />
      </ExecutivePanel>

      <ExecutivePanel number={3} title="선택 고객 체감 요약" className="exec-summary-panel" badge={<span className="exec-data-badge derived">계산</span>}>
        <CustomerExperienceSummary summary={summary} ruleSummary={ruleSummary} />
      </ExecutivePanel>

      <ExecutivePanel number={4} title="핵심 열악 구간" subtitle="Worst Section" className="exec-worst-panel" badge={<span className="exec-data-badge derived">Episode 계산</span>}>
        <WorstSectionCard episode={selectedEpisode} samples={samples} cause={mainCause} selected={Boolean(selectedEpisode)} onSelect={() => selectedEpisode && chooseEpisode(selectedEpisode.id)} />
      </ExecutivePanel>

      <ExecutivePanel number={5} title="고객 Journey" className="exec-journey-panel" badge={<span className="exec-data-badge derived">측정 변화 기반</span>}>
        <CustomerJourney events={journey} selectedSampleIndex={activeSampleIndex} onSelect={chooseJourneyEvent} />
      </ExecutivePanel>

      <ExecutivePanel number={6} title="주요 원인 분석" subtitle="Why?" className="exec-cause-panel" badge={<span className="exec-data-badge rule"><ShieldCheck /> Rule 기반</span>}>
        <RootCauseAnalysis causes={causes} />
      </ExecutivePanel>

      <ExecutivePanel number={7} title="예상 고객 체감" subtitle="AI 추정" className="exec-ai-panel" badge={<span className="exec-data-badge ai">AI 추정</span>}>
        <EstimatedCustomerExperience cause={mainCause} episode={selectedEpisode} averageMos={summary.averageMos} />
      </ExecutivePanel>

      <ExecutivePanel number={8} title="권장 조치" subtitle="Action Plan" className="exec-action-panel" badge={<span className="exec-data-badge rule">Rule 권고</span>}>
        <ActionPlan actions={actions} />
      </ExecutivePanel>
    </section>

    <footer className="exec-footer"><span>실제 측정값과 계산·Rule 결과를 구분해 표시합니다.</span><span>고객명 원본 데이터 없음 · 전화번호 마스킹 처리 · Poor 기준 QoE &lt; {dataset.meta.poorQoeThreshold.toFixed(1)}</span></footer>
  </main>;
}

function AlertCircleIcon() {
  return <span className="exec-load-alert">!</span>;
}
