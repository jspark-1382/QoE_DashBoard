/* eslint-disable @typescript-eslint/no-require-imports -- Uses the repository's CommonJS TypeScript test loader. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load } = require('../analyst-ts-loader.cjs');

function api() {
  assert.ok(fs.existsSync('lib/analyst/candidate-ai-selections.ts'), 'AI-selected findings helper must exist');
  return load('lib/analyst/candidate-ai-selections.ts');
}
function fixture() {
  const target = {
    kind: 'candidate', candidateId: 'candidate-23', sourceRevision: 'revision',
    scope: { dateStart: '2026-10-26', dateEnd: '2026-10-30', from: '00:00', to: '23:59' },
    candidateScope: { scopeKey: 'scope', policy: 'strict-3-site-v1', analysisMode: 'all', locationMode: 'gps-mdt-rough-unvalidated-v1', modelId: 'dbscan' },
  };
  const procedure = (id, targetKind, evidenceId) => ({
    id, targetKind, title: id, purpose: '원본 확인', reason: '관측 대조', materials: ['원본'],
    method: ['동일 대상 확인'], outcomes: ['확인 후 조치'], additionalData: [],
    evidenceIds: [evidenceId], checkNow: [id + ' 점검'],
    conditionalActions: [{ when: '해당 관측이 확인되면', action: id + ' 조건부 조치' }],
    verifyAfter: ['동일 대상 재측정'],
  });
  const grid = {
    id: 'MDT_A', kind: 'mdt-grid', title: '38507_77757 · 900', observation: 'RSRP 기준 이하 분포',
    sourceDates: ['2026-11-03'], band: '900', earfcn: '3743', metrics: [{ label: 'RSRP ≤-105 dBm', value: 11.16, unit: '%' }, { label: 'RSRP ≤-110 dBm', value: 2.85, unit: '%' }],
    evidenceIds: ['T01'], sopIds: ['MDT_COVERAGE', 'MDT_INTERFERENCE'], callIds: [],
    mapPoints: [{ pot: '38507_77757', lat: 37.493938, lon: 127.077901, band: '900', date: '2026-11-03' }],
    limitations: [],
  };
  const term = {
    id: 'TERM_A', kind: 'termination-group', title: 'FC 9563', observation: 'BYE RTP timeout',
    sourceDates: ['2026-10-28'], band: null, earfcn: null, metrics: [],
    evidenceIds: ['T02'], sopIds: ['SIP_REVIEW'], callIds: ['drop-a'], mapPoints: [], limitations: [],
  };
  const unselected = {
    ...grid, id: 'MDT_OTHER', title: '38507_77758 · 900', evidenceIds: ['T03'],
    mapPoints: [{ ...grid.mapPoints[0], pot: '38507_77758', lat: 37.494163 }],
  };
  const hypotheses = [
    { category: 'equipment', title: '실제 AI가 선택한 종료 원인', assessment: 'possible', reason: '실제 AI 원문: RTP timeout 종료 관측', supportingEvidenceIds: ['T02'], missingEvidence: '최초 중단 구간', sopIds: ['SIP_REVIEW'], targetIds: ['TERM_A'] },
    { category: 'coverage', title: '실제 AI가 선택한 국소 음영', assessment: 'supported', reason: '실제 AI 원문: RSRP 기준 이하 분포 확인', supportingEvidenceIds: ['T01'], missingEvidence: '독립 실측', sopIds: ['MDT_COVERAGE'], targetIds: ['MDT_A'] },
  ];
  return {
    id: 'job-current', target, status: 'completed', createdAt: '2026-11-12T00:00:00Z', updatedAt: '2026-11-12T00:01:00Z', model: 'test-model',
    evidence: {
      schemaVersion: 'qwen-candidate-evidence-v2', target, sourceRevision: 'revision', generatedAt: '2026-11-12T00:00:00Z', fingerprint: 'f',
      versions: { evidence: 'candidate-evidence-v3', prompt: 'candidate-prompt-v5', sop: 'candidate-sop-draft-v4' },
      analysisTargets: [grid, term, unselected],
      facts: [{ id: 'T01', title: 'MDT', detail: '분포' }, { id: 'T02', title: '종료', detail: 'timeout' }, { id: 'T03', title: 'MDT', detail: '분포' }],
      sop: { version: 'candidate-sop-draft-v4', templates: [procedure('MDT_COVERAGE', 'radio', 'T01'), procedure('MDT_INTERFERENCE', 'radio', 'T01'), procedure('SIP_REVIEW', 'drop', 'T02')] },
    },
    report: {
      summary: { observed: '실제 관측', priority: '선정 대상', missing: '추가 실측' }, observations: [{ text: '관측', evidenceIds: ['T01'] }],
      hypotheses, checks: [{ action: '확인', reason: '근거 대조', evidenceIds: ['T01'] }], limitations: ['실측 확인'],
      sop: [{ sopId: 'MDT_COVERAGE', reason: '연결', evidenceIds: ['T01'] }, { sopId: 'SIP_REVIEW', reason: '연결', evidenceIds: ['T02'] }],
    },
  };
}

test('only the two actual model categories appear in original order without rewriting model prose', () => {
  const job = fixture(), findings = api().getCandidateSelectedFindings(job);
  assert.deepEqual(findings.map(f => f.category), ['equipment', 'coverage']);
  assert.equal(findings.length, 2);
  assert.equal(findings[0].hypothesis, job.report.hypotheses[0]);
  assert.equal(findings[1].hypothesis.reason, job.report.hypotheses[1].reason);
  assert.deepEqual(findings[1].targets.map(t => t.id), ['MDT_A']);
  assert.deepEqual(findings[0].templates.map(t => t.id), ['SIP_REVIEW']);
  assert.deepEqual(findings[1].templates.map(t => t.id), ['MDT_COVERAGE']);
});
test('no selected hypothesis creates no default coverage or five empty cause categories', () => {
  const job = fixture(); job.report.hypotheses = []; job.report.sop = [];
  assert.deepEqual(api().getCandidateSelectedFindings(job), []);
  assert.deepEqual(api().getCandidateSelectedFindings(null), []);
  assert.deepEqual(api().getCandidateSelectedFindings(undefined), []);
});
test('insufficient hypotheses are not promoted to selected causes', () => {
  const job = fixture(); job.report.hypotheses[0].assessment = 'insufficient';
  assert.deepEqual(api().getCandidateSelectedFindings(job).map(f => f.category), ['coverage']);
});
test('pending, collecting, failed and cancelled jobs never expose prior or provisional causes', () => {
  for (const status of ['queued', 'collecting', 'analyzing', 'failed', 'cancelled']) {
    const job = fixture(); job.status = status;
    assert.deepEqual(api().getCandidateSelectedFindings(job), [], status);
  }
});
test('old prompts and absent or unknown categories cannot become current model selections', () => {
  let job = fixture(); job.evidence.versions.prompt = 'candidate-prompt-v3';
  assert.deepEqual(api().getCandidateSelectedFindings(job), []);
  job = fixture(); delete job.report.hypotheses[0].category;
  assert.deepEqual(api().getCandidateSelectedFindings(job), []);
  job = fixture(); job.report.hypotheses[0].category = 'invented';
  assert.deepEqual(api().getCandidateSelectedFindings(job), []);
});
test('a selected termination cause remains unlocated and never acquires another target POT', () => {
  const finding = api().getCandidateSelectedFindings(fixture())[0];
  assert.equal(finding.targets[0].kind, 'termination-group');
  assert.deepEqual(finding.targets[0].mapPoints, []);
  assert.deepEqual(api().getFindingPotIds([finding]), []);
});
test('a hypothesis cannot borrow an unrelated allowed SOP from a different target', () => {
  const job = fixture(); job.report.hypotheses[0].sopIds = ['MDT_COVERAGE'];
  job.report.sop = [{ sopId: 'MDT_COVERAGE', reason: '연결', evidenceIds: ['T01'] }];
  assert.ok(api().getCandidateSelectedFindings(job).every(f => f.category !== 'equipment'));
});
test('a hypothesis cannot borrow an unrelated observation reference', () => {
  const job = fixture(); job.report.hypotheses[0].supportingEvidenceIds = ['T03'];
  assert.ok(api().getCandidateSelectedFindings(job).every(f => f.category !== 'equipment'));
});
test('only real selected map points are deduplicated, never all context POTs', () => {
  const job = fixture();
  job.evidence.analysisTargets[0].mapPoints.push({ ...job.evidence.analysisTargets[0].mapPoints[0] });
  const findings = api().getCandidateSelectedFindings(job);
  assert.deepEqual(api().getFindingPotIds(findings), ['38507_77757']);
  assert.ok(!api().getFindingPotIds(findings).includes('38507_77758'));
});
test('unknown target references cannot acquire an arbitrary existing target', () => {
  const job = fixture(); job.report.hypotheses[0].targetIds = ['UNKNOWN_TARGET'];
  assert.deepEqual(api().getCandidateSelectedFindings(job), []);
});
test('duplicate public target IDs are rejected instead of selecting the last duplicate', () => {
  const job = fixture();
  job.evidence.analysisTargets.push({ ...job.evidence.analysisTargets[0], mapPoints: [{ pot: 'fake-other-location', lat: 1, lon: 1 }] });
  assert.deepEqual(api().getCandidateSelectedFindings(job), []);
});
test('selection IDs are stable and deriving findings does not mutate the verified job', () => {
  const job = fixture(), snapshot = structuredClone(job);
  const freeze = value => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } };
  freeze(job);
  const first = api().getCandidateSelectedFindings(job), second = api().getCandidateSelectedFindings(job);
  assert.deepEqual(first.map(f => f.id), second.map(f => f.id));
  assert.equal(new Set(first.map(f => f.id)).size, first.length);
  assert.deepEqual(job, snapshot);
});

test('every selected target has at least one linked procedure instead of an empty third stage', () => {
  const job = fixture(), original = job.evidence.analysisTargets.find(t => t.kind === 'termination-group');
  const procedure = job.evidence.sop.templates.find(s => s.id === original.sopIds[0]);
  const second = { ...original, id: 'TERM_SECOND', evidenceIds: ['T04'], sopIds: ['SIP_SECOND'] };
  job.evidence.analysisTargets.push(second);
  job.evidence.sop.templates.push({ ...procedure, id: 'SIP_SECOND', evidenceIds: ['T04'] });
  const hypothesis = job.report.hypotheses.find(h => h.category === 'equipment');
  hypothesis.targetIds.push(second.id);
  hypothesis.supportingEvidenceIds.push('T04');
  assert.ok(api().getCandidateSelectedFindings(job).every(f => f.category !== 'equipment'), 'Second target must not render without its own applicable procedure');
  second.sopIds = [...original.sopIds];
  const shared = api().getCandidateSelectedFindings(job).find(f => f.category === 'equipment');
  assert.equal(shared?.targets.length, 2, 'One shared procedure may cover both targets when both permit it');
});
