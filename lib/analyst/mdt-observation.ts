import type { SourceCall } from './types';

/** This summary is based exclusively on MDT rows tagged with the selected
 * call ID, never on a different customer's/call's measurements.
 * CDR start/end are timing references, not verified SIP BYE packet instants.
 */
export interface MdtObservationSummary {
  taggedRows: number;
  timestampedRows: number;
  duringCallRows: number;
  endBefore60Rows: number;
  endAfter60Rows: number;
  closestToEndSignedSeconds: number | null; // negative before, positive after
  clockBasis: 'cdr-start-end-and-mdt-observed-time' | 'time-not-verifiable';
}
const usableTime = (raw:unknown):number|null => {
  if(typeof raw!=='string'||!/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw))return null;
  const value=Date.parse(raw);
  return Number.isFinite(value)?value:null;
};
const sampleTime = (row:readonly unknown[]):number|null=>{
  const metadata=row[21];
  if(metadata===null||typeof metadata!=='object'||Array.isArray(metadata))return null;
  return usableTime((metadata as {timestamp?:unknown}).timestamp);
};
export function summarizeCallMdtObservations(
  call:Pick<SourceCall,'id'|'startTimestamp'|'endTimestamp'>,
  sourceRows:readonly (readonly unknown[])[]
):MdtObservationSummary {
  const tagged=sourceRows.filter(row=>row[19]===call.id);
  const start=usableTime(call.startTimestamp);
  const end=usableTime(call.endTimestamp);
  const observed=tagged.map(sampleTime).filter((v):v is number=>v!==null);
  const verified=start!==null&&end!==null&&end>=start;
  let during=0,before=0,after=0,nearest:null|number=null;
  if(verified){
    for(const time of observed){
      if(time>=start&&time<=end)during++;
      const diff=(time-end)/1000;
      if(diff>=-60&&diff<=0)before++;
      if(diff>0&&diff<=60)after++;
      if(nearest===null||Math.abs(diff)<Math.abs(nearest)||
         (Math.abs(diff)===Math.abs(nearest)&&diff<nearest))nearest=diff;
    }
  }
  return {
    taggedRows:tagged.length,
    timestampedRows:observed.length,
    duringCallRows:during,
    endBefore60Rows:before,
    endAfter60Rows:after,
    closestToEndSignedSeconds:nearest===null?null:Math.round(nearest*10)/10,
    clockBasis:verified?'cdr-start-end-and-mdt-observed-time':'time-not-verifiable',
  };
}

export type MdtObservationDisplay = {
  headline:string;detail:string;timeDetail:string;
  observation:'before'|'after'|'distant'|'none'|'unverified'|'ambiguous';
};
export function formatMdtObservation(
  summary:MdtObservationSummary,
  matchStatus: 'MATCHED'|'AMBIGUOUS'|'UNMATCHED'|undefined
):MdtObservationDisplay{
  if(matchStatus==='AMBIGUOUS')
    return {headline:'통화별 MDT 구분 불가',detail:'비슷한 시각의 MDT 기록이 여러 개여서 이 통화의 측정값을 구분할 수 없습니다.',
      timeDetail:'동일 통화 여부 미확인',observation:'ambiguous'};
  if(summary.taggedRows===0)
    return {headline:'해당 통화 MDT 없음',detail:'이 통화에 배정된 MDT 관측 기록이 없습니다.',
      timeDetail:'다른 통화·고객 전체의 MDT 기록까지 없다는 뜻은 아닙니다.',observation:'none'};
  if(summary.clockBasis!=='cdr-start-end-and-mdt-observed-time'||
     summary.timestampedRows===0)
    return {headline:'MDT 시각 확인 필요',detail:'이 통화에 MDT '+summary.taggedRows+'건이 있으나 관측 시각을 비교할 수 없습니다.',
      timeDetail:'통화와 MDT의 시각 정보가 불완전합니다.',observation:'unverified'};
  const before=summary.endBefore60Rows,after=summary.endAfter60Rows;
  const label=summary.closestToEndSignedSeconds;
  const closest=label===null?'가장 가까운 측정 시각 없음':
    Math.abs(label)<0.05?'가장 가까운 측정: 종료 시각':
    '가장 가까운 측정: 종료 '+Math.abs(label).toFixed(1)+'초 '+(label<0?'전':'후');
  const detail='통화 중 '+summary.duringCallRows+'건 · 종료 전 60초 '+before+
    '건 / 종료 후 60초 '+after+'건';
  if(before>0)
    return {headline:'종료 전 60초 이내 · '+before+'건',detail,timeDetail:closest,
      observation:'before'};
  if(after>0)
    return {headline:'종료 후 60초 이내 · '+after+'건',detail,
      timeDetail:closest+' · 종료 후 측정은 통화 중 품질 증거가 아닙니다.',
      observation:'after'};
  return {headline:'종료 전후 60초 내 없음',detail,
    timeDetail:closest+' · 해당 통화에 배정된 MDT만 확인',
    observation:'distant'};
}
