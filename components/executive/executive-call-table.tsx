'use client';

import { useMemo } from 'react';
import type { ExecutiveSample } from '@/lib/executive';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const average = (values: (number | null)[]) => {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
};

export function buildCallRows(samples: ExecutiveSample[]) {
  const groups = new Map<string, { sample: ExecutiveSample; index: number }[]>();
  samples.forEach((sample, index) => {
    // Missing source identifiers are not silently presented as inferred calls.
    if (!sample.callId || !sample.ci) return;
    const group = groups.get(sample.callId) ?? [];
    group.push({ sample, index });
    groups.set(sample.callId, group);
  });
  return [...groups].map(([id, group]) => {
    const counts = new Map<number, number>();
    group.forEach(({ sample }) => { if (sample.pci != null) counts.set(sample.pci, (counts.get(sample.pci) ?? 0) + 1); });
    const maxCount = Math.max(...counts.values());
    const pcis = [...counts].filter(([, count]) => count === maxCount).map(([pci]) => pci).sort((a, b) => a - b);
    return {
      id, ci: group[0].sample.ci, indices: group.map(item => item.index), index: group[0].index,
      site: [...new Set(group.map(item => item.sample.site || '장소 정보 없음'))].join(' · '),
      start: group[0].sample.time, end: group[group.length - 1].sample.time,
      pci: pcis.join(' / ') || '미측정',
      qoe: group[0].sample.qoe,
      mos: average(group.map(item => item.sample.mos)),
      rsrp: average(group.map(item => item.sample.rsrp)),
    };
  });
}

export function ExecutiveCallTable({ samples, selectedSampleIndex, onSelect, onShowAll, callMeta }: {
  callMeta?: Record<string, { start: string; end: string }>;
  samples: ExecutiveSample[];
  selectedSampleIndex: number | null;
  onSelect: (index: number) => void;
  onShowAll: () => void;
}) {
  const rows = useMemo(() => buildCallRows(samples), [samples]);
  return <section className="exec-panel exec-call-panel" aria-labelledby="call-table-title">
    <header><div><h2 id="call-table-title">콜 테이블</h2></div><div className="exec-call-tools"><span className="exec-call-count">{rows.length.toLocaleString()}개 측정 콜</span><button type="button" className="exec-call-show-all" onClick={onShowAll}>전체 보기</button></div></header>
    <p className="exec-call-note">CI 기준 1행 = 1콜 · QoE는 콜 평균 측정값으로 계산 · MOS / RSRP 평균</p>
    <div className="exec-call-scroll">
      <Table>
        <TableHeader><TableRow>
          <TableHead>지역/사이트</TableHead><TableHead>시간</TableHead><TableHead>최빈 PCI</TableHead><TableHead>QoE</TableHead><TableHead>MOS</TableHead><TableHead>RSRP <small>(dBm)</small></TableHead>
        </TableRow></TableHeader>
        <TableBody>{rows.map(row => {
          const selected = selectedSampleIndex != null && row.indices.includes(selectedSampleIndex);
          return <TableRow key={row.id} className={row.qoe <= 3.5 ? 'call-qoe-red' : row.qoe < 4 ? 'call-qoe-yellow' : 'call-qoe-green'} data-state={selected ? 'selected' : undefined} onClick={() => onSelect(row.index)}>
            <TableCell><button className="exec-call-select" aria-pressed={selected} onClick={event => { event.stopPropagation(); onSelect(row.index); }}>{row.site}<small style={{ display: 'block', color: '#8faabb', fontSize: 12, marginTop: 3 }}>CI {row.ci}</small></button></TableCell>
            <TableCell className="exec-call-time">{callMeta?.[row.id]?.start || row.start}<span>~ {callMeta?.[row.id]?.end || row.end}</span></TableCell>
            <TableCell>{row.pci}</TableCell>
            <TableCell><strong>{row.qoe.toFixed(2)}</strong></TableCell>
            <TableCell>{row.mos?.toFixed(2) ?? '—'}</TableCell>
            <TableCell>{row.rsrp?.toFixed(1) ?? '—'}</TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>
      {!rows.length && <div className="exec-empty"><b>표시할 콜 데이터가 없습니다.</b><span>고객과 측정 일자를 확인해 주세요.</span></div>}
    </div>
  </section>;
}
