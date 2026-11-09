/* eslint-disable @typescript-eslint/no-require-imports -- Node UI test harness. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
function load(file){file=path.resolve(file);if(file.endsWith('.css'))return {};if(!path.extname(file))file+=fs.existsSync(file+'.tsx')?'.tsx':'.ts';if(file.endsWith('improvement-candidate-map.tsx'))return {ImprovementCandidateMap:()=>React.createElement('div',{'data-testid':'candidate-map'})};const m={exports:{}};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;vm.runInThisContext('(function(require,module,exports){'+code+'\n})',{filename:file})(id=>id.startsWith('.')?load(path.resolve(path.dirname(file),id)):require(id),m,m.exports);return m.exports;}
test('original and improved candidate modes use identical shared layout and detailed sections',()=>{
 const {CandidateWorkspaceView}=load('components/analyst/improvement-candidates.tsx');assert.equal(typeof CandidateWorkspaceView,'function');
 const original=fs.readFileSync('components/analyst/improvement-candidates.tsx','utf8'),improved=fs.readFileSync('components/analyst/quality-improvement-candidate-panel.tsx','utf8');assert(original.includes('<CandidateWorkspaceView'));assert(improved.includes('<CandidateWorkspaceView'));
 const report=JSON.parse(fs.readFileSync('public/improvement-candidates/2026-10-26_2026-10-30.json','utf8'));
 const html=renderToStaticMarkup(React.createElement(CandidateWorkspaceView,{report,selectedId:report.candidates[0].id,filter:'all',onFilter:()=>{},onSelect:()=>{}}));
 for(const label of ['저품질 체감 고객','QoE 저하고객 중복 위치','반복 불량 Cell','개선 후보 종류','선택 개선 후보 상세 근거','Drop (SIP 11.REASON)','대표 통화 MDT','관련 종료 Cell','관련 원본 통화','원인 가설 및 검증 한계','현장 점검 항목'])assert(html.includes(label),label);
});
test('improved detail keeps raw call links and derives Drop without inventing missing RF',()=>{
 const {buildQualityPresentationCandidates}=load('lib/analyst/quality-candidate-presentation.ts');
 const summary={candidates:[{id:'x',label:'후보',medoid:{lat:37.5,lon:127},poorCustomerCount:1,poorCallCount:1,poorDateCount:1,displayRadiusM:100,validationNewCustomers:0}],discoveryDates:['2026-10-26'],validationDates:[]};
 const c={date:'2026-10-26',callId:'2026-10-26:customer:call-raw',rawCallId:'call-raw',customerId:'customer',mos:2,sipReason:'H: Drop',start:'09:00:00',endCellId:'42'};
 const detail={candidate:{id:'x',memberCallIds:[c.callId],nearbyPoints:[{...c,kind:'gnss',lat:37.5,lon:127,role:'discovery-member'}]},calls:[c]};const result=buildQualityPresentationCandidates(summary,detail)[0];assert.equal(result.discovery.dropCalls,1);assert.equal(result.representativeCalls[0].callId,'customer:call-raw');assert.equal(result.radioReference.rsrpMedianDbm,null);assert.equal(result.normalReference.distinctCustomers,null);
});
