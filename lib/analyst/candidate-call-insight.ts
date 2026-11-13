import { isReadableCandidateAnalysisJob, type CandidateAnalysisJob, type CandidateCauseCategory, type CandidateEvidenceTarget } from './candidate-ai-analysis';
import { getCandidateComparisonView } from './candidate-comparison-view';
import type { AnalysisCall } from './customer-ai-analysis';

type CallLink = Pick<AnalysisCall, 'id' | 'date' | 'start' | 'href'> & Partial<Pick<AnalysisCall, 'end'>>;
type Detail = {
  kind: 'overlap' | 'frequencyChange' | 'pollution' | 'dl' | 'ul' | 'termination' | 'radio' | 'quality';
  question: string; conclusion: string; context: string; firstCheck: string;
  rows: {label: string; value: string; time: string}[];
  period: string;
};
export type CandidateCallInsight = Detail & {
  call: CallLink; basis: 'qwen' | 'measurement'; targetId: string; evidenceIds: string[];
};

const record = (value: unknown): Record<string,unknown> | undefined =>
  value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : undefined;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const integer = (v: unknown): v is number => finite(v) && Number.isSafeInteger(v) && v >= 0;
const rsrp = (v: unknown): v is number => finite(v) && v < 0 && v >= -200;
const dbm = (v: number) => String(v).replace('-', '−') + ' dBm';
const summaryRow = (label: string, value: string) => ({label,value,time:''});
const dateLabel = (s: string) => s.slice(5).replace('-','.');
const callPeriod = (c: CallLink) => dateLabel(c.date) + ' 통화 · ' + c.start;
const metric = (t: CandidateEvidenceTarget, label: string) => t.metrics?.find(m=>m.label===label)?.value;
const matched = (t: CandidateEvidenceTarget, key: string) => {
  const c = record(t.criteria?.[key]);
  return c?.status === 'matched' ? c : undefined;
};
const DAY = 86400000;

// Time-only records in these Korean source workbooks use local Korean time.
// Offset-qualified records keep their own instant, also across midnight.
function instant(value: unknown, day: string) {
  if (typeof value !== 'string') return NaN;
  const m = value.match(/^(?:(\d{4}-\d{2}-\d{2})T)?(\d\d:\d\d:\d\d(?:\.\d+)?)(Z|[+-]\d\d:\d\d)?$/);
  return m ? Date.parse((m[1] ?? day) + 'T' + m[2] + (m[3] ?? '+09:00')) : NaN;
}
const clock = (ms: number) => new Date(ms + 9*3600000).toISOString().slice(11,23);
const eventPeriod = (when: number[]) =>
  dateLabel(new Date(when[0] + 9*3600000).toISOString().slice(0,10)) + ' 통화 관측 · ' +
  clock(when[0]).slice(0,8) + '–' + clock(Math.ceil(when[when.length-1]/1000)*1000).slice(0,8);

function localCall(c: CallLink, t: CandidateEvidenceTarget) {
  if (!c.id || !t.sourceDates.includes(c.date) || !/^\d{4}-\d\d-\d\d$/.test(c.date) ||
      typeof c.href !== 'string' || !/^\/(?:qoe\/?)?\?/.test(c.href)) return false;
  const params = new URLSearchParams(c.href.slice(c.href.indexOf('?')+1));
  const id=params.get('call');
  const joinedId=params.get('customer')+':'+id;
  return !!id && (id===c.id || (params.has('customer') && joinedId===c.id)) &&
    (!params.has('date') || params.get('date')===c.date);
}

