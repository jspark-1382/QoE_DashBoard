'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3, Check, ChevronDown, CircleUserRound, Database, FileSpreadsheet,
  Gamepad2, Globe2, KeyRound, Phone, Play, RadioTower, RotateCcw, Server,
  Signal, Smartphone, Upload, Video, Wifi,
} from 'lucide-react';
import { VworldMap } from '@/components/vworld-map';
import type { DatasetMetric, QoeDataset, RatFilter } from '@/lib/dataset';

const metricLabels: Record<DatasetMetric, string> = { qoe: 'QoE', mos: 'MOS', rsrp: 'RSRP', rsrq: 'RSRQ', sinr: 'SINR' };
const serviceIcons: Record<string, React.ReactNode> = { video: <Video />, voice: <Phone />, gaming: <Gamepad2 />, web: <Globe2 /> };
const causeInfo: Record<string, { label: string; rule: string; icon: React.ReactNode; color: string }> = {
  coverage: { label: 'Coverage 문제', rule: 'RSRP 낮음', icon: <Signal />, color: '#ffb332' },
  interference: { label: 'Interference 의심', rule: 'RSRP 정상 + SINR 낮음', icon: <RadioTower />, color: '#ff365f' },
  core: { label: 'Core · App 의심', rule: 'Radio 정상 + MOS 낮음', icon: <Server />, color: '#b86cf0' },
  transport: { label: '전송 구간 점검', rule: '무선 정상 + 품질 급락', icon: <RotateCcw />, color: '#438eea' },
  healthy: { label: '정상 · 지속 관찰', rule: '주요 무선 지표 정상', icon: <Database />, color: '#44cf7b' },
};
const barColors: Record<string, string> = { web: '#aebbd0', video: '#ff2e55', voice: '#367fe4', gaming: '#a54dd9' };

