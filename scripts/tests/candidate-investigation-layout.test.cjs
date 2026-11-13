/* eslint-disable @typescript-eslint/no-require-imports -- Render the real dialog with the repository TypeScript loader. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { load } = require('../analyst-ts-loader.cjs');
const { fixture } = require('./fixtures/candidate-targeted-ui.cjs');

function component(file, replacements = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8').replaceAll('import.meta', '({ env: {} })'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: file })(id => {
    if (id in replacements) return replacements[id];
    if (id.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (!id.startsWith('.')) return require(id);
    const local = path.resolve(path.dirname(file), id);
    return fs.existsSync(local + '.tsx') ? component(local + '.tsx') : load(local);
  }, loaded, loaded.exports);
  return loaded.exports;
}

const { CandidateAiDialog } = component('components/analyst/candidate-ai-analysis.tsx');
const categories = ['coverage', 'interference', 'mobility', 'equipment', 'capacity'];
function saved() {
  const entry = fixture();
  const evidence = entry.job.evidence;
  // A saved five-category run retains its own headings and associations.
  evidence.versions.evidence = 'candidate-evidence-v5';
  evidence.causeAssessments = categories.map(category => ({
    category, status: 'insufficient', headline: '실측 ' + category,
    reason: '근거 ' + category, nextCheck: '확인할 자료 ' + category,
    missingEvidence: [], targetIds: [], evidenceIds: [],
  }));
  return entry;
}
function render(entry) {
  return renderToStaticMarkup(React.createElement(CandidateAiDialog, {
    target: entry.target, title: '자료 검토 후보', entry, onClose() {}, onStart() {}, onCancel() {},
  }));
}
test('empty runs show no assigned categories or priority', () => {
  const entry = saved();
  delete entry.job;
  const html = render(entry);
  assert.doesNotMatch(html, /data-source-cause="/);
  assert.match(html, /data-investigation-priority="unavailable"/);
});
test('A and B use exact saved grid percentages, dates and frequency, including a real zero', () => {
  const entry = saved(), evidence = entry.job.evidence;
  evidence.versions.evidence = 'candidate-evidence-v7';
  const grid = evidence.analysisTargets.find(t => t.kind === 'mdt-grid');
  const neighbor = structuredClone(grid);
  neighbor.id = 'independent-adjacent-grid';
  neighbor.mapPoints[0].pot = 'independent-B';
  neighbor.mapPoints[0].lat += .00022;
  neighbor.metrics.find(m => m.label.includes('-105')).value = 0;
  evidence.analysisTargets.push(neighbor);
  evidence.coverageComparison = {primaryTargetId:grid.id,comparisonTargetId:neighbor.id,
    distanceM:25,sourceDate:grid.mapPoints[0].date,band:grid.band,earfcn:grid.earfcn,thresholdDbm:-105};
  Object.assign(evidence.causeAssessments[0], {status:'criteria-met',targetIds:[grid.id,neighbor.id],evidenceIds:grid.evidenceIds});
  let html = render(entry);
  assert.match(html, /data-map-target-role="primary"/);
  assert.match(html, /data-map-target-role="comparison" data-pot-id="independent-B" data-weak-percent="0"/);
  assert.match(html, />0.00%<\/strong>/);
  let mapProps;
  const { PotInvestigationContent } = component('components/analyst/candidate-pot-workspace.tsx', {
    './candidate-investigation-map': { CandidateInvestigationMap: props => { mapProps = props; return null; } },
  });
  renderToStaticMarkup(React.createElement(PotInvestigationContent, {
    entry, context: {grid:{measurementDates:[grid.mapPoints[0].date],cellSizeM:25},pots:[],stations:[]},
    investigationSelection:{targetId:neighbor.id,selection:1,source:'criteria',category:'coverage'},
  }));
  assert.equal(mapProps.selectedPot, neighbor.mapPoints[0].pot);
  assert.equal(mapProps.primaryPot, grid.mapPoints[0].pot);
  assert.equal(mapProps.comparisonPot, neighbor.mapPoints[0].pot);
  neighbor.mapPoints[0].date = '2026-11-04';
  html = render(entry);
  assert.doesNotMatch(html, /data-map-target-role="comparison"/);
});
test('normal dialog mounts map before result panel, five collapsed source rows, and prompt controls', () => {
  const html = render(saved());
  assert.ok(html.includes('data-map-panel='));
  assert.ok(html.indexOf('data-map-panel=') < html.indexOf('data-results-panel='));
  const rows = [...html.matchAll(/<details\b([^>]*\bdata-source-cause="([^"]+)"[^>]*)>/g)];
  assert.deepEqual(rows.map(([, , category]) => category), categories);
  const allCauses = html.match(/<details\b([^>]*data-cause-evidence-fold[^>]*)>/);
  assert.ok(allCauses, 'all categories have a single default-collapsed parent');
  assert.doesNotMatch(allCauses[1], /\bopen(?:=|\s|$)/);
  assert.ok(html.indexOf('data-cause-evidence-fold') < html.indexOf('data-source-cause='));
  for (const [, attrs, category] of rows) {
    assert.doesNotMatch(attrs, /\bopen(?:=|\s|$)/);
    assert.ok(html.includes('실측 ' + category));
  }
  assert.match(html, /프롬프트 수정/);
  assert.match(html, /AI 입력·응답/);
});
test('model comparison shows its actual interpretation and next check only for a verified response with linked evidence',()=>{
  const entry=saved(), job=entry.job, evidence=job.evidence;
  evidence.versions={evidence:'candidate-evidence-v7',prompt:'candidate-prompt-v11',sop:'candidate-sop-draft-v7'};
  evidence.sop.version=evidence.versions.sop;
  job.model='qwen-unit'; job.modelVerification={responseModel:'qwen-unit',responseModelVerified:true};
  job.report.hypotheses=[]; job.report.sop=[];
  const [grid,end]=evidence.analysisTargets;
  for(const [target,id,category] of [[grid,'T01','coverage'],[end,'T02','equipment']]){
    const fact=evidence.facts.find(f=>target.evidenceIds.includes(f.id));
    assert.ok(fact);
    fact.id=id; target.evidenceIds=[id];
    Object.assign(evidence.causeAssessments.find(row=>row.category===category),{status:'possible',targetIds:[target.id],evidenceIds:[id]});
  }
  job.report.comparison={schemaVersion:'cause-comparison-v1',assessment:'prioritize',
    primary:{category:'coverage',evidenceIds:['T01']},alternative:{category:'equipment',evidenceIds:['T02']},
    interpretation:'모델이 비교한 현장 신호와 종료 기록의 차이입니다.',
    limitation:'종료 기록에는 동시간대 신호가 없습니다.',nextCheck:'같은 통화에서 신호와 RTP 중단 시각을 대조합니다.'};
  evidence.comparisonReading={primary:{category:'coverage',evidenceIds:['T01']},alternative:{category:'equipment',evidenceIds:['T02']},
    text:'DL 약전계 기준 관측 2/5통화 · RTP 중단 사유 1/3통화'};
  const html=render(entry);
  assert.match(html,/data-ai-comparison="verified"/);
  assert(html.includes(job.report.comparison.interpretation));
  assert(html.includes(job.report.comparison.nextCheck));
  assert(html.includes('data-comparison-reading') && html.includes(evidence.comparisonReading.text));
  const mismatched=structuredClone(entry);
  mismatched.job.evidence.comparisonReading.alternative.evidenceIds=['T99'];
  assert.doesNotMatch(render(mismatched),/data-comparison-reading=/);
  assert.match(html,/data-comparison-source-id="T01"/);
  assert.match(html,/data-comparison-source-id="T02"/);
  const compact=structuredClone(entry);
  Object.assign(compact.job.report,{mode:'comparison-only',investigations:[],hypotheses:[],checks:[],sop:[],limitations:[],observations:[]});
  const compactHtml=render(compact);
  assert.match(compactHtml,/비교 해석 완료 · 전체 보고서 미확보/);
  assert.match(compactHtml,/data-ai-comparison="verified"/);
  assert.match(compactHtml,/data-map-panel=/);
  assert.match(compactHtml,/data-summary-disclosure="ai"/);
  assert.doesNotMatch(compactHtml,/data-summary-disclosure="evidence"|후보 전체 AI 보고서·통화 근거|data-analysis-stage=/);
  for(const bad of [
    j=>{j.modelVerification.responseModelVerified=false;},
    j=>{j.modelVerification.responseModel='another-model';},
    j=>{j.report.comparison.primary.evidenceIds=['T404'];},
    j=>{j.report.comparison.alternative.category='coverage';},
    j=>{j.report.comparison.primary.evidenceIds=['T02'];},
    j=>{j.report.comparison.alternative=null;},
  ]){
    const copy=structuredClone(entry); bad(copy.job);
    assert.doesNotMatch(render(copy),/data-ai-comparison="verified"/);
  }
  job.report.comparison.alternative=null; job.report.comparison.assessment='unresolved';
  const single=render(entry);
  assert.match(single,/data-ai-comparison="verified"/);
  assert.doesNotMatch(single,/data-comparison-reading=/);
  delete job.report.comparison;
  evidence.versions.prompt='candidate-prompt-v10';
  const archived=render(entry);
  assert.match(archived,/data-ai-comparison="archived"/);
  assert.doesNotMatch(archived,/data-comparison-interpretation=/);
});

test('four-category history preserves the stored UL category and never invents a capacity result', () => {
  const entry = saved(), evidence = entry.job.evidence;
  evidence.versions.evidence = 'candidate-evidence-v6';
  evidence.causeAssessments = ['coverage','uplink','interference','equipment'].map(category => ({
    category, status: 'insufficient', reason: category + ' 근거', nextCheck: category + ' 재확인',
    missingEvidence: [], targetIds: [], evidenceIds: [],
  }));
  const html = render(entry);
  assert.match(html, /data-source-cause="uplink"/);
  assert.doesNotMatch(html, /data-source-cause="capacity"/);
  assert.match(html, /저장 당시 4개 분류/);
});

test('the representative coverage comparison leads the dialog and the separate Qwen call procedure is collapsed', () => {
  const entry = saved(), e = entry.job.evidence;
  const grid = e.analysisTargets[0], call = e.analysisTargets[1];
  e.versions.evidence = 'candidate-evidence-v7';
  const reference = structuredClone(grid);
  reference.id = 'adjacent'; reference.mapPoints[0].pot = 'adjacent-POT';
  reference.mapPoints[0].lat += .00022;
  reference.metrics.find(m => m.label.includes('-105')).value = 0;
  const other = structuredClone(grid);
  other.id = 'another'; other.mapPoints[0].pot = 'another-POT';
  other.band = other.mapPoints[0].band = '2.1'; other.earfcn = '475';
  for (const t of [grid,reference,other]) t.metrics.find(m => m.label.includes('-105')).label = 'RSRP ≤-105 dBm';
  e.analysisTargets.push(reference,other);
  e.neighbourLinks = [[grid.id,reference.id,'N',25]];
  e.coverageComparison = {primaryTargetId:grid.id,comparisonTargetId:reference.id,
    distanceM:25,sourceDate:grid.mapPoints[0].date,band:grid.band,earfcn:grid.earfcn,thresholdDbm:-105};
  e.coveragePoints = {reviewedCombinations:3,qualifiedCombinations:2,qualifiedPotCount:2,areaCount:2,
    points:[grid,other].map((t,i)=>({rank:i+1,targetId:t.id,pot:t.mapPoints[0].pot,sourceDate:t.sourceDates[0],
      band:t.band,earfcn:t.earfcn,areaSize:1,reason:'해당 격자의 원본 측정 분포',comparisons:i?[]:[{kind:'adjacent-same-carrier',targetId:reference.id,distanceM:25}]}))};
  Object.assign(e.causeAssessments[0], {headline:'단일 대역 저장 제목',status:'criteria-met',targetIds:[grid.id],evidenceIds:grid.evidenceIds});
  e.calls.find(c=>c.id==='drop-only').href='/?call=drop-only';
  entry.job.report.hypotheses=[]; entry.job.report.sop=[];
  entry.job.report.investigations=[{title:'원본 종료 통화 먼저 대조',reason:'송수신 기록 확인',nextCheck:'BYE 시각 대조',
    targetIds:[call.id],evidenceIds:call.evidenceIds}];
  const html=render(entry);
  assert.match(html,/data-representative-cause="coverage"/);
  assert.match(html,/data-priority-source="source"/);
  const { CandidateCauseAssessments } = component('components/analyst/candidate-investigation-list.tsx');
  const lookup = load('lib/analyst/candidate-representative-cause.ts');
  const renderSelected = (target,role) => renderToStaticMarkup(React.createElement(CandidateCauseAssessments,{
    job:entry.job, selectedTargetId:target.id, selectedGrid:lookup.getCandidateSelectedGrid(target,role,-105),
  }));
  const atSurvey=renderSelected(grid,'survey'), atNeighbor=renderSelected(reference,'comparison');
  const representativeSection = text => text.match(/<section[^>]* data-representative-cause=[\s\S]*?<\/section>/)[0];
  assert.equal(representativeSection(atSurvey),representativeSection(atNeighbor));
  const neighborSection=atNeighbor.match(/<section[^>]* data-selected-pot-result="adjacent-POT"[\s\S]*?<\/section>/)[0];
  assert.match(neighborSection,/data-selected-pot-role="comparison"/);
  assert.match(neighborSection,/data-contrast-value="survey">0.00%/);
  assert.ok(neighborSection.includes(grid.sourceDates[0]));
  assert.ok(neighborSection.includes('EARFCN ' + reference.earfcn));
  assert.doesNotMatch(html.match(/<h3 data-representative-title[^>]*>(.*?)<\/h3>/)[1],/원본 종료 통화 먼저 대조/);
  const procedure=html.match(/<details([^>]*data-investigation-procedure[^>]*)>([\s\S]+?)<\/details>/);
  assert.ok(procedure);
  assert.doesNotMatch(procedure[1],/\bopen\b/);
  assert.match(procedure[2],/원본 종료 통화 먼저 대조/);
  assert.match(procedure[2],/BYE 시각 대조/);
  assert.match(html,/data-priority-target="TG_END"/);
  assert.match(html,/data-selected-pot="38507_77751" data-selected-target="TG_MDT"/);
  assert.match(html,/data-investigation-point="TG_MDT"/);
  assert.match(html,/data-investigation-point="another"/);
  assert.doesNotMatch(html,/data-investigation-point="adjacent"/);
  assert.match(html,/조사 POT 2곳/);
  assert.match(html,/data-investigation-call="drop-only"/);
  let props;
  const {PotInvestigationContent}=component('components/analyst/candidate-pot-workspace.tsx',{
    './candidate-investigation-map':{CandidateInvestigationMap:p=>{props=p;return null;}}
  });
  renderToStaticMarkup(React.createElement(PotInvestigationContent,{entry,context:{grid:{measurementDates:['2026-11-03'],cellSizeM:25},pots:[],stations:[]}}));
  assert.deepEqual(props.investigationPoints.map(p=>p.pot),[grid.mapPoints[0].pot,'another-POT']);
  assert.equal(props.selectedPot,grid.mapPoints[0].pot);
  assert.equal(props.comparisonPot,reference.mapPoints[0].pot);
  renderToStaticMarkup(React.createElement(PotInvestigationContent,{entry,investigationSelection:{targetId:'TG_END',selection:1},context:{grid:{measurementDates:['2026-11-03'],cellSizeM:25},pots:[],stations:[]}}));
  assert.equal(props.selectedPot,'');
  entry.job.status='failed'; delete entry.job.report;
  const failed=render(entry);
  assert.match(failed,/data-priority-source="source"/);
  assert.doesNotMatch(failed,/data-priority-source="qwen"/);
  assert.match(failed,/data-investigation-point="another"/);
});
