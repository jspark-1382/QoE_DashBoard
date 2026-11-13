import type { CandidateAnalysisEvidence, CandidateAnalysisJob, CandidateCauseCategory, CandidateEvidenceTarget } from './candidate-ai-analysis';
import { getCandidateSourceCauseAssessments } from './candidate-ai-selections';
import { coveragePointMetric, MDT_SUPPORT_WEIGHT } from './candidate-coverage-points.mjs';
import { formatInvestigationBand, gridReading, investigationCoverage, type InvestigationCoverage, type SourceCauseRow } from './candidate-investigation-presentation';

type Threshold = -100 | -105 | -110;
type FieldPoint = InvestigationCoverage['points'][number];
type GridPoint = Pick<FieldPoint, 'targetId' | 'pot' | 'sourceDate' | 'band' | 'earfcn' | 'reading' | 'metric'>;
export type CandidateSelectedGrid = GridPoint & {role: 'survey' | 'comparison'};
export type CandidateRepresentativeCause = {
  category: CandidateCauseCategory | null;
  title: string;
  summary: string;
  details: string[];
  targetId?: string;
  comparisonTargetId?: string;
  comparisonTargetIds?: string[];
  thresholdDbm?: Threshold;
  callIds: string[];
};

const thresholds: Threshold[] = [-100, -105, -110];
const fmt = (n: number) => n.toFixed(2);
function percentage(target: CandidateEvidenceTarget, limit: Threshold) {
  const metric = target.metrics.find(m => m.label === 'RSRP ≤' + limit + ' dBm' && m.unit === '%');
  const support = target.metrics.find(m => m.label === limit + ' 집계 가중치 (원본 측정 수)')?.value
    ?? target.metrics.find(m => m.label === '측정 수')?.value;
  return typeof metric?.value === 'number' && metric.value >= 0 && metric.value <= 100 &&
    typeof support === 'number' && Number.isFinite(support) && support >= MDT_SUPPORT_WEIGHT ? metric.value : undefined;
}

const opposite: Record<string,string> = {'북쪽':'남쪽','남쪽':'북쪽','동쪽':'서쪽','서쪽':'동쪽'};

/** Resolve the clicked grid, including neighbors that are outside the investigation shortlist. */
export function getCandidateSelectedGrid(target: CandidateEvidenceTarget | undefined, role: CandidateSelectedGrid['role'], thresholdDbm?: number): CandidateSelectedGrid | undefined {
  const reading = gridReading(target);
  if (!reading) return;
  const {point} = reading;
  const threshold = thresholds.find(value => value === thresholdDbm);
  const percent = threshold == null ? undefined : percentage(reading.target, threshold);
  return {
    targetId:reading.target.id, pot:point.pot, sourceDate:point.date, band:point.band, earfcn:reading.target.earfcn ?? '',
    reading, role, metric:threshold != null && percent != null ? {kind:'dl-rsrp',thresholdDbm:threshold,percent} : coveragePointMetric(reading.target),
  };
}

/** One dated, same-carrier measurement and all supported directly adjacent
 * grid measurements. Use the same population for labels, bars and ranking. */
