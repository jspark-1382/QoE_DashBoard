import type { AnalystOverview, OverviewCall } from './types';

/** The source archive is date-partitioned, so only available dates are selectable. */
export const MAX_ANALYSIS_DAYS = 3;

export function datesInRange(available: readonly string[], start: string, end: string): string[] {
  const dates = [...new Set(available)].sort();
  const first = dates.indexOf(start), last = dates.indexOf(end);
  if (first < 0 || last < first || last >= dates.length || last - first + 1 > MAX_ANALYSIS_DAYS)
    return [];
  // Require actual calendar-contiguous days. A missing partition must never
  // look like a one-day interval or hide a data collection gap.
  const selected=dates.slice(first,last+1);
  const day=86400000;
  if (selected.some((date,index)=>index>0 &&
    (Date.parse(date+'T00:00:00Z')-Date.parse(selected[index-1]+'T00:00:00Z'))!==day))
    return [];
  return selected;
}
export function adjustDateRange(
  available: readonly string[], start: string, end: string,
  changed: 'start'|'end', next: string,
): { start: string; end: string } {
  const dates = [...new Set(available)].sort();
  if (!dates.includes(next)) return {start,end};
  let first = dates.indexOf(changed === 'start' ? next : start);
  let last = dates.indexOf(changed === 'end' ? next : end);
  if (changed === 'start') {
    if (last < first) last = first;
    if (last - first + 1 > MAX_ANALYSIS_DAYS) last = first + MAX_ANALYSIS_DAYS - 1;
  } else {
    if (first > last) first = last;
    if (last - first + 1 > MAX_ANALYSIS_DAYS) first = last - MAX_ANALYSIS_DAYS + 1;
  }
  return {start:dates[first],end:dates[last]};
}
export function dateOfCall(call: Pick<OverviewCall,'startTimestamp'>, fallback:string):string {
  const value=call.startTimestamp?.slice(0,10);
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value)?value:fallback;
}
/** Concatenate independent dates without reassigning a call's id or GNSS position. */
export function combineDateOverviews(days: readonly AnalystOverview[]): AnalystOverview {
  if (!days.length) throw new Error('분석 기간의 실제 자료가 없습니다.');
  if (days.length > MAX_ANALYSIS_DAYS) throw new Error('분석 기간은 최대 3일입니다.');
  const sorted=[...days].sort((a,b)=>a.date.localeCompare(b.date));
  const reference=sorted[0];
  for (const item of sorted) {
    if (item.source!==reference.source || item.sourceRevision!==reference.sourceRevision ||
      item.spatialUnit!==reference.spatialUnit || item.gridSizeM!==reference.gridSizeM)
      throw new Error('날짜별 자료의 출처/좌표체계/원본 버전이 불일치합니다.');
  }
  const boundaries=new Map<string,NonNullable<AnalystOverview['administrativeDongs']>[number]>();
  const cells=new Map<string,NonNullable<AnalystOverview['cells']>[number]>();
  const calls=new Map<string,NonNullable<AnalystOverview['calls']>[number]>();
  const positions=new Map<string,NonNullable<AnalystOverview['callLocations']>[number]>();
  for(const item of sorted){
    for(const boundary of item.administrativeDongs??[]) boundaries.set(boundary.id,boundary);
    for(const cell of item.cells){
      const old=cells.get(cell.id);
      cells.set(cell.id,old?{...old,callIds:[...new Set([...old.callIds,...cell.callIds])]}:{...cell});
    }
    for(const call of item.calls){
      if(calls.has(call.id)) throw new Error('중복 Call ID: '+call.id);
      calls.set(call.id,call);
    }
    for(const position of item.callLocations??[]){
      if(positions.has(position.callId)) throw new Error('날짜 간 동일 위치 Call ID 중복');
      positions.set(position.callId,position);
    }
  }
  return {...reference,date:sorted[0].date===sorted.at(-1)!.date?reference.date:
    sorted[0].date+' ~ '+sorted.at(-1)!.date,
    calls:[...calls.values()],cells:[...cells.values()],
    administrativeDongs:[...boundaries.values()],callLocations:[...positions.values()]};
}
