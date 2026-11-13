/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {load}=require('../analyst-ts-loader.cjs');
function component(file){
  const mod={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,
  }}).outputText;
  vm.runInThisContext('(function(require,module,exports){'+code+'\n})',{filename:file})(id=>{
    if(id.endsWith('.module.css'))return {default:new Proxy({},{get:(_,key)=>String(key)})};
    if(!id.startsWith('.'))return require(id);
    const resolved=path.resolve(path.dirname(file),id);
    return fs.existsSync(resolved+'.tsx')?component(resolved+'.tsx'):load(resolved);
  },mod,mod.exports);
  return mod.exports;
}
const scope={dateStart:'2026-10-26',dateEnd:'2026-10-27',from:'00:00',to:'23:59'};
const call=(id,date,startSecond,qoe,drop=false)=>({id,rawCallId:'raw /'+id,date,start:'09:00:00',startSecond,qoe,drop,cell:'3470857',location:null});
const calls=[call('a',scope.dateStart,32400,4),call('b',scope.dateStart,32500,-2.2,true),
  call('null',scope.dateStart,32600,null,true),call('c',scope.dateStart,32700,0),
  call('d',scope.dateEnd,32400,3),call('e',scope.dateEnd,32400,4)];
const chart=props=>renderToStaticMarkup(React.createElement(component('components/analyst/customer-qoe-timeline.tsx').CustomerQoeTimelineChart,
  {calls,customerId:'opaque:customer',scope,...props}));