export function getCandidateGridContrast<T extends GridPoint>(evidence: CandidateAnalysisEvidence | undefined, point: T | undefined, options: {thresholdDbm?: number} = {}) {
  if (!evidence || !point) return;
  const targets = new Map(evidence.analysisTargets.map(t => [t.id,t]));
  const facts = new Set(evidence.facts.map(f => f.id));
  const linked = (t: CandidateEvidenceTarget) => t.evidenceIds.length > 0 && t.evidenceIds.every(id => facts.has(id));
  if (targets.size !== evidence.analysisTargets.length) return;
  const links = evidence.neighbourLinks ?? [];
  const target = targets.get(point.targetId);
  if (!target || target !== point.reading.target || !linked(target) || !point.band || !point.earfcn || !point.sourceDate ||
      target.band !== point.band || target.earfcn !== point.earfcn || target.sourceDates.length !== 1 || target.sourceDates[0] !== point.sourceDate) return;
  const nearby = new Map<string,{target:CandidateEvidenceTarget;direction:string;distanceM:number}>();
  for (const [a,b,linkDirection,distanceM] of links) {
    if (distanceM !== 25 || (a !== target.id && b !== target.id)) continue;
    const peer = targets.get(a === target.id ? b : a);
    const location = peer?.mapPoints[0];
    if (peer?.kind !== 'mdt-grid' || !linked(peer) || !location || !Number.isFinite(location.lat) || !Number.isFinite(location.lon) ||
        !location.pot || location.pot === point.pot || location.date !== point.sourceDate || location.band !== point.band ||
        peer.sourceDates.length !== 1 || peer.sourceDates[0] !== point.sourceDate || peer.earfcn !== point.earfcn || peer.band !== point.band) continue;
    const direction = Object.hasOwn(opposite,linkDirection) ? (a === target.id ? linkDirection : opposite[linkDirection]) : '인접';
    nearby.set(location.pot,{target:peer,direction,distanceM});
  }
  for (const threshold of thresholds) {
    if (options.thresholdDbm != null && options.thresholdDbm !== threshold) continue;
    const own = percentage(target,threshold);
    if (own == null) continue;
    const peers = [...nearby.values()].flatMap(({target:peer,direction,distanceM}) => {
      const pct = percentage(peer,threshold);
      return pct == null ? [] : [{id:peer.id,pot:peer.mapPoints[0].pot,pct,direction,distanceM}];
    }).sort((a,b) => a.pot.localeCompare(b.pot));
    if (!peers.length) continue;
    // Round the average of the published POT percentages to display precision
    // before subtracting. This makes the displayed difference reproducible.
    const average = Math.round(peers.reduce((total,peer) => total + Math.round(peer.pct * 100),0) / peers.length) / 100;
    return {point,threshold,own,peers,average,gap:(Math.round(own*100)-Math.round(average*100))/100};
  }
}

function gridComparisons(evidence: CandidateAnalysisEvidence, survey: InvestigationCoverage) {
  return survey.points.flatMap(point => {
    const contrast = getCandidateGridContrast(evidence,point);
    if (!contrast) return [];
    const corroborated = thresholds.some(deeper => deeper < contrast.threshold &&
      (percentage(point.reading.target,deeper) ?? 0) > Math.max(...contrast.peers.map(peer => peer.pct)));
    const band = survey.catalog.bandSummaries?.find(b => b.sourceDate === point.sourceDate &&
      b.band === point.band && b.earfcn === point.earfcn);
    return [{...contrast,corroborated,band}];
  }).filter(pair => pair.own > 0).sort((a,b) =>
    Number(b.corroborated) - Number(a.corroborated) || Number(b.gap > 0) - Number(a.gap > 0) || b.threshold - a.threshold ||
    Number((b.band?.weakPots ?? 0) > 1) - Number((a.band?.weakPots ?? 0) > 1) ||
    (b.band?.weakPercent ?? 0) - (a.band?.weakPercent ?? 0) ||
    b.gap - a.gap || b.own - a.own || a.point.rank - b.point.rank);
}

function fieldDetails(point: FieldPoint, evidence: CandidateAnalysisEvidence) {
  const dates = evidence.target.scope;
  return [
    point.sourceDate + ' 배경 MDT · ' + formatInvestigationBand(point.band) + ' · EARFCN ' + point.earfcn + ' · 조사 POT ' + point.pot,
    '통화 조사 기간은 ' + dates.dateStart + ' ~ ' + dates.dateEnd + '입니다. 통화 저하 시각의 위치와 서빙·이웃 셀별 측정은 이 격자 자료에서 확인할 수 없습니다.',
  ];
}

