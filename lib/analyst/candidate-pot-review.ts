import type { Mdt25mAnalysis, Mdt25mCell, MdtGridMode } from './mdt-25m-grid';
import type { CandidatePotContext } from './candidate-pot-context';

export const POT_CAUSE_CATEGORIES = [
  { id: 'coverage', label: '커버리지 부족' },
  { id: 'interference', label: '셀 중첩·간섭' },
  { id: 'mobility', label: '셀·주파수 전환' },
  { id: 'equipment', label: '장비·전송·단말 이상' },
  { id: 'capacity', label: '주파수·용량 부족' },
] as const;
export type PotCauseCategory = typeof POT_CAUSE_CATEGORIES[number]['id'] | 'uplink';
export function potCauseLabel(id: PotCauseCategory, legacyFour = false) {
  if (legacyFour || id === 'uplink') {
    const savedLabels: Partial<Record<PotCauseCategory, string>> = {
      coverage: 'DL 커버리지 불량', uplink: 'UL 커버리지 불량',
      interference: 'Pollution 추정', equipment: '기타 (장비 및 Core 확인)',
    };
    if (savedLabels[id]) return savedLabels[id]!;
  }
  return POT_CAUSE_CATEGORIES.find(category => category.id === id)?.label ?? id;
}
export type PotNeighbour = { pot: Mdt25mCell; measurement: Mdt25mAnalysis; distanceM: number; direction: string };
export type PotReview = {
  measurement: Mdt25mAnalysis | null;
  neighbours: PotNeighbour[];
  comparison: PotNeighbour | null;
  status: 'suspected' | 'review' | 'unavailable';
  headline: string;
  reason: string;
  check: string;
  action: string;
};
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const frequencies = ['900', '1.8협', '1.8광', '2.1'];
export function selectPotMeasurement(pot: Mdt25mCell, band: MdtGridMode, date: string): Mdt25mAnalysis | null {
  // Background visibility never changes the analysis band; hidden is mapped to Top1 by the UI.
  if (band === 'hidden') return null;
  const rows = (pot.analysis ?? []).filter(a => a.date === date && a.samples > 0 && finite(a.rsrpMean));
  if (band !== 'top1') return rows.find(a => a.band === band) ?? null;
  return [...rows].sort((a, b) => b.samples - a.samples || frequencies.indexOf(a.band) - frequencies.indexOf(b.band) || a.earfcn.localeCompare(b.earfcn))[0] ?? null;
}
export function potNeighbours(context: Pick<CandidatePotContext, 'pots'>, pot: Mdt25mCell, measurement: Mdt25mAnalysis): PotNeighbour[] {
  return context.pots.flatMap(other => {
    if (other.pot === pot.pot) return [];
    const dx = other.x - pot.x, dy = other.y - pot.y;
    const distanceM = Math.hypot(dx, dy);
    // Immediate eight 25m neighbours only, never a distant candidate-wide tail comparison.
    if (!finite(distanceM) || distanceM < 1 || Math.abs(dx) > 26 || Math.abs(dy) > 26) return [];
    const row = other.analysis?.find(a => a.date === measurement.date && a.band === measurement.band && a.earfcn === measurement.earfcn && a.samples > 0);
    if (!row) return [];
    const direction = (dy > 1 ? '북' : dy < -1 ? '남' : '') + (dx > 1 ? '동' : dx < -1 ? '서' : '') + '쪽';
    return [{ pot: other, measurement: row, distanceM, direction }];
  }).sort((a, b) => a.distanceM - b.distanceM || a.pot.pot.localeCompare(b.pot.pot));
}

