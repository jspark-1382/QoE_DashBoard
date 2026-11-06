import type { OverviewCallLocation } from './types';

type Selection = Pick<OverviewCallLocation,
  'byeSelectionMethod'|'byeCandidateCount'|'byeSelectionDeltaSeconds'>;

/** Explains how a tower reference was chosen; never describes a UE fix. */
export function byeSelectionLabel(point: Selection): string {
  const method = point.byeSelectionMethod === 'mdt' ? 'MDT 장비 일치'
    : point.byeSelectionMethod === 'first' ? '첫 후보 선택'
    : point.byeSelectionMethod === 'unique' ? 'Cell 단일 후보' : 'BYE 기지국 참고';
  const count = point.byeCandidateCount;
  return method + (Number.isInteger(count) && (count ?? 0) > 0 ? ` · 후보 ${count}개` : '');
}

export function byeSelectionDescription(point: Selection): string {
  const label = byeSelectionLabel(point);
  if (point.byeSelectionMethod === 'first')
    return label + ' · 기지국 목록 순서로 선택한 참고 위치';
  if (point.byeSelectionMethod === 'mdt') {
    const delta = point.byeSelectionDeltaSeconds;
    return label + (delta != null && Number.isFinite(delta)
      ? ` · 종료 ${Math.abs(delta).toFixed(1)}초 ${delta < 0 ? '후' : '전'} MDT`
      : ' · 같은 통화의 MDT 장비 코드 기준');
  }
  return label;
}
