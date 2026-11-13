/* eslint-disable @typescript-eslint/no-require-imports -- Render actual React UI to verify automatic AI selections. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');const {load}=require('../analyst-ts-loader.cjs');
function component(file,overrides={}){const mod={exports:{}};const code=ts.transpileModule(fs.readFileSync(file,'utf8').split('import.meta').join('({env:{}})'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;vm.runInThisContext('(function(require,module,exports){'+code+'\n})',{filename:file})(id=>{if(overrides[id])return overrides[id];if(id.endsWith('.css'))return{default:new Proxy({},{get:(_,key)=>String(key)})};if(!id.startsWith('.'))return require(id);const p=path.resolve(path.dirname(file),id);return fs.existsSync(p+'.tsx')?component(p+'.tsx',overrides):load(p);},mod,mod.exports);return mod.exports;}
function fixture(){const {fixture}=require('./fixtures/candidate-targeted-ui.cjs');const entry=fixture();entry.job.evidence.versions.evidence='candidate-evidence-v7';entry.job.evidence.versions.prompt='candidate-prompt-v10';entry.job.evidence.versions.sop='candidate-sop-draft-v7';entry.job.evidence.sop.version='candidate-sop-draft-v7';entry.job.evidence.analysisTargets[0].metrics.find(m=>m.label==='RSRP ≤ -105').label='RSRP ≤-105 dBm';entry.job.report.hypotheses.forEach((h,i)=>{h.category=i?'equipment':'coverage';h.reason=i?'실제 종료 원문을 바탕으로 AI가 선택한 중단 구간':'원본 분포를 바탕으로 AI가 선택한 특정 POT 음영';});entry.job.report.investigations=entry.job.report.hypotheses.map(h=>({title:h.title,reason:h.reason,nextCheck:'해당 원본 관측을 대조합니다.',targetIds:h.targetIds,evidenceIds:h.supportingEvidenceIds}));
const a={date:'2026-11-03',band:'900',earfcn:'3743',samples:268,rsrpMean:-98.27,rsrqMean:-16.59,phrMean:null,rsrpMeanSumCnt:null,belowPct:{'-105':48.51},metricSamples:{},sourceFiles:[]};const cell=(pot,x)=>({pot,x,y:100,lat:37.486,lon:127.061,rsrp:-98,samples:268,bands:{900:[-98,268]},analysis:[a]});const context={schemaVersion:'candidate-pot-context-v1',target:entry.target,generatedAt:'2026-11-12T00:00:00Z',fingerprint:'context',candidate:{id:entry.target.candidateId,title:'후보23',center:{lat:37.486,lon:127.061},radiusM:130},grid:{status:'available',cellSizeM:25,basisPerMeter:null,measurementDates:['2026-11-03'],metricWeightBasis:'원본 집계',inputSignature:'source'},pots:[cell('not-selected',100),cell('38507_77751',125)],stations:[],stationSummary:{sourceDate:'2026-11-04',uniqueCells:0,ambiguousCells:[],missingCells:[]},limitations:[]};return{entry,context};}
const render=(f)=>renderToStaticMarkup(React.createElement(component('components/analyst/candidate-pot-workspace.tsx').PotInvestigationContent,{context:f.context,entry:f.entry}));
test('only categories selected in the real report are visible, with its first target automatic',()=>{const f=fixture(),html=render(f);assert.deepEqual([...html.matchAll(/data-cause-category="([^"]+)"/g)].map(m=>m[1]),['coverage','equipment']);assert.match(html,/data-selected-pot="38507_77751"/);assert.match(html,/원본 분포를 바탕으로 AI가 선택한 특정 POT 음영/);assert.doesNotMatch(html,/조사 POT 선택/);});
test('one selected cause is a result, not a manual five-way cause chooser',()=>{const f=fixture();f.entry.job.report.hypotheses=f.entry.job.report.hypotheses.slice(0,1);f.entry.job.report.sop=f.entry.job.report.sop.slice(0,1);const html=render(f);assert.equal((html.match(/data-cause-category=/g)||[]).length,1);assert.doesNotMatch(html,/<button[^>]*data-cause-category=/);assert.deepEqual([...html.matchAll(/data-pot-stage="(\d)"/g)].map(m=>m[1]),['1','2','3']);});
test('pending and failed jobs never substitute deterministic coverage as an AI result',()=>{for(const status of ['analyzing','failed']){const f=fixture();f.entry.job.status=status;const html=render(f);assert.doesNotMatch(html,/data-cause-category=|data-pot-stage=/);assert.doesNotMatch(html,/커버리지 부족 의심/);}});
test('empty or insufficient model findings produce no selected cause cards',()=>{for(const empty of [true,false]){const f=fixture();if(empty){f.entry.job.report.hypotheses=[];f.entry.job.report.sop=[];}else f.entry.job.report.hypotheses.forEach(h=>h.assessment='insufficient');const html=render(f);assert.doesNotMatch(html,/data-cause-category=|data-pot-stage=/);assert.match(html,/data-ai-finding-count="0"/);assert.equal((html.match(/data-source-cause=/g)||[]).length,5);}});
test('unlocated call-group finding never inherits an arbitrary first POT',()=>{const f=fixture();f.entry.job.report.hypotheses=f.entry.job.report.hypotheses.slice(1);f.entry.job.report.sop=f.entry.job.report.sop.slice(1);f.entry.job.report.investigations=f.entry.job.report.investigations.slice(1);const html=render(f);assert.match(html,/data-selected-pot=""/);assert.match(html,/POT 미연결/);assert.doesNotMatch(html,/data-selected-pot="not-selected"/);});
test('old reports without the new classification contract require a fresh analysis',()=>{const f=fixture();f.entry.job.evidence.versions.prompt='candidate-prompt-v3';f.entry.job.report.hypotheses.forEach(h=>delete h.category);const html=render(f);assert.doesNotMatch(html,/data-cause-category=|data-pot-stage=/);assert.equal(load('lib/analyst/candidate-ai-analysis.ts').isCurrentCandidateAnalysisJob(f.entry.job),false);assert.match(html,/data-ai-finding-count="0"/);});

test('candidate summary uses the same representative cause and evidence as the dialog',()=>{
 const {entry}=fixture(),{CandidateAiSummary}=component('components/analyst/candidate-ai-analysis.tsx');
 entry.job.report.hypotheses[1].assessment='insufficient';
 const summary=load('lib/analyst/candidate-representative-cause.ts').getCandidateRepresentativeCause(entry.job);
 const html=renderToStaticMarkup(React.createElement(CandidateAiSummary,{entry,onOpen(){},onStart(){},onCancel(){}}));
 assert(html.includes(summary.title));assert(html.includes(summary.summary));assert.match(html,/data-summary-representative-title/);
 assert(!html.includes(entry.job.report.investigations[1].nextCheck));
});
test('completed dialog exposes a fresh analysis and comparable latest three saved reports',()=>{const f=fixture();f.entry.history=Array.from({length:4},(_,i)=>({...structuredClone(f.entry.job),id:'saved-'+i,model:'Qwen-'+i,updatedAt:'2026-11-'+String(12-i).padStart(2,'0')+'T00:01:00Z',persistence:{status:'saved',savedAt:'2026-11-'+String(12-i).padStart(2,'0')+'T00:01:00Z'}}));const {CandidateAiDialog}=component('components/analyst/candidate-ai-analysis.tsx');const html=renderToStaticMarkup(React.createElement(CandidateAiDialog,{target:f.entry.target,title:'후보23',entry:f.entry,onClose(){},onStart(){},onCancel(){}}));assert.match(html,/>프롬프트 수정<\/button>/);assert.match(html,/>전송<\/button>/);assert.match(html,/AI 입력·응답/);assert.equal((html.match(/data-saved-analysis=/g)||[]).length,3);assert.match(html,/data-saved-analysis="saved-0"/);assert.match(html,/data-saved-analysis="saved-2"/);assert.doesNotMatch(html,/data-saved-analysis="saved-3"/);assert.match(html,/38507_77751/);});

test('a running analysis keeps the previous saved report readable',()=>{const f=fixture(),saved=structuredClone(f.entry.job);saved.id='prior-report';f.entry.history=[saved];f.entry.job={...f.entry.job,id:'running-now',status:'analyzing',report:undefined};f.entry.pending=true;const {CandidateAiDialog}=component('components/analyst/candidate-ai-analysis.tsx');const html=renderToStaticMarkup(React.createElement(CandidateAiDialog,{target:f.entry.target,title:'후보23',entry:f.entry,onClose(){},onStart(){},onCancel(){}}));assert.match(html,/새 분석 진행 중/);assert.match(html,/이전 결과/);assert.match(html,/data-displayed-analysis="prior-report"/);assert.match(html,/원본 분포를 바탕으로 AI가 선택한 특정 POT 음영/);});

test('a bounded corrective attempt is visible while prior analysis remains readable',()=>{const f=fixture();f.entry.history=[structuredClone(f.entry.job)];f.entry.job={...f.entry.job,status:'analyzing',report:undefined,attempt:{attempt:2,status:'retrying'}};f.entry.pending=true;const {CandidateAiDialog}=component('components/analyst/candidate-ai-analysis.tsx');const html=renderToStaticMarkup(React.createElement(CandidateAiDialog,{target:f.entry.target,title:'후보23',entry:f.entry,onClose(){},onStart(){},onCancel(){}}));assert.match(html,/Qwen 응답 교정 중 · 2차/);});

test('independent review labels agreement, extra and missing targets without impersonating model findings',()=>{const f=fixture();const source=f.entry.job.evidence.analysisTargets[0];f.entry.job.evidence.analysisTargets.push({...structuredClone(source),id:'SERVER_ONLY',title:'POT server-only',evidenceIds:['E03'],mapPoints:[{...source.mapPoints[0],pot:'server-only'}]});f.entry.job.evidence.independentReview={schemaVersion:'candidate-independent-review-v1',label:'근거 규칙 검토',method:'원본 분포와 종료 문자열 대조',reviewed:{mdtTargets:2,terminationTargets:1,radioTargets:0,prioritizedTargets:3,zeroTailTargets:1,sparseTargets:0},priorities:[{id:'review-coverage',category:'coverage',targetIds:['TG_MDT','SERVER_ONLY'],evidenceIds:['E01','E03'],title:'양의 저신호 꼬리 POT 2곳',observation:'동일 날짜 대역의 저신호 분포',nextCheck:'해당 구간 재측정',limitations:['통화 발생 시점과 MDT 날짜 불일치'],assessment:'possible'}],limitations:['대상 일치만 비교하며 원인 확정이 아닙니다.']};const html=renderReview(f);assert.match(html,/근거 규칙 검토/);assert.match(html,/Qwen과 일치/);assert.match(html,/Qwen 추가/);assert.match(html,/Qwen 미선정/);assert.match(html,/data-review-target="SERVER_ONLY"/);assert.match(html,/server-only/);assert.match(html,/통화 발생 시점과 MDT 날짜 불일치/);assert.doesNotMatch(html,/data-cause-category=/);assert.equal((render(f).match(/data-cause-category=/g)||[]).length,2);});

test('selected coverage shows every ranked POT and interruption shows exact original evidence and uncertainty',()=>{const f=fixture(),source=f.entry.job.evidence.analysisTargets[0];f.entry.job.evidence.analysisTargets.push({...structuredClone(source),id:'SECOND_POT',title:'POT second',evidenceIds:['E03'],mapPoints:[{...source.mapPoints[0],pot:'second'}]});f.entry.job.report.hypotheses[0].targetIds.push('SECOND_POT');f.entry.job.report.hypotheses[0].supportingEvidenceIds.push('E03');const html=render(f);assert.match(html,/aria-label="Qwen 선정 POT 우선순위"/);assert.match(html,/data-ranked-target="TG_MDT"/);assert.match(html,/data-ranked-target="SECOND_POT"/);assert.match(html,/48.51/);f.entry.job.report.hypotheses=f.entry.job.report.hypotheses.slice(1);f.entry.job.report.sop=f.entry.job.report.sop.slice(1);f.entry.job.report.investigations=f.entry.job.report.investigations.slice(1);f.entry.job.evidence.analysisTargets[1].metrics.push({label:'fcRaw',value:'9563'},{label:'byeReasonRaw',value:'102^RTP timeout'},{label:'reasonRaw',value:'H : Drop/V : Rx_RTP_middle_Loss'});const term=render(f);assert.match(term,/102\^RTP timeout/);assert.match(term,/Rx_RTP_middle_Loss/);assert.match(term,/먼저 중단된 방향/);assert.match(term,/FC 9563 공식 코드 정의 미확보/);});

test('pending or failed Qwen is not labelled as having missed independent review priorities',()=>{for(const status of ['analyzing','failed']){const f=fixture();f.entry.job.status=status;f.entry.job.evidence.independentReview={schemaVersion:'candidate-independent-review-v1',label:'근거 규칙 검토',method:'독립 근거 검토',reviewed:{mdtTargets:1,terminationTargets:0,radioTargets:0,prioritizedTargets:1,zeroTailTargets:0,sparseTargets:0},priorities:[{id:'rule',category:'coverage',assessment:'possible',targetIds:['TG_MDT'],evidenceIds:['E01'],title:'독립 우선 POT',observation:'저신호 관측',nextCheck:'동일 구간 실측',limitations:[]}],limitations:[]};const html=renderReview(f);assert.match(html,/독립 우선 POT/);assert.doesNotMatch(html,/Qwen 미선정/);assert.match(html,status==='analyzing'?/Qwen 해석 대기/:/Qwen 분석 미완료/);}});

test('independent rule drill-down links actual source targets without adding Qwen findings',()=>{const f=fixture();const priority={id:'rule',category:'coverage',assessment:'possible',targetIds:['TG_MDT'],evidenceIds:['E01'],title:'독립 우선 POT',observation:'규칙 저신호 관측',nextCheck:'같은 대역 현장 확인',limitations:['통화 시각 미정합']};f.entry.job.evidence.independentReview={schemaVersion:'candidate-independent-review-v1',label:'근거 규칙 검토',method:'독립 검토',reviewed:{mdtTargets:1,terminationTargets:0,radioTargets:0,prioritizedTargets:1,zeroTailTargets:0,sparseTargets:0},priorities:[priority],limitations:[]};const html=render(f);assert.match(renderReview(f),/data-review-target="TG_MDT"/);assert.match(html,/data-rule-pot-count="1"/);assert.equal((html.match(/data-cause-category=/g)||[]).length,2);const {CandidateRuleTargetAnalysis}=component('components/analyst/candidate-pot-workspace.tsx');const ruleHtml=renderToStaticMarkup(React.createElement(CandidateRuleTargetAnalysis,{priority,target:f.entry.job.evidence.analysisTargets[0],targets:[f.entry.job.evidence.analysisTargets[0]],sourceLabel:'근거 규칙 검토 · Qwen 미선정',templates:[],onSelect(){}}));assert.match(ruleHtml,/근거 규칙 검토 · Qwen 미선정/);assert.match(ruleHtml,/규칙 저신호 관측/);assert.match(ruleHtml,/같은 대역 현장 확인/);assert.match(ruleHtml,/통화 시각 미정합/);assert.deepEqual([...ruleHtml.matchAll(/data-rule-stage="(\d)"/g)].map(m=>m[1]),['1','2','3']);assert.doesNotMatch(ruleHtml,/data-pot-stage=|data-cause-category=/);});

test('historical condition mismatch keeps the original validated Qwen report readable with a clear notice',()=>{const f=fixture();f.entry.job.currentConditionsMatch=false;const html=render(f);assert.match(html,/원본 분포를 바탕으로 AI가 선택한 특정 POT 음영/);assert.match(html,/data-selected-pot="38507_77751"/);const {CandidateAiDialog}=component('components/analyst/candidate-ai-analysis.tsx');f.entry.history=[f.entry.job];const dialog=renderToStaticMarkup(React.createElement(CandidateAiDialog,{target:f.entry.target,title:'후보23',entry:f.entry,onClose(){},onStart(){},onCancel(){}}));assert.match(dialog,/저장 당시 결과/);assert.match(dialog,/현재 원본·설정과 다름/);assert.match(dialog,/재분석 필요/);});

test('saved findings remain readable without a current map context or source artifact',()=>{const f=fixture();f.entry.job.currentConditionsMatch=false;const ui=component('components/analyst/candidate-pot-workspace.tsx');const html=renderToStaticMarkup(React.createElement(ui.PotInvestigationContent,{context:null,entry:f.entry,contextError:'현재 원본 자료가 없습니다.'}));assert.match(html,/원본 분포를 바탕으로 AI가 선택한 특정 POT 음영/);assert.match(html,/data-selected-pot="38507_77751"/);assert.match(html,/현재 원본 자료가 없습니다/);assert.match(html,/지도 근거 사용 불가/);assert.doesNotMatch(html,/data-candidate-pot-map=/);assert.deepEqual([...html.matchAll(/data-pot-stage="(\d)"/g)].map(m=>m[1]),['1','2','3']);const initial=renderToStaticMarkup(React.createElement(ui.CandidatePotWorkspace,{target:f.entry.target,entry:f.entry}));assert.match(initial,/원본 분포를 바탕으로 AI가 선택한 특정 POT 음영/);});

test('opening a report before passive effects cannot lose the history request or start inference',async()=>{const f=fixture(),effects=[],emissions=[],requests=[],priorFetch=global.fetch;const react={...React,useState:initial=>[initial,value=>{if(value instanceof Map)emissions.push(value);}],useRef:initial=>({current:initial}),useEffect:effect=>effects.push(effect),useCallback:callback=>callback};let cleanup;global.fetch=async(url,init)=>{requests.push({url,method:init?.method});assert.match(url,/candidate-history$/);return new Response(JSON.stringify({target:f.entry.target,jobs:[f.entry.job],limit:3}),{status:200,headers:{'Content-Type':'application/json'}});};try{const hook=component('components/analyst/candidate-ai-analysis.tsx',{react}).useCandidateAiAnalysis();hook.open(f.entry.target,'초기 클릭');hook.start(f.entry.target);await new Promise(resolve=>setImmediate(resolve));assert.equal(requests.length,1,'An early click must request saved history before effects run');assert(emissions.some(map=>[...map.values()].some(entry=>entry.job?.id===f.entry.job.id)),'Saved report must reach the hook state');cleanup=effects[0]();hook.start(f.entry.target);await new Promise(resolve=>setImmediate(resolve));assert.equal(requests.length,1,'Mount effect must retain the event-created manager and loaded report');}finally{cleanup?.();global.fetch=priorFetch;}});

test('the selected-target detail starts closed and retains the three Qwen-selected POTs',()=>{const f=fixture(),source=f.entry.job.evidence.analysisTargets[0],hypothesis=f.entry.job.report.hypotheses[0];for(let i=1;i<3;i++){const id='MORE_'+i,evidenceId='EXTRA_'+i;f.entry.job.evidence.analysisTargets.push({...structuredClone(source),id,evidenceIds:[evidenceId],mapPoints:[{...source.mapPoints[0],pot:'extra-pot-'+i}]});hypothesis.targetIds.push(id);hypothesis.supportingEvidenceIds.push(evidenceId);}f.entry.job.evidence.independentReview={schemaVersion:'candidate-independent-review-v1',label:'근거 규칙 검토',method:'독립 검토',reviewed:{mdtTargets:3,terminationTargets:0,radioTargets:0,prioritizedTargets:3,zeroTailTargets:0,sparseTargets:0},priorities:[{id:'rule',category:'coverage',assessment:'possible',targetIds:hypothesis.targetIds,evidenceIds:hypothesis.supportingEvidenceIds,title:'독립 우선 POT',observation:'저신호 관측',nextCheck:'현장 확인',limitations:[]}],limitations:[]};const html=render(f);const detail=html.match(/<details[^>]*data-summary-detail="selected-target"[^>]*>/);assert(detail);assert.doesNotMatch(detail[0],/\bopen(?:=|\s|>)/);for(const id of hypothesis.targetIds)assert(html.includes('data-ranked-target="'+id+'"'));assert.equal((html.match(/data-ranked-target=/g)||[]).length,3);});

function addFailureRule(f){
 f.entry.job.evidence.independentReview={schemaVersion:'candidate-independent-review-v1',label:'근거 규칙 검토',method:'원본 분포에 따른 독립 검토',reviewed:{mdtTargets:1,terminationTargets:0,radioTargets:0,prioritizedTargets:1,zeroTailTargets:0,sparseTargets:0},priorities:[{id:'rule-first',category:'coverage',assessment:'possible',targetIds:['unknown-target','TG_MDT'],evidenceIds:['E01'],title:'원본 저신호 분포 확인',observation:'RSRP 저신호 꼬리가 원본에 관측됨',nextCheck:'해당 대역의 동일 구간 현장 실측',limitations:['통화 저하 순간과 MDT 시각 미정합']}],limitations:[]};
 return f;
}

test('failed Qwen automatically opens the first available independent rule target without creating a finding',()=>{
 const f=addFailureRule(fixture());f.entry.job.status='failed';delete f.entry.job.report;
 f.entry.job.error={code:'QWEN_REPORT_INVALID',message:'hypotheses[0].sopIds: 대상과 연결된 절차가 필요합니다.'};
 const html=render(f);
 assert.match(html,/data-ai-finding-count="0"/);assert.match(html,/data-analysis-source="rules"/);
 assert.match(html,/data-rule-target-analysis="TG_MDT"/);assert.match(html,/data-selected-target="TG_MDT"/);assert.match(html,/data-selected-pot="38507_77751"/);
 assert.deepEqual([...html.matchAll(/data-rule-stage="(\d)"/g)].map(m=>m[1]),['1','2','3']);
 assert.match(html,/근거 규칙 검토 · Qwen 검증 보류/);assert.match(html,/해당 대역의 동일 구간 현장 실측/);
 assert.match(html,/QWEN_REPORT_INVALID/);assert.match(html,/hypotheses\[0\]\.sopIds: 대상과 연결된 절차가 필요합니다\./);
 assert.match(html,/Qwen 분석 실패/);assert.match(html,/관측 규칙 · 원인 미확정/);
 assert.doesNotMatch(html,/data-pot-stage=|data-cause-category=|Qwen과 일치|Qwen 미선정/);
 assert.equal(f.entry.job.status,'failed');assert.equal(f.entry.job.report,undefined);
});

test('automatic rule inspection is limited to failed jobs and never replaces a pending or completed empty result',()=>{
 for(const status of ['analyzing','queued','completed']){
  const f=addFailureRule(fixture());f.entry.job.status=status;
  if(status==='completed'){f.entry.job.report.hypotheses=[];f.entry.job.report.sop=[];f.entry.job.report.investigations=[];}else{delete f.entry.job.report;f.entry.pending=true;}
  const html=render(f);assert.match(html,/data-ai-finding-count="0"/);assert.match(html,/data-analysis-source="qwen"/);
  assert.match(html,/data-selected-target=""/);assert.doesNotMatch(html,/data-rule-target-analysis=|data-rule-stage=|Qwen 검증 보류/);
 }
 const f=addFailureRule(fixture());f.entry.job.status='failed';delete f.entry.job.report;f.entry.pending=true;
 assert.doesNotMatch(render(f),/data-rule-target-analysis=/,'A new pending request must not trigger failure fallback');
});

test('failed analysis without a resolvable independent target keeps its real error visible',()=>{
 const f=addFailureRule(fixture());f.entry.job.status='failed';delete f.entry.job.report;
 f.entry.job.evidence.independentReview.priorities[0].targetIds=['missing-target'];
 f.entry.job.error={code:'QWEN_EMPTY_RESPONSE',message:'모델에서 빈 응답을 반환했습니다.'};
 const html=render(f);assert.match(html,/QWEN_EMPTY_RESPONSE/);assert.match(html,/모델에서 빈 응답을 반환했습니다\./);
 assert.match(html,/data-selected-target=""/);assert.doesNotMatch(html,/data-rule-target-analysis=|data-rule-stage=|data-pot-stage=/);
});

test('compacted evidence discloses full review and retained detail counts only in the report evidence section',()=>{
 const f=fixture();f.entry.job.evidence.publicCoverage={schemaVersion:'candidate-public-coverage-v1',policy:'sent-priority-report-v1',reviewedTargets:9554,detailedTargets:530,omittedTargets:9024,modelSentTargets:80,totalFacts:10000,detailedFacts:600,totalNeighbourLinks:12000,detailedNeighbourLinks:300,radioSeriesIncluded:false};
 const {CandidateAiDialog}=component('components/analyst/candidate-ai-analysis.tsx');
 const renderDialog=()=>renderToStaticMarkup(React.createElement(CandidateAiDialog,{target:f.entry.target,title:'후보',entry:f.entry,onClose(){},onStart(){},onCancel(){}}));
 const html=renderDialog(),evidenceStart=html.indexOf('상세 근거·전체 구성 통화·원본 보기'),notice=html.indexOf('aria-label="상세 근거 표시 범위"');
 assert(notice>evidenceStart,'Disclosure belongs inside the existing report evidence section');
 assert.match(html,/전체 조사 대상 9,554개는 서버에서 검토했으며, Qwen에는 80개를 전송했습니다\./);
 assert.match(html,/530개 대상의 상세 근거/);assert.match(html,/나머지 9,024개의 상세 근거는 생략합니다\./);
 assert.doesNotMatch(render(f),/상세 근거 표시 범위|9,554개는 서버/,'Main investigation workspace stays uncluttered');
 f.entry.job.evidence.publicCoverage.omittedTargets=0;assert.doesNotMatch(renderDialog(),/aria-label="상세 근거 표시 범위"/);
 delete f.entry.job.evidence.publicCoverage;assert.doesNotMatch(renderDialog(),/aria-label="상세 근거 표시 범위"/);
});

function investigationReviewFixture(){
 const f=fixture(),source=f.entry.job.evidence.analysisTargets[0];
 const targets=[source];for(let i=1;i<5;i++)targets.push({...structuredClone(source),id:'INV_'+i,evidenceIds:['INV_FACT_'+i],mapPoints:[{...source.mapPoints[0],pot:'overlap-pot-'+i}]});
 f.entry.job.evidence.analysisTargets=targets;
 f.entry.job.report.hypotheses=[];f.entry.job.report.sop=[];
 f.entry.job.report.investigations=[{title:'실제 다섯 POT 조사',reason:'연결된 원본 분포를 대조합니다.',nextCheck:'동일 대역의 다섯 POT를 실측합니다.',targetIds:targets.map(target=>target.id),evidenceIds:targets.flatMap(target=>target.evidenceIds)}];
 f.entry.job.evidence.independentReview={schemaVersion:'candidate-independent-review-v1',label:'근거 규칙 검토',method:'원본 독립 검토',reviewed:{mdtTargets:5,terminationTargets:0,radioTargets:0,prioritizedTargets:5,zeroTailTargets:0,sparseTargets:0},priorities:[{id:'review-five',category:'coverage',assessment:'possible',title:'원본 다섯 POT',observation:'실제 RSRP 분포',targetIds:targets.map(target=>target.id),evidenceIds:targets.flatMap(target=>target.evidenceIds),nextCheck:'동일 구간 실측',limitations:[]}],limitations:[]};
 return f;
}
function renderReview(f){const {CandidateIndependentReview}=component('components/analyst/candidate-pot-workspace.tsx');return renderToStaticMarkup(React.createElement(CandidateIndependentReview,{entry:f.entry}));}
test('five source-linked investigation POTs overlap rules without being counted as missed causes',()=>{
 const f=investigationReviewFixture(),html=renderReview(f);
 assert.match(html,/data-review-comparison="investigations"/);assert.match(html,/조사 대상 겹침 5/);assert.match(html,/AI에만 0/);assert.match(html,/규칙에만 0/);
 assert.match(html,/대상 ID의 중복만 비교/);assert.doesNotMatch(html,/Qwen 미선정|동일 원인 분류와 대상의 중복/);assert.equal(f.entry.job.report.hypotheses.length,0);
});
test('investigation overlap uses unique exact targets without inferring a rule cause category',()=>{
 const f=investigationReviewFixture();f.entry.job.evidence.independentReview.priorities[0].category='equipment';f.entry.job.evidence.independentReview.priorities.push(structuredClone(f.entry.job.evidence.independentReview.priorities[0]));
 const html=renderReview(f);assert.match(html,/조사 대상 겹침 5/);assert.match(html,/AI에만 0/);assert.match(html,/규칙에만 0/);assert.doesNotMatch(html,/Qwen 미선정/);
});
test('investigation comparison keeps AI-only and rule-only source targets separate',()=>{
 const f=investigationReviewFixture(),source=f.entry.job.evidence.analysisTargets[0];
 for(const id of ['AI_ONLY','RULE_ONLY'])f.entry.job.evidence.analysisTargets.push({...structuredClone(source),id,evidenceIds:[id+'_FACT'],mapPoints:[{...source.mapPoints[0],pot:id.toLowerCase()}]});
 f.entry.job.report.investigations.push({title:'AI 추가 조사',reason:'추가 원본 분포를 대조합니다.',nextCheck:'원본을 확인합니다.',targetIds:['AI_ONLY'],evidenceIds:['AI_ONLY_FACT']});
 f.entry.job.evidence.independentReview.priorities[0].targetIds.push('RULE_ONLY');
 const html=renderReview(f);assert.match(html,/조사 대상 겹침 5/);assert.match(html,/AI에만 1/);assert.match(html,/규칙에만 1/);assert.match(html,/ai_only/);assert.match(html,/rule_only/);
});
test('readable historical cause results retain category-and-target comparison independent of reuse version',()=>{
 const f=fixture();f.entry.job.evidence.versions.prompt='candidate-prompt-v6';f.entry.job.currentConditionsMatch=false;
 f.entry.job.evidence.independentReview={schemaVersion:'candidate-independent-review-v1',label:'근거 규칙 검토',method:'독립 검토',reviewed:{mdtTargets:1,terminationTargets:0,radioTargets:0,prioritizedTargets:1,zeroTailTargets:0,sparseTargets:0},priorities:[{id:'rule',category:'coverage',assessment:'possible',targetIds:['TG_MDT'],evidenceIds:['E01'],title:'원본 POT',observation:'분포',nextCheck:'실측',limitations:[]}],limitations:[]};
 const html=renderReview(f);assert.match(html,/data-review-comparison="causes"/);assert.match(html,/Qwen과 일치 1/);assert.match(html,/Qwen 추가 1/);assert.match(html,/동일 원인 분류와 대상의 중복/);assert.doesNotMatch(html,/Qwen 분석 미완료|조사 대상 겹침/);
});
test('unlinked or unsupported saved formats label comparison unavailable instead of analysis unfinished',()=>{
 for(const alter of [f=>{f.entry.job.evidence.versions.prompt='candidate-prompt-v2';},f=>{f.entry.job.report.investigations[0].targetIds=['foreign'];}]){
  const f=investigationReviewFixture();alter(f);const html=renderReview(f);assert.match(html,/비교 불가/);assert.match(html,/대상 연결 미확인/);assert.doesNotMatch(html,/Qwen 분석 미완료|조사 대상 겹침 5/);
 }
});
test('selected rule uses investigation overlap label rather than claiming AI did not select it',()=>{
 const f=investigationReviewFixture(),react={...React,useState:initial=>[initial===null?'review-five:TG_MDT':typeof initial==='function'?initial():initial,()=>{}]};
 const html=renderToStaticMarkup(React.createElement(component('components/analyst/candidate-pot-workspace.tsx',{react}).PotInvestigationContent,{context:null,entry:f.entry}));
 assert.match(html,/근거 규칙 검토 · AI 조사 대상과 겹침/);assert.doesNotMatch(html,/근거 규칙 검토 · Qwen 미선정/);
});
test('quality and repeated-call targets have distinct source labels',()=>{
 const f=investigationReviewFixture(),targets=f.entry.job.evidence.analysisTargets;targets[0].kind='call-quality';targets[0].mapPoints=[];targets[1].kind='call-pattern';targets[1].mapPoints=[];
 const html=renderReview(f);assert.match(html,/통화 품질·RTP 관측 · POT 미연결/);assert.match(html,/반복 관측 통화 · POT 미연결/);
});





