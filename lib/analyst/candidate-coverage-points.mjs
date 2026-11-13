// Display bound and support weighting follow the existing MDT investigation review.
// A grid weight is a measurement aggregate, never a count of independent calls.
export const MDT_SUPPORT_WEIGHT = 30;
const POINT_LIMIT = 6;
const THRESHOLDS = [-100, -105, -110];

function reading(target) {
  const point = target.mapPoints?.[0];
  const date = target.sourceDates?.[0];
  if (!point?.pot || !Number.isFinite(point.lat) || !Number.isFinite(point.lon) ||
      !date || date !== point.date || !target.band || target.band !== point.band || !target.earfcn) return;
  const metrics = new Map(target.metrics.map(metric => [metric.label, metric.value]));
  const samples = metrics.get('측정 수');
  if (!Number.isSafeInteger(samples) || samples <= 0) return;
  const weight = key => metrics.get(key + ' 집계 가중치 (원본 측정 수)') ?? samples;
  const tails = THRESHOLDS.map(threshold => {
    const value = metrics.get('RSRP ≤' + threshold + ' dBm');
    return Number.isFinite(value) && value >= 0 && value <= 100 && weight(threshold) >= MDT_SUPPORT_WEIGHT ? value : null;
  });
  const ul = target.criteria?.ul;
  const phr = ul?.aggregation === 'source-grid-mean' && ul.status === 'matched' &&
    Number.isFinite(ul.mean) && weight('phrMean') >= MDT_SUPPORT_WEIGHT ? ul.mean : null;
  const score = tails.reduce((sum, value) => sum + (value ?? 0), 0) + (phr !== null ? MDT_SUPPORT_WEIGHT : 0);
  const carrier = JSON.stringify([date, target.band, target.earfcn]);
  return {id:target.id, pot:point.pot, date, band:target.band, earfcn:target.earfcn, samples, tails, dlWeight:weight(-100), phr, score, carrier};
}

// "POTs with weak readings" includes any positive fraction. It is a spatial
// count, separate from the source-weighted fraction of weak measurements.
function summarizeBands(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (row.tails[0] === null || !Number.isSafeInteger(row.dlWeight) || row.dlWeight < MDT_SUPPORT_WEIGHT) continue;
    if (!groups.has(row.carrier)) groups.set(row.carrier, {
      sourceDate:row.date, band:row.band, earfcn:row.earfcn,
      pots:new Set(), weak:new Set(), sourceWeight:0, weightedSum:0,
    });
    const group = groups.get(row.carrier);
    group.pots.add(row.pot);
    if (row.tails[0] > 0) group.weak.add(row.pot);
    group.sourceWeight += row.dlWeight;
    group.weightedSum += row.dlWeight * row.tails[0];
  }
  return Array.from(groups.values(), group => ({
    sourceDate:group.sourceDate, band:group.band, earfcn:group.earfcn,
    validPots:group.pots.size, weakPots:group.weak.size, sourceWeight:group.sourceWeight,
    weakPercent:group.weightedSum / group.sourceWeight,
  }));
}

function compare(a, b) {
  return b.score - a.score || b.samples - a.samples || a.id.localeCompare(b.id);
}

function leadingMetric(row) {
  if (!row) return;
  const index = row.tails.findIndex(value => value > 0);
  if (index >= 0) return {kind:'dl-rsrp', thresholdDbm:THRESHOLDS[index], percent:row.tails[index]};
  if (row.phr !== null) return {kind:'ul-phr', mean:row.phr};
}

export function coveragePointMetric(target) {
  return leadingMetric(reading(target));
}

function reason(row) {
  const readings = [];
  // Use the operational DL criterion, then the observed deeper distribution if available.
  for (const [index, value] of row.tails.entries()) {
    if (value > 0) readings.push('RSRP ≤ ' + THRESHOLDS[index] + ' dBm ' + value + '%');
  }
  if (row.phr !== null) readings.push('UL PHR 원본 평균 ' + Number(row.phr.toFixed(2)) + ' (기준 ≤ 3, 단위 미확인)');
  return readings.join(' · ') + ' · ' + row.samples + '측정. ' +
    (row.phr !== null && row.tails.some(value => value > 0) ? 'DL 분포와 UL PHR 평균을 현장에서 함께 확인합니다.' :
      row.phr !== null ? '낮은 PHR 평균이 이 지점의 개별 측정에서도 반복되는지 확인합니다.' :
        '기준 이하 신호가 이 지점과 주변에서 반복되는지 확인합니다.');
}

