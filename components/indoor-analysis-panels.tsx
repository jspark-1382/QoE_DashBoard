'use client';

import { AlertTriangle, Building2, Check, Database, RadioTower, Server, Signal, Wifi } from 'lucide-react';
import type { IndoorBuilding, IndoorFloor } from '@/lib/indoor-dataset';

export type IndoorCauseKey = 'coverage' | 'interference' | 'voice' | 'overlap' | 'healthy';

const causes: Record<IndoorCauseKey, { label: string; rule: string; detail: string }> = {
  coverage: { label: '인빌딩 커버리지 부족', rule: 'RSRP -100 dBm 미만', detail: '음영 구간과 안테나 도달 범위를 우선 확인합니다.' },
  interference: { label: '간섭 · 품질 열화 의심', rule: 'SINR 5 dB 미만 또는 RSRQ -15 dB 미만', detail: '인접 셀 중첩과 외부 매크로셀 유입을 점검합니다.' },
  voice: { label: 'Voice 품질 점검', rule: 'MOS 3.2 미만', detail: '무선 지표가 정상이라면 음성·코어 구간을 확인합니다.' },
  overlap: { label: '다중 PCI 중첩 관찰', rule: '동일 층 주요 PCI 4개 이상', detail: '셀 경계와 층 내부 망 선택 안정성을 확인합니다.' },
  healthy: { label: '주요 지표 정상', rule: '품질 임계치 충족', detail: '현재 상태를 기준선으로 저장하고 지속 관찰합니다.' },
};

export function inferIndoorCause(floor: IndoorFloor): IndoorCauseKey {
  if (floor.rsrp != null && floor.rsrp < -100) return 'coverage';
  if ((floor.sinr != null && floor.sinr < 5) || (floor.rsrq != null && floor.rsrq < -15)) return 'interference';
  if (floor.mos != null && floor.mos < 3.2) return 'voice';
  if (floor.topPcis.length >= 4) return 'overlap';
  return 'healthy';
}

function format(value: number | null, digits = 1) {
  return value == null ? '-' : value.toFixed(digits);
}

export function IndoorFloorComparison({ building, selectedCode, onSelect }: { building: IndoorBuilding; selectedCode: string; onSelect: (code: string) => void }) {
  return <div className="indoor-floor-comparison">
    <div className="floor-compare-head"><span>층</span><span>QoE</span><span>MOS</span><span>RSRP</span><span>SINR</span></div>
    <div className="floor-compare-list">{building.floors.map(floor => {
      const qoe = floor.qoe ?? 0;
      return <button className={floor.code === selectedCode ? 'active' : ''} onClick={() => onSelect(floor.code)} key={floor.code}>
        <strong>{floor.code}<small>{floor.name}</small></strong>
        <span className="floor-qoe"><i style={{ width: `${qoe / 5 * 100}%` }} /><b>{format(floor.qoe, 2)}</b></span>
        <span>{format(floor.mos, 2)}</span><span>{format(floor.rsrp)}<small>dBm</small></span><span>{format(floor.sinr)}<small>dB</small></span>
      </button>;
    })}</div>
    <div className="panel-evidence"><Database /> 원본 측정값을 층 단위로 집계 · QoE는 무선지표와 MOS 기반 계산</div>
  </div>;
}

export function IndoorCauseAnalysis({ floor }: { floor: IndoorFloor }) {
  const active = inferIndoorCause(floor);
  const selected = causes[active];
  return <div className="indoor-cause-analysis">
    <div className="indoor-cause-rules">{(Object.entries(causes) as [IndoorCauseKey, typeof causes[IndoorCauseKey]][]).map(([key, item]) => <div className={key === active ? 'active' : ''} key={key}>
      <span>{key === 'coverage' ? <Signal /> : key === 'interference' ? <RadioTower /> : key === 'voice' ? <Server /> : key === 'overlap' ? <Wifi /> : <Database />}</span>
      <b>{item.rule}</b><i>→</i><em>{item.label}</em>
    </div>)}</div>
    <aside className={`indoor-diagnosis ${active}`}>
      <small>{floor.code} {floor.name} · 규칙 기반 진단</small>
      <strong>{active === 'healthy' ? <Check /> : <AlertTriangle />}{selected.label}</strong>
      <p>{selected.detail}</p>
      <dl><div><dt>RSRP</dt><dd>{format(floor.rsrp)} dBm</dd></div><div><dt>RSRQ</dt><dd>{format(floor.rsrq)} dB</dd></div><div><dt>SINR</dt><dd>{format(floor.sinr)} dB</dd></div><div><dt>MOS</dt><dd>{format(floor.mos, 2)}</dd></div></dl>
      <span>진단은 장애 확정이 아닌 우선 점검 분류입니다.</span>
    </aside>
  </div>;
}

