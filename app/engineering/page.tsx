'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3, CalendarDays, Check, ChevronDown, CircleUserRound, Clock3,
  Database, Phone, Play, RadioTower, RotateCcw, Server, ShieldCheck, Signal,
  Smartphone, UserRoundSearch, Wifi,
} from 'lucide-react';
import { VworldMap } from '@/components/vworld-map';
import { IndoorBuilding } from '@/components/indoor-building';
import {
  IndoorActionAnalysis, IndoorCauseAnalysis, IndoorFloorComparison,
  IndoorImpactAnalysis, IndoorPciAnalysis,
} from '@/components/indoor-analysis-panels';
import type { DatasetMetric, QoeDataset, RatFilter } from '@/lib/dataset';
import type { IndoorDataset } from '@/lib/indoor-dataset';

const metricLabels: Record<DatasetMetric, string> = { qoe: 'QoE', mos: 'MOS', rsrp: 'RSRP', rsrq: 'RSRQ', sinr: 'SINR' };
const causeInfo: Record<string, { label: string; rule: string; icon: React.ReactNode; color: string }> = {
  coverage: { label: 'Coverage 문제', rule: 'RSRP 낮음', icon: <Signal />, color: '#ffb332' },
  interference: { label: 'Interference 의심', rule: 'RSRP 정상 + SINR 낮음', icon: <RadioTower />, color: '#ff365f' },
  core: { label: 'Core · App 의심', rule: 'Radio 정상 + MOS 낮음', icon: <Server />, color: '#b86cf0' },
  transport: { label: '전송 구간 점검', rule: '무선 정상 + 품질 급락', icon: <RotateCcw />, color: '#438eea' },
  healthy: { label: '정상 · 지속 관찰', rule: '주요 무선 지표 정상', icon: <Database />, color: '#44cf7b' },
};
const virtualCustomers = [
  { id: 'customer-a', name: '김민준', phone: '010-42**-1382', segment: '출퇴근형', outdoorIndex: 0, journeyIndex: 0, buildingIndex: 0, floorIndex: 0 },
  { id: 'customer-b', name: '이서연', phone: '010-73**-2047', segment: '영상통화형', outdoorIndex: 3, journeyIndex: 2, buildingIndex: 1, floorIndex: 2 },
  { id: 'customer-c', name: '박지훈', phone: '010-58**-7714', segment: '업무통화형', outdoorIndex: 5, journeyIndex: 4, buildingIndex: 3, floorIndex: 1 },
  { id: 'customer-d', name: '최유진', phone: '010-91**-0635', segment: '실내체류형', outdoorIndex: 7, journeyIndex: 6, buildingIndex: 5, floorIndex: 1 },
];
export default function EngineeringDashboard() {
  const [data, setData] = useState<QoeDataset | null>(null);
  const [indoorData, setIndoorData] = useState<IndoorDataset | null>(null);
  const [mapMode, setMapMode] = useState<'outdoor' | 'indoor'>('outdoor');
  const [buildingName, setBuildingName] = useState('');
  const [floorCode, setFloorCode] = useState('');
  const [metric, setMetric] = useState<DatasetMetric>('qoe');
  const [rat, setRat] = useState<RatFilter>('ALL');
  const [location, setLocation] = useState('ALL');
  const [selectedKey, setSelectedKey] = useState('');
  const [journeyStep, setJourneyStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [actions, setActions] = useState([true, true, false, false, false]);
  const [mapKey] = useState(() => import.meta.env.VITE_VWORLD_API_KEY?.trim() ?? '');
  const [toast, setToast] = useState('');
  const [customerId, setCustomerId] = useState(virtualCustomers[0].id);
  const [analysisDate, setAnalysisDate] = useState('');
  const [analysisHour, setAnalysisHour] = useState('ALL');

  useEffect(() => {
    fetch('/qoe/qoe-data.json').then(response => response.json()).then((next: QoeDataset) => {
      setData(next);
      setSelectedKey(`${next.pciSummary[0].rat}-${next.pciSummary[0].pci}`);
      setAnalysisDate(next.meta.measurementDate);
    });
  }, []);

  useEffect(() => {
    fetch('/qoe/indoor-data.json').then(response => response.json()).then((next: IndoorDataset) => {
      setIndoorData(next);
      setBuildingName(next.buildings[0]?.name ?? '');
      setFloorCode(next.buildings[0]?.floors[0]?.code ?? '');
    }).catch(() => setIndoorData(null));
  }, []);

  useEffect(() => {
    if (!playing || !data) return;
    const timer = window.setInterval(() => setJourneyStep(step => {
      if (step >= data.journey.length - 1) { setPlaying(false); return 0; }
      return step + 1;
    }), 850);
    return () => window.clearInterval(timer);
  }, [playing, data]);

  useEffect(() => {
    if (!data) return;
    const profile = virtualCustomers.find(item => item.id === customerId) ?? virtualCustomers[0];
    if (mapMode === 'outdoor') {
      const hours = data.hourly.map(item => item.hour);
      const hourOffset = analysisHour === 'ALL' ? 0 : Math.max(0, hours.indexOf(Number(analysisHour)));
      const cell = data.pciSummary[(profile.outdoorIndex + hourOffset) % Math.max(1, data.pciSummary.length)];
      if (cell) {
        setSelectedKey(`${cell.rat}-${cell.pci}`);
        setLocation(cell.location);
        setRat(cell.rat);
      }
      setJourneyStep(Math.min(data.journey.length - 1, profile.journeyIndex + hourOffset));
      return;
    }
    if (!indoorData) return;
    const building = indoorData.buildings[profile.buildingIndex % Math.max(1, indoorData.buildings.length)];
    if (!building) return;
    const hours = indoorData.meta.hours ?? [];
    const hourOffset = analysisHour === 'ALL' ? 0 : Math.max(0, hours.indexOf(Number(analysisHour)));
    const floor = building.floors[(profile.floorIndex + hourOffset) % Math.max(1, building.floors.length)];
    setBuildingName(building.name);
    setFloorCode(floor?.code ?? building.floors[0]?.code ?? '');
  }, [customerId, analysisHour, mapMode, data, indoorData]);

  const filteredPoints = useMemo(() => data?.heatPoints.filter(point =>
    (rat === 'ALL' || point.rat === rat) && (location === 'ALL' || point.location === location)
  ) ?? [], [data, rat, location]);
  const selected = data?.pciSummary.find(item => `${item.rat}-${item.pci}` === selectedKey) ?? data?.pciSummary[0];
  const selectedIndoorBuilding = indoorData?.buildings.find(item => item.name === buildingName) ?? indoorData?.buildings[0];
  const selectedIndoorFloor = selectedIndoorBuilding?.floors.find(item => item.code === floorCode) ?? selectedIndoorBuilding?.floors[0];
  const diagnosis = selected ? inferCause(selected.rsrp, selected.sinr, selected.mos) : 'healthy';
  const poorCount = selected ? Math.round(selected.samples * selected.poorRate / 100) : 0;
  const virtualCustomer = virtualCustomers.find(item => item.id === customerId) ?? virtualCustomers[0];
  const availableHours = mapMode === 'indoor' ? (indoorData?.meta.hours ?? []) : data?.hourly.map(item => item.hour) ?? [];

  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2400); };
  const switchMode = (mode: 'outdoor' | 'indoor') => {
    setMapMode(mode);
    setAnalysisDate(mode === 'indoor' ? (indoorData?.meta.measurementDate ?? '') : (data?.meta.measurementDate ?? ''));
    setAnalysisHour('ALL');
  };
  const changeDate = (date: string) => {
    setAnalysisDate(date);
    setAnalysisHour('ALL');
    if (date === indoorData?.meta.measurementDate) setMapMode('indoor');
    else setMapMode('outdoor');
  };
  if (!data || !selected) return <main className="platform loading">실측 데이터를 불러오는 중입니다…</main>;
  const cause = causeInfo[diagnosis];
  const selectedActions = actions.filter(Boolean).length;
  const indoorVoiceActive = mapMode === 'indoor' && selectedIndoorFloor?.mos != null;
  const voiceScore = indoorVoiceActive ? selectedIndoorFloor.mos! : (selected.mos ?? data.kpis.averageMos ?? 0);
  const voiceSamples = indoorVoiceActive ? selectedIndoorFloor.mosSamples : selected.mosSamples;
  const voiceBaseSamples = indoorVoiceActive ? selectedIndoorFloor.validSamples : selected.samples;
  const voiceCoverage = Math.round(voiceSamples / Math.max(1, voiceBaseSamples) * 100);
  const voiceScope = indoorVoiceActive
    ? `${selectedIndoorBuilding?.name} · ${selectedIndoorFloor.code} ${selectedIndoorFloor.name}`
    : `${virtualCustomer.name} 가상 매핑 · ${selected.rat} PCI ${selected.pci}`;
  const voiceGrade = voiceScore >= 4.3 ? '매우 양호' : voiceScore >= 3.8 ? '양호' : voiceScore >= 3 ? '보통' : '주의';

  return <main className="platform">
    <header className="hero-bar">
      <div><h1>통신망 데이터로 보는 고객체감품질 (QoE) 분석 플랫폼</h1><p>데이터에서 고객의 경험을, 경험에서 더 나은 네트워크를.</p></div>
      <div className="dataset-badge"><i /><span><b>PERSON VIEW</b><small>{virtualCustomer.name} · {analysisDate || data.meta.measurementDate}</small></span></div>
    </header>

    <section className="data-toolbar customer-toolbar" aria-label="가상 고객 분석 조건">
      <div className="virtual-customer-card"><span className="customer-avatar">{virtualCustomer.name.slice(0, 1)}</span><div><small>가상 고객 프로파일</small><b>{virtualCustomer.name}<em>가상 사용자</em></b><span>{virtualCustomer.phone} · {virtualCustomer.segment}</span></div></div>
      <label className="context-select customer-select"><UserRoundSearch /><span><small>분석 대상</small><select value={customerId} onChange={event => setCustomerId(event.target.value)}>{virtualCustomers.map(customer => <option value={customer.id} key={customer.id}>{customer.name} · {customer.phone}</option>)}</select></span><ChevronDown /></label>
      <div className="context-period">
        <label className="context-select"><CalendarDays /><span><small>측정 일자</small><select value={analysisDate} onChange={event => changeDate(event.target.value)}><option value={data.meta.measurementDate}>{data.meta.measurementDate} · 실외</option>{indoorData && indoorData.meta.measurementDate !== data.meta.measurementDate && <option value={indoorData.meta.measurementDate}>{indoorData.meta.measurementDate} · 인빌딩</option>}</select></span><ChevronDown /></label>
        <label className="context-select"><Clock3 /><span><small>측정 시간</small><select value={analysisHour} onChange={event => setAnalysisHour(event.target.value)}><option value="ALL">전체 시간</option>{availableHours.map(hour => <option value={hour} key={hour}>{String(hour).padStart(2, '0')}:00</option>)}</select></span><ChevronDown /></label>
      </div>
      <div className="context-source"><ShieldCheck /><span><small>분석 기준</small><b>{mapMode === 'indoor' ? '인빌딩 실측 구간' : '실외 실측 구간'}</b><em>{mapKey ? 'VWorld 연결 · ' : ''}가상 고객 ↔ 실측 데이터 매핑</em></span></div>
    </section>

    <section className="dashboard-grid">
      <Panel className="map-panel" title={mapMode === 'outdoor' ? '1. 네트워크 품질 지도 (QoE Heatmap)' : '1. 인빌딩 층별 품질 (Building View)'} actions={<div className="map-actions"><div className="map-mode-toggle"><button className={mapMode === 'outdoor' ? 'active' : ''} onClick={() => switchMode('outdoor')}>실외 지도</button><button className={mapMode === 'indoor' ? 'active' : ''} onClick={() => switchMode('indoor')} disabled={!indoorData}>인빌딩</button></div>{mapMode === 'outdoor' && <div className="selects"><label><select value={location} onChange={event => setLocation(event.target.value)}><option value="ALL">전체 지역</option>{data.meta.locations.map(item => <option key={item.name}>{item.name}</option>)}</select><ChevronDown /></label><label><select value={rat} onChange={event => setRat(event.target.value as RatFilter)}><option value="ALL">LTE + 5G</option><option value="LTE">LTE</option><option value="NR5G">5G</option></select><ChevronDown /></label></div>}</div>}>
        <div className="metric-tabs">{(Object.keys(metricLabels) as DatasetMetric[]).map(key => <button className={metric === key ? 'active' : ''} onClick={() => setMetric(key)} key={key}>{metricLabels[key]}</button>)}</div>
        {mapMode === 'outdoor' ? <div className="geo-map">
          <VworldMap apiKey={mapKey} center={data.meta.center} points={filteredPoints} metric={metric} selectedKey={selectedKey} onSelect={setSelectedKey} />
          <div className="map-readout"><strong>{metricLabels[metric]} 저품질 관찰 구간</strong><span>{selected.rat} · PCI {selected.pci}</span><span>{selected.location} · 측정 {selected.samples.toLocaleString()}건</span><span>QoE {selected.qoe.toFixed(2)} · 저품질률 {selected.poorRate}%</span></div>
          <div className="gradient-legend"><b>{metricLabels[metric]} 품질 범례</b><i /><div><span>저품질</span><span>관찰</span><span>양호</span></div></div>
        </div> : indoorData ? <IndoorBuilding data={indoorData} metric={metric} buildingName={buildingName} floorCode={floorCode} onBuildingChange={name => { setBuildingName(name); const building = indoorData.buildings.find(item => item.name === name); setFloorCode(building?.floors[0]?.code ?? ''); }} onFloorChange={setFloorCode} /> : <div className="indoor-empty">인빌딩 데이터를 준비하는 중입니다.</div>}
      </Panel>

      <Panel className="service-panel" title="2. Voice 고객체감품질 (MOS 실측)" actions={<DataBadge label="실측" />}>
        <div className="voice-qoe-card">
          <div className="voice-kicker"><span><Phone /> Voice</span><em>실측 데이터</em></div>
          <div className="voice-score-row">
            <div className="voice-score-ring" style={{ '--voice-angle': `${voiceScore / 5 * 360}deg` } as React.CSSProperties}>
              <span><strong>{voiceScore.toFixed(2)}</strong><small>/ 5.0</small></span>
            </div>
            <div className="voice-summary"><span>평균 MOS</span><strong>{voiceGrade}</strong><small>{voiceScope}</small></div>
          </div>
          <div className="voice-metrics"><div><span>MOS 실측 표본</span><b>{voiceSamples.toLocaleString()}건</b></div><div><span>데이터 반영률</span><b>{voiceCoverage}%</b></div></div>
          <div className="voice-evidence"><Database /><span><b>MOS 기반 Voice 품질</b><small>Video · Web · Gaming 추정값 제외</small></span></div>
        </div>
      </Panel>

      <Panel className="time-panel" title={mapMode === 'indoor' ? '3. 건물 층별 품질 비교' : '3. 시간대별 실측 품질 변화'} actions={mapMode === 'indoor' ? <DataBadge label="실측 집계" /> : undefined}>
        {mapMode === 'indoor' && selectedIndoorBuilding && selectedIndoorFloor
          ? <IndoorFloorComparison building={selectedIndoorBuilding} selectedCode={selectedIndoorFloor.code} onSelect={setFloorCode} />
          : <><div className="line-legend"><span><i className="red" />QoE</span><span><i className="blue" />MOS</span><span><i className="orange" />SINR</span></div><TrendChart data={data} selectedHour={analysisHour} /></>}
      </Panel>

      <Panel className="cause-panel" title={mapMode === 'indoor' ? '4. 선택 층 저하 원인 진단' : '4. QoE 저하 원인 자동 분류 (Why?)'} actions={mapMode === 'indoor' ? <DataBadge label="규칙 기반" tone="calculated" /> : undefined}>
        {mapMode === 'indoor' && selectedIndoorFloor
          ? <IndoorCauseAnalysis floor={selectedIndoorFloor} />
          : <div className="cause-flow"><div className="poor-node">QoE Poor</div><div className="cause-list">{Object.entries(causeInfo).map(([key, item]) => <button key={key} className={key === diagnosis ? 'active' : ''}><span>{item.icon}</span><b>{item.rule}</b><i>→</i><em>{item.label}</em><small>{(data.kpis.causeCounts[key] ?? 0).toLocaleString()}건</small></button>)}</div><div className="diagnosis"><h3>진단 결과 ({selected.rat} PCI {selected.pci})</h3><strong style={{ color: cause.color }}>{cause.icon} {cause.label}</strong><ul><li>RSRP: {selected.rsrp?.toFixed(1) ?? '-'} dBm</li><li>SINR: {selected.sinr?.toFixed(1) ?? '-'} dB</li><li>MOS: {selected.mos?.toFixed(2) ?? '미측정'}</li><li>저품질률: <b>{selected.poorRate}%</b></li></ul><p>→ {cause.rule} 조건을 기준으로<br />우선 점검 대상을 분류했습니다.</p><small>규칙 기반 진단 · 실측 {selected.samples.toLocaleString()}건</small></div></div>}
      </Panel>

      <Panel className="journey-panel" title={mapMode === 'indoor' ? '5. 선택 층 주요 PCI · 망 구성' : '5. 실측 사용자 이동 경로 (Customer Journey)'} actions={mapMode === 'indoor' ? <DataBadge label="실측 집계" /> : <button className="panel-action" onClick={() => setPlaying(!playing)}><Play /> {playing ? '일시정지' : '재생'}</button>}>
        {mapMode === 'indoor' && selectedIndoorFloor ? <IndoorPciAnalysis floor={selectedIndoorFloor} /> : <Journey data={data} step={journeyStep} setStep={setJourneyStep} />}
      </Panel>

      <Panel className="voc-panel" title={mapMode === 'indoor' ? '6. 취약구간 영향도 (측정점)' : '6. 예상 고객 VOC (추정)'} actions={mapMode === 'indoor' ? <DataBadge label="실측 집계" /> : undefined}>
        {mapMode === 'indoor' && selectedIndoorBuilding && selectedIndoorFloor
          ? <IndoorImpactAnalysis building={selectedIndoorBuilding} floor={selectedIndoorFloor} />
          : <><div className="voc-list"><Voc critical quote="“영상이 자주 멈추고 끊겨요.”" meta={`${selected.location} · ${selected.rat} PCI ${selected.pci}`} /><Voc quote="“게임 반응이 늦고 버벅여요.”" meta={`SINR ${selected.sinr?.toFixed(1) ?? '-'} dB 기반`} /><Voc quote="“통화 음성이 간헐적으로 끊겨요.”" meta={`MOS ${selected.mos?.toFixed(2) ?? '미측정'} 기반`} /></div><div className="impact"><b>선택 PCI 저품질 측정점</b><div><span className="people">●●●</span> 약 <strong>{poorCount.toLocaleString()}</strong> 건 <small>({selected.samples.toLocaleString()}건 중)</small></div></div></>}
      </Panel>

      <Panel className="action-panel" title={mapMode === 'indoor' ? '7. 인빌딩 조치 추천' : '7. 조치 추천 (Action)'} actions={mapMode === 'indoor' ? <DataBadge label="권고안" tone="recommended" /> : <button className="panel-action" onClick={() => flash('선택 조치의 기대효과를 계산했습니다.')}>효과 계산</button>}>
        {mapMode === 'indoor' && selectedIndoorFloor
          ? <IndoorActionAnalysis floor={selectedIndoorFloor} checks={actions} onToggle={index => setActions(items => items.map((item, i) => i === index ? !item : item))} />
          : <div className="action-body"><div className="check-list">{actionLabels(diagnosis, selected.pci).map((text, index) => <label key={text}><input type="checkbox" checked={actions[index]} onChange={() => setActions(items => items.map((item, i) => i === index ? !item : item))} /><span><Check /></span>{text}</label>)}</div><div className="action-arrow">▶</div><div className="effect-card"><h3><BarChart3 /> 기대 효과</h3><p><Check /> QoE +{(selectedActions * .35).toFixed(1)} 향상 (예상)</p><p><Check /> 저품질 측정점 {Math.min(75, selectedActions * 18)}% 감소 (예상)</p><p><Check /> 해당 지역 품질 안정성 개선</p></div></div>}
      </Panel>
    </section>

    <footer><q>데이터로 고객의 불편을 먼저 발견하고, 더 나은 일상을 연결합니다.</q><div><span>원본 {data.meta.totalRows.toLocaleString()}행</span><button onClick={() => flash('data 폴더의 분석 결과가 적용되어 있습니다.')}><Wifi /> 데이터 확인</button></div></footer>
    {toast && <div className="toast"><Check /> {toast}</div>}
  </main>;
}