/** Derive the field shortlist only from the supplied measured targets and their proven links.
 * On archived jobs the input can be a retained subset. Counts always describe that input. */
export function buildCoveragePoints(targets = [], links = []) {
  const rows = targets.filter(t => t.kind === 'mdt-grid').map(reading).filter(Boolean);
  const byId = new Map(rows.map(row => [row.id, row]));
  const samePot = new Map(), adjacent = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.date, row.pot]);
    if (!samePot.has(key)) samePot.set(key, []);
    samePot.get(key).push(row);
    adjacent.set(row.id, []);
  }
  for (const [a, b, , distanceM] of links) {
    const first = byId.get(a), second = byId.get(b);
    if (!first || !second || first.carrier !== second.carrier || first.pot === second.pot ||
        !Number.isFinite(distanceM) || distanceM <= 0) continue;
    adjacent.get(a).push({row:second, distanceM});
    adjacent.get(b).push({row:first, distanceM});
  }
  const qualified = rows.filter(row => row.score > 0).sort(compare);
  const areaById = new Map();
  for (const seed of qualified) {
    if (areaById.has(seed.id)) continue;
    const area = [seed];
    areaById.set(seed.id, area);
    for (let i = 0; i < area.length; i++) {
      for (const {row} of adjacent.get(area[i].id)) {
        if (row.score <= 0 || areaById.has(row.id)) continue;
        areaById.set(row.id, area);
        area.push(row);
      }
    }
  }

  // Visit a distinct physical POT per measured carrier first, then unrepresented
  // connected areas. Fill any remaining slots by the existing RSRP/PHR rank.
  const chosen = [], pots = new Set(), carriers = new Set(), areas = new Set();
  function add(row) {
    chosen.push(row);
    pots.add(row.pot);
    carriers.add(row.carrier);
    areas.add(areaById.get(row.id));
  }
  for (const eligible of [row => !carriers.has(row.carrier), row => !areas.has(areaById.get(row.id)), () => true]) {
    for (const row of qualified) {
      if (chosen.length >= POINT_LIMIT) break;
      if (!pots.has(row.pot) && eligible(row)) add(row);
    }
  }
  const points = chosen.map((row, i) => {
    const comparisons = [];
    if (row.tails[1] !== null) {
      const neighbour = adjacent.get(row.id)
        .filter(peer => peer.distanceM === 25 && peer.row.tails[1] !== null && peer.row.tails[1] < row.tails[1])
        .sort((a,b) => a.row.tails[1] - b.row.tails[1] || b.row.samples - a.row.samples || a.row.id.localeCompare(b.row.id))[0];
      if (neighbour) comparisons.push({kind:'adjacent-same-carrier', targetId:neighbour.row.id, distanceM:neighbour.distanceM});
      const crossBand = samePot.get(JSON.stringify([row.date, row.pot]))
        .filter(peer => peer.band !== row.band && peer.earfcn !== row.earfcn && peer.tails[1] !== null)
        .sort((a,b) => b.samples - a.samples || a.id.localeCompare(b.id))[0];
      if (crossBand) comparisons.push({kind:'same-pot-other-band', targetId:crossBand.id, distanceM:0});
    }
    return {rank:i + 1, targetId:row.id, pot:row.pot, sourceDate:row.date, band:row.band, earfcn:row.earfcn,
      areaSize:areaById.get(row.id).length, reason:reason(row), metric:leadingMetric(row), comparisons};
  });
  return {bandSummaries:summarizeBands(rows), reviewedCombinations:rows.length, qualifiedCombinations:qualified.length,
    qualifiedPotCount:new Set(qualified.map(row => row.pot)).size, areaCount:new Set(areaById.values()).size, points};
}