export function IndoorPciAnalysis({ floor }: { floor: IndoorFloor }) {
  const maximum = Math.max(1, ...floor.topPcis.map(item => item.samples));
  const lte = floor.ratCounts.LTE ?? 0;
  const nr = floor.ratCounts.NR5G ?? 0;
  const total = Math.max(1, lte + nr);
  return <div className="indoor-pci-analysis">
    <div className="rat-share"><div><span>LTE</span><b>{lte.toLocaleString()}건</b><i style={{ width: `${lte / total * 100}%` }} /></div><div><span>5G</span><b>{nr.toLocaleString()}건</b><i className="nr" style={{ width: `${nr / total * 100}%` }} /></div></div>
    <div className="pci-analysis-list">{floor.topPcis.map((cell, index) => <div key={`${cell.rat}-${cell.pci}`}>
      <span className={cell.rat === 'NR5G' ? 'nr' : ''}>{cell.rat === 'NR5G' ? '5G' : 'LTE'}</span>
      <strong>PCI {cell.pci}<small>{index === 0 ? '주요 셀' : '인접 셀'}</small></strong>
      <i><b style={{ width: `${cell.samples / maximum * 100}%` }} /></i>
      <em>{cell.samples.toLocaleString()}건</em><small>QoE {format(cell.qoe, 2)}</small>
    </div>)}</div>
    <div className="panel-evidence"><RadioTower /> {floor.code}에서 실제 검출된 PCI와 측정 비중</div>
  </div>;
}

export function IndoorImpactAnalysis({ building, floor }: { building: IndoorBuilding; floor: IndoorFloor }) {
  const poor = Math.round(floor.validSamples * floor.poorRate / 100);
  const ranked = [...building.floors].sort((a, b) => b.poorRate - a.poorRate);
  const worst = ranked[0];
  return <div className="indoor-impact-analysis">
    <div className="impact-primary"><span>선택 층 저품질 측정점</span><strong>{poor.toLocaleString()}<small>건</small></strong><em>전체 유효 측정 {floor.validSamples.toLocaleString()}건 중 {floor.poorRate}%</em></div>
    <div className="impact-meter"><i style={{ width: `${Math.max(2, floor.poorRate)}%` }} /></div>
    <div className="impact-facts"><div><span>건물 내 취약 층</span><b>{worst.code} {worst.name}</b><small>저품질률 {worst.poorRate}%</small></div><div><span>선택 층 주요 PCI</span><b>{floor.topPcis[0] ? `${floor.topPcis[0].rat} PCI ${floor.topPcis[0].pci}` : '-'}</b><small>{floor.topPcis[0]?.samples.toLocaleString() ?? 0}건 검출</small></div></div>
    <div className="impact-notice"><AlertTriangle /><span><b>고객 수가 아닌 측정점 수입니다.</b><small>가입자 식별 데이터가 없어 인원으로 환산하지 않습니다.</small></span></div>
  </div>;
}

function recommendations(cause: IndoorCauseKey, floor: IndoorFloor) {
  const first = cause === 'coverage' ? `${floor.code} 음영 구간 안테나 도달 범위 점검`
    : cause === 'interference' ? `${floor.code} 인접 셀 중첩·외부 매크로 유입 점검`
      : cause === 'voice' ? `${floor.code} Voice 호와 코어 구간 품질 점검`
        : cause === 'overlap' ? `${floor.code} PCI 우선순위·셀 경계 최적화`
          : `${floor.code} 현재 품질 기준선 저장`;
  return [first, 'IBS·RU 출력과 안테나 방향 확인', '저품질 좌표 우선 재측정', 'LTE·5G 망 선택 안정성 확인', '조치 후 동일 동선 재측정'];
}

export function IndoorActionAnalysis({ floor, checks, onToggle }: { floor: IndoorFloor; checks: boolean[]; onToggle: (index: number) => void }) {
  const cause = inferIndoorCause(floor);
  return <div className="indoor-action-analysis">
    <div className="indoor-action-list">{recommendations(cause, floor).map((item, index) => <label key={item}><input type="checkbox" checked={checks[index]} onChange={() => onToggle(index)} /><span><Check /></span><b>{item}</b></label>)}</div>
    <div className="verification-card"><Building2 /><span><b>개선 확인 방법</b><small>동일 층 · 동일 동선 재측정</small><small>RSRP · SINR · MOS 전후 비교</small></span></div>
    <p>수치형 기대효과는 검증 데이터 확보 후 제공합니다.</p>
  </div>;
}