function inferCause(rsrp: number | null, sinr: number | null, mos: number | null) {
  if (rsrp != null && rsrp < -105) return 'coverage';
  if (sinr != null && sinr < 3) return 'interference';
  if (mos != null && mos < 3) return 'core';
  return 'healthy';
}

function actionLabels(cause: string, pci: number) {
  const first = cause === 'interference' ? `PCI ${pci} 인접 셀 간섭·틸트 점검` : cause === 'coverage' ? `PCI ${pci} 음영 구간 커버리지 점검` : `PCI ${pci} 품질 현황 현장 확인`;
  return [first, '저품질 좌표 우선 재측정', '인접 셀 간 부하 분산 검토', '서비스 트래픽 정책 검토', '지속 모니터링 및 재발 방지'];
}

function Panel({ title, actions, className = '', children }: { title: string; actions?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return <section className={`panel ${className}`}><header><h2>{title}</h2>{actions}</header>{children}</section>;
}

function DataBadge({ label, tone = 'measured' }: { label: string; tone?: 'measured' | 'calculated' | 'recommended' }) {
  return <span className={`data-kind-badge ${tone}`}>{label}</span>;
}

function Voc({ quote, meta, critical = false }: { quote: string; meta: string; critical?: boolean }) {
  return <button className={critical ? 'critical' : ''}><span><CircleUserRound /></span><div><b>{quote}</b><small>- {meta}</small></div></button>;
}

function TrendChart({ data, selectedHour }: { data: QoeDataset; selectedHour: string }) {
  const left = 34, right = 372, top = 22, bottom = 148;
  const x = (index: number) => left + index * ((right - left) / Math.max(1, data.hourly.length - 1));
  const line = (field: 'qoe' | 'mos', low = 0, high = 5) => data.hourly.map((item, index) => `${x(index)},${bottom - (((item[field] ?? low) - low) / (high - low)) * (bottom - top)}`).join(' ');
  const sinr = data.hourly.map((item, index) => `${x(index)},${bottom - (((item.sinr ?? -5) + 5) / 30) * (bottom - top)}`).join(' ');
  return <div className="line-chart"><svg viewBox="0 0 390 174" preserveAspectRatio="none">{[22, 53, 85, 116, 148].map((y, index) => <g key={y}><line x1={left} y1={y} x2={right} y2={y} /><text x="15" y={y + 3}>{5 - index}</text></g>)}<polyline className="qoe-line" points={line('qoe')} /><polyline className="mos-line" points={line('mos')} /><polyline className="sinr-line" points={sinr} />{data.hourly.map((item, index) => { const active = selectedHour === String(item.hour); return <circle key={item.hour} className={`qoe-dot ${active ? 'active' : ''}`} cx={x(index)} cy={bottom - (item.qoe / 5) * (bottom - top)} r={active ? 6 : 3} />; })}</svg><div className="x-axis">{data.hourly.map(item => <span className={selectedHour === String(item.hour) ? 'active' : ''} key={item.hour}>{item.hour}시<small>{item.samples.toLocaleString()}건</small></span>)}</div></div>;
}

function Journey({ data, step, setStep }: { data: QoeDataset; step: number; setStep: (step: number) => void }) {
  const point = data.journey[step];
  const visible = data.journey.slice(0, 7);
  return <><div className="journey-map"><div className="journey-user"><Smartphone /> {point.location} 드라이브테스트 · {point.time}</div><div className="route-line"><i className="progress" style={{ width: `${Math.max(0, Math.min(100, step / Math.max(1, data.journey.length - 1) * 100))}%` }} />{visible.map((item, index) => <button onClick={() => setStep(index)} style={{ left: `${8 + index * 14}%` }} className={`${index <= step ? 'passed' : ''} ${index === step ? 'current' : ''}`} key={`${item.time}-${index}`}><span />PCI {item.pci}</button>)}</div></div><div className="journey-table"><table><thead><tr><th>시간</th><th>위치</th><th>RAT</th><th>PCI</th><th>RSRP</th><th>SINR</th><th>MOS</th><th>QoE</th><th>진단</th></tr></thead><tbody>{visible.map((item, index) => <tr className={index === step ? 'active' : ''} onClick={() => setStep(index)} key={`${item.time}-${index}`}><td>{item.time}</td><td>{item.location}</td><td>{item.rat}</td><td>{item.pci}</td><td>{item.rsrp?.toFixed(1) ?? '-'}</td><td>{item.sinr?.toFixed(1) ?? '-'}</td><td>{item.mos?.toFixed(1) ?? '-'}</td><td><span className={`score s-${Math.floor(item.qoe)}`}>{item.qoe.toFixed(1)}</span></td><td className={item.cause === 'healthy' ? '' : 'event'}>{causeInfo[item.cause]?.label ?? item.cause}</td></tr>)}</tbody></table></div></>;
}