function eventDetail(t: CandidateEvidenceTarget, c: CallLink, kind: 'overlap'|'frequencyChange'): Detail | undefined {
  const w = record(matched(t,kind)?.window);
  const events = Array.isArray(w?.events) ? w.events.map(record) : [];
  if (!w || events.length !== (kind==='overlap' ? 3 : 2) || events.some(r=>!r)) return;
  const rows = events as Record<string,unknown>[];
  const when = rows.map(r=>instant(r.at,c.date)), last=when[when.length-1];
  const begin=instant(c.start,c.date), end=instant(c.end,c.date);
  if (when.some((at,i)=>!Number.isFinite(at) || (i>0 && at<=when[i-1])) ||
      when[0]!==instant(w.startedAt,c.date) || last!==instant(w.endedAt,c.date) ||
      last-when[0]>30000 || !Number.isFinite(begin) || when[0]<begin ||
      (Number.isFinite(end) && last>=(end<begin ? end+DAY : end)+1000)) return;
  const channels=rows.map(r=>r.earfcn);
  if (!channels.every(integer)) return;
  const pci=rows.map(r=>r.servingPci), cell=rows.map(r=>r.cellId);
  const returns = (ids: unknown[]) => ids[0]===ids[2] && ids[0]!==ids[1];
  let labels: string[];
  if (kind==='overlap') {
    if (new Set(channels).size!==1) return;
    if (pci.every(integer) && returns(pci)) labels=pci.map(v=>'PCI '+v);
    else if (cell.every(v=>typeof v==='string' && v.length>0) && returns(cell)) labels=cell.map(v=>'Cell '+v);
    else return;
  } else {
    if (channels[0]===channels[1]) return;
    labels=channels.map(v=>'EARFCN '+v);
  }
  const dl=record(t.criteria?.dl);
  const threshold=finite(dl?.threshold) ? dl.threshold : -100;
  const valid=rows.map(r=>r.rsrp).filter(rsrp);
  const weak=valid.filter(value=>value<=threshold).length;
  const target=kind==='overlap' ? '셀 복귀' : '주파수 변경';
  const total=rows.length===3 ? '세' : '두';
  const criterion=dbm(threshold)+' 이하';
  const conclusion=valid.length===rows.length && !weak
    ? total+' 시점 모두 약전 기준('+criterion+')을 충족하지 않았습니다.'
    : valid.length ? 'RSRP가 기록된 '+valid.length+'개 시점 중 '+weak+'개에서 '+criterion+'였습니다.'
    : target+' 구간의 RSRP 측정값이 없어 약전 여부를 판단하기 어렵습니다.';
  // A call-wide minimum can only be attributed to another instant when every
  // event has RSRP, and that minimum is strictly below every displayed value.
  const other = dl?.status==='matched' && rsrp(dl.minimum) && dl.minimum<=threshold &&
    integer(dl.validSamples) && dl.validSamples>rows.length && valid.length===rows.length && dl.minimum<Math.min(...valid);
  return {kind,question:target+' 순간에도 신호가 약했을까?',conclusion,
    context:other ? '같은 통화의 다른 시점에서는 '+dbm(dl.minimum as number)+'이 관측됐습니다.' : '',
    firstCheck:target+' 시각에 음질도 떨어졌는지 확인',period:eventPeriod(when),
    rows:rows.map((r,i)=>({label:labels[i],value:rsrp(r.rsrp)?dbm(r.rsrp):'RSRP 미확보',time:clock(when[i])}))};
}

function thresholdDetail(t: CandidateEvidenceTarget, c: CallLink, kind: 'dl'|'ul'): Detail | undefined {
  const rule=matched(t,kind);
  if (!rule || !finite(rule.threshold) || !finite(rule.minimum) || !integer(rule.validSamples) || !integer(rule.observedCount) ||
      !rule.observedCount || rule.validSamples<rule.observedCount || rule.minimum>rule.threshold || (kind==='dl' && !rsrp(rule.minimum))) return;
  const dl=kind==='dl', field=dl?'RSRP':'PHR';
  return {kind, question:dl?'통화 중 약한 신호가 얼마나 관측됐을까?':'통화 중 송신 여유가 낮았을까?',
    period:callPeriod(c),rows:[summaryRow('통화 최저 '+field,dl?dbm(rule.minimum):String(rule.minimum)),summaryRow('기준 이하 관측',rule.observedCount+' / '+rule.validSamples+'회')],
    conclusion:'이 통화에서 '+field+'가 '+(dl?dbm(rule.threshold):String(rule.threshold))+' 이하인 측정이 '+rule.observedCount+'회 있었습니다.',
    context:dl?'':'PHR은 원본 값이며 단위는 미확인입니다.',firstCheck:'기준 이하 측정 시각에 음질도 떨어졌는지 확인'};
}