export default function Home() {
  const [data, setData] = useState<QoeDataset | null>(null);
  const [metric, setMetric] = useState<DatasetMetric>('qoe');
  const [rat, setRat] = useState<RatFilter>('ALL');
  const [location, setLocation] = useState('ALL');
  const [service, setService] = useState('video');
  const [selectedKey, setSelectedKey] = useState('');
  const [journeyStep, setJourneyStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [actions, setActions] = useState([true, true, false, false, false]);
  const [keyInput, setKeyInput] = useState('');
  const [mapKey, setMapKey] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    fetch('/qoe-data.json').then(response => response.json()).then((next: QoeDataset) => {
      setData(next);
      setSelectedKey(`${next.pciSummary[0].rat}-${next.pciSummary[0].pci}`);
    });
  }, []);

  useEffect(() => {
    if (!playing || !data) return;
    const timer = window.setInterval(() => setJourneyStep(step => {
      if (step >= data.journey.length - 1) { setPlaying(false); return 0; }
      return step + 1;
    }), 850);
    return () => window.clearInterval(timer);
  }, [playing, data]);

  const filteredPoints = useMemo(() => data?.heatPoints.filter(point =>
    (rat === 'ALL' || point.rat === rat) && (location === 'ALL' || point.location === location)
  ) ?? [], [data, rat, location]);
  const selected = data?.pciSummary.find(item => `${item.rat}-${item.pci}` === selectedKey) ?? data?.pciSummary[0];
  const diagnosis = selected ? inferCause(selected.rsrp, selected.sinr, selected.mos) : 'healthy';
  const poorCount = selected ? Math.round(selected.samples * selected.poorRate / 100) : 0;

  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2400); };
  const importFile = async (file?: File) => {
    if (!file) return;
    if (file.name.endsWith('.json')) {
      try {
        const next = JSON.parse(await file.text()) as QoeDataset;
        if (!next.meta || !next.heatPoints) throw new Error('invalid');
        setData(next); setSelectedKey(`${next.pciSummary[0].rat}-${next.pciSummary[0].pci}`);
        flash(`${file.name} 데이터를 로컬 화면에 반영했습니다.`); return;
      } catch { flash('변환된 QoE JSON 형식을 확인해 주세요.'); return; }
    }
    flash(`${file.name} 파일을 선택했습니다. Excel은 data 폴더 변환 후 반영됩니다.`);
  };
  const downloadTemplate = () => {
    const csv = 'timestamp,location,latitude,longitude,rat,pci,mos,rsrp,rsrq,sinr\n2026-08-21 10:00:00,풍산동,37.6658,126.8003,LTE,215,4.1,-95,-12,4\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'qoe_upload_template.csv'; anchor.click(); URL.revokeObjectURL(url);
  };

  if (!data || !selected) return <main className="platform loading">실측 데이터를 불러오는 중입니다…</main>;
  const cause = causeInfo[diagnosis];
  const selectedActions = actions.filter(Boolean).length;

  return <main className="platform">
    <header className="hero-bar">
      <div><h1>통신망 데이터로 보는 고객체감품질 (QoE) 분석 플랫폼</h1><p>데이터에서 고객의 경험을, 경험에서 더 나은 네트워크를.</p></div>
      <div className="dataset-badge"><i /><span><b>LOCAL DATA</b><small>{data.meta.measurementDate} · {data.meta.validGeoRows.toLocaleString()}건</small></span></div>
    </header>

    <section className="data-toolbar" aria-label="분석 데이터 업로드">
      <div className="upload-copy"><span><Upload /></span><div><b>MOS · PCI · MDT 데이터 연결</b><small>현재 data/{data.meta.source} 분석 중</small></div></div>
      <label className="file-drop"><input type="file" accept=".xlsx,.csv,.json" onChange={event => importFile(event.target.files?.[0])} /><FileSpreadsheet /><span>새 데이터 파일 선택<small>XLSX · CSV · 변환된 JSON</small></span></label>
      <button className="template-button" onClick={downloadTemplate}><FileSpreadsheet /> 업로드 양식 받기</button>
      <div className="vworld-key"><KeyRound /><label><span>VWORLD API KEY</span><input type="password" value={keyInput} onChange={event => setKeyInput(event.target.value)} placeholder="발급 키 입력" /></label><button onClick={() => { setMapKey(keyInput.trim()); flash(keyInput.trim() ? 'VWorld 위성지도를 연결합니다.' : 'API 키를 입력해 주세요.'); }}>지도 연결</button></div>
    </section>

    <section className="dashboard-grid">
      <Panel className="map-panel" title="1. 네트워크 품질 지도 (QoE Heatmap)" actions={<div className="selects"><label><select value={location} onChange={event => setLocation(event.target.value)}><option value="ALL">전체 지역</option>{data.meta.locations.map(item => <option key={item.name}>{item.name}</option>)}</select><ChevronDown /></label><label><select value={rat} onChange={event => setRat(event.target.value as RatFilter)}><option value="ALL">LTE + 5G</option><option value="LTE">LTE</option><option value="NR5G">5G</option></select><ChevronDown /></label></div>}>
        <div className="metric-tabs">{(Object.keys(metricLabels) as DatasetMetric[]).map(key => <button className={metric === key ? 'active' : ''} onClick={() => setMetric(key)} key={key}>{metricLabels[key]}</button>)}</div>
        <div className="geo-map">
          <VworldMap apiKey={mapKey} center={data.meta.center} points={filteredPoints} metric={metric} selectedKey={selectedKey} onSelect={setSelectedKey} />
          <div className="map-readout"><strong>{metricLabels[metric]} 저품질 관찰 구간</strong><span>{selected.rat} · PCI {selected.pci}</span><span>{selected.location} · 측정 {selected.samples.toLocaleString()}건</span><span>QoE {selected.qoe.toFixed(2)} · 저품질률 {selected.poorRate}%</span></div>
          <div className="gradient-legend"><b>{metricLabels[metric]} 품질 범례</b><i /><div><span>저품질</span><span>관찰</span><span>양호</span></div></div>
        </div>
      </Panel>

      <Panel className="service-panel" title="2. 서비스별 고객체감품질 (QoE)">
        <div className="service-tabs">{data.services.map(item => <button className={service === item.key ? 'active' : ''} onClick={() => setService(item.key)} key={item.key}>{serviceIcons[item.key]} {item.label}</button>)}</div>
        <span className="chart-title">평균 QoE Score <em>{data.services.find(item => item.key === service)?.basis}</em></span>
        <div className="bar-chart">{['web', 'video', 'voice', 'gaming'].map(key => { const item = data.services.find(entry => entry.key === key)!; return <div className={`bar-col ${service === key ? 'selected' : ''}`} key={key}><b>{item.score.toFixed(2)}</b><i style={{ height: `${item.score / 5 * 100}%`, background: barColors[key] }} /><span>{item.label}</span></div>; })}</div>
      </Panel>

      <Panel className="time-panel" title="3. 시간대별 실측 품질 변화">
        <div className="line-legend"><span><i className="red" />QoE</span><span><i className="blue" />MOS</span><span><i className="orange" />SINR</span></div>
        <TrendChart data={data} />
      </Panel>

      <Panel className="cause-panel" title="4. QoE 저하 원인 자동 분류 (Why?)">
        <div className="cause-flow"><div className="poor-node">QoE Poor</div><div className="cause-list">{Object.entries(causeInfo).map(([key, item]) => <button key={key} className={key === diagnosis ? 'active' : ''}><span>{item.icon}</span><b>{item.rule}</b><i>→</i><em>{item.label}</em><small>{(data.kpis.causeCounts[key] ?? 0).toLocaleString()}건</small></button>)}</div><div className="diagnosis"><h3>진단 결과 ({selected.rat} PCI {selected.pci})</h3><strong style={{ color: cause.color }}>{cause.icon} {cause.label}</strong><ul><li>RSRP: {selected.rsrp?.toFixed(1) ?? '-'} dBm</li><li>SINR: {selected.sinr?.toFixed(1) ?? '-'} dB</li><li>MOS: {selected.mos?.toFixed(2) ?? '미측정'}</li><li>저품질률: <b>{selected.poorRate}%</b></li></ul><p>→ {cause.rule} 조건을 기준으로<br />우선 점검 대상을 분류했습니다.</p><small>규칙 기반 진단 · 실측 {selected.samples.toLocaleString()}건</small></div></div>
      </Panel>

      <Panel className="journey-panel" title="5. 실측 사용자 이동 경로 (Customer Journey)" actions={<button className="panel-action" onClick={() => setPlaying(!playing)}><Play /> {playing ? '일시정지' : '재생'}</button>}>
        <Journey data={data} step={journeyStep} setStep={setJourneyStep} />
      </Panel>

      <Panel className="voc-panel" title="6. 예상 고객 VOC (추정)">
        <div className="voc-list"><Voc critical quote="“영상이 자주 멈추고 끊겨요.”" meta={`${selected.location} · ${selected.rat} PCI ${selected.pci}`} /><Voc quote="“게임 반응이 늦고 버벅여요.”" meta={`SINR ${selected.sinr?.toFixed(1) ?? '-'} dB 기반`} /><Voc quote="“통화 음성이 간헐적으로 끊겨요.”" meta={`MOS ${selected.mos?.toFixed(2) ?? '미측정'} 기반`} /></div>
        <div className="impact"><b>선택 PCI 저품질 측정점</b><div><span className="people">●●●</span> 약 <strong>{poorCount.toLocaleString()}</strong> 건 <small>({selected.samples.toLocaleString()}건 중)</small></div></div>
      </Panel>

      <Panel className="action-panel" title="7. 조치 추천 (Action)" actions={<button className="panel-action" onClick={() => flash('선택 조치의 기대효과를 계산했습니다.')}>효과 계산</button>}>
        <div className="action-body"><div className="check-list">{actionLabels(diagnosis, selected.pci).map((text, index) => <label key={text}><input type="checkbox" checked={actions[index]} onChange={() => setActions(items => items.map((item, i) => i === index ? !item : item))} /><span><Check /></span>{text}</label>)}</div><div className="action-arrow">▶</div><div className="effect-card"><h3><BarChart3 /> 기대 효과</h3><p><Check /> QoE +{(selectedActions * .35).toFixed(1)} 향상 (예상)</p><p><Check /> 저품질 측정점 {Math.min(75, selectedActions * 18)}% 감소 (예상)</p><p><Check /> 해당 지역 품질 안정성 개선</p></div></div>
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

