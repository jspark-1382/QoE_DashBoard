'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, LocateFixed, Maximize2, Minimize2 } from 'lucide-react';
import { ExecutiveFilters } from './executive-filters';
import { ExecutiveKpiCards } from './executive-kpis';
import { ExecutiveQoeMap } from './qoe-map';
import { MdtLocationMap } from './mdt-location-map';
import { mapMetrics, type MapMetric } from '@/lib/executive/map-metrics';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { ExecutiveTimeChart } from './qoe-time-chart';
import { ExecutivePanel } from './executive-panels';
import { ExecutiveCallTable } from './executive-call-table';
import { MapCallContext } from './map-call-context';
import {
  analyzeRootCause, calculateQoESummary,
  findPoorEpisodes, findWorstEpisode, getCustomerDaySamples,
  type ExecutiveDataset,
} from '@/lib/executive';

export function ExecutiveDashboard() {
  const [source, setSource] = useState<'실측' | 'MDT'>(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('source') === 'MDT' ? 'MDT' : '실측');
  const [mapMetric, setMapMetric] = useState<MapMetric>('qoe');
  const [showLocationEstimation, setShowLocationEstimation] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  useEffect(() => {
    if (!mapExpanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMapExpanded(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [mapExpanded]);
  const [dataset, setDataset] = useState<ExecutiveDataset | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [date, setDate] = useState('');
  const [site, setSite] = useState('ALL');
  const [rat, setRat] = useState('ALL');
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [showAllCalls, setShowAllCalls] = useState(false);
  const [overviewRevision, setOverviewRevision] = useState(0);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);
  const [selectedSampleIndex, setSelectedSampleIndex] = useState<number | null>(null);
  const [mapKey] = useState(() => (import.meta as ImportMeta & { env: { VITE_VWORLD_API_KEY?: string } }).env.VITE_VWORLD_API_KEY?.trim() ?? '');

  useEffect(() => {
    const controller = new AbortController();
    setDataset(null); setLoadError(false);
    fetch(source === 'MDT' ? '/qoe/mdt-data.json' : '/qoe/executive-data.json?schema=call-qoe-v3', { cache: 'no-store', signal: controller.signal }).then(response => {
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
    }).catch(() => { if (!controller.signal.aborted) setLoadError(true); });
    return () => controller.abort();
  }, [source]);

  const customer = dataset?.customers.find(item => item.id === customerId);
  const day = dataset?.days.find(item => item.customerId === customerId && item.date === date);
  const sites = useMemo(() => day?.sites ?? [], [day]);
  const rats = useMemo(() => day?.rats ?? [], [day]);
  const activeSite = site === 'ALL' || sites.includes(site) ? site : 'ALL';
  const activeRat = rat === 'ALL' || rats.includes(rat as 'LTE' | 'NR5G') ? rat : 'ALL';

  useEffect(() => {
    if (!dataset || !customerId || !date) return;
    const params = new URLSearchParams(window.location.search);
    params.set('source', source);
    params.set('customer', customerId);
    params.set('date', date);
    if (activeSite === 'ALL') params.delete('site'); else params.set('site', activeSite);
    if (activeRat === 'ALL') params.delete('rat'); else params.set('rat', activeRat);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }, [source, dataset, customerId, date, activeSite, activeRat]);

  const samples = useMemo(() => getCustomerDaySamples(day, activeSite, activeRat), [day, activeSite, activeRat]);
  const episodes = useMemo(() => findPoorEpisodes(samples, dataset?.meta.poorQoeThreshold), [samples, dataset?.meta.poorQoeThreshold]);
  const worstEpisode = useMemo(() => findWorstEpisode(episodes), [episodes]);
  const selectedEpisode = showAllCalls ? null : episodes.find(episode => episode.id === selectedEpisodeId) ?? worstEpisode;
  const activeSampleIndex = showAllCalls ? null : selectedSampleIndex ?? selectedEpisode?.minIndex ?? (samples.length ? 0 : null);
  const summary = useMemo(() => calculateQoESummary(samples, episodes, dataset?.meta.poorQoeThreshold), [samples, episodes, dataset?.meta.poorQoeThreshold]);
  const causes = useMemo(() => analyzeRootCause(samples, selectedEpisode), [samples, selectedEpisode]);
  const mainCause = causes.find(cause => cause.evidenceCount > 0) ?? null;
  const episodeCauseLabels = useMemo(() => Object.fromEntries(episodes.map(episode => [episode.id, analyzeRootCause(samples, episode).find(cause => cause.evidenceCount > 0)?.label ?? 'Rule 근거 부족'])), [episodes, samples]);

  const chooseEpisode = (id: string) => {
    setShowAllCalls(false);
    const episode = episodes.find(item => item.id === id);
    if (!episode) return;
    setSelectedCallId(null);
    setSelectedEpisodeId(id);
    setSelectedSampleIndex(episode.minIndex);
  };
  const changeCustomer = (id: string) => {
    const next = dataset?.customers.find(item => item.id === id);
    setCustomerId(id);
    setDate(next?.dates[0] ?? dataset?.meta.dates[0] ?? '');
    setSite('ALL');
    setRat('ALL');
    setSelectedEpisodeId(null);
    setSelectedSampleIndex(null); setSelectedCallId(null);
  };

  if (loadError) return <main className="executive-dashboard loading"><div><AlertCircleIcon /><h1>Executive 데이터를 불러오지 못했습니다.</h1><p><code>npm run data:executive</code> 실행 후 다시 열어 주세요.</p></div></main>;
  if (!dataset) return <main className="executive-dashboard loading"><div><Activity /><h1>고객 일자 데이터를 준비하고 있습니다.</h1></div></main>;

  const sourceType = source === 'MDT' ? 'MDT · POC 위치 추정' : day?.areaTypes.includes('indoor') ? '인빌딩 실측' : day ? '실외 실측' : '데이터 없음';

  return <main className="executive-dashboard exec-map-focused">
    <header className="exec-hero">
      <div><h1>통신망 데이터로 보는 고객체감품질 (QoE) 분석 플랫폼</h1><p>고객별 측정 경로와 시간대별 품질, 콜별 측정값을 확인합니다.</p></div>
      <div className="exec-live"><Activity /><span><b>EXECUTIVE DASHBOARD</b><small>{customer?.displayName ?? '고객 미선택'} · {date || '일자 미선택'}</small></span><em>{sourceType}</em></div>
    </header>

    <ExecutiveFilters customers={dataset.customers} customerId={customerId} date={date} dates={dataset.meta.dates} site={activeSite} sites={sites} source={source} onSourceChange={value => { setDataset(null); setSource(value); setRat('ALL'); setSite('ALL'); setSelectedCallId(null); setSelectedSampleIndex(null); setSelectedEpisodeId(null); setShowAllCalls(true); }} onCustomerChange={changeCustomer} onDateChange={value => { setDate(value); setSite('ALL'); setRat('ALL'); setSelectedEpisodeId(null); setSelectedSampleIndex(null); setSelectedCallId(null); }} onSiteChange={value => { setSite(value); setSelectedEpisodeId(null); setSelectedSampleIndex(null); setSelectedCallId(null); }} />
    <ExecutiveKpiCards summary={summary} mainCause={mainCause} />

    <section className="exec-dashboard-grid">
      <ExecutivePanel number={1} title="고객체감품질 지도" className={`exec-map-panel${mapExpanded ? ' exec-map-expanded' : ''}`} badge={<div className="exec-map-metrics">
        <button type="button" className="exec-location-toggle exec-map-expand" aria-expanded={mapExpanded} title={mapExpanded ? '원래 크기로 돌아가기 (Esc)' : '지도를 크게 보기'} onClick={() => setMapExpanded(value => !value)}>{mapExpanded ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}<span>{mapExpanded ? '원래 크기' : '크게 보기'}</span></button>
        {source === 'MDT' && <button type="button" className="exec-location-toggle" aria-label="고객 위치 추정" aria-pressed={showLocationEstimation} title={showLocationEstimation ? '고객 위치 추정 끄기' : '고객 위치 추정 켜기'} onClick={() => setShowLocationEstimation(value => !value)}><LocateFixed aria-hidden="true" size={16} /><span>고객 위치 추정</span><span className="exec-location-state" aria-hidden="true">{showLocationEstimation ? 'ON' : 'OFF'}</span></button>}
        <label htmlFor="map-metric">표시 지표</label>
        <NativeSelect id="map-metric" className="exec-metric-select" value={mapMetric} onChange={event => setMapMetric(event.target.value as MapMetric)}>
          {(Object.keys(mapMetrics) as MapMetric[]).map(metric => <NativeSelectOption key={metric} value={metric}>{mapMetrics[metric].label} · {metric === 'qoe' ? '콜 단위' : source === 'MDT' ? '이벤트 단위' : '초 단위'}</NativeSelectOption>)}
        </NativeSelect>
      </div>}>
        <MapCallContext samples={samples} selectedSampleIndex={activeSampleIndex} expanded={mapExpanded} callMeta={dataset.meta.callMeta} onSelect={index => { setShowAllCalls(false); setSelectedCallId(samples[index]?.callId || null); setSelectedEpisodeId(null); setSelectedSampleIndex(index); }} onShowAll={() => { setShowAllCalls(true); setSelectedCallId(null); setSelectedEpisodeId(null); setSelectedSampleIndex(null); setOverviewRevision(value => value + 1); }}>
        {source === 'MDT' && showLocationEstimation ? <MdtLocationMap samples={samples} baseStations={dataset.meta.baseStations ?? []} selectedSampleIndex={activeSampleIndex} apiKey={mapKey} metric={mapMetric} overviewRevision={overviewRevision} onSampleSelect={index=>{setShowAllCalls(false);setSelectedSampleIndex(index);setSelectedCallId(samples[index]?.callId??null);setSelectedEpisodeId(null);}} />
          : <ExecutiveQoeMap overviewRevision={overviewRevision} metric={mapMetric} apiKey={mapKey} samples={samples} episodes={episodes} selectedCallId={selectedCallId} selectedEpisodeId={selectedCallId ? null : selectedEpisode?.id ?? null} selectedSampleIndex={activeSampleIndex} causeLabels={episodeCauseLabels} onEpisodeSelect={chooseEpisode} />}
        </MapCallContext>
      </ExecutivePanel>

      <ExecutivePanel number={2} title="시간대별 품질 변화" className="exec-chart-panel" badge={<span className="exec-data-badge derived">{source === 'MDT' ? 'QoE 무선 추정 · MOS 없음' : 'QoE 계산 · MOS 실측'}</span>}>
        <ExecutiveTimeChart samples={samples} episodes={episodes} selectedCallId={selectedCallId} selectedEpisodeId={selectedCallId ? null : selectedEpisode?.id ?? null} selectedSampleIndex={activeSampleIndex} onEpisodeSelect={chooseEpisode} onSampleSelect={index => { setShowAllCalls(false); setSelectedSampleIndex(index); }} />
      </ExecutivePanel>

      <ExecutiveCallTable callMeta={dataset.meta.callMeta} samples={samples} selectedSampleIndex={activeSampleIndex} onShowAll={() => { setShowAllCalls(true); setSelectedCallId(null); setSelectedEpisodeId(null); setSelectedSampleIndex(null); setOverviewRevision(value => value + 1); }} onSelect={index => { setShowAllCalls(false); setSelectedCallId(samples[index]?.callId || null); setSelectedEpisodeId(null); setSelectedSampleIndex(index); }} />
    </section>

    <footer className="exec-footer"><span>{source === 'MDT' ? `기지국 좌표와 위치 추정 결과는 POC용 가상 데이터가 포함될 수 있습니다. · 무선값 없는 ${dataset.meta.unscoredCalls ?? 0}콜 QoE 집계 제외` : '실제 측정값과 계산·Rule 결과를 구분해 표시합니다.'}</span><span>고객명 원본 데이터 없음 · 전화번호 마스킹 처리 · Poor 기준 QoE &lt; {dataset.meta.poorQoeThreshold.toFixed(1)}</span></footer>
  </main>;
}

function AlertCircleIcon() {
  return <span className="exec-load-alert">!</span>;
}