function selectDetail(t: CandidateEvidenceTarget, c: CallLink, category?: CandidateCauseCategory): Detail | undefined {
  if (t.kind==='call-criteria' && t.callIds.length===1) {
    if (!category || category==='interference') {
      const result=eventDetail(t,c,'overlap'); if (result) return result;
    }
    if (!category || category==='mobility') {
      const result=eventDetail(t,c,'frequencyChange'); if (result) return result;
      const poll=matched(t,'pollution'),w=record(poll?.window);
      if (w && integer(w.changes) && w.changes>=3 && poll?.windowSeconds===30) {
        return {kind:'pollution',question:'서빙 셀이 반복해서 바뀌었을까?',period:callPeriod(c),
          rows:[summaryRow('30초 이내 변경',w.changes+'회')],conclusion:'같은 통화에서 서빙 PCI 또는 Cell-ID가 반복 변경됐습니다.',
          context:'핸드오버 실패 여부는 추가 확인이 필요합니다.',firstCheck:'반복 변경 구간과 음질 저하 시각을 대조'};
      }
    }
    if (!category || category==='coverage' || category==='uplink') {
      return (category!=='uplink' && thresholdDetail(t,c,'dl')) || thresholdDetail(t,c,'ul');
    }
  }
  if (t.kind==='termination-group' && (!category || category==='equipment')) {
    const rows=['byeReasonRaw','reasonRaw'].flatMap(label=>{
      const code=metric(t,label);
      return typeof code==='string' && /RTP timeout|Rx_RTP_middle_Loss/iu.test(code)
        ? [summaryRow(label==='byeReasonRaw'?'BYE 원문':'종료 사유 원문',code)] : [];
    });
    if (rows.length) return {kind:'termination',question:'통화 종료 기록은 무엇을 보여줄까?',rows,period:callPeriod(c),
      conclusion:'이 통화의 종료 사유에 RTP 중단 단서가 기록됐습니다.',
      context:'처음 손실이 발생한 구간은 종료 원문만으로 특정하기 어렵습니다.',firstCheck:'같은 통화의 마지막 송수신 RTP와 최초 BYE 시각을 대조'};
  }
  if (t.kind==='call-radio' && t.callIds.length===1 && (!category || category==='coverage')) {
    const min=metric(t,'RSRP 최소'), max=metric(t,'RSRP 최대');
    if (rsrp(min) && rsrp(max) && min<=-100 && min<=max) return {kind:'radio',question:'통화 중 신호가 얼마나 약해졌을까?',
      rows:[summaryRow('RSRP 최저',dbm(min)),summaryRow('RSRP 최고',dbm(max))],period:callPeriod(c),
      conclusion:'통화 중 RSRP가 −100 dBm 이하로 관측됐습니다.',context:'',firstCheck:'최저 신호 관측 시각과 음질 저하 시각을 대조'};
  }
  if (t.kind==='call-quality' && t.callIds.length===1 && !category) {
    const qoe=metric(t,'저장 QoE'), mos=metric(t,'원본 MOS');
    if (finite(qoe) && qoe<3) return {kind:'quality',question:'이 통화에서 품질 저하는 어떻게 관측됐을까?',
      rows:[summaryRow('통화 QoE',String(Number(qoe.toFixed(2)))),...(finite(mos)?[summaryRow('통화 MOS',String(Number(mos.toFixed(2))))]:[])],period:callPeriod(c),
      conclusion:'통화 단위 QoE가 3점 미만이었습니다.',context:'통화 집계값만으로 품질이 떨어진 순간을 특정하기 어렵습니다.',
      firstCheck:'원본 통화에서 음질 저하 구간과 무선·RTP 기록을 대조'};
  }
}

/** Each detail stays with one recorded call from this job. Only model-cited
 * targets can be labelled Qwen evidence; others are independent measurements. */
export function getCandidateCallInsights(job?: CandidateAnalysisJob | null, representative?: {
  category: CandidateCauseCategory | null; targetId?: string;
}): CandidateCallInsight[] {
  const evidence=job?.evidence;
  if (!evidence) return [];
  const targets=evidence.analysisTargets ?? [];
  const byId=new Map(targets.map(t=>[t.id,t]));
  if (byId.size!==targets.length) return [];
  const facts=new Set((evidence.facts??[]).map(f=>f.id));
  const calls=new Map<string,CallLink>();
  for (const c of [...(evidence.members??[]),...(evidence.calls??[])]) calls.set(c.id,c);
  const picked=new Map<string,CandidateCallInsight>();
  function add(t: CandidateEvidenceTarget | undefined, basis: CandidateCallInsight['basis'], category?: CandidateCauseCategory) {
    if (!t?.callIds?.length || !t.evidenceIds.length || !t.evidenceIds.every(id=>facts.has(id))) return;
    for (const id of t.callIds) {
      const call=calls.get(id);
      if (!call || picked.has(id) || !localCall(call,t)) continue;
      const detail=selectDetail(t,call,category);
      if (detail) picked.set(id,{...detail,call,basis,targetId:t.id,evidenceIds:t.evidenceIds});
    }
  }
  const comparison=getCandidateComparisonView(job);
  for (const side of [comparison?.primary,comparison?.alternative]) {
    for (const source of side?.sources??[]) add(source.target,'qwen',side!.category);
  }
  if (isReadableCandidateAnalysisJob(job) && job?.modelVerification?.responseModelVerified && job.modelVerification.responseModel===job.model) {
    for (const plan of job.report?.investigations??[]) {
      if (!Array.isArray(plan?.targetIds) || !Array.isArray(plan.evidenceIds) || !plan.evidenceIds.length) continue;
      const linked=plan.targetIds.flatMap(id=>byId.get(id)??[]);
      if (linked.length!==plan.targetIds.length || plan.evidenceIds.some(id=>!linked.some(t=>t.evidenceIds.includes(id))) ||
          linked.some(t=>!t.evidenceIds.some(id=>plan.evidenceIds.includes(id)))) continue;
      for (const t of linked) add(t,'qwen');
    }
  }
  if (representative?.category) {
    add(byId.get(representative.targetId??''),'measurement',representative.category);
    for (const t of targets) add(t,'measurement',representative.category);
  }
  // With no linked model observation, show source-owned event windows ahead
  // of aggregate measurements; missing/sparse calls remain unselected.
  for (const category of ['interference','mobility','equipment','coverage'] as const)
    for (const target of targets) add(target,'measurement',category);
  for (const target of targets) add(target,'measurement');
  return [...picked.values()];
}
export function getCandidateCallInsight(job?: CandidateAnalysisJob | null, representative?: Parameters<typeof getCandidateCallInsights>[1]) {
  return getCandidateCallInsights(job,representative)[0] ?? null;
}
