/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=name=>fs.readFileSync('components/analyst/voice-improvement-1/'+name,'utf8');
const path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {renderToStaticMarkup}=require('react-dom/server');
const React=require('react');
function loadUi(file){
 file=path.resolve(file);
 if(file.endsWith('.css'))return {};
 if(!path.extname(file))file+=fs.existsSync(file+'.tsx')?'.tsx':'.ts';
 const mod={exports:{}};
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 vm.runInThisContext('(function(require,module,exports){'+js+'\n})',{filename:file})(id=>id.startsWith('.')?loadUi(path.resolve(path.dirname(file),id)):require(id),mod,mod.exports);
 return mod.exports;
}

test('independent route restores URL scope and blocks stale results',()=>{
 assert(fs.readFileSync('app/overview-improvement-1/page.tsx','utf8').includes('redirect('));
 const ui=read('workspace.tsx');
 for(const key of ['popstate','AbortController','loadImprovementReport','compareRevision','active="improvement1"','legacyHref','metric','hour','customer'])assert(ui.includes(key),key);
 assert(ui.includes('sourceRevision'));
});
test('coverage presents real branched unique-call denominators and missing rates',()=>{
 const ui=read('coverage-panel.tsx');
 for(const key of ['전체 CDR','유효 QoE','MDT 연결','GPS','검토 통과 삼각 측량','위치 활용 가능','분모','저QoE','산출 불가'])assert(ui.includes(key),key);
 assert(ui.includes('branchGNSS'));assert(ui.includes('strictRadio'));
});
test('map loads Leaflet in browser and separates point evidence and investigation range',()=>{
 const ui=read('candidate-map.tsx');
 assert(ui.includes("import('leaflet')"));
 for(const key of ['nearbyPoints','reviewed-radio','displayRadiusM','discovery-member','validation-new','scrollWheelZoom:true','현장 확인'])assert(ui.includes(key),key);
 assert(!ui.includes('MOS 저하 위치 확정'));
});
test('candidate context includes selection reasons, comparison and complete customer calls',()=>{
 const candidate=read('candidate-panel.tsx'),customer=read('customer-panel.tsx'),field=read('field-panel.tsx');
 for(const key of ['rank','poorDateCount','maxPairDistanceM','재관측','규칙 기반'])assert(candidate.includes(key),key);
 for(const key of ['candidateCustomerCalls','buildCustomerExperience','선택 기간 전체 통화','sipReasonLabel','원본 상세'])assert(customer.includes(key),key);
 for(const key of ['현장 자료 미확보','SCAN','비교 조건 미충족'])assert(field.includes(key),key);
 assert(read('comparison-panel.tsx').includes('현행 후보 산정 방식'));
});

test('rendered coverage shows exact unique-call counts and zero denominator as unavailable',()=>{
 const {CoveragePanel}=loadUi('components/analyst/voice-improvement-1/coverage-panel.tsx');
 const coverage={N:100,M:80,D:60,G:20,T:0,U:20,poor:{N:7,M:7,D:3,G:2,T:0,U:2},mdtAmbiguous:4,mdtUnknown:0,excludedReasons:{},ratios:{},poorRatios:{}};
 const html=renderToStaticMarkup(React.createElement(CoveragePanel,{coverage}));
 assert(html.includes('100'));assert(html.includes('80.0%'));assert(html.includes('33.3%'));assert(html.includes('20.0%'));
 const zero=Object.fromEntries(['N','M','D','G','T','U'].map(k=>[k,0]));
 const empty=renderToStaticMarkup(React.createElement(CoveragePanel,{coverage:{...coverage,...zero}}));
 assert(empty.includes('산출 불가'));assert(!empty.includes('NaN'));assert(!empty.includes('Infinity'));
});

test('rendered customer detail retains normal and unevaluated calls outside candidate membership',()=>{
 const {CustomerPanel}=loadUi('components/analyst/voice-improvement-1/customer-panel.tsx');
 const base={date:'2026-10-26',customerId:'c1',sourceRevision:'rev',sourceFile:'day.json',mdtLinkStatus:'unique'};
 const calls=[{...base,callId:'26:p',rawCallId:'p',startedAt:'2026-10-26T09:00:00+09:00',mos:2},{...base,callId:'26:n',rawCallId:'n',startedAt:'2026-10-26T10:00:00+09:00',mos:4},{...base,callId:'26:u',rawCallId:'u',startedAt:'2026-10-26T11:00:00+09:00',mos:null}];
 const candidate={id:'s1',memberCallIds:['26:p'],nearbyPoints:[]};
 const props={calls,candidate,availableDates:['2026-10-26'],customerId:null,hour:null,onCustomer:()=>{},onHour:()=>{}};
 const html=renderToStaticMarkup(React.createElement(CustomerPanel,props));
 assert(html.includes('4.00'));assert(html.includes('未評価')===false);assert(html.includes('미평가'));
 assert.equal((html.match(/발견 구성원/g)||[]).length,1);
 assert.equal((html.match(/기간 내 기타 통화/g)||[]).length,2);
 const missing=renderToStaticMarkup(React.createElement(CustomerPanel,{...props,customerId:'unknown'}));
 assert(missing.includes('관련 고객 목록에 없습니다'));assert(!missing.includes('4.00'));
});

test('one-day screening keeps adopted observations visible without promoting candidates',()=>{
 const {mapEvidencePoints}=loadUi('components/analyst/voice-improvement-1/map-evidence.ts');
 const point={callId:'d:c',customerId:'customer',date:'2026-10-26',kind:'gnss',lat:37.5,lon:127.1,mos:2};
 const report={improvedSpatialCandidates:[],diagnostics:{observationPoints:[point]},calls:[{...point}],decisions:[{...point,status:'accepted'}]};
 const layers=mapEvidencePoints(report,undefined);
 assert.equal(layers.observationPoints.length,1);
 assert.equal(layers.nearbyPoints.length,0);
 assert.equal(report.improvedSpatialCandidates.length,0);
 const candidate={nearbyPoints:[{...point,role:'discovery-member'}]};
 const selected=mapEvidencePoints({...report,improvedSpatialCandidates:[candidate]},candidate);
 assert.equal(selected.observationPoints.length,0);
 assert.equal(selected.nearbyPoints.length,1);
 const map=read('candidate-map.tsx');
 assert(map.includes('observationPoints'));
 assert(map.includes('coords.push(p)'));
 assert(map.includes('반복 지역 후보로 선정되지 않았습니다'));
});

test('active improvement tab preserves normalized comparison conditions',()=>{
 assert(read('workspace.tsx').includes('improvementHref={scope?improvementComparisonHref(scope):undefined}'));
});
