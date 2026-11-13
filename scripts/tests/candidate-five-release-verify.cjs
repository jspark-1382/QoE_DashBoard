/* eslint-disable @typescript-eslint/no-require-imports -- Node release acceptance CLI. */
/* Candidate 23 release acceptance. Only generate-once can submit a job. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { validateCandidateReport } = require('../qwen-candidate-client.cjs');
const { createCandidateHistoryStore } = require('../qwen-candidate-history.cjs');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'outputs/five-category-release');
const origin = new URL(process.env.QOE_QA_ORIGIN || 'http://127.0.0.1:3017');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname), 'Use a local preview');
const versions = { evidence: 'candidate-evidence-v7', prompt: 'candidate-prompt-v10', sop: 'candidate-sop-draft-v7' };
const categories = ['coverage', 'capacity', 'interference', 'mobility', 'equipment'];
const archived = require('../../outputs/candidate-five-causes/candidate-23-job.json');
const target = archived.target;
assert.equal(archived.evidence.candidate.title, '후보 지역 23');
assert.deepEqual(target, {
  kind: 'candidate', candidateId: 'spatial-74cf136978399144', sourceRevision: 'da0b8405340fe0ea2459',
  scope: { dateStart: '2026-10-26', dateEnd: '2026-10-30', from: '00:00', to: '23:59' },
  candidateScope: { scopeKey: 'mixed-full-full-fcf5cbdfa9398ac1ef24', policy: 'strict-3-site-v1', analysisMode: 'all', locationMode: 'gps-mdt-rough-unvalidated-v1', modelId: 'dbscan' },
});

const file = name => path.join(output, name + '.json');
const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
const save = (name, value, exclusive = false) => fs.writeFileSync(file(name), JSON.stringify(value, null, 2), { flag: exclusive ? 'wx' : 'w' });
const digest = value => createHash('sha256').update(value).digest('hex');
const ids = history => history.jobs.map(row => row.id);
async function api(route, body) {
  const response = await fetch(new URL('/qoe/api/analysis/' + route, origin), {
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(90000), redirect: 'error',
  });
  const value = await response.json();
  assert(response.ok, route + ' HTTP ' + response.status + ': ' + JSON.stringify(value).slice(0,1000));
  return value;
}
function verifyInput(input) {
  assert.deepEqual(input.versions, versions);
  assert.deepEqual(input.scope, target.scope);
  assert.equal(input.candidate.algorithm, 'DBSCAN');
  assert.deepEqual(input.causeAssessments.map(row => row.category), categories);
}
async function sameCandidateHistory() {
  const history = await api('candidate-history', target);
  assert.deepEqual(history.target, target);
  assert.equal(history.limit, 3);
  assert.equal(history.jobs.length, 3, 'Three existing saved analyses are required to witness actual eviction');
  assert.equal(new Set(ids(history)).size, 3);
  for (const row of history.jobs) {
    assert.deepEqual(row.target, target);
    assert.equal(row.status, 'completed');
    assert.equal(row.persistence?.status, 'saved');
  }
  return history;
}
async function prepare() {
  const before = await sameCandidateHistory();
  const draft = await api('candidate-prompt', target);
  assert.deepEqual(draft.target, target);
  verifyInput(JSON.parse(draft.user));
  // A repeated read-only preflight must never replace the baseline after evicting a report.
  if (fs.existsSync(file('history-before'))) assert.deepEqual(ids(read('history-before')), ids(before));
  else save('history-before', before, true);
  return { before: ids(before), versions, draftFingerprint: draft.fingerprint, target };
}
async function generateOnce() {
  const prepared = await prepare();
  const startedAt = new Date().toISOString();
  // Reserve before the network operation. A timeout or interrupted caller cannot submit again.
  save('generation-reservation', { origin: origin.origin, startedAt, before: prepared.before, target }, true);
  const job = await api('jobs', { ...target, rerun: true });
  assert(job.id && !prepared.before.includes(job.id), 'Server must return a new job ID');
  save('generation-receipt', { id: job.id, startedAt, origin: origin.origin, initialStatus: job.status, reused: job.reused }, true);
  assert.equal(job.reused, false, 'The creation request must not attach to another active job');
  console.log('New Qwen job', job.id);
  return collect();
}
async function collect() {
  const receipt = read('generation-receipt');
  const server = read('generation-reservation');
  assert.equal(receipt.origin, origin.origin, 'Poll the preview that accepted this job');
  assert.equal(server.startedAt, receipt.startedAt);
  assert.equal(receipt.reused, false);
  const route = 'jobs/' + encodeURIComponent(receipt.id);
  const deadline = Date.now() + 10 * 60 * 1000;
  let job;
  do {
    job = await api(route);
    if (!['queued', 'collecting', 'analyzing'].includes(job.status)) break;
    await delay(1500);
  } while (Date.now() < deadline);
  save('candidate-23-job', job);
  const diagnostics = await api(route + '/diagnostics');
  save('candidate-23-diagnostics', diagnostics);
  assert.equal(job.status, 'completed', JSON.stringify(job.error || job.status));
  return verify();
}
function verifyGrid(evidence) {
  const pair = evidence.coverageComparison;
  assert(pair, 'source-backed 25 m POT pair');
  assert.equal(Number(pair.earfcn), 3743);
  assert.equal(Number(pair.band), 900);
  assert.equal(pair.sourceDate, '2026-11-03');
  assert.equal(pair.thresholdDbm, -105);
  assert(Math.abs(pair.distanceM - 25) < 1);
  const expected = [
    [pair.primaryTargetId, '38507_77751', 268, 55.60, 48.51],
    [pair.comparisonTargetId, '38507_77752', 219, 7.31, 0.91],
  ];
  for (const [id, pot, count, below100, below105] of expected) {
    const row = evidence.analysisTargets.find(row => row.id === id);
    assert(row, 'public target ' + id);
    assert.equal(row.mapPoints[0].pot, pot);
    assert.equal(Number(row.earfcn), 3743);
    assert.deepEqual(row.sourceDates, [pair.sourceDate]);
    for (const [label, value] of [['측정 수', count], ['RSRP ≤-100 dBm', below100], ['RSRP ≤-105 dBm', below105]]) {
      assert.equal(row.metrics.find(metric => metric.label === label)?.value, value, pot + ' ' + label);
    }
  }
  const other = evidence.analysisTargets.find(row => row.id === pair.otherBandTargetId);
  assert.equal(other?.mapPoints[0].pot, '38507_77751');
  assert.equal(Number(other.earfcn), 1550);
  assert.deepEqual(other.sourceDates, [pair.sourceDate]);
  assert.equal(other.metrics.find(row => row.label === 'RSRP ≤-105 dBm')?.value, 4.68);
  return expected.map(([id, pot, count, below100, below105]) => ({ id, pot, count, below100, below105 }));
}
function verifyCallSources(evidence) {
  const { totalCalls, evaluatedCalls, poorCalls, normalRadioCalls } = evidence.capacityComparison;
  assert.deepEqual([totalCalls, evaluatedCalls, poorCalls, normalRadioCalls], [288, 205, 3, 2]);
  const byId = new Map(evidence.analysisTargets.map(row => [row.id, row]));
  const calls = new Map(evidence.calls.map(row => [row.id, row]));
  const byCategory = category => evidence.causeAssessments.find(row => row.category === category).targetIds.map(id => byId.get(id));
  const overlap = byCategory('interference').find(row => row.callIds.some(id => calls.get(id)?.start === '08:48:45'))?.criteria.overlap;
  assert.equal(overlap?.status, 'matched');
  const reports = overlap.a3Reports;
  assert.deepEqual(reports.map(row => row.servingPci), [77, 139, 77, 139, 77]);
  assert(reports.every(row => Number(row.earfcn) === 3743 && row.triggerEvent === 'A3'));
  assert(reports[0].at.includes('08:49:01.675') && reports.at(-1).at.includes('08:49:10.794'));
  assert.deepEqual([Math.min(...reports.map(row => row.rsrp)), Math.max(...reports.map(row => row.rsrp))], [-99, -97]);
  assert.deepEqual([Math.min(...reports.map(row => row.rsrq)), Math.max(...reports.map(row => row.rsrq))], [-18.5, -15.5]);
  const transitionTarget = byCategory('mobility').find(row => row.callIds.some(id => calls.get(id)?.start === '11:18:11'));
  const mobility = transitionTarget?.criteria.frequencyChange;
  assert.equal(mobility?.status, 'matched');
  assert.deepEqual(mobility.window.events.map(row => [Number(row.earfcn), row.servingPci, row.rsrp]), [[1694, 139, -101], [1550, 389, -70]]);
  assert(mobility.window.startedAt.includes('11:19:56.998') && mobility.window.endedAt.includes('11:19:57.084'));
  const transitionCall = calls.get(transitionTarget.callIds[0]);
  assert.equal(Number(transitionCall.mos.toFixed(2)), 2.53);
  assert.equal(transitionCall.isDrop, false);
  const dropped = byCategory('equipment').find(row => row.kind === 'termination-group' && row.observation.includes('102^RTP timeout') && row.observation.includes('Rx_RTP_middle_Loss'));
  assert(dropped, 'linked RTP timeout group');
  const dropCalls = dropped.callIds.map(id => calls.get(id));
  assert(dropCalls.every(row => row.isDrop && row.id !== transitionCall.id));
  assert.deepEqual(dropCalls.map(row => [row.date, row.start, row.rtp.rxLossCount]).sort(), [
    ['2026-10-28', '11:31:03', 143], ['2026-10-30', '12:42:30', 100],
  ]);
  return { comparisonCalls: totalCalls, evaluatedCalls, poorCalls, normalRadioCalls, sameCarrierA3Reports: reports.length,
    transition: [mobility.window.startedAt, mobility.window.endedAt], dropCallCount: dropCalls.length };
}
async function source() {
  const { collectCandidateEvidence } = require('../qwen-candidate-evidence.cjs');
  const { publicCandidateEvidence } = require('../qwen-candidate-public-evidence.cjs');
  const publicDir = path.join(root, 'public');
  const index = JSON.parse(fs.readFileSync(path.join(publicDir, 'voice-query-index.json'), 'utf8'));
  const data = collectCandidateEvidence({ publicDir, dbPath: path.resolve(root, index.database), sourceRevision: target.sourceRevision, target });
  verifyInput(data.modelInput);
  const evidence = publicCandidateEvidence(data);
  return { versions: evidence.versions, verifiedGrid: verifyGrid(evidence), callSources: verifyCallSources(evidence), target };
}
async function verify() {
  const receipt = read('generation-receipt');
  const capture = read('candidate-23-job');
  const capturedDiagnostics = read('candidate-23-diagnostics');
  const before = read('history-before');
  assert.deepEqual(ids(before), read('generation-reservation').before);
  assert.equal(capture.id, receipt.id);
  assert(!ids(before).includes(capture.id));
  assert.deepEqual(capture.target, target);
  assert.equal(capture.status, 'completed');
  assert.equal(capture.persistence.status, 'saved');
  assert.equal(capture.modelVerification.responseModelVerified, true);
  assert.match(capture.model, /qwen/i);
  assert.equal(capture.model, capture.modelVerification.responseModel);
  const evidence = capture.evidence;
  assert.deepEqual(evidence.versions, versions);
  assert.deepEqual(evidence.causeAssessments.map(row => row.category), categories);
  assert.equal(evidence.causeAssessments.find(row => row.category === 'capacity').status, 'insufficient');
  const pair = verifyGrid(evidence);
  const callSources = verifyCallSources(evidence);
  const route = 'jobs/' + encodeURIComponent(capture.id);
  const [history, restoredJob, diagnostics] = await Promise.all([sameCandidateHistory(), api(route), api(route + '/diagnostics')]);
  const expectedIds = [capture.id, ...ids(before).slice(0, 2)];
  assert.deepEqual(ids(history), expectedIds);
  assert.deepEqual(restoredJob.report, capture.report);
  assert.deepEqual(history.jobs[0].report, capture.report);
  assert.equal(history.jobs[0].currentConditionsMatch, true);
  const durable = createCandidateHistoryStore(root).list(target);
  assert.deepEqual(durable.map(item => item.job.id), expectedIds);
  for (const earlier of before.jobs.slice(0, 2)) {
    assert.deepEqual(history.jobs.find(job => job.id === earlier.id).report, earlier.report);
    assert.deepEqual(durable.find(item => item.job.id === earlier.id).job.report, earlier.report);
  }
  assert.deepEqual(diagnostics.request, capturedDiagnostics.request);
  assert.deepEqual(diagnostics.response, capturedDiagnostics.response);
  assert.deepEqual(diagnostics.attempts, capturedDiagnostics.attempts);
  assert.deepEqual(durable[0].diagnostics.response, capturedDiagnostics.response);
  assert.equal(diagnostics.validation.status, 'passed');
  const final = diagnostics.attempts?.at(-1) || diagnostics;
  assert.equal(final.response.model, capture.model);
  const original = final.response.content.trim();
  const fenced = original.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const input = JSON.parse(final.request.messages.find(message => message.role === 'user').content);
  verifyInput(input);
  const report = validateCandidateReport(JSON.parse(fenced ? fenced[1] : original), { ...evidence, modelInput: input });
  assert.deepEqual(report, capture.report);
  assert(report.investigations.length > 0);
  assert(report.hypotheses.every(row => categories.includes(row.category)));
  const draft = await api('candidate-prompt', target);
  verifyInput(JSON.parse(draft.user));
  save('candidate-23-history', history);
  return {
    jobId: capture.id, target, versions, model: capture.model, submittedJobs: 1,
    modelAttempts: diagnostics.attempts?.length || 1, modelResponseSha256: digest(final.response.content),
    sourceCategories: evidence.causeAssessments.map(row => ({ category: row.category, status: row.status })),
    reportedHypotheses: report.hypotheses.map(row => ({ category: row.category, assessment: row.assessment })),
    verifiedGrid: pair, callSources, restoredHistory: expectedIds, evicted: before.jobs[2].id,
  };
}
if (require.main === module) {
  const command = process.argv[2];
  const commands = { source, prepare, 'generate-once': generateOnce, collect, verify };
  if (!Object.hasOwn(commands, command)) throw Error('Expected source, prepare, generate-once, collect, or verify');
  fs.mkdirSync(output, { recursive: true });
  const summary = 'verification-' + command + '-' + origin.port;
  commands[command]().then(result => {
    save(summary, { status: 'passed', origin: origin.origin, at: new Date().toISOString(), ...result });
    console.log(JSON.stringify(result));
  }).catch(error => {
    save(summary, { status: 'failed', origin: origin.origin, at: new Date().toISOString(), error: error.message });
    console.error(error);
    process.exitCode = 1;
  });
}
module.exports = { root, output, target, categories, versions, read, origin, verifyInput };