function Voc({ quote, meta, critical = false }: { quote: string; meta: string; critical?: boolean }) {
  return <button className={critical ? 'critical' : ''}><span><CircleUserRound /></span><div><b>{quote}</b><small>- {meta}</small></div></button>;
}

function TrendChart({ data }: { data: QoeDataset }) {
  const left = 34, right = 372, top = 22, bottom = 148;
  const x = (index: number) => left + index * ((right - left) / Math.max(1, data.hourly.length - 1));
  const line = (field: 'qoe' | 'mos', low = 0, high = 5) => data.hourly.map((item, index) => `${x(index)},${bottom - (((item[field] ?? low) - low) / (high - low)) * (bottom - top)}`).join(' ');
  const sinr = data.hourly.map((item, index) => `${x(index)},${bottom - (((item.sinr ?? -5) + 5) / 30) * (bottom - top)}`).join(' ');
  return <div className="line-chart"><svg viewBox="0 0 390 174" preserveAspectRatio="none">{[22, 53, 85, 116, 148].map((y, index) => <g key={y}><line x1={left} y1={y} x2={right} y2={y} /><text x="15" y={y + 3}>{5 - index}</text></g>)}<polyline className="qoe-line" points={line('qoe')} /><polyline className="mos-line" points={line('mos')} /><polyline className="sinr-line" points={sinr} />{data.hourly.map((item, index) => <circle key={item.hour} className="qoe-dot" cx={x(index)} cy={bottom - (item.qoe / 5) * (bottom - top)} r="3" />)}</svg><div className="x-axis">{data.hourly.map(item => <span key={item.hour}>{item.hour}시<small>{item.samples.toLocaleString()}건</small></span>)}</div></div>;
}

