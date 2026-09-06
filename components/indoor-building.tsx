'use client';

import { useState } from 'react';
import { Building2, ChevronDown, Layers3, RadioTower, Signal } from 'lucide-react';
import type { IndoorBuilding as Building, IndoorDataset, IndoorFloor, IndoorMetric } from '@/lib/indoor-dataset';

type Props = {
  data: IndoorDataset;
  metric: IndoorMetric;
  buildingName: string;
  floorCode: string;
  onBuildingChange: (name: string) => void;
  onFloorChange: (code: string) => void;
};

const metricLabel: Record<IndoorMetric, string> = { qoe: 'QoE', mos: 'MOS', rsrp: 'RSRP', rsrq: 'RSRQ', sinr: 'SINR' };

function quality(value: number | null, metric: IndoorMetric) {
  if (value == null) return { color: '#526a7a', className: 'none' };
  const ranges: Record<IndoorMetric, [number, number]> = { qoe: [2.5, 3.6], mos: [3, 4], rsrp: [-105, -92], rsrq: [-15, -10], sinr: [3, 10] };
  const [bad, good] = ranges[metric];
  if (value < bad) return { color: '#ff3b5d', className: 'poor' };
  if (value < good) return { color: '#ffb52d', className: 'watch' };
  return { color: '#42d784', className: 'good' };
}

function metricValue(floor: IndoorFloor, metric: IndoorMetric) {
  const value = floor[metric];
  if (value == null) return '-';
  if (metric === 'rsrp') return `${value.toFixed(1)} dBm`;
  if (metric === 'rsrq' || metric === 'sinr') return `${value.toFixed(1)} dB`;
  return value.toFixed(2);
}

export function IndoorBuilding({ data, metric, buildingName, floorCode, onBuildingChange, onFloorChange }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const building: Building = data.buildings.find(item => item.name === buildingName) ?? data.buildings[0];
  const selected = building.floors.find(item => item.code === floorCode) ?? building.floors[0];
  const measured = building.floors.filter(floor => floor.qoe != null);
  const average = measured.reduce((sum, floor) => sum + (floor.qoe ?? 0), 0) / Math.max(1, measured.length);
  const highestFloor = Math.max(1, ...building.floors.map(floor => floor.order));

  return <div className="indoor-shell">
    <div className="indoor-toolbar">
      <div className={`building-select ${pickerOpen ? 'open' : ''}`}>
        <button className="building-picker-button" onClick={() => setPickerOpen(open => !open)} aria-haspopup="listbox" aria-expanded={pickerOpen}><Building2 /><span><small>분석 건물</small><b>{building.name}</b></span><ChevronDown /></button>
        {pickerOpen && <div className="building-options" role="listbox" aria-label="분석 건물 선택">{data.buildings.map(item => <button role="option" aria-selected={item.name === building.name} key={item.name} onClick={() => { onBuildingChange(item.name); setPickerOpen(false); }}><Building2 /><span>{item.name}<small>{item.floors.length}개 층 · {item.samples.toLocaleString()}행</small></span></button>)}</div>}
      </div>
      <div className="indoor-summary"><span><b>{building.floors.length}</b>개 층</span><span><b>{building.samples.toLocaleString()}</b>행</span><span><b>{average.toFixed(2)}</b> 평균 QoE</span></div>
    </div>

    <div className="indoor-content">
      <section className="building-stage" aria-label={`${building.name} 층별 품질`}>
        <div className="building-caption"><span>IN-BUILDING DIGITAL TWIN</span><strong>{building.name}</strong><small>{building.category} · {data.meta.measurementDate}</small></div>
        <div className="building-photo">
          <img src="/qoe/indoor-building.png" alt="층별 품질이 표시되는 건물 투시도" />
          <div className="ibs-beacon"><RadioTower /><span>IBS</span></div>
          {building.floors.map(floor => {
            const state = quality(floor[metric], metric);
            const top = floor.order < 0 ? 89 : 77 - ((floor.order - 1) / Math.max(1, highestFloor - 1)) * 57;
            return <button
              key={floor.code}
              className={`floor-overlay ${floor.code === selected.code ? 'active' : ''} ${floor.order < 0 ? 'basement' : ''}`}
              style={{ '--floor-color': state.color, '--floor-top': `${top}%` } as React.CSSProperties}
              onClick={() => onFloorChange(floor.code)}
              aria-label={`${floor.code} ${floor.name} ${metricLabel[metric]} ${metricValue(floor, metric)}`}
            >
              <span className="floor-tag">{floor.code}<small>{floor.name}</small></span>
              <span className="floor-band"><i /></span>
              <span className="floor-value"><b>{metricValue(floor, metric)}</b><small>{floor.validSamples.toLocaleString()}건</small></span>
            </button>;
          })}
          <div className="ground-line"><span>GROUND</span></div>
        </div>
      </section>

      <aside className="floor-inspector">
        <header><span className="floor-badge">{selected.code}</span><div><b>{selected.name}</b><small>{building.name}</small></div><i className={quality(selected[metric], metric).className} /></header>
        <div className="floor-primary"><span>{metricLabel[metric]} 층 평균</span><strong>{metricValue(selected, metric)}</strong><small>저품질 측정 비율 {selected.poorRate}%</small></div>
        <div className="floor-kpis"><div><span>RSRP</span><b>{selected.rsrp?.toFixed(1) ?? '-'}<small>dBm</small></b></div><div><span>SINR</span><b>{selected.sinr?.toFixed(1) ?? '-'}<small>dB</small></b></div><div><span>MOS</span><b>{selected.mos?.toFixed(2) ?? '-'}</b></div><div><span>QoE</span><b>{selected.qoe?.toFixed(2) ?? '-'}</b></div></div>
        <div className="pci-floor-list"><h4><Signal /> 주요 PCI</h4>{selected.topPcis.slice(0, 3).map(cell => <div key={`${cell.rat}-${cell.pci}`}><span><i className={cell.rat === 'NR5G' ? 'nr' : ''}>{cell.rat === 'NR5G' ? '5G' : 'L'}</i>PCI {cell.pci}</span><b>{cell.samples.toLocaleString()}건</b><em>QoE {cell.qoe?.toFixed(2) ?? '-'}</em></div>)}</div>
        <p><Layers3 /> 건물의 층 표시를 선택하면 해당 층 무선 품질과 주요 PCI가 표시됩니다.</p>
      </aside>
    </div>
  </div>;
}
