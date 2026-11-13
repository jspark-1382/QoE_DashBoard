const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {load}=require('../analyst-ts-loader.cjs');
const file='components/analyst/quality-summary-panels.tsx';
function panels(){
  assert.ok(fs.existsSync(file),'small shared summary panels module exists');
  const mod={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,
  }}).outputText;
  vm.runInThisContext('(function(require,module,exports){'+code+'\n})',{filename:file})(id=>
    id.endsWith('.module.css')?{default:{}}:id.startsWith('.')?load(path.resolve(path.dirname(file),id)):require(id),
  mod,mod.exports);
  return mod.exports;
}
test('summary opening imports only the shared presentation module and cannot pull in maps or investigation',()=>{
  const main=fs.readFileSync('components/analyst/server-quality-overview.tsx','utf8');
  assert.match(main,/from '\.\/quality-summary-panels'/);
  assert.doesNotMatch(main,/from '\.\/quality-proposal-four'/);
  assert.ok(fs.existsSync(file),'presentation module exists');
  const source=fs.readFileSync(file,'utf8');
  assert.doesNotMatch(source,/from ['"][^'"]*(?:analyst-map|mos-call-investigation|data-loader|improvement-candidates|leaflet)/);
  const legacy=fs.readFileSync('components/analyst/quality-proposal-four.tsx','utf8');
  assert.match(legacy,/from '\.\/quality-summary-panels'/);
  assert.doesNotMatch(legacy,/function (?:GradeDonut|HourlyChart|ExperiencePanel|PanelHeading|Table)\(/);
});
test('shared grade, hourly and customer cards retain all visible counts and accessible controls',()=>{
  const {QualityGradeDonut,QualityHourlyChart,QualityExperiencePanel}=panels();
  const grades={evaluated:8,unavailable:2,mean:3.2,bands:[
    {id:'poor',label:'불량',range:'3.0 미만',count:2,percentage:25},
    {id:'fair',label:'보통',range:'3.0 이상',count:2,percentage:25},
    {id:'good',label:'양호',range:'3.5 이상',count:4,percentage:50},
  ]};
  const donut=renderToStaticMarkup(React.createElement(QualityGradeDonut,{grades,selected:'poor',onSelect(){},mode:'mos',onModeChange(){}}));
  assert.match(donut,/QoE 분포/);assert.match(donut,/3\.20/);assert.match(donut,/25\.0%/);assert.match(donut,/미평가 2통화 제외/);
  const hourly=Array.from({length:24},(_,hour)=>({hour,total:hour===23?8:0,evaluated:hour===23?8:0,poor:hour===23?2:0,other:hour===23?6:0,mean:hour===23?3.2:null}));
  const chart=renderToStaticMarkup(React.createElement(QualityHourlyChart,{hourly,selected:23,onChoose(){}}));
  assert.equal((chart.match(/aria-pressed=/g)??[]).length,24);
  assert.match(chart,/23시 유효 8건, 저품질 2건, 평균 QoE 3\.20/);
  const analytics={experience:[{id:'affected',count:15,hourly:Array(24).fill(1)},{id:'repeat',count:8,hourly:Array(24).fill(0)},{id:'consecutive',count:3,hourly:Array(24).fill(0)}]};
  const experience=renderToStaticMarkup(React.createElement(QualityExperiencePanel,{analytics,cohort:'repeat',improvement:true,onChoose(){}}));
  for(const label of ['저품질 경험 고객','반복 불량 고객','연속 불량 고객'])assert.match(experience,new RegExp(label));
  assert.match(experience,/15/);assert.match(experience,/고객 유형 필터 적용됨/);
});
test('shared call table preserves full total, exact pinned call, original SIP and source evidence',()=>{
  const {QualityCallTable}=panels();
  const call={id:'opaque:raw',customerId:'opaque',rawCallId:'raw',start:'23:59:59',end:'00:00:01',
    startTimestamp:'2026-10-30T23:59:59+09:00',qoe:2.5,mos:2.5,sipCause:'H: Drop'};
  const html=renderToStaticMarkup(React.createElement(QualityCallTable,{
    calls:[call],totalCount:101,selectedBand:'poor',distributionMode:'mos',regionNames:new Map(),locationByCall:new Map(),details:{},selected:call.id,
    onSelect(){},search:'',setSearch(){},sipFilter:'all',setSipFilter(){},limit:25,onMore(){},onCsv(){},investigation:null,investigationMode:'members',onInvestigationMode(){},onClearInvestigation(){},
  }));
  assert.match(html,/101건/);assert.match(html,/표시 1건/);assert.match(html,/data-call-id="opaque:raw"/);
  assert.match(html,/선택 통화를 목록 최상단에 고정/);assert.match(html,/10-30 23:59:59/);
  assert.match(html,/CSV 내보내기/);assert.match(html,/SIP 상태코드/);assert.match(html,/Drop/);
});

test('reference KPI layout retains both ratio badges, original colors and GPS breakdown',()=>{
  const {QualitySummaryKpis}=panels();
  assert.equal(typeof QualitySummaryKpis,'function');
  const grades={evaluated:130940,unavailable:53292,mean:4.11,bands:[
    {id:'poor',count:1580},{id:'fair',count:2228},{id:'good',count:127132},
  ]};
  const html=renderToStaticMarkup(React.createElement(QualitySummaryKpis,{grades,mapped:{U:237,G:131,T:106},selectedBand:null}));
  assert.match(html,/QoE 대비 1\.2%/);assert.match(html,/저품질 통화 대비 15\.0%/);
  assert.match(html,/GPS 131건 · 삼각 측량 근사 106건/);
  assert.equal((html.match(/style="color:#cb3546"/g)??[]).length,1);
  assert.doesNotMatch(html,/<strong style="color:#(?:328ee3|12ba9f|8f69e4)"/);
  const fair=renderToStaticMarkup(React.createElement(QualitySummaryKpis,{grades,mapped:{U:50,G:40,T:10},selectedBand:'fair'}));
  assert.match(fair,/보통 통화 대비 2\.2%/);
  const empty=renderToStaticMarkup(React.createElement(QualitySummaryKpis,{grades:{...grades,evaluated:0,bands:grades.bands.map(b=>({...b,count:0}))},mapped:{U:0,G:0,T:0},selectedBand:null}));
  assert.doesNotMatch(empty,/NaN|Infinity/);
});
test('reference map heading contains the five controls in their original order',()=>{
  const {QualityMapPanelHeading}=panels();
  assert.equal(typeof QualityMapPanelHeading,'function');
  const html=renderToStaticMarkup(React.createElement(QualityMapPanelHeading,{
    band:null,mode:'mos',evidence:'all',onEvidenceChange(){},stationsVisible:true,stationCount:106,onToggleStations(){},
    toggleButton:React.createElement('button',null,'지도 전체 화면'),
  }));
  assert.match(html,/<h2>저품질 통화 위치<\/h2>/);
  assert.match(html,/lucide-map-pinned/);assert.match(html,/title="GPS 실측과 삼각 측량 근사 조사 위치/);
  const controls=[...html.matchAll(/<button\b[^>]*>(.*?)<\/button>/gs)].map(m=>m[1].replace(/<[^>]*>/g,'').trim());
  assert.deepEqual(controls,['전체','GPS','삼각 측량','기지국 숨기기 · 106곳','지도 전체 화면']);
  assert.match(html,/aria-pressed="true"/);
});