function Journey({ data, step, setStep }: { data: QoeDataset; step: number; setStep: (step: number) => void }) {
  const point = data.journey[step];
  const visible = data.journey.slice(0, 7);
  return <><div className="journey-map"><div className="journey-user"><Smartphone /> {point.location} 드라이브테스트 · {point.time}</div><div className="route-line"><i className="progress" style={{ width: `${Math.max(0, Math.min(100, step / Math.max(1, data.journey.length - 1) * 100))}%` }} />{visible.map((item, index) => <button onClick={() => setStep(index)} style={{ left: `${8 + index * 14}%` }} className={`${index <= step ? 'passed' : ''} ${index === step ? 'current' : ''}`} key={`${item.time}-${index}`}><span />PCI {item.pci}</button>)}</div></div><div className="journey-table"><table><thead><tr><th>시간</th><th>위치</th><th>RAT</th><th>PCI</th><th>RSRP</th><th>SINR</th><th>MOS</th><th>QoE</th><th>진단</th></tr></thead><tbody>{visible.map((item, index) => <tr className={index === step ? 'active' : ''} onClick={() => setStep(index)} key={`${item.time}-${index}`}><td>{item.time}</td><td>{item.location}</td><td>{item.rat}</td><td>{item.pci}</td><td>{item.rsrp?.toFixed(1) ?? '-'}</td><td>{item.sinr?.toFixed(1) ?? '-'}</td><td>{item.mos?.toFixed(1) ?? '-'}</td><td><span className={`score s-${Math.floor(item.qoe)}`}>{item.qoe.toFixed(1)}</span></td><td className={item.cause === 'healthy' ? '' : 'event'}>{causeInfo[item.cause]?.label ?? item.cause}</td></tr>)}</tbody></table></div></>;
}