function comparedGrid(pair: ReturnType<typeof gridComparisons>[number], evidence: CandidateAnalysisEvidence, survey: InvestigationCoverage): CandidateRepresentativeCause {
  const {point, threshold, own, peers, average, gap, band, corroborated} = pair;
  const nearby = peers.length === 1 ? '25 m 인접 POT' : '25 m 인접 POT ' + peers.length + '곳 평균';
  const details = fieldDetails(point, evidence);
  if (band) details.push((survey.savedSubset ? '저장된 측정 자료' : '후보 원본 측정 자료') + '에서 이 대역의 유효 POT ' + band.validPots + '곳 중 ' +
    band.weakPots + '곳에 RSRP −100 dBm 이하 측정이 있었습니다. 지표별 원본 집계 가중치를 적용한 비율은 ' + fmt(band.weakPercent) + '%입니다.');
  details.push('비교 POT별 약전계 비율 · ' + peers.map(p => p.pot + ' ' + fmt(p.pct) + '%').join(' · '));
  details.push('해당 결과에 보존된 같은 날짜·대역·EARFCN의 25 m 인접 격자 중 지표 집계 가중치가 30 이상인 곳을 모두 비교했습니다.' +
    (peers.length > 1 ? ' 각 POT의 비율에 같은 비중을 준 산술평균입니다.' : ' 비교 가능한 인접 격자는 1곳입니다.'));
  return {
    category:'coverage', title:formatInvestigationBand(point.band) + (corroborated ? (band && band.weakPots > 1 ? '' : ' 국소') + ' 커버리지 검토 필요' : ' 약전계 관측 · 국소 차이 판단 보류'),
    summary:'약전계(RSRP ≤ ' + threshold + ' dBm) 비율은 조사 POT ' + fmt(own) + '%, ' + nearby + ' ' + fmt(average) + '%' +
      (Math.abs(gap) < .005 ? '로 같습니다.' : '로 조사 지점이 ' + fmt(Math.abs(gap)) + '%p ' + (gap > 0 ? '높습니다.' : '낮습니다.')),
    details, targetId:point.targetId, comparisonTargetId:peers.length === 1 ? peers[0].id : undefined,
    comparisonTargetIds:peers.map(p => p.id), thresholdDbm:threshold, callIds:[],
  };
}

