/* eslint-disable @typescript-eslint/no-require-imports -- Render source-linked investigation UI. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server'),{load}=require('../analyst-ts-loader.cjs');
function component(file){const mod={exports:{}};const code=ts.transpileModule(fs.readFileSync(file,'utf8').split('import.meta').join('({env:{}})'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;vm.runInThisContext('(function(require,module,exports){'+code+'\n})',{filename:file})(id=>{if(id.endsWith('.css'))return{default:new Proxy({},{get:(_,key)=>String(key)})};if(!id.startsWith('.'))return require(id);const p=path.resolve(path.dirname(file),id);return fs.existsSync(p+'.tsx')?component(p+'.tsx'):load(p);},mod,mod.exports);return mod.exports;}
function fixture(){const {fixture}=require('./fixtures/candidate-targeted-ui.cjs');const entry=fixture();const evidence=entry.job.evidence;evidence.versions.evidence='candidate-evidence-v5';evidence.versions.prompt='candidate-prompt-v8';evidence.versions.sop='candidate-sop-draft-v5';evidence.sop.version='candidate-sop-draft-v5';evidence.members=[{id:'source-call',customerLabel:'고객 001',date:'2026-10-27',start:'11:23:45',qoe:2.1,mos:2.2,isDrop:false,cell:'cell',locationEvidence:'rough',href:'/?source=MDT&date=2026-10-27&call=source-call'}];evidence.calls=[];evidence.facts.push({id:'CALL_FACT',title:'동일 통화 관측',detail:'원본',severity:'attention'});evidence.analysisTargets.push({id:'CALL_TARGET',kind:'call-quality',title:'통화 품질 대조',observation:'원본 MOS·무선·RTP가 연결된 통화',sourceDates:['2026-10-27'],band:null,earfcn:null,metrics:[{label:'원본 MOS',value:2.2}],evidenceIds:['CALL_FACT'],sopIds:[],allowedCauseCategories:[],callIds:['source-call'],mapPoints:[],limitations:['RTP 단위 미확인'],investigationHint:{why:'서로 다른 지표를 같은 통화에서 대조합니다.',check:'저하 시각의 양방향 RTP를 확인합니다.'}});entry.job.report.investigations=[{title:'통화 품질과 무선의 동반 관측 확인',reason:'같은 통화에 연결된 지표여서 조사할 구간을 좁힐 수 있습니다.',nextCheck:'원본 저하 시각과 송수신 RTP 기록을 대조합니다.',targetIds:['CALL_TARGET'],evidenceIds:['CALL_FACT']}];return entry;}
const Workspace = component('components/analyst/candidate-pot-workspace.tsx').PotInvestigationContent;
const Dialog = component('components/analyst/candidate-ai-analysis.tsx').CandidateAiDialog;
const { getCandidateInvestigationPlans } = component('components/analyst/candidate-investigation-list.tsx');
const render = entry => renderToStaticMarkup(React.createElement(Workspace, {entry, investigationSelection:{targetId:'CALL_TARGET',selection:1}}));
const renderDialog = entry => renderToStaticMarkup(React.createElement(Dialog,{target:entry.target,title:'후보',entry,onClose(){},onStart(){},onCancel(){}}));
test('a selected saved investigation links its exact source call and preserves why and next check', () => {
 const html = render(fixture());
 assert.match(html,/data-analysis-source="investigations"/);
 assert.match(html,/data-investigation-target-analysis="CALL_TARGET"/);
 assert.match(html,/2026-10-27.*11:23:45/);
 assert.match(html,/href="\/qoe\/\?source=MDT&amp;date=2026-10-27&amp;call=source-call"/);
 assert.match(html,/같은 통화에 연결된 지표여서/);
 assert.match(html,/원본 저하 시각과 송수신 RTP 기록/);
 assert.match(html,/원본 MOS<\/th><td>2\.2/);
});
test('missing targets, ambiguous targets and foreign evidence cannot create source-linked investigations', () => {
 for(const alter of [e=>e.job.report.investigations[0].targetIds.push('missing'),e=>e.job.report.investigations[0].evidenceIds.push('E01'),e=>e.job.evidence.analysisTargets.push(structuredClone(e.job.evidence.analysisTargets.at(-1)))]) {
   const entry=fixture(); alter(entry);
   assert.deepEqual(getCandidateInvestigationPlans(entry.job),[]);
   assert.doesNotMatch(render(entry),/data-investigation-target-analysis="CALL_TARGET"/);
 }
});
test('a legacy report without investigations keeps its saved report available', () => {
 const entry=fixture(); delete entry.job.report.investigations;
 assert.deepEqual(getCandidateInvestigationPlans(entry.job),[]);
 assert.match(renderDialog(entry),/data-displayed-analysis="fixture-job"/);
});
test('failed Qwen retains its source notes and displays the original validation error', () => {
 const entry=fixture(); entry.job.status='failed'; delete entry.job.report;
 entry.job.error={code:'QWEN_INVALID_REPORT',message:'모델 응답 근거 오류'};
 const html=renderDialog(entry);
 assert.match(html,/QWEN_INVALID_REPORT/); assert.match(html,/모델 응답 근거 오류/);
 assert.match(html,/분류별 추가 원본 확인이 필요합니다/); assert.doesNotMatch(html,/data-cause-category=/);
});
test('pending and unsafe source links are never presented as completed investigations', () => {
 const entry=fixture(); entry.job.status='analyzing'; assert.deepEqual(getCandidateInvestigationPlans(entry.job),[]);
 entry.job.status='completed'; entry.job.evidence.members[0].href='javascript:alert(1)'; entry.job.report.investigations[0].title='<script>source</script>';
 const html=render(entry); assert.doesNotMatch(html,/href="javascript:|<script>/); assert.match(html,/&lt;script&gt;source&lt;\/script&gt;/);
});
test('the dialog puts the map before the five source disclosures and keeps model prose inspectable', () => {
 const entry=fixture();
 entry.job.evidence.analysisTargets[0].metrics.find(metric=>metric.label==='RSRP ≤ -105').label='RSRP ≤-105 dBm';
 const html=renderDialog(entry);
 assert(html.indexOf('data-map-panel=')>=0 && html.indexOf('data-map-panel=')<html.indexOf('data-results-panel='));
 assert.equal((html.match(/<details[^>]*data-source-cause="/g)||[]).length,5);
 assert(html.includes(entry.job.report.summary.observed));
});
test('recent history exposes the three actual saved runs, their dates and selected ID', () => {
 const entry=fixture(),ui=component('components/analyst/candidate-ai-analysis.tsx');
 entry.history=Array.from({length:4},(_,i)=>({...entry.job,id:'saved-'+i,updatedAt:'2026-11-0'+(4-i)+'T10:30:00Z'}));
 const html=renderToStaticMarkup(React.createElement(ui.CandidateSavedAnalysisHistory,{entry,selectedId:'saved-1',onSelect(){}}));
 assert.deepEqual([...html.matchAll(/data-saved-analysis="([^"]+)"/g)].map(m=>m[1]),['saved-0','saved-1','saved-2']);
 assert.match(html,/data-saved-analysis="saved-1" aria-pressed="true"/);
 assert.match(html,/2026-11-03T10:30:00Z/);
});
test('source metric precision and all RTP values remain inspectable without invented units',()=>{const entry=fixture(),source=entry.job.evidence.analysisTargets.at(-1);source.metrics.push(...['txPacketLoss','rxPacketLoss','txJitter','rxJitter','txLossCount','rxLossCount'].map(label=>({label,value:0.00000123})));const html=render(entry);assert.match(html,/0\.00000123/);assert.match(html,/전체 원본 측정값/);assert.match(html,/rxLossCount/);assert.doesNotMatch(html,/0\.00000123 (?:%|ms)/);});
test('an investigation-only POT opens inspection and map selection without creating a cause finding',()=>{const entry=fixture(),target=entry.job.evidence.analysisTargets[0];entry.job.report.hypotheses=[];entry.job.report.sop=[];entry.job.report.investigations=[{title:'분포 경계 조사',reason:'원본 RSRP 분포의 차이가 있어 경계를 대조합니다.',nextCheck:'같은 대역의 이웃 POT를 동시 측정합니다.',targetIds:[target.id],evidenceIds:target.evidenceIds}];const html=renderToStaticMarkup(React.createElement(component('components/analyst/candidate-pot-workspace.tsx').PotInvestigationContent,{context:null,entry}));assert.match(html,/data-ai-finding-count="0"/);assert.match(html,/data-investigation-pot-count="1"/);assert.match(html,/data-analysis-source="investigations"/);assert.match(html,/data-selected-pot="38507_77751"/);assert.match(html,/AI 조사 제안 · 원인 미확정/);assert.match(html,/같은 대역의 이웃 POT를 동시 측정/);assert.doesNotMatch(html,/data-cause-category=/);});
test('a failed rerun keeps its exact error visible above a retained saved result',()=>{const entry=fixture(),saved=structuredClone(entry.job);entry.history=[saved];entry.job={...entry.job,id:'failed-rerun',status:'failed',report:undefined,error:{code:'QWEN_INVALID_REPORT',message:'새 응답의 대상 연결 오류'}};const html=renderToStaticMarkup(React.createElement(component('components/analyst/candidate-ai-analysis.tsx').CandidateAiDialog,{target:entry.target,title:'후보',entry,onClose(){},onStart(){},onCancel(){}}));assert.match(html,/aria-label="새 분석 실패 상세"/);assert.match(html,/QWEN_INVALID_REPORT/);assert.match(html,/새 응답의 대상 연결 오류/);assert.match(html,/이전 저장 결과를 계속 표시/);assert.match(html,/data-displayed-analysis="fixture-job"/);});
test('why and next check precede the full measurement table in selected source detail', () => {
 const html=render(fixture()),panel=html.slice(html.indexOf('data-investigation-target-analysis="CALL_TARGET"'));
 const reason=panel.indexOf('같은 통화에 연결된 지표여서'),check=panel.indexOf('원본 저하 시각과 송수신 RTP 기록'),metrics=panel.indexOf('전체 원본 측정값');
 assert(reason>=0 && reason<check && check<metrics);
});
test('v10 investigation-only results are current while saved v8 results remain readable', () => {
 const {isCurrentCandidateAnalysisJob,isReadableCandidateAnalysisJob}=load(path.resolve('lib/analyst/candidate-ai-analysis.ts'));
 const entry=fixture(); entry.job.report.hypotheses=[]; entry.job.report.sop=[];
 const saved=structuredClone(entry.job);
 entry.job.evidence.versions={evidence:'candidate-evidence-v7',prompt:'candidate-prompt-v10',sop:'candidate-sop-draft-v7'};
 entry.job.evidence.sop.version=entry.job.evidence.versions.sop;
 assert.equal(isCurrentCandidateAnalysisJob(entry.job),true);
 assert.equal(isCurrentCandidateAnalysisJob(saved),false);
 assert.equal(isReadableCandidateAnalysisJob(saved),true);
});



