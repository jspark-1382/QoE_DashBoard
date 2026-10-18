'use client';

import { useMemo } from 'react';
import type { ExecutiveSample } from '@/lib/executive';
import { Table, TableBody, TableRow } from '@/components/ui/table';

// Grid rank panel for the all-customers landing: severity = observation count x distance of the cell average below 3.2.
const GRID_LAT = 0.0011;
const GRID_LON = 0.0014;
const severityColor = (qoe: number) => qoe <= 1 ? '#b3123f' : qoe <= 1.75 ? '#e5174c' : qoe <= 2.5 ? '#ff5470' : '#ff8d5c';
const right = { textAlign: 'right' as const };

type LocCell = { lat: number; lon: number; count: number; qoeSum: number; worstQoe: number; worstIndex: number; owners: Set<string>; calls: Set<string> };

export function LowQoeClusterPanel({ samples, onSelectSample }: { samples: ExecutiveSample[]; onSelectSample: (index: number) => void }) {
  const locations = useMemo(() => {
    const cells = new Map<string, LocCell>();
    samples.forEach((sample, index) => {
      const key = `${Math.round(sample.lat / GRID_LAT)},${Math.round(sample.lon / GRID_LON)}`;
      const cell = cells.get(key);
      if (!cell) {
        const owners = new Set<string>();
        if (sample.ownerId) owners.add(sample.ownerId);
        cells.set(key, { lat: sample.lat, lon: sample.lon, count: 1, qoeSum: sample.qoe, worstQoe: sample.qoe, worstIndex: index, owners, calls: new Set([sample.callId]) });
      } else {
        cell.count += 1;
        cell.qoeSum += sample.qoe;
        if (sample.qoe < cell.worstQoe) { cell.worstQoe = sample.qoe; cell.worstIndex = index; }
        if (sample.ownerId) cell.owners.add(sample.ownerId);
        cell.calls.add(sample.callId);
      }
    });
    return [...cells.values()].map(cell => {
      const avg = cell.qoeSum / cell.count;
      return { lat: cell.lat, lon: cell.lon, count: cell.count, avg, worstIndex: cell.worstIndex, contracts: cell.owners.size, calls: cell.calls.size, severity: cell.count * (3.2 - avg) };
    }).sort((a, b) => b.severity - a.severity).slice(0, 12);
  }, [samples]);

  const pcis = useMemo(() => {
    const rows = new Map<number, { count: number; calls: Set<string>; qoeSum: number; rsrpSum: number; rsrpCount: number; worstQoe: number; worstIndex: number }>();
    samples.forEach((sample, index) => {
      if (sample.pci == null) return;
      const row = rows.get(sample.pci) ?? { count: 0, calls: new Set<string>(), qoeSum: 0, rsrpSum: 0, rsrpCount: 0, worstQoe: Number.POSITIVE_INFINITY, worstIndex: index };
      row.count += 1;
      row.calls.add(sample.callId);
      row.qoeSum += sample.qoe;
      if (sample.qoe < row.worstQoe) { row.worstQoe = sample.qoe; row.worstIndex = index; }
      if (sample.rsrp != null) { row.rsrpSum += sample.rsrp; row.rsrpCount += 1; }
      rows.set(sample.pci, row);
    });
    return [...rows].map(([pci, row]) => ({
      pci, count: row.count, calls: row.calls.size, avg: row.qoeSum / row.count,
      rsrp: row.rsrpCount ? row.rsrpSum / row.rsrpCount : null, worstIndex: row.worstIndex,
    })).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [samples]);

  return <section className="exec-panel exec-call-panel" aria-labelledby="cluster-title">
    <header><div><h2 id="cluster-title">저품질 클러스터 순위</h2></div><div className="exec-call-tools"><span className="exec-call-count">격자 120m · 대상 {samples.length.toLocaleString()}건</span></div></header>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <div>
        <div className="exec-call-scroll" style={{ maxHeight: 250 }}>
          <Table><TableBody>
            {locations.map(row => <TableRow key={`${row.lat},${row.lon}`} onClick={() => onSelectSample(row.worstIndex)} style={{ cursor: 'pointer' }}>
              <td><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: severityColor(row.avg), marginRight: 6 }} /><code>{row.lat.toFixed(4)}, {row.lon.toFixed(4)}</code></td>
              <td style={right}>QoE {row.avg.toFixed(2)}</td>
              <td style={right}>{row.count.toLocaleString()}관</td>
              <td style={right}>{row.contracts.toLocaleString()}계 · {row.calls.toLocaleString()}콜</td>
            </TableRow>)}
          </TableBody></Table>
        </div>
      </div>
      <div>
        <div className="exec-call-scroll" style={{ maxHeight: 250 }}>
          <Table><TableBody>
            {pcis.map(row => <TableRow key={row.pci} onClick={() => onSelectSample(row.worstIndex)} style={{ cursor: 'pointer' }}>
              <td><b>PCI {row.pci}</b></td>
              <td style={right}>QoE {row.avg.toFixed(2)}</td>
              <td style={right}>{row.rsrp == null ? '—' : `${row.rsrp.toFixed(1)} dBm`}</td>
              <td style={right}>{row.count.toLocaleString()}관 · {row.calls.toLocaleString()}콜</td>
            </TableRow>)}
          </TableBody></Table>
        </div>
      </div>
    </div>
    <p className="exec-call-note">행 클릭 시 그 클러스터 최악 콜의 고객으로 이동 · 위치 열 = 격자 중심 좌표</p>
  </section>;
}