function criterion(target: CandidateEvidenceTarget, name: string) {
  const value = target.criteria?.[name];
  return value && typeof value === 'object' && 'status' in value && value.status === 'matched';
}
const magnitude = (t: CandidateEvidenceTarget, label: string) => {
  const value = t.metrics.find(m => m.label === label)?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

function callFindings(row: SourceCauseRow, evidence: CandidateAnalysisEvidence) {
  const known = new Set([...evidence.calls, ...evidence.members].map(c => c.id));
  const factIds = new Set(evidence.facts.map(f => f.id));
  const scopedTargets = new Map(row.targets.map(target => [target.id,target]));
  // Source assessment cards can cap their examples. Reconnect other measured
  // calls only inside the same snapshot and its own category/evidence allowlist.
  for (const target of evidence.analysisTargets) {
    if (target.kind !== 'mdt-grid' && target.callIds.length && target.allowedCauseCategories?.includes(row.category) &&
      target.evidenceIds.length && target.evidenceIds.every(id => factIds.has(id))) scopedTargets.set(target.id,target);
  }
  const targets = [...scopedTargets.values()];
  function finding(title: string, signal: string, rowTargets: CandidateEvidenceTarget[]) {
    const scoped = rowTargets.filter(t => t.callIds.some(id => known.has(id)));
    const calls = [...new Set(scoped.flatMap(t => t.callIds.filter(id => known.has(id))))];
    if (!calls.length) return [];
    return [{category:row.category, title,
      summary:'후보 통화 ' + evidence.summary.totalCalls + '건 중 ' + (calls.length < evidence.summary.totalCalls ? '최소 ' : '') + calls.length + '건에서 ' + signal,
      details:[row.reason, ...row.missingEvidence], targetId:scoped[0].id, callIds:calls}];
  }
  switch (row.category) {
    case 'coverage':
    case 'uplink': {
      const dl = targets.filter(t => t.kind !== 'mdt-grid' &&
        (criterion(t,'dl') || (magnitude(t,'RSRP 최소') ?? Infinity) <= -100));
      const ul = targets.filter(t => t.kind !== 'mdt-grid' && criterion(t,'ul'));
      return [
        ...(row.category === 'coverage' ? finding('하향 커버리지 검토 필요','RSRP −100 dBm 이하가 관측됐습니다.',dl) : []),
        ...finding('상향 커버리지 검토 필요','PHR 원본값 3 이하가 관측됐습니다. 원본 단위는 미확인입니다.',ul),
      ];
    }
    case 'equipment': {
      const lost = targets.filter(t => t.kind === 'termination-group' &&
        t.metrics.some(m => ['byeReasonRaw','reasonRaw'].includes(m.label) && typeof m.value === 'string' && /RTP timeout|Rx_RTP_middle_Loss/iu.test(m.value)));
      return finding('RTP 중단 원인 확인 필요','RTP 중단을 나타내는 종료 사유가 기록됐습니다.',lost);
    }
    case 'mobility': {
      const switched = targets.filter(t => criterion(t,'frequencyChange'));
      const repeated = targets.filter(t => criterion(t,'pollution'));
      return [...finding('주파수 전환 구간 검토 필요','통화 중 EARFCN 변경이 관측됐습니다.',switched),
        ...finding('서빙 셀 반복 변경 검토 필요','30초 내 PCI 또는 Cell-ID가 3회 이상 변경됐습니다.',repeated)];
    }
    case 'interference': {
      const returned = targets.filter(t => criterion(t,'overlap'));
      if (returned.length) return finding('동일 주파수 셀 중첩 검토 필요','같은 주파수에서 다른 서빙 셀로 바뀐 뒤 원래 셀로 돌아왔습니다.',returned);
      return finding('셀 중첩·간섭 검토 필요','30초 내 서빙 셀 식별자가 3회 이상 변경됐습니다.',targets.filter(t => criterion(t,'pollution')));
    }
    default: return [];
  }
}

function loneGrid(point: FieldPoint, evidence: CandidateAnalysisEvidence): CandidateRepresentativeCause {
  const metric = point.metric!;
  return {category:'coverage', title:formatInvestigationBand(point.band) + (metric.kind === 'ul-phr' ? ' 상향' : ' 국소') + ' 커버리지 검토 필요',
    summary:'조사 POT ' + point.pot + '에서 ' + (metric.kind === 'dl-rsrp' ? 'RSRP ' + metric.thresholdDbm + ' dBm 이하 비율 ' + fmt(metric.percent) + '%' : 'PHR 원본 평균 ' + metric.mean + ' (기준 3 이하, 단위 미확인)') + '가 관측됐습니다. 같은 조건의 인접 비교값은 미확보입니다.',
    details:fieldDetails(point,evidence), targetId:point.targetId,
    thresholdDbm:metric.kind === 'dl-rsrp' ? thresholds.find(n => n === metric.thresholdDbm) : undefined, callIds:[]};
}

/** Rank field hypotheses by the evidence preserved in this run, independently of Qwen's work order. */
export function getCandidateRepresentativeCause(job?: CandidateAnalysisJob | null, survey?: InvestigationCoverage): CandidateRepresentativeCause {
  const evidence = job?.evidence;
  const unknown = {category:null, title:'대표 원인 판단 보류', summary:'대표 원인을 정할 측정 비교나 통화 근거가 부족합니다.', details:[], callIds:[]};
  if (!evidence) return unknown;
  const rows = getCandidateSourceCauseAssessments(job).filter(row => row.status !== 'insufficient');
  if (!rows.length) {
    // Pre-assessment snapshots still contain source-owned grid percentages
    // and explicit neighbour links. Never reconstruct a historical AI verdict.
    const legacy = job?.status === 'completed' && evidence.schemaVersion === 'qwen-candidate-evidence-v2' &&
      evidence.causeAssessments === undefined && ['candidate-evidence-v3','candidate-evidence-v4','candidate-evidence-v5'].includes(evidence.versions.evidence);
    if (!legacy) return unknown;
    const field = survey ?? investigationCoverage(evidence);
    const pair = gridComparisons(evidence,field)[0];
    if (!pair) return {...unknown, summary:'저장 당시 원인별 평가가 없으며, 저장된 측정에서 같은 조건의 인접 POT 비교를 구성할 수 없습니다.'};
    const result = comparedGrid(pair,evidence,field);
    return {...result,details:['저장 측정값으로 재검토 · 이 실행에 보존된 MDT 측정과 인접 격자 연결에서 계산했습니다.',...result.details]};
  }
  const field = survey ?? investigationCoverage(evidence);
  const hasCoverage = rows.some(row => row.category === 'coverage');
  const pair = hasCoverage ? gridComparisons(evidence,field)[0] : undefined;
  // Observed signal deficiencies / interrupted calls repeated in the majority
  // carry greater weight than background grids. A routine cell change does not.
  const callOptions = rows.flatMap(row => callFindings(row,evidence)).sort((a,b) => b.callIds.length - a.callIds.length);
  const most = callOptions[0];
  const recurring = callOptions.find(item => ['coverage','uplink','equipment'].includes(item.category) &&
    item.callIds.length >= 2 && item.callIds.length > evidence.summary.totalCalls / 2);
  if (recurring) return recurring;
  if (pair?.corroborated) return comparedGrid(pair,evidence,field);
  if (most) return most;
  if (pair) return comparedGrid(pair,evidence,field);
  const point = hasCoverage && field.points.find(p => p.metric && evidence.analysisTargets.includes(p.reading.target));
  if (point) return loneGrid(point,evidence);
  return unknown;
}
