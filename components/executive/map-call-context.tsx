'use client';
import { useMemo, useState } from 'react';
import type { ExecutiveSample } from '@/lib/executive';
import { buildCallRows } from './executive-call-table';

export function MapCallContext({ samples, selectedSampleIndex, expanded, onSelect, onShowAll, callMeta, children }: {
  samples: ExecutiveSample[]; selectedSampleIndex: number | null; expanded: boolean;
  onSelect: (index: number) => void; onShowAll: () => void;
  callMeta?: Record<string, { start: string; end: string }>; children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const rows = useMemo(() => buildCallRows(samples), [samples]);
  const sample = selectedSampleIndex == null ? undefined : samples[selectedSampleIndex];
  const selected = rows.find(row => row.id === sample?.callId);
  return <div className="map-call-context">
    <div className="map-call-main">
      <div className="map-call-summary" aria-label="선택 콜 요약" aria-live="polite">
        {selected ? <><strong>CI {selected.ci}</strong><span>{callMeta?.[selected.id]?.start || selected.start} ~ {callMeta?.[selected.id]?.end || selected.end}</span><span>QoE <b>{selected.qoe.toFixed(2)}</b></span><span>평균 RSRP <b>{selected.rsrp?.toFixed(1) ?? '—'}</b> dBm</span><span>선택 시점 기지국 <b>{sample?.mdt?.baseStationId || '정보 없음'}</b></span></> : <span>{rows.length ? '전체 콜 보기 · 콜을 선택하면 요약이 표시됩니다.' : '표시할 콜 데이터가 없습니다.'}</span>}
      </div>
      <div className="map-call-canvas">{children}</div>
    </div>
    {expanded && <aside className={`map-call-sidebar${collapsed ? ' collapsed' : ''}`} aria-label="확대 지도 콜 목록">
      <button type="button" className="map-call-collapse" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>{collapsed ? '◀ 콜 목록' : `콜 목록 · ${rows.length}개 ▶ 접기`}</button>
      {!collapsed && <><button className="map-call-all" type="button" onClick={onShowAll}>전체 보기</button>
        <div className="map-call-items">{rows.map(row => <button type="button" key={row.id} aria-pressed={selected?.id === row.id} onClick={() => onSelect(row.index)} className={`map-call-item ${row.qoe <= 3.5 ? 'poor' : row.qoe < 4 ? 'fair' : 'good'}`}>
          <span><b>CI {row.ci}</b><strong>QoE {row.qoe.toFixed(2)}</strong></span><small>{callMeta?.[row.id]?.start || row.start} ~ {callMeta?.[row.id]?.end || row.end}</small><small>{row.site}</small>
        </button>)}</div>{!rows.length && <p>표시할 콜이 없습니다.</p>}</>}
    </aside>}
  </div>;
}
