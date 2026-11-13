/** Preserve the old pair shape for consumers that display a single comparison example. */
function comparisonExample(coveragePoints) {
  for (const point of coveragePoints.points) {
    const adjacent = point.comparisons.find(row => row.kind === 'adjacent-same-carrier');
    if (!adjacent) continue;
    const otherBand = point.comparisons.find(row => row.kind === 'same-pot-other-band');
    return {primaryTargetId:point.targetId, comparisonTargetId:adjacent.targetId, distanceM:adjacent.distanceM,
      sourceDate:point.sourceDate, band:point.band, earfcn:point.earfcn, thresholdDbm:-105,
      ...(otherBand ? {otherBandTargetId:otherBand.targetId} : {})};
  }
}

/** Pre-shortlist callers can still retrieve their original rule-selected comparison. */
function buildCoverageComparison(targets, links, review) {
  const grids = targets.filter(target => target.kind === 'mdt-grid');
  const byId = new Map(grids.map(target => [target.id, target]));
  const metric = (target, label) => target.metrics.find(row => row.label === label)?.value;
  const tail = target => metric(target, 'RSRP ≤-105 dBm');
  const samples = target => metric(target, '측정 수');
  const eligible = target => target && Number.isFinite(tail(target)) && samples(target) >= 30;
  const candidates = (review?.priorities ?? []).filter(row => row.category === 'coverage')
    .flatMap(row => row.targetIds).map(id => byId.get(id)).filter(eligible);
  for (const primary of candidates) {
    const neighbours = [];
    for (const [a, b, , distanceM] of links) {
      const peer = byId.get(a === primary.id ? b : b === primary.id ? a : '');
      if (!eligible(peer) || distanceM !== 25 || peer.earfcn !== primary.earfcn ||
          peer.band !== primary.band || peer.sourceDates[0] !== primary.sourceDates[0] || tail(peer) >= tail(primary)) continue;
      neighbours.push(peer);
    }
    // Among adequately sampled adjacent cells show the largest observed contrast.
    neighbours.sort((a,b) => tail(a)-tail(b) || samples(b)-samples(a) || a.id.localeCompare(b.id));
    if (!neighbours.length) continue;
    const otherBand = grids.filter(other => eligible(other) && other.band !== primary.band &&
      other.mapPoints[0]?.pot === primary.mapPoints[0]?.pot && other.sourceDates[0] === primary.sourceDates[0])
      .sort((a,b) => samples(b)-samples(a) || a.id.localeCompare(b.id))[0];
    return {primaryTargetId:primary.id,comparisonTargetId:neighbours[0].id,distanceM:25,
      sourceDate:primary.sourceDates[0],band:primary.band,earfcn:primary.earfcn,thresholdDbm:-105,
      ...(otherBand ? {otherBandTargetId:otherBand.id} : {})};
  }
  return undefined;
}
module.exports = {buildCoverageComparison, comparisonExample};