test('chart conserves scored and unscored observations, negative QoE and threshold',()=>{
  const html=chart({selectedCallId:'b'});
  assert.equal((html.match(/data-call-id=/g)||[]).length,6);
  assert.equal((html.match(/data-unscored="true"/g)||[]).length,1);
  assert.equal((html.match(/data-drop="true"/g)||[]).length,2);
  assert.match(html,/data-threshold="3"/);
  assert.match(html,/저품질 기준 3\.0/);
  assert.match(html,/data-poor-region="true"/);
  assert.match(html,/QoE -2\.20/);
  assert.match(html,/QoE 미평가/);
  assert.match(html,/BYE Cell/);
  assert.match(html,/href="\/qoe\/\?source=MDT&amp;view=contract&amp;date=2026-10-26&amp;customer=opaque%3Acustomer&amp;call=raw\+%2Fb"/);
  assert.doesNotMatch(html,/NaN|Infinity|[CQ] \d/);
  assert.deepEqual([...html.matchAll(/data-axis-score="([^"]+)"/g)].map(match=>Number(match[1])),[5,4,3,2,1]);
  assert.match(html,/data-out-of-range="below"/);
  assert.match(html,/표시 범위 밖 · 1 미만/);
});

test('geometry breaks connectors at null values and midnight, preserving duplicate starts',()=>{
  const {buildCustomerQoeChart}=load('lib/analyst/customer-qoe-chart.ts');
  const chart=buildCustomerQoeChart(calls,{scope,mode:'all'});
  assert.equal(chart.points.length,6);
  assert.equal(chart.min,1);
  assert.equal(chart.max,5);
  assert.deepEqual(chart.segments.map(segment=>segment.map(point=>point.call.id)),[['a','b'],['d','e']]);
  const [a,b,unscored,c,d,e]=chart.points;
  assert.ok(a.y<b.y,'negative score plots below 4');
  assert.equal(c.y,b.y,'zero and negative observations use the lower boundary without changing their original values');
  assert.equal(b.y,chart.bottom);
  assert.equal(b.call.qoe,-2.2);
  assert.equal(c.call.qoe,0);
  assert.ok(unscored.y>chart.bottom,'null belongs in separate strip');
  assert.equal(d.x,e.x,'duplicate starts preserve their shared time coordinate');
  const day=buildCustomerQoeChart(calls,{scope,mode:'day',date:scope.dateEnd});
  assert.deepEqual(day.points.map(point=>point.call.id),['d','e']);
});

test('QoE axis remains exactly 1 to 5 for all-day, single-day and empty views',()=>{
  const {buildCustomerQoeChart}=load('lib/analyst/customer-qoe-chart.ts');
  const extremes=[call('below',scope.dateStart,100,0.999),call('above',scope.dateStart,200,5.001),call('low',scope.dateStart,300,1),call('high',scope.dateStart,400,5)];
  for(const options of [{scope},{scope,mode:'day',date:scope.dateStart},{scope,mode:'day',date:'2026-10-28'}]){
    const result=buildCustomerQoeChart(extremes,options);
    assert.deepEqual([result.min,result.max],[1,5]);
    assert.equal(result.y(1),result.bottom);
    assert.equal(result.y(5),result.top);
    assert.equal(result.y(3),(result.top+result.bottom)/2);
    assert.ok(result.points.every(point=>point.y>=result.top&&point.y<=result.bottom));
  }
  const below=chart({calls:extremes,selectedCallId:'below'});
  assert.match(below,/QoE 0\.999/);
  assert.match(below,/data-out-of-range="below"/);
  assert.match(below,/표시 범위 밖 · 1 미만/);
  const above=chart({calls:extremes,selectedCallId:'above'});
  assert.match(above,/QoE 5\.001/);
  assert.match(above,/data-out-of-range="above"/);
  assert.match(above,/표시 범위 밖 · 5 초과/);
});

test('adjacent calls after timestamp ties never move backward on a five day axis',()=>{
  const {buildCustomerQoeChart}=load('lib/analyst/customer-qoe-chart.ts');
  const tied=[call('first',scope.dateStart,32400,4),call('tie',scope.dateStart,32400,3),call('next',scope.dateStart,32401,2)];
  const result=buildCustomerQoeChart(tied,{scope:{...scope,dateEnd:'2026-10-30'},mode:'all'});
  assert.equal(result.points[0].x,result.points[1].x);
  assert.ok(result.points[1].x<result.points[2].x,'one-second-later call remains to the right of both tied starts');
});

test('more than 1000 calls remain selectable with one tab stop before the detail link',()=>{
  const many=Array.from({length:1105},(_,i)=>call('call-'+i,scope.dateStart,i*30,i%5));
  const html=chart({calls:many});
  assert.equal((html.match(/data-call-id=/g)||[]).length,1105);
  assert.equal((html.match(/tabindex="0"/g)||[]).length,1);
  assert.equal((html.match(/tabindex="-1"/g)||[]).length,1104);
  const selectedHtml=chart({calls:many,selectedCallId:'call-450'});
  const selectedTag=selectedHtml.match(/<g\b[^>]*data-call-id="call-450"[^>]*>/)?.[0];
  assert.match(selectedTag,/tabindex="0"/);
  assert.equal((selectedHtml.match(/tabindex="0"/g)||[]).length,1);
  assert.match(selectedHtml,/call=raw\+%2Fcall-450/);
  assert.match(html,/방향키/);
});

test('pending panel has no stale chart and retains clearable region and controls',()=>{
  const {CustomerQoeTimelinePanel}=component('components/analyst/customer-qoe-timeline.tsx');
  const html=renderToStaticMarkup(React.createElement(CustomerQoeTimelinePanel,{
    customer:{id:'opaque:customer',number:'00012345'},scope,sourceRevision:'r1',dates:[scope.dateStart,scope.dateEnd],
    pending:true,selectedRegion:'개포3동',onClearRegion:()=>{},
  }));
  assert.match(html,/00012345/);assert.match(html,/개포3동/);assert.match(html,/지역 선택 해제/);
  assert.match(html,/<h3>[\s\S]*선택 고객 통화 품질 추이<\/h3>/);
  assert.match(html,/기간 전체/);assert.match(html,/하루 확대/);assert.match(html,/불러오는 중/);
  assert.doesNotMatch(html,/data-call-id=/);
});

test('unselected panel requests customer selection and renders no observations',()=>{
  const {CustomerQoeTimelinePanel}=component('components/analyst/customer-qoe-timeline.tsx');
  const html=renderToStaticMarkup(React.createElement(CustomerQoeTimelinePanel,{customer:null,scope,sourceRevision:'r1',dates:[]}));
  assert.match(html,/고객을 선택/);assert.doesNotMatch(html,/data-call-id=/);
});

test('pending scope shows loading even while the customer list is being replaced',()=>{
  const {CustomerQoeTimelinePanel}=component('components/analyst/customer-qoe-timeline.tsx');
  const html=renderToStaticMarkup(React.createElement(CustomerQoeTimelinePanel,{customer:null,scope,sourceRevision:'r1',dates:[],pending:true}));
  assert.match(html,/불러오는 중/);assert.match(html,/aria-busy="true"/);
  assert.doesNotMatch(html,/목록에서 고객을 선택/);
});