/** Deterministic source comparison, not generated Qwen prose or a confirmed network diagnosis. */
export function reviewPot(context: Pick<CandidatePotContext, 'pots'>, pot: Mdt25mCell, band: MdtGridMode, date: string, category: PotCauseCategory): PotReview {
  const measurement = selectPotMeasurement(pot, band, date);
  const neighbours = measurement ? potNeighbours(context, pot, measurement) : [];
  const frequency = measurement?.band ?? (band === 'top1' ? '해당 대역' : band);
  const prefix = `POT ${pot.pot} · ${frequency}`;
  const base: PotReview = {
    measurement, neighbours, comparison: null, status: 'unavailable',
    headline: measurement ? `${frequency} 측정 ${measurement.samples.toLocaleString('ko-KR')}건 · 추가 근거 확인 필요` : `${date} ${frequency} 측정 미확보`,
    reason: '선택 POT의 해당 날짜·대역에서 판단할 근거를 확인합니다.',
    check: `${prefix}의 원본 MDT 측정 여부 확인`,
    action: '측정 자료를 확보한 뒤 같은 날짜·대역으로 비교합니다.',
  };
  if (!measurement) return base;
  if (category === 'uplink') return { ...base, reason: 'UL은 원본 PHR 관측 기준으로 별도 확인합니다. RSRP 분포를 UL 근거로 사용하지 않습니다.', check: `${prefix}에 연결된 통화의 원본 PHR ≤ 3 관측 확인`, action: '동일 통화의 상향 전력·품질 로그를 확보해 대조합니다.' };

  if (category === 'capacity') return {
    ...base,
    reason: '이 POT를 담당하는 셀의 구축 대역·부하를 확인해야 투자 여부를 판단할 수 있습니다.',
    check: `${prefix}를 서비스하는 셀의 구축 대역·시간대별 PRB 사용률 확인`,
    action: '운용 조정·부하 분산으로 해소되지 않는 용량 부족이면 주파수 보강을 검토합니다.',
  };
  if (category === 'mobility') return {
    ...base,
    reason: '대역별 집계만으로 실제 서빙 선택이나 핸드오버 실패를 판단할 수 없습니다.',
    check: `${prefix}의 실제 서빙·동시 이웃 측정과 전환 실패 시각 대조`,
    action: '전환 실패가 확인되면 해당 셀의 이웃 관계·핸드오버 조건을 점검합니다.',
  };
  if (category === 'equipment') return {
    ...base,
    reason: '이 POT에 연결된 장비·전송·단말 장애 근거가 아직 없습니다.',
    check: `${prefix}에 연결되는 통화의 장애 시각·FC 원문과 장비·전송 기록 대조`,
    action: '장애가 확인된 장비·전송 구간·단말에 맞춰 점검합니다.',
  };
  if (category === 'interference') {
    const comparison = finite(measurement.rsrqMean) ? neighbours.find(n => finite(n.measurement.rsrqMean) && n.measurement.rsrpMean > measurement.rsrpMean && n.measurement.rsrqMean < measurement.rsrqMean!) ?? null : null;
    return {
      ...base, comparison, status: comparison ? 'review' : 'unavailable',
      headline: comparison ? `${comparison.direction} POT는 신호 세기가 높아도 RSRQ는 더 낮음` : `${frequency} 셀 중첩·간섭 확인 자료 필요`,
      reason: comparison ? '신호 세기와 품질이 다른 양상입니다. 셀 중첩·간섭과 부하를 구분해 확인합니다.' : 'RSRQ만으로 PCI 충돌이나 간섭을 확정하지 않습니다. 셀별 동시 관측이 필요합니다.',
      check: `POT ${pot.pot}${comparison ? '·' + comparison.pot.pot : ''}의 ${frequency} SINR·서빙/이웃 PCI와 같은 시간대 부하 비교`,
      action: '중첩·간섭이 확인되면 해당 셀들의 커버리지·PCI 계획을 검토합니다.',
    };
  }
  const tail = measurement.belowPct['-105'];
  if (!finite(tail)) return { ...base, headline: `${frequency} 약전계 비율 미확보`, reason: '기준 이하 비율이 없어 평균 RSRP만으로 커버리지 부족을 분류하지 않습니다.' };
  const available = neighbours.filter(n => finite(n.measurement.belowPct['-105']));
  const higher = [...available].filter(n => n.measurement.belowPct['-105']! > tail).sort((a, b) => b.measurement.belowPct['-105']! - a.measurement.belowPct['-105']! || b.measurement.samples - a.measurement.samples)[0];
  const comparison = higher ?? available[0] ?? null;
  return {
    ...base, comparison, status: tail > 0 ? 'suspected' : 'unavailable',
    headline: higher ? `${higher.direction} 인접 POT에서 ${frequency} 약전계 관측 비율이 더 높음` : tail > 0 ? `${frequency} 기준 이하 신호가 관측된 POT` : `${frequency} 기준 이하 비율 0% 관측 · 전체 품질 정상 판정은 아님`,
    reason: tail > 0 ? `${frequency} 대역의 국소 음영 여부를 우선 확인합니다.` : '선택 POT에서는 해당 기준 이하 관측이 없습니다. 다른 지표와 주변 POT를 확인합니다.',
    check: `POT ${pot.pot}${comparison ? '·' + comparison.pot.pot : ''}의 ${frequency} 서빙·이웃 셀 신호 비교`,
    action: '같은 구간에서 음영이 반복되면 커버리지 조정·보강을 검토합니다.',
  };
}
